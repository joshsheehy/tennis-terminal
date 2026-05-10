import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Finds tournament rows where a JeffSackmann import (name=city, country=null)
// matches a canonical tournament (from tournament-data.ts) by city name,
// then merges all editions from the JeffSackmann row into the canonical row,
// across all years. This fixes the "Savannah vs Savannah, GA" style history gaps.
//
// Normalization strips accents and ", XX" state suffixes before comparing.
//
// ?dryRun=false to actually merge (default: dryRun=true)

const CANONICAL_SLUGS = new Set(ALL_EDITIONS.map((e) => e.tournament.slug));

function normCity(s: string): string {
  return s
    .toLowerCase()
    .replace(/áàãâäéèêëíìîïóòõôöúùûüçñ/g, (c) => 'aaaaaeeeeiiiiooooouuuucn'['áàãâäéèêëíìîïóòõôöúùûüçñ'.indexOf(c)])
    .replace(/,\s*[a-z]{2}$/, '')
    .trim();
}

export async function GET(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get('dryRun') !== 'false';

  // Load all tournament rows with their edition counts
  const allTournaments = await pool.query<{
    id: string;
    slug: string;
    name: string;
    city: string;
    country: string | null;
    edition_count: string;
  }>(
    `select t.id, t.slug, t.name, t.city, t.country,
            count(te.id)::text as edition_count
     from tournaments t
     left join tournament_editions te on te.tournament_id = t.id
     group by t.id, t.slug, t.name, t.city, t.country`
  );

  // Group by normalized city
  const byCity = new Map<string, typeof allTournaments.rows>();
  for (const row of allTournaments.rows) {
    const key = normCity(row.city ?? row.name);
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key)!.push(row);
  }

  // Find groups where there's both a canonical and a non-canonical entry
  const mergePairs: Array<{
    canonical: (typeof allTournaments.rows)[0];
    ghost: (typeof allTournaments.rows)[0];
    normKey: string;
  }> = [];

  for (const [normKey, rows] of byCity) {
    if (rows.length < 2) continue;
    const canonical = rows.find((r) => CANONICAL_SLUGS.has(r.slug));
    if (!canonical) continue;
    const ghosts = rows.filter((r) => !CANONICAL_SLUGS.has(r.slug));
    for (const ghost of ghosts) {
      mergePairs.push({ canonical, ghost, normKey });
    }
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      pairsFound: mergePairs.length,
      pairs: mergePairs.map((p) => ({
        normKey: p.normKey,
        canonical: { slug: p.canonical.slug, name: p.canonical.name, editions: p.canonical.edition_count },
        ghost: { slug: p.ghost.slug, name: p.ghost.name, editions: p.ghost.edition_count },
      })),
    });
  }

  const merged = [];
  const errors = [];

  for (const { canonical, ghost } of mergePairs) {
    try {
      await pool.query('BEGIN');

      // Get editions from ghost that don't conflict with canonical (different year)
      const ghostEditions = await pool.query<{ id: string; year: number }>(
        `select te.id, te.year from tournament_editions te
         where te.tournament_id = $1`,
        [ghost.id]
      );

      const canonicalYears = await pool.query<{ year: number }>(
        `select year from tournament_editions where tournament_id = $1`,
        [canonical.id]
      );
      const canonicalYearSet = new Set(canonicalYears.rows.map((r) => r.year));

      let movedEditions = 0;
      let skippedConflicts = 0;

      for (const ed of ghostEditions.rows) {
        if (canonicalYearSet.has(ed.year)) {
          // Conflict: canonical already has this year — migrate cutoffs then delete ghost edition
          await pool.query(
            `insert into cutoff_snapshots (
               tournament_edition_id, event_type, draw_type, source_type,
               last_direct_acceptance_rank, last_direct_acceptance_player_name,
               last_alternate_rank, last_alternate_player_name,
               challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
               challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
               parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, updated_at
             )
             select (select id from tournament_editions where tournament_id = $2 and year = $3 limit 1),
               event_type, draw_type, source_type,
               last_direct_acceptance_rank, last_direct_acceptance_player_name,
               last_alternate_rank, last_alternate_player_name,
               challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
               challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
               parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, now()
             from cutoff_snapshots
             where tournament_edition_id = $1
             on conflict (tournament_edition_id, event_type, draw_type) do nothing`,
            [ed.id, canonical.id, ed.year]
          );
          await pool.query('delete from cutoff_snapshots where tournament_edition_id = $1', [ed.id]);
          await pool.query('delete from tournament_editions where id = $1', [ed.id]);
          skippedConflicts++;
        } else {
          // No conflict: just reassign to canonical tournament
          await pool.query(
            'update tournament_editions set tournament_id = $1, updated_at = now() where id = $2',
            [canonical.id, ed.id]
          );
          movedEditions++;
        }
      }

      // Delete ghost tournament if now empty
      const remaining = await pool.query<{ cnt: string }>(
        'select count(*) as cnt from tournament_editions where tournament_id = $1',
        [ghost.id]
      );
      if (Number(remaining.rows[0].cnt) === 0) {
        await pool.query('delete from tournaments where id = $1', [ghost.id]);
      }

      await pool.query('COMMIT');
      merged.push({
        canonical: canonical.slug,
        ghost: ghost.slug,
        movedEditions,
        skippedConflicts,
      });
    } catch (err) {
      await pool.query('ROLLBACK');
      errors.push({
        canonical: canonical.slug,
        ghost: ghost.slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    mergedCount: merged.length,
    errorCount: errors.length,
    merged,
    errors,
  });
}
