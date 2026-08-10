import { NextRequest, NextResponse } from 'next/server';
import { pool, withTransaction } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CANONICAL_SLUGS = new Set(ALL_EDITIONS.map((e) => e.tournament.slug));

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/,\s*[a-z]{2}$/, '')
    // Hyphens/underscores are word separators, not part of the word: the ATP
    // archive writes "Mouilleron le Captif" where the official calendar writes
    // "Mouilleron-le-Captif". Without this the same city lands in two different
    // buckets and its duplicate rows are never even compared.
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levelBucket(level: string): 'atp' | 'challenger' | 'other' {
  const n = normalize(level);
  if (n.includes('challenger')) return 'challenger';
  if (n.includes('atp')) return 'atp';
  return 'other';
}

export async function GET(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get('dryRun') !== 'false';

  const allTournaments = await pool.query<{
    id: string; slug: string; name: string; city: string; country: string | null; edition_count: string; levels: string[];
  }>(
    `select t.id, t.slug, t.name, t.city, t.country,
            count(te.id)::text as edition_count,
            coalesce(array_remove(array_agg(distinct te.level), null), '{}') as levels
     from tournaments t
     left join tournament_editions te on te.tournament_id = t.id
     group by t.id, t.slug, t.name, t.city, t.country`
  );

  const byCity = new Map<string, typeof allTournaments.rows>();
  for (const row of allTournaments.rows) {
    const key = normalize(row.city ?? row.name);
    if (!byCity.has(key)) byCity.set(key, []);
    byCity.get(key)!.push(row);
  }

  const mergePairs: Array<{ canonical: (typeof allTournaments.rows)[0]; ghost: (typeof allTournaments.rows)[0]; normKey: string }> = [];
  const blockedPairs: Array<{ normKey: string; canonical: string; ghost: string; reason: string }> = [];

  for (const [normKey, rows] of byCity) {
    if (rows.length < 2) continue;
    const canonical = rows.find((r) => CANONICAL_SLUGS.has(r.slug));
    if (!canonical) continue;
    const ghosts = rows.filter((r) => !CANONICAL_SLUGS.has(r.slug));

    for (const ghost of ghosts) {
      const countryOk = !ghost.country || ghost.country === canonical.country;
      const nameNorm = normalize(ghost.name);
      const canonicalNameNorm = normalize(canonical.name);
      const canonicalCityNorm = normalize(canonical.city);
      const nameOk = nameNorm === canonicalNameNorm || nameNorm === canonicalCityNorm;

      const ghostKinds = new Set(ghost.levels.map(levelBucket));
      const canonicalKinds = new Set(canonical.levels.map(levelBucket));
      const levelsOk =
        (ghostKinds.has('challenger') && canonicalKinds.has('challenger') && !canonicalKinds.has('atp')) ||
        (ghostKinds.has('atp') && canonicalKinds.has('atp') && !canonicalKinds.has('challenger'));

      if (!countryOk) {
        blockedPairs.push({ normKey, canonical: canonical.slug, ghost: ghost.slug, reason: 'incompatible_country' });
      } else if (!nameOk) {
        blockedPairs.push({ normKey, canonical: canonical.slug, ghost: ghost.slug, reason: 'incompatible_name' });
      } else if (!levelsOk) {
        blockedPairs.push({ normKey, canonical: canonical.slug, ghost: ghost.slug, reason: 'incompatible_level' });
      } else {
        mergePairs.push({ canonical, ghost, normKey });
      }
    }
  }

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, pairsFound: mergePairs.length, blockedPairs, pairs: mergePairs.map((p) => ({ normKey: p.normKey, canonical: { slug: p.canonical.slug, name: p.canonical.name, editions: p.canonical.edition_count, levels: p.canonical.levels }, ghost: { slug: p.ghost.slug, name: p.ghost.name, editions: p.ghost.edition_count, levels: p.ghost.levels } })) });
  }

  const merged = [];
  const errors = [];

  for (const { canonical, ghost } of mergePairs) {
    try {
      const summary = await withTransaction(async (client) => {
        const ghostEditions = await client.query<{ id: string; year: number }>(`select te.id, te.year from tournament_editions te where te.tournament_id = $1`, [ghost.id]);
        const canonicalYears = await client.query<{ year: number }>(`select year from tournament_editions where tournament_id = $1`, [canonical.id]);
        const canonicalYearSet = new Set(canonicalYears.rows.map((r) => r.year));
        let movedEditions = 0;
        let skippedConflicts = 0;

        for (const ed of ghostEditions.rows) {
          if (canonicalYearSet.has(ed.year)) {
            const targetEdition = await client.query<{ id: string }>('select id from tournament_editions where tournament_id = $1 and year = $2 limit 1', [canonical.id, ed.year]);
            if (!targetEdition.rows[0]?.id) {
              skippedConflicts++;
              continue;
            }
            await client.query(
              `insert into cutoff_snapshots (
                 tournament_edition_id, event_type, draw_type, source_type,
                 last_direct_acceptance_rank, last_direct_acceptance_player_name,
                 last_alternate_rank, last_alternate_player_name,
                 challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
                 challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
                 parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, updated_at
               )
               select $2,
                 event_type, draw_type, source_type,
                 last_direct_acceptance_rank, last_direct_acceptance_player_name,
                 last_alternate_rank, last_alternate_player_name,
                 challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
                 challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
                 parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, now()
               from cutoff_snapshots
               where tournament_edition_id = $1
               on conflict (tournament_edition_id, event_type, draw_type) do nothing`,
              [ed.id, targetEdition.rows[0].id]
            );
            await client.query('delete from cutoff_snapshots where tournament_edition_id = $1', [ed.id]);
            await client.query('delete from tournament_editions where id = $1', [ed.id]);
            skippedConflicts++;
          } else {
            await client.query('update tournament_editions set tournament_id = $1, updated_at = now() where id = $2', [canonical.id, ed.id]);
            movedEditions++;
          }
        }

        const remaining = await client.query<{ cnt: string }>('select count(*) as cnt from tournament_editions where tournament_id = $1', [ghost.id]);
        if (Number(remaining.rows[0].cnt) === 0) await client.query('delete from tournaments where id = $1', [ghost.id]);
        return { movedEditions, skippedConflicts };
      });
      merged.push({ canonical: canonical.slug, ghost: ghost.slug, ...summary });
    } catch (err) {
      errors.push({ canonical: canonical.slug, ghost: ghost.slug, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ ok: true, dryRun: false, mergedCount: merged.length, errorCount: errors.length, blockedPairs, merged, errors });
}
