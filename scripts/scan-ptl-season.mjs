// Season scanner for ProTennisLive — the ATP's own posting system and the
// primary historical source (JeffSackmann's qual_chall CSVs stop before 2022).
//
// Sweeps /posting/{year}/{code}/mds.pdf across a code range, parses each
// working posting's header (name, city/country, dates, surface, category),
// and emits calendar rows. ATP + Challenger only; ITF postings are skipped.
//
//   node scripts/scan-ptl-season.mjs 2022 --emit-rows /tmp/ptl-2022.json
//   node scripts/scan-ptl-season.mjs 2022 --start 400 --end 3000
//
// Defunct tournaments come through like everything else — if it posted an
// entry list, it's in the scan.

const year = Number(process.argv[2]);
if (!Number.isInteger(year) || year < 2020 || year > 2030) {
  console.error('usage: node scripts/scan-ptl-season.mjs <year> [--start N] [--end N] [--emit-rows file]');
  process.exit(1);
}
const argVal = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : dflt;
};
const START = Number(argVal('--start', 1));
const END = Number(argVal('--end', 9999));
const CONCURRENCY = Number(argVal('--concurrency', 12));
const emitPath = argVal('--emit-rows', null);

const HEADERS = {
  'User-Agent': 'TennisCutsSeasonScan/1.0 (+https://tenniscuts.com)',
  Accept: 'application/pdf,*/*;q=0.8',
};

