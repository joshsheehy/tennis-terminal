// Diagnostic: download the official ATP Challenger calendar PDF(s) and replay
// the sync-official-calendar parser over the extracted lines, reporting what
// each week contributes and which candidate lines FAIL the row regex.
//
// Run in CI (full network): node scripts/diagnose-calendar-pdf.mjs 2026
// Logic below mirrors src/app/api/sync-official-calendar/route.ts.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const year = Number(process.argv[2] ?? new Date().getFullYear());
const verifyAgainstDb = process.argv.includes('--verify');
const emitRowsIdx = process.argv.indexOf('--emit-rows');
const emitRowsPath = emitRowsIdx !== -1 ? process.argv[emitRowsIdx + 1] : null;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];

async function fetchHtml(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return await res.text();
}

function findCalendarPdfUrls(html, baseUrl) {
  const found = new Set();
  const hrefPattern = /(?:href|data-url|src)=["']([^"']*\.pdf[^"']*)["']/gi;
  let match;
  while ((match = hrefPattern.exec(html)) !== null) {
    const raw = match[1];
    if (!/calendar/i.test(raw)) continue;
    let absoluteUrl;
    if (raw.startsWith('http')) absoluteUrl = raw;
    else if (raw.startsWith('//')) absoluteUrl = `https:${raw}`;
    else if (raw.startsWith('/')) absoluteUrl = `https://www.atptour.com${raw}`;
    else { try { absoluteUrl = new URL(raw, baseUrl).toString(); } catch { continue; } }
    if (/challenger-calendar/i.test(absoluteUrl)) found.add(absoluteUrl);
  }
  return Array.from(found);
}

async function probeUrlExists(url) {
  try {
    let res = await fetch(url, { method: 'HEAD', headers: BROWSER_HEADERS });
    if (res.status === 405) res = await fetch(url, { headers: { ...BROWSER_HEADERS, Range: 'bytes=0-0' } });
    return res.ok || res.status === 206;
  } catch { return false; }
}

async function discoverPdfUrls() {
  const urls = new Set();
  for (const pageUrl of ['https://www.atptour.com/en/tournaments', 'https://www.atptour.com/en/atp-challenger-tour/calendar']) {
    try {
      for (const u of findCalendarPdfUrls(await fetchHtml(pageUrl), pageUrl)) urls.add(u);
    } catch (err) {
      console.log(`page fetch failed: ${pageUrl}: ${err.message}`);
    }
  }
  if (urls.size === 0) {
    // Past seasons: the newest "as-of" PDF was published near season end.
    const now = new Date();
    const seasonEnd = new Date(Date.UTC(year, 11, 31));
    const today = seasonEnd.getTime() < now.getTime() ? seasonEnd : now;
    const yy2 = String((year + 1) % 100).padStart(2, '0');
    for (const prefix of [`${year}-${yy2}-atp-challenger-calendar`, `${year}-atp-challenger-calendar`]) {
      for (let back = 0; back <= 120; back += 1) {
        const d = new Date(today.getTime() - back * 86400000);
        let found = false;
        for (const dayVariant of [String(d.getUTCDate()), String(d.getUTCDate()).padStart(2, '0')]) {
          const url = `https://www.atptour.com/-/media/files/calendar-pdfs/${year}/${prefix}-as-of-${dayVariant}-${MONTH_NAMES[d.getUTCMonth()]}-${d.getUTCFullYear()}.pdf`;
          if (await probeUrlExists(url)) { urls.add(url); found = true; break; }
        }
        if (found) break;
      }
    }
  }
  return Array.from(urls);
}

function rebuildLinesFromPositionedItems(items) {
  const sortedByY = items.sort((a, b) => b.y - a.y || a.x - b.x);
  const groups = [];
  for (const item of sortedByY) {
    const group = groups.find((existing) => Math.abs(existing[0].y - item.y) <= 2.5);
    if (group) group.push(item); else groups.push([item]);
  }
  const lines = [];
  for (const group of groups) {
    const left = group.filter((i) => i.x < i.pageWidth * 0.52);
    const right = group.filter((i) => i.x >= i.pageWidth * 0.48);
    for (const side of [left, right]) {
      const text = side.sort((a, b) => a.x - b.x).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (text.length > 0) lines.push(text);
    }
  }
  return lines;
}

// Candidate replacement extractor: modern pdf.js instead of the ancient copy
// bundled inside pdf-parse (which extracts 0 lines from current ATP PDFs).
async function extractLinesPdfjs(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
  }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items = content.items
      .map((item) => {
        const str = typeof item.str === 'string' ? item.str.trim() : '';
        if (!str || !Array.isArray(item.transform) || item.transform.length < 6) return null;
        return { str, x: Number(item.transform[4] ?? 0), y: Number(item.transform[5] ?? 0), pageWidth: viewport.width };
      })
      .filter(Boolean);
    lines.push(...rebuildLinesFromPositionedItems(items));
  }
  await doc.destroy();
  return Array.from(new Set(lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)));
}

