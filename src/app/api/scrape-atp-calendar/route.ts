import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';
import { getAtpEditionYearForStartDate, getAtpWeekForSeason } from '@/lib/atp-week';
import slugify from 'slugify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Primary calendar source: atptour.com. The two pages we care about:
//   https://www.atptour.com/en/tournaments
//   https://www.atptour.com/en/atp-challenger-tour/calendar
//
// Both are Next.js pages. We extract tournament refs by:
//   1. URL pattern matching in the HTML
//        /en/tournaments/{city}/{code}/overview
//        /en/atp-challenger-tour/tournaments/{city}/{code}/overview
//        /en/scores/archive/{city}/{code}/{year}/
//   2. Walking the __NEXT_DATA__ JSON blob for tournament-like objects
//      with start_date / level / surface fields.
//
// We never delete existing editions — only insert new ones and update
// metadata. Cuts still come from ProTennisLive via the run-all sweep.

const CODE_TO_CANONICAL = new Map(
  ALL_EDITIONS
    .filter((e) => e.edition.protennislive_code)
    .map((e) => [Number(e.edition.protennislive_code), e])
);

type CalendarTournament = {
  code: number;
  citySlug: string;
  name?: string;
  city?: string;
  country?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  level?: string | null;
  surface?: string | null;
  isChallenger: boolean;
};

