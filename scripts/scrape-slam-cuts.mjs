// Grand Slam entry-cut scraper — runs on GitHub runners, where the sources
// that block datacenter/proxy traffic (menstennisforums.com bot wall,
// wimbledon.com) are reachable and JS challenges can be passed with a real
// browser. Slams publish no ProTennisLive acceptance lists, so the cuts live
// in published entry lists that fans mirror verbatim on forums.
//
//   node scripts/scrape-slam-cuts.mjs --years 2022,2023 --draws ms,qs,md --emit /tmp/slam-cuts.json
//
// For every (slam, year, draw) target it:
//   1. discovers candidate pages via DuckDuckGo (site:menstennisforums.com)
//   2. fetches them (plain fetch first, Playwright Chromium when challenged)
//   3. extracts the LAST DIRECT ACCEPTANCE — an explicit "last direct
//      acceptance/cut" line when present, otherwise the tail of a long
//      numbered entry list ending at an Alternates section
//   4. records the exact evidence lines it based the number on
//
// NOTHING is guessed: each row carries confidence 'high' or 'review', and the
// importing workflow only writes 'high' rows. Plausibility windows per draw
// keep prose numbers (seeds, dates, prize money) from masquerading as cuts.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const argVal = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : dflt;
};
const YEARS = argVal('--years', '2022,2023').split(',').map((y) => Number(y.trim())).filter(Boolean);
const DRAWS = argVal('--draws', 'ms,qs,md').split(',').map((d) => d.trim());
const EMIT = argVal('--emit', null);

const SLAMS = [
  { name: 'Australian Open', altNames: [], mainSlug: 'australian-open-melbourne', qualiSlug: 'australian-open-qualifying-melbourne' },
  { name: 'Roland Garros', altNames: ['French Open'], mainSlug: 'roland-garros-paris', qualiSlug: 'roland-garros-qualifying-paris' },
  { name: 'Wimbledon', altNames: [], mainSlug: 'wimbledon-london', qualiSlug: 'wimbledon-qualifying-london' },
  { name: 'US Open', altNames: [], mainSlug: 'us-open-new-york', qualiSlug: 'us-open-qualifying-new-york' },
];

// Ranking windows a believable slam cut falls in, per draw. Slam MD singles
// cuts have sat between 96 and 125 for a decade; qualifying roughly 190-320;
// doubles (combined team ranking of the last team in) roughly 40-220.
const DRAW_META = {
  ms: { eventType: 'singles', drawType: 'main', slugKey: 'mainSlug', min: 90, max: 160, query: 'entry list' },
  qs: { eventType: 'singles', drawType: 'qualifying', slugKey: 'qualiSlug', min: 170, max: 400, query: 'qualifying entry list' },
  md: { eventType: 'doubles', drawType: 'main', slugKey: 'mainSlug', min: 30, max: 260, query: 'doubles entry list' },
};

// ---------------------------------------------------------------------------
// Fetching

let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('@playwright/test');
      return chromium.launch({
        executablePath: process.env.PW_EXECUTABLE || undefined,
        args: ['--disable-blink-features=AutomationControlled'],
      });
    })();
  }
  return browserPromise;
}

async function fetchTextPlain(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  return { status: res.status, body };
}

function looksBlocked(status, body) {
  if (status === 402 || status === 403 || status === 429 || status === 202) return true;
  if (body.length < 4000) return true;
  return /just a moment|challenge-platform|tollbit|enable javascript|attention required/i.test(body);
}

async function fetchPageText(url) {
  try {
    const { status, body } = await fetchTextPlain(url);
    if (!looksBlocked(status, body)) return htmlToText(body);
  } catch {
    // fall through to the browser
  }
  try {
    const browser = await getBrowser();
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(2_500); // let JS challenges settle
      return await page.evaluate(() => document.body?.innerText ?? '');
    } finally {
      await page.close().catch(() => undefined);
    }
  } catch (err) {
    return `__FETCH_FAILED__ ${err.message?.slice(0, 120)}`;
  }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<td[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'");
}

