// Grand Slam entry cuts, COMPUTED from public structured data instead of
// scraped from bot-walled entry lists (menstennisforums/wimbledon.com defeat
// even a real browser on GitHub runners — see the failed slam-cuts scrape).
//
// Method: Wikipedia's slam draw pages mark every entrant's entry route
// (seed number / blank = direct acceptance, WC, Q, LL, PR), and Jeff
// Sackmann's weekly ATP ranking files give each player's rank at the entry
// deadline (six weeks before the main draw). The cut = the worst-ranked
// direct acceptance. This is the "last direct acceptance IN DRAW" (players
// who moved in as next-by-ranking after withdrawals count as direct), the
// same line PTL prints next to AT DEADLINE on tour draw sheets.
//
//   node scripts/compute-slam-cuts.mjs --years 2022,2023 --draws ms,qs --emit /tmp/slam-cuts.json
//
// Doubles is out of scope: entry is by combined team ranking and no public
// doubles-ranking history exists to compute against.
//
// NOTHING is guessed: a target where any direct acceptance fails to match a
// ranked player is downgraded to 'review' with the unmatched names printed —
// the unmatched player could BE the cut. Only 'high' rows get imported.

import { writeFileSync } from 'node:fs';

const argVal = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : dflt;
};
const YEARS = argVal('--years', '2022,2023').split(',').map((y) => Number(y.trim())).filter(Boolean);
const DRAWS = argVal('--draws', 'ms,qs').split(',').map((d) => d.trim());
const EMIT = argVal('--emit', null);

const SLAMS = [
  { wiki: 'Australian Open', mainSlug: 'australian-open-melbourne', qualiSlug: 'australian-open-qualifying-melbourne',
    starts: { 2022: '2022-01-17', 2023: '2023-01-16', 2024: '2024-01-15', 2025: '2025-01-13', 2026: '2026-01-19' } },
  { wiki: 'French Open', mainSlug: 'roland-garros-paris', qualiSlug: 'roland-garros-qualifying-paris',
    starts: { 2022: '2022-05-23', 2023: '2023-05-29', 2024: '2024-05-27', 2025: '2025-05-26', 2026: '2026-05-25' } },
  { wiki: 'Wimbledon Championships', mainSlug: 'wimbledon-london', qualiSlug: 'wimbledon-qualifying-london',
    starts: { 2022: '2022-06-27', 2023: '2023-07-03', 2024: '2024-07-01', 2025: '2025-06-30', 2026: '2026-06-29' } },
  { wiki: 'US Open', mainSlug: 'us-open-new-york', qualiSlug: 'us-open-qualifying-new-york',
    starts: { 2022: '2022-08-29', 2023: '2023-08-28', 2024: '2024-08-26', 2025: '2025-08-25', 2026: '2026-08-31' } },
];

// Slam entry deadlines sit six weeks before the main draw.
const DEADLINE_DAYS = 42;

const DRAW_META = {
  ms: { slugKey: 'mainSlug', suffix: "Men's singles", min: 90, max: 170 },
  qs: { slugKey: 'qualiSlug', suffix: "Men's singles qualifying", min: 170, max: 420 },
};

// Entry-route markers that are NOT ranking-based direct acceptances.
const NON_DIRECT = new Set(['WC', 'Q', 'LL', 'PR', 'ALT', 'SE', 'JE', 'ITF']);

const UA = { 'User-Agent': 'TennisCutsSlamCompute/1.0 (+https://tenniscuts.com)' };