const URL_PATTERNS = [
  // ATP Tour upcoming/current tournament overview
  /\/en\/tournaments\/([a-z0-9-]+)\/(\d{2,6})\/overview/gi,
  // ATP Tour live scores
  /\/en\/tournaments\/([a-z0-9-]+)\/(\d{2,6})\/(?:draws|players|live-scores)/gi,
  // Challenger Tour
  /\/en\/atp-challenger-tour\/tournaments\/([a-z0-9-]+)\/(\d{2,6})\/(?:overview|draws|live-scores)/gi,
  // Archived pages (also surfaces here on calendar pages occasionally)
  /\/en\/scores\/archive\/([a-z0-9-]+)\/(\d{2,6})\/\d{4}\//gi,
];

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`ATP Tour returned ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeLevelString(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (t.includes('grand slam')) return 'Grand Slam';
  if (t.includes('atp finals')) return 'ATP Finals';
  if (t.includes('next gen')) return 'Next Gen Finals';
  if (t.includes('masters 1000') || t === 'masters' || t.includes('atp 1000') || t === '1000') return 'ATP 1000';
  if (t.includes('atp 500') || t === '500') return 'ATP 500';
  if (t.includes('atp 250') || t === '250') return 'ATP 250';
  if (t.includes('challenger 175') || t === 'ch 175' || t.includes('chal 175')) return 'Challenger 175';
  if (t.includes('challenger 125') || t === 'ch 125') return 'Challenger 125';
  if (t.includes('challenger 100') || t === 'ch 100') return 'Challenger 100';
  if (t.includes('challenger 75') || t === 'ch 75') return 'Challenger 75';
  if (t.includes('challenger 50') || t === 'ch 50') return 'Challenger 50';
  if (t.includes('challenger')) return 'Challenger';
  return null;
}

function normalizeSurface(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (t.includes('hard')) return 'Hard';
  if (t.includes('clay')) return 'Clay';
  if (t.includes('grass')) return 'Grass';
  if (t.includes('carpet')) return 'Carpet';
  return null;
}

function pickString(rec: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return null;
}

function pickDate(rec: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string') {
      const m = v.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    }
  }
  return null;
}

// Recursively walk a JSON-ish object looking for tournament-shaped sub-objects.
function harvestTournaments(
  obj: unknown,
  out: Map<number, CalendarTournament>,
  contextIsChallenger: boolean
): void {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) harvestTournaments(item, out, contextIsChallenger);
    return;
  }
  const rec = obj as Record<string, unknown>;

  const idCandidate =
    pickString(rec, ['tournamentId', 'tournament_id', 'atpId', 'eventId', 'id']) ??
    null;
  const code = idCandidate && /^\d{2,6}$/.test(idCandidate) ? Number(idCandidate) : null;

  if (code !== null && code > 0) {
    const name = pickString(rec, ['title', 'tournamentTitle', 'name', 'tournamentName']);
    const city = pickString(rec, ['city', 'tournamentCity', 'venueCity']);
    const country = pickString(rec, ['country', 'tournamentCountry', 'countryName']);
    const startDate = pickDate(rec, ['startDate', 'tournamentStartDate', 'dateStart', 'start_date']);
    const endDate = pickDate(rec, ['endDate', 'tournamentEndDate', 'dateEnd', 'end_date']);
    const level = normalizeLevelString(
      pickString(rec, ['levelName', 'level', 'tournamentLevel', 'category', 'tournamentType'])
    );
    const surface = normalizeSurface(
      pickString(rec, ['surface', 'tournamentSurface', 'courtSurface'])
    );

    const existing = out.get(code);
    out.set(code, {
      code,
      citySlug: existing?.citySlug ?? (city ? slugify(city, { lower: true, strict: true }) : 'unknown'),
      name: existing?.name ?? name ?? undefined,
      city: existing?.city ?? city ?? undefined,
      country: existing?.country ?? country ?? null,
      startDate: existing?.startDate ?? startDate ?? null,
      endDate: existing?.endDate ?? endDate ?? null,
      level: existing?.level ?? level ?? null,
      surface: existing?.surface ?? surface ?? null,
      isChallenger: existing?.isChallenger || contextIsChallenger,
    });
  }

  for (const v of Object.values(rec)) harvestTournaments(v, out, contextIsChallenger);
}

async function scrapeOne(url: string, isChallenger: boolean) {
  const html = await fetchHtml(url);
  const tournaments = new Map<number, CalendarTournament>();

  // Method 1: URL pattern matching for tournament refs
  for (const pattern of URL_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(html)) !== null) {
      const code = Number(m[2]);
      if (!tournaments.has(code)) {
        tournaments.set(code, {
          code,
          citySlug: m[1],
          isChallenger,
        });
      }
    }
  }

  // Method 2: walk __NEXT_DATA__ for richer metadata
  const ndMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (ndMatch) {
    try {
      const nd = JSON.parse(ndMatch[1]);
      harvestTournaments(nd, tournaments, isChallenger);
    } catch {
      // Best-effort; URL pattern matches are still useful.
    }
  }

  return { url, count: tournaments.size, tournaments: Array.from(tournaments.values()) };
}

async function upsertTournament(t: CalendarTournament, year: number) {
  // Prefer canonical metadata if we have it.
  const canonical = CODE_TO_CANONICAL.get(t.code);
  const name =
    canonical?.tournament.name ??
    t.name ??
    (t.city ?? t.citySlug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
  const city = canonical?.tournament.city ?? t.city ?? name;
  const country = canonical?.tournament.country ?? t.country ?? null;
  const slug = canonical?.tournament.slug ?? slugify(name, { lower: true, strict: true, trim: true });

  // Derive year from start date when possible (Dec dates roll into next ATP season).
  const startDate = t.startDate ?? null;
  const editionYear = startDate ? getAtpEditionYearForStartDate(startDate, year) : year;
  const week = startDate ? (getAtpWeekForSeason(startDate, editionYear) ?? null) : null;
  const level = t.level ?? canonical?.edition.level ?? (t.isChallenger ? 'Challenger' : 'ATP 250');
  const surface = t.surface ?? canonical?.edition.surface ?? 'Hard';

  const tournamentResult = await pool.query<{ id: string }>(
    `insert into tournaments (slug, name, city, country, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (slug) do update set
       name = coalesce(tournaments.name, excluded.name),
       city = coalesce(tournaments.city, excluded.city),
       country = coalesce(tournaments.country, excluded.country),
       updated_at = now()
     returning id`,
    [slug, name, city, country]
  );
  const tournamentId = tournamentResult.rows[0].id;

  const sourceUrl = t.isChallenger
    ? `https://www.atptour.com/en/atp-challenger-tour/tournaments/${t.citySlug}/${t.code}/overview`
    : `https://www.atptour.com/en/tournaments/${t.citySlug}/${t.code}/overview`;

  // Don't clobber an existing real start_date with null. Status defaults to
  // 'held' so the schedule renders it; run-all + restore-historical-status
  // own the held/not_held flips.
  await pool.query(
    `insert into tournament_editions (
       tournament_id, year, week, start_date, end_date, level, surface,
       indoor, source, source_url, status, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, false, 'atp_tour_calendar', $8, 'held', now())
     on conflict (tournament_id, year) do update set
       week = coalesce(excluded.week, tournament_editions.week),
       start_date = coalesce(excluded.start_date, tournament_editions.start_date),
       end_date = coalesce(excluded.end_date, tournament_editions.end_date),
       level = coalesce(excluded.level, tournament_editions.level),
       surface = coalesce(excluded.surface, tournament_editions.surface),
       source_url = case
         when tournament_editions.source_url ~ '/posting/\\d+/\\d+/' then tournament_editions.source_url
         else excluded.source_url
       end,
       updated_at = now()`,
    [tournamentId, editionYear, week, startDate, t.endDate ?? null, level, surface, sourceUrl]
  );

  return { slug, code: t.code, editionYear, week, level, surface, startDate, isChallenger: t.isChallenger };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const year = Number(params.get('year') ?? new Date().getFullYear());
  const dryRun = params.get('apply') === 'false';

  const targets = [
    { url: 'https://www.atptour.com/en/tournaments', isChallenger: false },
    { url: 'https://www.atptour.com/en/atp-challenger-tour/calendar', isChallenger: true },
  ];

  const scrapeResults: Array<Awaited<ReturnType<typeof scrapeOne>>> = [];
  const scrapeErrors: Array<{ url: string; error: string }> = [];

  for (const t of targets) {
    try {
      scrapeResults.push(await scrapeOne(t.url, t.isChallenger));
    } catch (err) {
      scrapeErrors.push({ url: t.url, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const merged = new Map<number, CalendarTournament>();
  for (const result of scrapeResults) {
    for (const t of result.tournaments) {
      const existing = merged.get(t.code);
      merged.set(t.code, {
        ...t,
        ...(existing ?? {}),
        // Prefer richer metadata, but keep the most-specific isChallenger.
        isChallenger: t.isChallenger || (existing?.isChallenger ?? false),
        name: existing?.name ?? t.name,
        city: existing?.city ?? t.city,
        country: existing?.country ?? t.country,
        startDate: existing?.startDate ?? t.startDate,
        endDate: existing?.endDate ?? t.endDate,
        level: existing?.level ?? t.level,
        surface: existing?.surface ?? t.surface,
      });
    }
  }

  if (merged.size === 0) {
    return NextResponse.json({
      ok: false,
      error:
        'No tournaments extracted from atptour.com. The pages may have changed structure or are blocking the request. Inspect the response and update URL_PATTERNS or harvestTournaments() in scrape-atp-calendar.',
      scrapeErrors,
      scrapeResultsCount: scrapeResults.map((r) => ({ url: r.url, count: r.count })),
    }, { status: 502 });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      year,
      scrapeResultsCount: scrapeResults.map((r) => ({ url: r.url, count: r.count })),
      scrapeErrors,
      uniqueTournamentCount: merged.size,
      sample: Array.from(merged.values()).slice(0, 25),
    });
  }

  const upserted = [];
  const failed = [];
  for (const t of merged.values()) {
    try {
      upserted.push(await upsertTournament(t, year));
    } catch (err) {
      failed.push({ code: t.code, citySlug: t.citySlug, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    ok: true,
    year,
    scrapeResultsCount: scrapeResults.map((r) => ({ url: r.url, count: r.count })),
    scrapeErrors,
    upsertedCount: upserted.length,
    failedCount: failed.length,
    sampleUpserted: upserted.slice(0, 25),
    failed,
  });
}