async function probe(url) {
  try {
    let res = await fetch(url, { method: 'HEAD', headers: HEADERS });
    if (res.status === 405) res = await fetch(url, { headers: { ...HEADERS, Range: 'bytes=0-0' } });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

// Positioned-text extraction of page 1 only (headers live there) — same
// row/column rebuild the calendar parser uses.
function rebuildLines(items) {
  const sorted = items.sort((a, b) => b.y - a.y || a.x - b.x);
  const groups = [];
  for (const it of sorted) {
    const g = groups.find((ex) => Math.abs(ex[0].y - it.y) <= 2.5);
    if (g) g.push(it);
    else groups.push([it]);
  }
  const lines = [];
  for (const g of groups) {
    const left = g.filter((i) => i.x < i.pageWidth * 0.52);
    const right = g.filter((i) => i.x >= i.pageWidth * 0.48);
    for (const side of [left, right]) {
      const text = side.sort((a, b) => a.x - b.x).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    }
  }
  return lines;
}

async function firstPageLines(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
  }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .map((it) => {
        const str = typeof it.str === 'string' ? it.str.trim() : '';
        if (!str || !Array.isArray(it.transform) || it.transform.length < 6) return null;
        return { str, x: Number(it.transform[4] ?? 0), y: Number(it.transform[5] ?? 0), pageWidth: viewport.width };
      })
      .filter(Boolean);
    return rebuildLines(items);
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// "22-28 August 2022" | "2 - 7 January 2023" | "31 January - 6 February 2022"
// | "26 December 2022 - 1 January 2023" | "7 July — 13 July 2025" (Challenger
// headers use an em-dash) → { start, end } ISO dates.
function parseDates(text) {
  const halves = text.split(/[-–—]/).map((s) => s.trim());
  if (halves.length < 2) return null;
  const parse = (part, fallback) => {
    const m = part.match(/^(\d{1,2})(?:\s+([A-Za-z]+))?(?:\s+(\d{4}))?$/);
    if (!m) return null;
    const day = Number(m[1]);
    const month = m[2] ? MONTHS[m[2].toLowerCase()] : fallback?.month;
    const yr = m[3] ? Number(m[3]) : fallback?.year;
    if (!day || !month || !yr) return null;
    return { day, month, year: yr };
  };
  const end = parse(halves[halves.length - 1], null);
  if (!end) return null;
  const start = parse(halves[0], end);
  if (!start) return null;
  const iso = (d) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  return { start: iso(start), end: iso(end) };
}

function moneyToNumber(line) {
  const m = line.replace(/[, ]/g, '').match(/(\d{4,})/);
  return m ? Number(m[1]) : null;
}

// Header layouts. Labels sit on their own rows but the layout rebuild often
// merges value pairs onto shared lines ("Rotterdam, Netherlands 7-13 February
// 2022", "Hard € 1,349,070"), so every field is located by pattern anywhere
// in a line rather than by position.
//   Challenger: has a "Challenger NN" CATEGORY value
//   ATP tour:   has TOTAL FINANCIAL COMMITMENT and no Challenger category
//   ITF:        "ITF World Tennis Tour" anywhere → skip
const DATE_RE = /(\d{1,2}(?:\s+[A-Za-z]+)?(?:\s+\d{4})?\s*[-–—]\s*\d{1,2}\s+[A-Za-z]+\s+\d{4})/;

function parseHeader(lines, code) {
  const head = lines.filter(Boolean).slice(0, 18);
  const joined = head.join(' | ');
  if (/ITF World Tennis Tour/i.test(joined)) return { skip: 'itf' };
  if (/Tournament Information Not Yet Available/i.test(joined)) return { skip: 'placeholder' };

  const name = head[0]?.trim();
  if (!name || /^CITY, COUNTRY/i.test(name)) return { skip: 'no-name' };

  let dates = null;
  let cityFromDateLine = null;
  for (const l of head.slice(1)) {
    const m = l.match(DATE_RE);
    if (!m) continue;
    const parsed = parseDates(m[1]);
    if (!parsed) continue;
    dates = parsed;
    const before = l.slice(0, m.index).trim();
    if (/^[^,]+,\s*\S/.test(before)) cityFromDateLine = before;
    break;
  }
  if (!dates) return { skip: 'no-dates' };

  const cityLine =
    cityFromDateLine ??
    head
      .slice(1)
      .find((l) => /^[^,]+,\s*[A-Za-z]/.test(l) && !DATE_RE.test(l) && !/^CITY, COUNTRY/i.test(l) && !/\d{3,}/.test(l));
  if (!cityLine) return { skip: 'no-city' };
  const [city, ...countryParts] = cityLine.split(',');
  const country = countryParts.join(',').trim() || null;

  const surfaceLine = head.find((l) => /^(Hard|Clay|Grass|Carpet)\b/i.test(l)) ?? 'Hard';
  const surface = /clay/i.test(surfaceLine) ? 'Clay' : /grass/i.test(surfaceLine) ? 'Grass' : /carpet/i.test(surfaceLine) ? 'Carpet' : 'Hard';
  const indoor = /indoor/i.test(joined);

  const category = joined.match(/Challenger\s+(\d{2,3})\b/i);
  const isTour = /TOTAL FINANCIAL COMMITMENT/i.test(joined) && !category;
  const moneyLine = head.find((l) => /[$€£]\s*[\d,. ]{4,}/.test(l));
  const money = moneyLine ? moneyToNumber(moneyLine) : null;

  let level;
  if (category) level = `Challenger ${category[1]}`;
  else if (isTour) level = money != null && money >= 3_500_000 ? 'ATP 1000' : 'ATP 250';
  else return { skip: 'no-level' };

  // ATP headers shout ("ABN AMRO ROTTERDAM") — title-case fully-uppercase names.
  const displayName =
    name === name.toUpperCase()
      ? name.toLowerCase().replace(/(^|[\s\-(])(\p{L})/gu, (m, pre, ch) => pre + ch.toUpperCase())
      : name;

  return {
    row: {
      code,
      name: displayName.replace(/\s+\d{4}$/, '').trim(),
      city: city.trim(),
      country,
      startDate: dates.start,
      endDate: dates.end,
      level,
      surface,
      indoor,
      tourLevelHeuristic: isTour, // endpoint upgrades level from catalogue-by-code when possible
    },
  };
}

async function scanCode(code) {
  const base = `https://www.protennislive.com/posting/${year}/${code}`;
  let url = `${base}/mds.pdf`;
  if (!(await probe(url))) {
    url = `${base}/qs.pdf`;
    if (!(await probe(url))) return null;
  }
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const lines = await firstPageLines(buffer);
    const parsed = parseHeader(lines, code);
    if (parsed.skip) return { code, skip: parsed.skip };
    return { code, row: parsed.row };
  } catch (err) {
    return { code, skip: `error: ${err.message?.slice(0, 60)}` };
  }
}

async function main() {
  const codes = [];
  for (let c = START; c <= END; c++) codes.push(c);
  const rows = [];
  const skips = {};
  let done = 0;
  let idx = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (idx < codes.length) {
        const code = codes[idx++];
        const result = await scanCode(code);
        done += 1;
        if (done % 500 === 0) console.log(`...${done}/${codes.length} probed, ${rows.length} rows so far`);
        if (!result) continue;
        if (result.skip) {
          skips[result.skip] = (skips[result.skip] ?? 0) + 1;
          continue;
        }
        rows.push(result.row);
        console.log(`+ ${result.row.startDate} [${result.row.level}] ${result.row.name} (${result.row.city}) code=${code}`);
      }
    })
  );

  rows.sort((a, b) => a.startDate.localeCompare(b.startDate));
  console.log(`\nScan complete: ${rows.length} ATP/Challenger postings for ${year}; skipped:`, skips);
  if (emitPath && rows.length > 0) {
    (await import('node:fs')).writeFileSync(emitPath, JSON.stringify({ year, rows }));
    console.log(`emitted ${rows.length} rows to ${emitPath}`);
  }
}

main();