// ---------------------------------------------------------------------------
// Discovery: DuckDuckGo (POST + lite variants) with a Bing fallback — search
// engines treat datacenter GETs unevenly, so several doors are tried. Thread
// URLs from any engine are only candidates; the year/slam check inside
// extractCut() decides whether a page actually counts.

function threadLinks(body, limit) {
  const links = [];
  const patterns = [
    /uddg=([^&"']+)/g, // duckduckgo redirect links
    /https?:\/\/(?:www\.)?menstennisforums\.com\/threads\/[a-z0-9.\-]+/gi, // direct
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(body)) && links.length < 25) {
      let candidate = m[1] ? decodeURIComponent(m[1]) : m[0];
      candidate = candidate.split('&')[0];
      if (candidate.includes('menstennisforums.com/threads/') && !links.includes(candidate)) {
        links.push(candidate);
      }
    }
  }
  return links.slice(0, limit);
}

async function discover(query, limit = 4) {
  const encoded = encodeURIComponent(query);
  const attempts = [
    () =>
      fetch('https://html.duckduckgo.com/html/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        },
        body: `q=${encoded}`,
        signal: AbortSignal.timeout(25_000),
      }).then((r) => r.text()),
    () => fetchTextPlain(`https://lite.duckduckgo.com/lite/?q=${encoded}`).then((r) => r.body),
    () => fetchTextPlain(`https://www.bing.com/search?q=${encoded}&count=20`).then((r) => r.body),
  ];
  for (const attempt of attempts) {
    try {
      const body = await attempt();
      const links = threadLinks(body, limit);
      if (links.length > 0) return links;
    } catch {
      // next engine
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Extraction

// Explicit statements are the strongest signal: "Last direct acceptance:
// Norbert Gombos (109)" / "Cut: 104" / "LDA 246".
function extractExplicit(lines, meta) {
  const results = [];
  for (const line of lines) {
    if (!/last direct acceptance|\bLDA\b|cut[-\s]?off|(^|\s)cut\s*[:=]/i.test(line)) continue;
    const nums = [...line.matchAll(/\b(\d{2,4})\b/g)].map((m) => Number(m[1]));
    const inWindow = nums.filter((n) => n >= meta.min && n <= meta.max);
    if (inWindow.length === 1) {
      results.push({ cut: inWindow[0], evidence: line.trim().slice(0, 200), kind: 'explicit' });
    }
  }
  return results;
}

// Numbered-list extraction: find long runs of lines that begin with an
// integer (an official entry list pasted verbatim), tolerate small gaps
// (players who didn't enter), and read the cut off the last row before an
// Alternates section. Runs that don't look like an entry list (short, wild
// jumps, starting high) are ignored.
function extractFromList(lines, meta) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(\d{1,4})[.)]?\s+\S/);
    rows.push(m ? Number(m[1]) : null);
  }
  const results = [];
  let start = null;
  let prev = null;
  for (let i = 0; i <= rows.length; i++) {
    const n = i < rows.length ? rows[i] : null;
    const continues = n !== null && (prev === null || (n > prev && n - prev <= 12));
    if (start === null && n !== null && n <= 5) {
      start = i;
      prev = n;
      continue;
    }
    if (start !== null && continues) {
      prev = n;
      continue;
    }
    if (start !== null) {
      const len = i - start;
      const last = rows[i - 1];
      if (len >= 50 && last !== null && last >= meta.min && last <= meta.max) {
        const after = lines.slice(i, i + 4).join(' ').toLowerCase();
        const boundary = /alternate|withdraw|wild\s?card|qualif|special exempt|^$/.test(after) || i >= rows.length;
        // A perfectly consecutive 1..N run is probably POSITION numbering
        // (list index), not rankings — real ranking-ordered entry lists have
        // gaps where players didn't enter. Positions can't prove the cut, so
        // those runs never rate better than 'review'.
        const hasGaps = last > rows[start] + len - 1;
        results.push({
          cut: last,
          evidence: `${len}-row list ending "${lines[i - 1].trim().slice(0, 90)}"${boundary ? ' followed by section boundary' : ''}${hasGaps ? '' : ' (no ranking gaps — may be position numbers)'}`,
          kind: boundary && hasGaps ? 'list-with-boundary' : 'list',
        });
      }
      start = null;
      prev = null;
      if (n !== null && n <= 5) {
        start = i;
        prev = n;
      }
    }
  }
  return results;
}

