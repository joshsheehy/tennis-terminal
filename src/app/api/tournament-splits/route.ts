import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { cityKeySql } from '@/lib/city-key';
import { clusterSplits, suggestCanonical, type SplitRecord } from '@/lib/tournament-splits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One event held under several tournament records.
//
// /api/city-dupes finds duplicate EDITIONS — two rows for the same tournament in
// the same week of the same year. It cannot see a split where the 2025 edition
// sits under one tournament record and the 2026 edition under another, because
// no single week contains both.
//
// That case matters more than a repeated schedule row: cut history hangs off the
// tournament, so a split event's history stops at the year it was renamed.
// Mouilleron-le-Captif ran under three records at once — "Open De Vendée"
// holding 2022-2026, and two others splitting 2026.
//
// Candidates are narrowed by folded city, then decided on the calendar: see
// src/lib/tournament-splits.ts. City alone is not evidence — Paris holds Roland
// Garros and the Rolex Paris Masters, and Oeiras runs four Challengers.
//
// Read-only. Merging deletes rows and is a judgement call, so it stays with
// /api/merge-tournaments and a human.

type Row = {
  tournament_id: string;
  slug: string;
  name: string;
  city: string | null;
  country: string | null;
  city_key: string;
  editions: Array<{ year: number; week: number; level: string }>;
  cutoff_count: number;
};

export async function GET(request: NextRequest) {
  const reasonFilter = request.nextUrl.searchParams.get('reason');

  const { rows } = await pool.query<Row>(
    `
    select
      t.id as tournament_id,
      t.slug,
      t.name,
      t.city,
      t.country,
      ${cityKeySql('t.city')} as city_key,
      json_agg(json_build_object(
        'year', te.year,
        'week', extract(week from te.start_date)::int,
        'level', te.level
      )) as editions,
      (
        select count(*)::int
        from cutoff_snapshots cs
        join tournament_editions te2 on te2.id = cs.tournament_edition_id
        where te2.tournament_id = t.id
      ) as cutoff_count
    from tournaments t
    join tournament_editions te on te.tournament_id = t.id
    where t.city is not null
      and te.start_date is not null
      -- ITF events legitimately share a city and a week with a Challenger stop
      -- and are separate tournaments however alike the address looks.
      and te.level not ilike 'ITF%'
    group by t.id, t.slug, t.name, t.city, t.country
    `
  );

  const byCity = new Map<string, SplitRecord[]>();
  for (const row of rows) {
    if (!row.city_key) continue;
    const record: SplitRecord = {
      tournamentId: row.tournament_id,
      slug: row.slug,
      name: row.name,
      city: row.city,
      country: row.country,
      editions: row.editions ?? [],
      cutoffCount: row.cutoff_count,
    };
    byCity.set(row.city_key, [...(byCity.get(row.city_key) ?? []), record]);
  }

  const splits = [];
  for (const [cityKey, records] of byCity) {
    if (records.length < 2) continue;
    for (const cluster of clusterSplits(records)) {
      const canonical = suggestCanonical(cluster.records);
      const others = cluster.records.filter((r) => r.tournamentId !== canonical.tournamentId);
      splits.push({
        cityKey,
        city: canonical.city,
        country: canonical.country,
        reasons: cluster.reasons,
        suggestedCanonical: canonical.slug,
        records: cluster.records.map((r) => ({
          slug: r.slug,
          name: r.name,
          city: r.city,
          years: [...new Set(r.editions.map((e) => e.year))].sort(),
          weeks: [...new Set(r.editions.map((e) => e.week))].sort((a, b) => a - b),
          levels: [...new Set(r.editions.map((e) => e.level))],
          editionCount: r.editions.length,
          cutoffCount: r.cutoffCount,
        })),
        mergeLinks: others.map(
          (other) => `/api/merge-tournaments?from=${other.slug}&to=${canonical.slug}&apply=true`
        ),
      });
    }
  }

  const filtered = reasonFilter
    ? splits.filter((split) => split.reasons.includes(reasonFilter as never))
    : splits;

  filtered.sort((a, b) => b.records.length - a.records.length || a.cityKey.localeCompare(b.cityKey));

  return NextResponse.json({
    ok: true,
    splitCount: filtered.length,
    note: 'Read-only. Check each suggestion before running its merge link — the canonical is the record holding the most cut history, which is a heuristic, not a fact.',
    splits: filtered,
  });
}
