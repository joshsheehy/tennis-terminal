// Diagnostic: download the official ATP Challenger calendar PDF(s) and replay
// the sync-official-calendar parser over the extracted lines, reporting what
// each week contributes and which candidate lines FAIL the row regex.
//
// Run in CI (full network): node scripts/diagnose-calendar-pdf.mjs 2026
// Logic below mirrors src/app/api/sync-official-calendar/route.ts.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const year = Number(process.argv[2] ?? new Date().getFullYear());

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
    const today = new Date();
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

function parseDateToken(token) {
  const m = token.trim().match(/^(\d{1,2})[-\s]([A-Za-z]{3})$/);
  if (!m) return null;
  const month = MONTH_ABBR[m[2].toLowerCase()];
  if (!month) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

function analyze(lines) {
  let currentWeek = null;
  let currentStartDate = null;
  const byWeek = new Map();
  const transitions = [];
  const nearMisses = [];

  for (const line of lines) {
    const match = ROW_PATTERN.exec(line);
    if (!match) {
      // Candidate line that mentions a Challenger level + country code but fails the regex.
      if (/\b(50|75|100|125|175)\b/.test(line) && /\b[A-Z]{3}\b/.test(line) && !/^week/i.test(line)) {
        nearMisses.push(line);
      }
      continue;
    }
    if (match[1] && match[2]) {
      currentWeek = Number(match[1]);
      currentStartDate = parseDateToken(match[2]);
      transitions.push(`week ${match[1]} dateToken="${match[2]}" -> startDate=${currentStartDate}`);
    }
    if (currentWeek === null || !currentStartDate) continue;
    const key = `${currentWeek} (${currentStartDate})`;
    if (!byWeek.has(key)) byWeek.set(key, []);
    byWeek.get(key).push(`${match[3].trim()} [${match[4].toUpperCase()} ${match[5]}]`);
  }

  console.log('\n--- WEEK TRANSITIONS SEEN BY PARSER ---');
  for (const t of transitions) console.log(t);

  console.log('\n--- ACCEPTED ROWS PER WEEK ---');
  for (const [week, rows] of byWeek) console.log(`week ${week}: ${rows.length} rows :: ${rows.join(' | ')}`);

  console.log(`\n--- NEAR-MISS LINES (level+country present, regex failed): ${nearMisses.length} ---`);
  for (const l of nearMisses.slice(0, 60)) console.log(`NEARMISS: ${l}`);

  console.log('\n--- RAW LINES CONTAINING Feb/Mar DATE TOKENS ---');
  for (const l of lines) {
    if (/\b\d{1,2}[-\s](feb|mar)\b/i.test(l)) console.log(`RAW: ${l}`);
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
    analyze(lines);
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
  }
}