export function extractCut(text, slam, year, meta) {
  if (text.startsWith('__FETCH_FAILED__')) return { error: text.slice(0, 140) };
  const names = [slam.name, ...slam.altNames];
  if (!names.some((n) => text.toLowerCase().includes(n.toLowerCase()))) return { error: 'slam name not on page' };
  if (!text.includes(String(year))) return { error: `year ${year} not on page` };

  const lines = text.split('\n').map((l) => l.trim());
  const explicit = extractExplicit(lines, meta);
  const listed = extractFromList(lines, meta);
  const all = [...explicit, ...listed];
  if (all.length === 0) return { error: 'no cut signal found' };

  // Agreement between an explicit line and a list tail (or multiple explicit
  // lines saying the same number) is the high bar.
  const counts = new Map();
  for (const r of all) counts.set(r.cut, (counts.get(r.cut) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const winners = all.filter((r) => r.cut === best[0]);
  const confidence =
    best[1] >= 2 || winners.some((r) => r.kind === 'list-with-boundary') ? 'high' : 'review';
  return {
    cut: best[0],
    confidence,
    evidence: winners.map((r) => `[${r.kind}] ${r.evidence}`).slice(0, 3),
    disagreements: [...counts.keys()].filter((c) => c !== best[0]),
  };
}

// ---------------------------------------------------------------------------

function loadManifest() {
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), 'slam-cut-sources.json');
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

async function main() {
  const manifest = loadManifest();
  const found = [];
  const gaps = [];

  for (const slam of SLAMS) {
    for (const year of YEARS) {
      for (const drawKey of DRAWS) {
        const meta = DRAW_META[drawKey];
        if (!meta) continue;
        const target = {
          slug: slam[meta.slugKey],
          year,
          eventType: meta.eventType,
          drawType: meta.drawType,
        };
        const label = `${slam.name} ${year} ${drawKey}`;
        const query = `site:menstennisforums.com "${slam.name}" ${year} ${meta.query}`;
        const discovered = await discover(query);
        // Known threads from the manifest ride along after discovery — the
        // in-page slam/year verification makes wrong-year candidates harmless.
        const urls = [...new Set([...discovered, ...(manifest[slam.name] ?? [])])];
        if (urls.length === 0) {
          gaps.push({ ...target, label, reason: 'no candidate pages found' });
          console.log(`- ${label}: no candidates (query: ${query})`);
          continue;
        }
        let recorded = false;
        const attempts = [];
        for (const url of urls) {
          const text = await fetchPageText(url);
          const result = extractCut(text, slam, year, meta);
          if (result.cut) {
            found.push({ ...target, cut: result.cut, confidence: result.confidence, source: url, evidence: result.evidence, disagreements: result.disagreements });
            console.log(`+ ${label}: cut=${result.cut} [${result.confidence}] ${url}`);
            for (const e of result.evidence) console.log(`    ${e}`);
            if (result.disagreements.length) console.log(`    ! other candidates on page: ${result.disagreements.join(', ')}`);
            recorded = true;
            break;
          }
          attempts.push(`${url} → ${result.error}`);
        }
        if (!recorded) {
          gaps.push({ ...target, label, reason: attempts.join(' | ').slice(0, 300) });
          console.log(`- ${label}: ${attempts.join(' | ').slice(0, 200)}`);
        }
        await new Promise((r) => setTimeout(r, 1500)); // be polite to DDG
      }
    }
  }

  console.log(`\nScrape complete: ${found.length} cuts found (${found.filter((f) => f.confidence === 'high').length} high-confidence), ${gaps.length} gaps`);
  if (EMIT) {
    writeFileSync(EMIT, JSON.stringify({ found, gaps }, null, 2));
    console.log(`emitted to ${EMIT}`);
  }
  const browser = await browserPromise;
  if (browser) await browser.close().catch(() => undefined);
}

// Only run when invoked as a script (the workflow path); extractCut stays
// importable for tests.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
