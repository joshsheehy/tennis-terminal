import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Temporary protected diagnostic. All targets are fixed at build time: this is
// not an arbitrary URL proxy. We use it only to determine whether the public
// ATP website exposes tournament component JSON to the Railway egress IP.
const ATP = 'https://www.atptour.com/en/-/www';
const YEAR = '2026';
const TOURNAMENT_ID = '3121'; // Kingston, Aug 17, 2026

const candidates = [
  // Known public control. This must succeed before candidate results mean much.
  ['control-player-hero', `${ATP}/players/hero/a0e2?v=1`],

  // Tournament page components / common Sitecore controller naming variants.
  ['tournaments-hero', `${ATP}/tournaments/hero/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-overview', `${ATP}/tournaments/overview/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-details', `${ATP}/tournaments/details/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-tournament-details', `${ATP}/tournaments/tournament-details/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-profile', `${ATP}/tournaments/profile/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-info', `${ATP}/tournaments/info/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournament-hero', `${ATP}/tournament/hero/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournament-overview', `${ATP}/tournament/overview/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournament-details', `${ATP}/tournament/details/${TOURNAMENT_ID}?year=${YEAR}&v=1`],

  // Player/entry-list naming variants.
  ['tournaments-players', `${ATP}/tournaments/players/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-player-list', `${ATP}/tournaments/player-list/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-playerlist', `${ATP}/tournaments/playerlist/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-participants', `${ATP}/tournaments/participants/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-participant-list', `${ATP}/tournaments/participant-list/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-entries', `${ATP}/tournaments/entries/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-entry-list', `${ATP}/tournaments/entry-list/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-entrylist', `${ATP}/tournaments/entrylist/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-acceptance-list', `${ATP}/tournaments/acceptance-list/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournaments-acceptancelist', `${ATP}/tournaments/acceptancelist/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournament-players', `${ATP}/tournament/players/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournament-player-list', `${ATP}/tournament/player-list/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournament-participants', `${ATP}/tournament/participants/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['tournament-entry-list', `${ATP}/tournament/entry-list/${TOURNAMENT_ID}?year=${YEAR}&v=1`],

  // Alternate path parameter layouts.
  ['players-year-id', `${ATP}/tournaments/players/${YEAR}/${TOURNAMENT_ID}?v=1`],
  ['players-id-year', `${ATP}/tournaments/players/${TOURNAMENT_ID}/${YEAR}?v=1`],
  ['entries-year-id', `${ATP}/tournaments/entries/${YEAR}/${TOURNAMENT_ID}?v=1`],
  ['entry-list-year-id', `${ATP}/tournaments/entry-list/${YEAR}/${TOURNAMENT_ID}?v=1`],
  ['participants-year-id', `${ATP}/tournaments/participants/${YEAR}/${TOURNAMENT_ID}?v=1`],

  // Tournament results/archive component variants may expose the same roster.
  ['scores-tournament', `${ATP}/scores/tournament/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['scores-results', `${ATP}/scores/results/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['scores-draws', `${ATP}/scores/draws/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['scores-players', `${ATP}/scores/players/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
  ['scores-archive-results', `${ATP}/scores/archive/tournament-results/${TOURNAMENT_ID}?year=${YEAR}&v=1`],
] as const;

type ProbeResult = {
  name: string;
  status?: number;
  contentType?: string | null;
  bytes?: number;
  json?: boolean;
  keys?: string[];
  prefix?: string;
  error?: string;
};

async function probe(name: string, url: string): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'en-US,en;q=0.9',
        referer: `https://www.atptour.com/en/tournaments/kingston/${TOURNAMENT_ID}/overview`,
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
      },
    });
    const body = Buffer.from(await response.arrayBuffer());
    const text = body.subarray(0, 20_000).toString('utf8');
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* diagnostic only */ }
    return {
      name,
      status: response.status,
      contentType: response.headers.get('content-type'),
      bytes: body.length,
      json: parsed !== null,
      keys: parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? Object.keys(parsed as Record<string, unknown>).slice(0, 30)
        : undefined,
      prefix: text.replace(/\s+/g, ' ').slice(0, 240),
    };
  } catch (error) {
    return { name, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  // Control first. If ATP blocks Railway too, avoid spraying useless guesses.
  const [controlName, controlUrl] = candidates[0];
  const control = await probe(controlName, controlUrl);
  if (control.status !== 200 || !control.json) {
    return NextResponse.json({ ok: true, reachable: false, control, results: [] });
  }

  const rest = candidates.slice(1);
  const results: ProbeResult[] = [];
  for (let i = 0; i < rest.length; i += 6) {
    results.push(...await Promise.all(rest.slice(i, i + 6).map(([name, url]) => probe(name, url))));
  }

  return NextResponse.json({
    ok: true,
    reachable: true,
    control,
    interesting: results.filter((r) => r.status !== 404),
    all: results,
  });
}