async function extractLines(buffer) {
  const pdfParse = require('pdf-parse');
  const parsed = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const viewport = typeof pageData.getViewport === 'function' ? pageData.getViewport({ scale: 1 }) : { width: 612 };
      const content = await pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      const items = content.items
        .map((item) => {
          const str = typeof item.str === 'string' ? item.str.trim() : '';
          if (!str || !Array.isArray(item.transform) || item.transform.length < 6) return null;
          return { str, x: Number(item.transform[4] ?? 0), y: Number(item.transform[5] ?? 0), pageWidth: viewport.width };
        })
        .filter(Boolean);
      return rebuildLinesFromPositionedItems(items).join('\n');
    },
  });
  return Array.from(new Set((parsed.text ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)));
}

const ROW_PATTERN = /^(?:(\d{1,2})\s+(\d{1,2}[-\s][A-Za-z]{3})\s+)?(.+?)\s+([A-Z]{3})\s+(50|75|100|125|175)\s+(?:(?:USD|EUR|€|\$)\s*)?[0-9][0-9,\.]*\s+((?:IH|CL|H|C|G)\*?)\b(.*)$/i;
const MONTH_ABBR = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

function parseDateToken(token, dateYear) {
  const m = token.trim().match(/^(\d{1,2})[-\s]([A-Za-z]{3})$/);
  if (!m) return null;
  const month = MONTH_ABBR[m[2].toLowerCase()];
  if (!month) return null;
  return `${dateYear}-${String(month).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

// Mirrors src/lib/atp-week.ts.
function getAtpWeekForSeason(startDate, seasonYear) {
  const jan1 = new Date(Date.UTC(seasonYear, 0, 1));
  const isoDow = jan1.getUTCDay() === 0 ? 7 : jan1.getUTCDay();
  const offsetDays = isoDow <= 3 ? 1 - isoDow : 8 - isoDow;
  const seasonStart = jan1.getTime() + offsetDays * 86400000;
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  return Math.max(1, Math.floor(Math.floor((start - seasonStart) / 86400000) / 7) + 1);
}

function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

// Same season-section handling as the route: a "<year> CALENDAR" or
// "JAN 2027"-style header switches sections; rows outside the requested
// season are skipped, and early-week December tokens belong to the prior
// calendar year.
function parseRows(lines) {
  let currentWeek = null;
  let currentStartDate = null;
  let sectionYear = year;
  const rows = [];
  const nearMisses = [];
  const transitions = [];
  const sectionPattern = /\b(20\d{2})\s+CALENDAR\b/i;
  const monthHeaderPattern = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(20\d{2})$/i;

  for (const line of lines) {
    const sectionMatch = sectionPattern.exec(line) ?? monthHeaderPattern.exec(line);
    if (sectionMatch) {
      const headerYear = Number(sectionMatch[1].length === 4 ? sectionMatch[1] : sectionMatch[2]);
      if (headerYear >= 2000 && headerYear <= 2100 && headerYear !== sectionYear) {
        transitions.push(`SECTION -> ${headerYear} ("${line}")`);
        sectionYear = headerYear;
        currentWeek = null;
        currentStartDate = null;
      }
      continue;
    }
    const match = ROW_PATTERN.exec(line);
    if (!match) {
      if (/\b(50|75|100|125|175)\b/.test(line) && /\b[A-Z]{3}\b/.test(line) && !/^week/i.test(line)) {
        nearMisses.push(line);
      }
      continue;
    }
    if (match[1] && match[2]) {
      currentWeek = Number(match[1]);
      const monthAbbr = match[2].trim().slice(-3).toLowerCase();
      const dateYear = monthAbbr === 'dec' && currentWeek <= 2 ? sectionYear - 1 : sectionYear;
      currentStartDate = parseDateToken(match[2], dateYear);
      transitions.push(`week ${currentWeek} (${sectionYear}) dateToken="${match[2]}" -> ${currentStartDate}`);
    }
    if (currentWeek === null || !currentStartDate) continue;
    if (sectionYear !== year) continue;
    const notes = (match[7] ?? '').trim();
    if (/cancelled|postponed/i.test(notes)) {
      transitions.push(`SKIPPED (cancelled/postponed): ${match[3].trim()}`);
      continue;
    }
    rows.push({
      week: currentWeek,
      startDate: currentStartDate,
      name: match[3].trim().replace(/[•†‡*]+/g, '').trim(),
      country: match[4].toUpperCase(),
      level: `Challenger ${match[5]}`,
      levelNumber: match[5],
      surfaceCode: match[6],
      notes,
    });
  }
  return { rows, nearMisses, transitions };
}

function analyze(lines) {
  const { rows, nearMisses, transitions } = parseRows(lines);

  console.log('\n--- WEEK/SECTION TRANSITIONS SEEN BY PARSER ---');
  for (const t of transitions) console.log(t);

  const byWeek = new Map();
  for (const r of rows) {
    const key = `${r.week} (${r.startDate})`;
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push(`${r.name} [${r.country} ${r.level.replace('Challenger ', '')}]`);
  }
  console.log(`\n--- ACCEPTED ${year} ROWS PER WEEK: ${rows.length} total ---`);
  for (const [week, names] of byWeek) console.log(`week ${week}: ${names.length} rows :: ${names.join(' | ')}`);

  console.log(`\n--- NEAR-MISS LINES (level+country present, regex failed): ${nearMisses.length} ---`);
  for (const l of nearMisses.slice(0, 60)) console.log(`NEARMISS: ${l}`);

  return rows;
}

// Compare official PDF rows against production DB editions for the season.
async function verifyAgainstProduction(pdfRows) {
  const appUrl = (process.env.APP_URL ?? '').trim().replace(/\/$/, '');
  const secret = process.env.ADMIN_SECRET ?? '';
  if (!appUrl || !secret) {
    console.log('\n--- DB VERIFY SKIPPED (APP_URL / ADMIN_SECRET not set) ---');
    return;
  }
  const res = await fetch(
    `${appUrl}/api/debug-week?year=${year}&from=${year - 1}-12-20&to=${year}-12-31`,
    { headers: { 'X-Admin-Secret': secret, Accept: 'application/json' } }
  );
  if (!res.ok) {
    console.log(`\n--- DB VERIFY FAILED: debug-week returned ${res.status} ---`);
    return;
  }
  const db = await res.json();
  const editions = (db.editions ?? []).filter((e) => e.status === 'held');

  // Index DB editions by normalized name and city.
  const byKey = new Map();
  const add = (key, e) => {
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(e);
  };
  for (const e of editions) {
    add(normalizeKey(e.name), e);
    add(normalizeKey((e.name ?? '').replace(/,\s*[A-Z]{2}$/, '')), e);
  }

  const missing = [];
  const wrongDate = [];
  const wrongLevel = [];
  const matchedIds = new Set();

  for (const row of pdfRows) {
    const keys = [
      normalizeKey(row.name),
      normalizeKey(row.name.replace(/,\s*[A-Z]{2}$/, '')),
      normalizeKey(row.name.replace(/\s*\([^)]*\)/g, '')),
    ];
    let candidates = [];
    for (const k of keys) {
      if (byKey.has(k)) { candidates = byKey.get(k); break; }
    }
    if (candidates.length === 0) {
      missing.push(`${row.name} [${row.level}] week ${row.week} (${row.startDate})${row.notes ? ` notes: ${row.notes}` : ''}`);
      continue;
    }
    // Prefer a same-date candidate, else closest by date.
    const match =
      candidates.find((e) => e.start_date === row.startDate) ??
      candidates
        .slice()
        .sort((a, b) =>
          Math.abs(new Date(a.start_date) - new Date(row.startDate)) -
          Math.abs(new Date(b.start_date) - new Date(row.startDate))
        )[0];
    matchedIds.add(`${match.slug}|${match.start_date}`);
    if (match.start_date !== row.startDate) {
      wrongDate.push(
        `${row.name}: official ${row.startDate} (week ${getAtpWeekForSeason(row.startDate, year)}) vs DB ${match.start_date} (week ${match.week}) [slug ${match.slug}]`
      );
    }
    if (match.level !== row.level) {
      wrongLevel.push(`${row.name}: official ${row.level} vs DB ${match.level} [slug ${match.slug}]`);
    }
  }

  const challengerExtras = editions.filter(
    (e) => /challenger/i.test(e.level ?? '') && !matchedIds.has(`${e.slug}|${e.start_date}`)
  );

  console.log(`\n=== OFFICIAL ${year} CALENDAR vs PRODUCTION DB ===`);
  console.log(`official challenger rows: ${pdfRows.length} | held DB editions in season: ${editions.length}`);
  console.log(`\nMISSING from DB entirely: ${missing.length}`);
  missing.slice(0, 60).forEach((l) => console.log(`  MISSING: ${l}`));
  console.log(`\nWRONG DATE/WEEK: ${wrongDate.length}`);
  wrongDate.slice(0, 60).forEach((l) => console.log(`  DATE: ${l}`));
  console.log(`\nWRONG LEVEL: ${wrongLevel.length}`);
  wrongLevel.slice(0, 60).forEach((l) => console.log(`  LEVEL: ${l}`));
  console.log(`\nDB challenger editions NOT in official PDF (extra/ghost): ${challengerExtras.length}`);
  challengerExtras.slice(0, 40).forEach((e) =>
    console.log(`  EXTRA: ${e.name} [${e.level}] ${e.start_date} week ${e.week} slug ${e.slug} cuts ${e.cuts}`)
  );
  if (missing.length === 0 && wrongDate.length === 0 && wrongLevel.length === 0) {
    console.log(`\nALL ${year} OFFICIAL CHALLENGER ROWS MATCH PRODUCTION (dates, weeks, levels).`);
  }
}

// Mirrors normalizeReaderTextToLines in the route: production falls back to
// the r.jina.ai reader whenever pdf-parse extracts zero lines (which is the
// case for these ATP calendar PDFs), so the reader path is what actually runs.
function normalizeReaderTextToLines(text) {
  return Array.from(
    new Set(
      text
        .replace(/\r/g, '\n')
        .split('\n')
        .flatMap((rawLine) => {
          const line = rawLine
            .replace(/^Title:\s*/i, '')
            .replace(/^URL Source:\s*/i, '')
            .replace(/^Markdown Content:\s*/i, '')
            .replace(/^#+\s*/, '')
            .replace(/^[-*]\s*/, '')
            .replace(/\|/g, ' | ')
            .replace(/\s+/g, ' ')
            .trim();
          return line ? [line] : [];
        })
        .filter(Boolean)
    )
  );
}

async function fetchReaderLines(pdfUrl) {
  const res = await fetch(`https://r.jina.ai/${pdfUrl}`, {
    headers: { Accept: 'text/plain, text/markdown, */*', 'User-Agent': 'TennisTerminalCalendarSync/1.0' },
  });
  if (!res.ok) throw new Error(`Reader returned ${res.status}`);
  return normalizeReaderTextToLines(await res.text());
}

