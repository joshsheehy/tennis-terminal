import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { cityKeySql } from '@/lib/city-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One event held under several tournament records.
//
// /api/city-dupes finds duplicate EDITIONS — two rows for the same tournament in
// the same week of the same year. It cannot see this: a split where the 2025
// edition sits under one tournament record and the 2026 edition under another,
// because there is never a week where both appear.
//
// The consequence is worse than a repeated row on the schedule. Cut history
// hangs off the tournament, so a split event's history stops at the year it was
// renamed — which is the one number this site exists to show. Mouilleron-le-
// Captif ran under three records at once: "Open De Vendée" holding the 2025
// history, and "Open de Vendée" and "Mouilleron-le-Captif" splitting 2026.
//
// Read-only. Merging is a judgement call about which record is canonical, so it
// stays with /api/merge-tournaments and a human.

type SplitRow = {
  city_key: string;
  tournament_count: string;
  records: Array<{
    tournament_id: string;
    slug: string;
    name: string;
    city: string | null;
    country: string | null;
    years: number[];
    edition_count: number;
    cutoff_count: number;
  }>;
};

export async function GET(request: NextRequest) {
  const minTournaments = Number(request.nextUrl.searchParams.get('min') ?? '2');

  const { rows } = await pool.query<SplitRow>(
    `
    with per_tournament as (
      select
        t.id as tournament_id,
        t.slug,
        t.name,
        t.city,
        t.country,
        ${cityKeySql('t.city')} as city_key,
        array_agg(distinct te.year order by te.year) as years,
        count(distinct te.id)::int as edition_count,
        (
          select count(*)::int
          from cutoff_snapshots cs
          join tournament_editions te2 on te2.id = cs.tournament_edition_id
          where te2.tournament_id = t.id
        ) as cutoff_count
      from tournaments t
      join tournament_editions te on te.tournament_id = t.id
      where t.city is not null
        -- ITF events legitimately share a city with an ATP or Challenger stop,
        -- and are separate tournaments however similar the address looks.
        and te.level not ilike 'ITF%'
      group by t.id, t.slug, t.name, t.city, t.country
    )
    select
      city_key,
      count(*) as tournament_count,
      json_agg(json_build_object(
        'tournament_id', tournament_id,
        'slug', slug,
        'name', name,
        'city', city,
        'country', country,
        'years', years,
        'edition_count', edition_count,
        'cutoff_count', cutoff_count
      ) order by cutoff_count desc, edition_count desc) as records
    from per_tournament
    where city_key <> ''
    group by city_key
    having count(*) >= $1
    order by count(*) desc, city_key
    `,
    [Number.isFinite(minTournaments) && minTournaments >= 2 ? minTournaments : 2]
  );

  const splits = rows.map((row) => {
    const records = row.records;
    // The record carrying the most history is the one worth keeping; merging
    // into it moves the fewest cuts and breaks the fewest links.
    const [canonical, ...others] = records;
    return {
      cityKey: row.city_key,
      city: canonical.city,
      country: canonical.country,
      tournamentCount: Number(row.tournament_count),
      suggestedCanonical: canonical.slug,
      records,
      mergeLinks: others.map(
        (other) => `/api/merge-tournaments?from=${other.slug}&to=${canonical.slug}&apply=true`
      ),
    };
  });

  return NextResponse.json({
    ok: true,
    splitCount: splits.length,
    note: 'Read-only. Each mergeLink moves one record into the suggested canonical tournament; check the suggestion before running it.',
    splits,
  });
}