async function fetchText(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchWithFallback(urls) {
  let lastErr = null;
  for (const url of urls) {
    try {
      return await fetchText(url);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('no urls');
}

// --- Wikipedia draw parsing -------------------------------------------------

async function fetchWikitext(title) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&format=json&formatversion=2&redirects=1`;
  const body = JSON.parse(await fetchText(url));
  if (body.error) throw new Error(`wiki: ${body.error.info ?? body.error.code}`);
  return body.parse?.wikitext ?? '';
}

function stripParen(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/** All RD1 entrants with their strongest entry marker, deduped by player
 * (players repeat across the section brackets and the finals bracket). */
export function parseDrawEntrants(wikitext) {
  const entries = [...wikitext.matchAll(/RD1-seed\d+=([^\n|]*)\n\s*\|\s*RD1-team\d+=([^\n]*)/g)];
  const byName = new Map();
  for (const [, seedRaw, teamRaw] of entries) {
    const marker = seedRaw.trim().replace(/'/g, '').toUpperCase();
    const links = [...teamRaw.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]);
    if (links.length === 0) continue;
    const name = stripParen(links[links.length - 1]);
    const existing = byName.get(name);
    const isRoute = NON_DIRECT.has(marker);
    if (!existing || (isRoute && !NON_DIRECT.has(existing))) byName.set(name, marker);
  }
  return byName; // name -> marker ('' | number | WC/Q/LL/PR/...)
}

// --- Rankings ----------------------------------------------------------------

const RANKING_SOURCES = [
  'https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_rankings_20s.csv',
  'https://cdn.jsdelivr.net/gh/JeffSackmann/tennis_atp@master/atp_rankings_20s.csv',
];
const PLAYER_SOURCES = [
  'https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_players.csv',
  'https://cdn.jsdelivr.net/gh/JeffSackmann/tennis_atp@master/atp_players.csv',
];

export function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function loadRankings(csv) {
  // ranking_date,rank,player,points — grouped by date.
  const byDate = new Map();
  for (const line of csv.split('\n')) {
    const [date, rank, player] = line.split(',');
    if (!date || !rank || !player || date === 'ranking_date') continue;
    let m = byDate.get(date);
    if (!m) byDate.set(date, (m = new Map()));
    m.set(player.trim(), Number(rank));
  }
  return byDate;
}

function loadPlayers(csv) {
  const byNorm = new Map();
  for (const line of csv.split('\n')) {
    const parts = line.split(',');
    if (parts.length < 3 || parts[0] === 'player_id') continue;
    const key = normalizeName(`${parts[1]} ${parts[2]}`);
    if (!key) continue;
    const ids = byNorm.get(key) ?? [];
    ids.push(parts[0].trim());
    byNorm.set(key, ids);
  }
  return byNorm;
}

function snapshotFor(byDate, deadlineIso) {
  const want = deadlineIso.replace(/-/g, '');
  let best = null;
  for (const date of byDate.keys()) {
    if (date <= want && (!best || date > best)) best = date;
  }
  return best ? { date: best, ranks: byDate.get(best) } : null;
}

// -----------------------------------------------------------------------------

async function main() {
  console.log('Loading ATP rankings + players (Sackmann)...');
  const rankingsByDate = loadRankings(await fetchWithFallback(RANKING_SOURCES));
  const playersByNorm = loadPlayers(await fetchWithFallback(PLAYER_SOURCES));
  console.log(`ranking snapshots: ${rankingsByDate.size}, player names: ${playersByNorm.size}\n`);

  const found = [];
  const gaps = [];

  for (const slam of SLAMS) {
    for (const year of YEARS) {
      const start = slam.starts[year];
      if (!start) continue;
      const deadline = new Date(new Date(`${start}T00:00:00Z`).getTime() - DEADLINE_DAYS * 86400000)
        .toISOString()
        .slice(0, 10);
      const snapshot = snapshotFor(rankingsByDate, deadline);

      for (const drawKey of DRAWS) {
        const meta = DRAW_META[drawKey];
        if (!meta) continue;
        const label = `${slam.wiki} ${year} ${drawKey}`;
        const target = {
          slug: slam[meta.slugKey],
          year,
          eventType: 'singles',
          drawType: drawKey === 'qs' ? 'qualifying' : 'main',
        };
        const title = `${year} ${slam.wiki} – ${meta.suffix}`;
        try {
          if (!snapshot) throw new Error(`no ranking snapshot at ${deadline}`);
          const wikitext = await fetchWikitext(title);
          const entrants = parseDrawEntrants(wikitext);
          if (entrants.size < 60) throw new Error(`draw not found (only ${entrants.size} entrants parsed)`);

          const direct = [...entrants.entries()]
            .filter(([, marker]) => !NON_DIRECT.has(marker))
            .map(([name]) => name);
          const matched = [];
          const unmatched = [];
          for (const name of direct) {
            const ids = playersByNorm.get(normalizeName(name)) ?? [];
            const ranked = ids
              .map((id) => snapshot.ranks.get(id))
              .filter((r) => r != null && r <= 3000);
            if (ranked.length === 1) matched.push({ name, rank: ranked[0] });
            else if (ranked.length > 1) unmatched.push(`${name} (ambiguous)`);
            else unmatched.push(name);
          }
          if (matched.length === 0) throw new Error('no direct acceptances matched to rankings');

          const last = matched.reduce((a, b) => (b.rank > a.rank ? b : a));
          const inWindow = last.rank >= meta.min && last.rank <= meta.max;
          const confidence = unmatched.length === 0 && inWindow ? 'high' : 'review';
          const source = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
          const evidence = [
            `computed from ${direct.length} direct acceptances in the Wikipedia draw (of ${entrants.size} entrants) × ATP rankings at ${snapshot.date}`,
            `last direct acceptance in draw: ${last.name} (#${last.rank})`,
            ...(unmatched.length ? [`UNMATCHED (${unmatched.length}): ${unmatched.slice(0, 8).join(', ')}`] : []),
            ...(inWindow ? [] : [`outside plausibility window ${meta.min}-${meta.max}`]),
          ];
          found.push({ ...target, cut: last.rank, confidence, source, evidence });
          console.log(`+ ${label}: cut=${last.rank} [${confidence}] (${direct.length} direct, ${unmatched.length} unmatched)`);
          for (const e of evidence) console.log(`    ${e}`);
        } catch (err) {
          gaps.push({ ...target, label, reason: String(err.message ?? err).slice(0, 200) });
          console.log(`- ${label}: ${String(err.message ?? err).slice(0, 160)}`);
        }
      }
    }
  }

  console.log(`\nCompute complete: ${found.length} cuts (${found.filter((f) => f.confidence === 'high').length} high-confidence), ${gaps.length} gaps`);
  console.log('note: doubles cuts are not computable (no public doubles-ranking history).');
  if (EMIT) {
    writeFileSync(EMIT, JSON.stringify({ found, gaps }, null, 2));
    console.log(`emitted to ${EMIT}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