function printWeek8To10Window(lines) {
  // Dump the raw region between the week-8 date token (23-Feb) and the
  // week-10 token (9-Mar) so the week-9 layout is visible verbatim.
  const startIdx = lines.findIndex((l) => /\b23[-\s]Feb\b/i.test(l));
  const endIdx = lines.findIndex((l) => /\b9[-\s]Mar\b/i.test(l));
  console.log(`\n--- RAW WINDOW between "23-Feb" (idx ${startIdx}) and "9-Mar" (idx ${endIdx}) ---`);
  if (startIdx === -1) return;
  const stop = endIdx > startIdx ? Math.min(endIdx + 1, startIdx + 100) : Math.min(startIdx + 40, lines.length);
  for (let i = Math.max(0, startIdx - 2); i < stop; i++) console.log(`[${i}] ${lines[i]}`);
}

const urls = await discoverPdfUrls();
console.log(`Discovered ${urls.length} calendar PDF URL(s):`);
urls.forEach((u) => console.log(`  ${u}`));

for (const url of urls) {
  console.log(`\n================ ${url}`);
  try {
    const res = await fetch(url, { headers: { ...BROWSER_HEADERS, Accept: 'application/pdf,*/*;q=0.8' } });
    if (!res.ok) { console.log(`download failed: ${res.status}`); continue; }
    const buffer = Buffer.from(await res.arrayBuffer());
    console.log(`downloaded ${buffer.length} bytes`);
    let lines = await extractLinesPdfjs(buffer).catch((err) => {
      console.log(`pdfjs extraction failed: ${err.message}`);
      return [];
    });
    let source = 'pdfjs-dist';
    if (lines.length === 0) {
      lines = await extractLines(buffer);
      source = 'pdf-parse';
    }
    if (lines.length === 0) {
      console.log('pdfjs + pdf-parse extracted 0 lines -> falling back to r.jina.ai reader');
      lines = await fetchReaderLines(url);
      source = 'jina-reader';
    }
    console.log(`extracted ${lines.length} lines via ${source}`);
    printWeek8To10Window(lines);
    const rows = analyze(lines);
    if (emitRowsPath && rows.length > 0) {
      const payload = {
        year,
        sourcePdfUrl: url,
        rows: rows.map((r) => ({
          week: r.week,
          startDate: r.startDate,
          name: r.name,
          countryCode: r.country,
          level: r.levelNumber,
          surfaceCode: r.surfaceCode,
        })),
      };
      (await import('node:fs')).writeFileSync(emitRowsPath, JSON.stringify(payload));
      console.log(`emitted ${payload.rows.length} rows to ${emitRowsPath}`);
    }
    if (verifyAgainstDb) await verifyAgainstProduction(rows);
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }
}
