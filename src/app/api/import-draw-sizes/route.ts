import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { fetchSackmannCsv } from '@/lib/sackmann';
import { parseSackmannDrawSizes, type TourneyDrawSizes } from '@/lib/draw-sizes';
import { ALL_EDITIONS } from '@/lib/tournament-data';
import { getAtpEditionYearForStartDate } from '@/lib/atp-week';
import { isAvailableSeason, AVAILABLE_SEASONS, CURRENT_SEASON } from '@/lib/seasons';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Backfill real singles draw sizes onto tournament_editions.
//
// singles_draw_size and qualifying_draw_size have existed since the first
// schema and nothing has ever written them, so every acceptance-slot count in
// src/lib/depth.ts falls back to a per-level default. Those defaults flatten
// variation that is real and large — an ATP 1000 is 56 at most stops and 96 at
// Indian Wells and Miami, and Challenger main draws run 32 or 48 at the same
// level — which feeds straight into the "places within reach" figure on /depth.
//
//   GET /api/import-draw-sizes                → dry run for the current season
//   GET /api/import-draw-sizes?year=2025&apply=true
//   GET /api/import-draw-sizes?all=true&apply=true   → every available season
//
// Doubles is deliberately not covered: tennis_atp's doubles files do not span
// the tour and Challenger calendar, so doubles slots stay on their default.

// Permanent code → edition lookup from the hand-curated catalogue, the same
// mapping /api/import-challenger-season uses.
const CODE_TO_EDITION = new Map(
  ALL_EDITIONS.filter((e) => e.edition.protennislive_code).map((e) => [
    Number(e.edition.protennislive_code),
    e,
  ])
);

type Update = {
  slug: string;
  name: string;
  year: number;
  mainDrawSize: number | null;
  qualifyingDrawSize: number | null;
};

async function collectForSeason(year: number): Promise<{
  tournaments: TourneyDrawSizes[];
  errors: string[];
}> {
  const errors: string[] = [];
  const tournaments: TourneyDrawSizes[] = [];

  // Tour file carries levels A (250/500) and M (1000) plus Grand Slams (G).
  for (const [file, levels] of [
    [`atp_matches_${year}.csv`, ['A', 'M', 'G']],
    [`atp_matches_qual_chall_${year}.csv`, ['C']],
  ] as const) {
    try {
      tournaments.push(...parseSackmannDrawSizes(await fetchSackmannCsv(file), levels));
    } catch (err) {
      errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { tournaments, errors };
}

async function applySeason(
  year: number,
  apply: boolean
): Promise<{
  year: number;
  parsed: number;
  matched: number;
  updated: number;
  unmatched: string[];
  errors: string[];
  sample: Update[];
}> {
  const { tournaments, errors } = await collectForSeason(year);
  const unmatched: string[] = [];
  const sample: Update[] = [];
  let matched = 0;
  let updated = 0;

  for (const t of tournaments) {
    const entry = CODE_TO_EDITION.get(t.code);
    if (!entry) {
      if (unmatched.length < 25) unmatched.push(`${t.code} ${t.name}`);
      continue;
    }
    matched++;
    const slug = entry.tournament.slug;
    // A January event can belong to the previous ATP season; use the same
    // resolution the schedule importers use rather than the file's year.
    const editionYear = getAtpEditionYearForStartDate(t.startDate, year);

    const update: Update = {
      slug,
      name: entry.tournament.name,
      year: editionYear,
      mainDrawSize: t.mainDrawSize,
      qualifyingDrawSize: t.qualifyingDrawSize,
    };
    if (sample.length < 15) sample.push(update);

    if (!apply) continue;
    // coalesce keeps an existing value when this file has no row for that draw,
    // so re-running with a partial season never blanks a good size.
    const res = await pool.query(
      `update tournament_editions te
         set singles_draw_size = coalesce($3, te.singles_draw_size),
             qualifying_draw_size = coalesce($4, te.qualifying_draw_size),
             updated_at = now()
       from tournaments t
       where t.id = te.tournament_id
         and t.slug = $1
         and te.year = $2`,
      [slug, editionYear, t.mainDrawSize, t.qualifyingDrawSize]
    );
    updated += res.rowCount ?? 0;
  }

  return { year, parsed: tournaments.length, matched, updated, unmatched, errors, sample };
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const apply = params.get('apply') === 'true';
  const all = params.get('all') === 'true';
  const yearParam = params.get('year');

  let years: number[];
  if (all) {
    years = [...AVAILABLE_SEASONS].sort();
  } else if (yearParam) {
    const y = Number(yearParam);
    if (!isAvailableSeason(y)) {
      return NextResponse.json(
        { ok: false, error: `year must be one of ${AVAILABLE_SEASONS.join(', ')}` },
        { status: 400 }
      );
    }
    years = [y];
  } else {
    years = [CURRENT_SEASON];
  }

  try {
    const seasons = [];
    for (const y of years) seasons.push(await applySeason(y, apply));
    return NextResponse.json({
      ok: true,
      apply,
      note: apply ? undefined : 'dry run — pass apply=true to write',
      doublesCovered: false,
      seasons,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
