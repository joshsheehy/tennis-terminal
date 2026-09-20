import { ensureByesColumn, pool, withTransaction } from './db';

// The transactional core of /api/merge-tournaments, factored out so
// /api/resolve-tournament-aliases can reuse it for the same-event duplicates
// that recur from an outside data source rather than being fixed once by hand.
//
// Moves every edition from the ghost tournament into the canonical one. A year
// the canonical already has gets its cutoff_snapshots folded in (existing
// values win on conflict — the canonical row is trusted) and the ghost edition
// is dropped; any other year moves over wholesale. Deletes the ghost tournament
// row once it has no editions left.

export type TournamentRow = { id: string; slug: string; name: string; city: string | null; country: string | null };

export async function resolveTournamentBySlugOrText(query: string): Promise<TournamentRow[]> {
  const bySlug = await pool.query<TournamentRow>(
    `select id, slug, name, city, country from tournaments where slug = $1`,
    [query]
  );
  if (bySlug.rows.length) return bySlug.rows;

  const byText = await pool.query<TournamentRow>(
    `select id, slug, name, city, country from tournaments
     where name ilike $1 or city ilike $1 or slug ilike $1
     order by name
     limit 10`,
    [`%${query}%`]
  );
  return byText.rows;
}

export type MergeSummary = { movedEditions: number; mergedConflictYears: number; ghostDeleted: boolean };

export async function mergeTournaments(ghostId: string, canonicalId: string): Promise<MergeSummary> {
  await ensureByesColumn();
  const ghostEditions = await pool.query<{ id: string; year: number }>(
    `select id, year from tournament_editions where tournament_id = $1 order by year`,
    [ghostId]
  );

  return withTransaction(async (client) => {
    let movedEditions = 0;
    let mergedConflictYears = 0;

    const canonicalYears = await client.query<{ year: number }>(
      `select year from tournament_editions where tournament_id = $1`,
      [canonicalId]
    );
    const yearSet = new Set(canonicalYears.rows.map((r) => r.year));

    for (const ed of ghostEditions.rows) {
      if (yearSet.has(ed.year)) {
        // Canonical already has this year — merge cutoffs into its edition, then drop the ghost edition.
        const target = await client.query<{ id: string }>(
          `select id from tournament_editions where tournament_id = $1 and year = $2 limit 1`,
          [canonicalId, ed.year]
        );
        const targetId = target.rows[0]?.id;
        if (!targetId) continue;

        await client.query(
          `insert into cutoff_snapshots (
             tournament_edition_id, event_type, draw_type, source_type,
             last_direct_acceptance_rank, last_direct_acceptance_player_name,
             last_alternate_rank, last_alternate_player_name,
             challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
             challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
             parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, byes_count, updated_at
           )
           select $2,
             event_type, draw_type, source_type,
             last_direct_acceptance_rank, last_direct_acceptance_player_name,
             last_alternate_rank, last_alternate_player_name,
             challenger_doubles_advanced_cut_rank, challenger_doubles_advanced_team_name,
             challenger_doubles_onsite_cut_rank, challenger_doubles_onsite_team_name,
             parsed_at, parser_version, source_notes, alternate_entries_count, lucky_loser_count, byes_count, now()
           from cutoff_snapshots
           where tournament_edition_id = $1
           on conflict (tournament_edition_id, event_type, draw_type) do nothing`,
          [ed.id, targetId]
        );
        await client.query('delete from cutoff_snapshots where tournament_edition_id = $1', [ed.id]);
        await client.query('delete from tournament_editions where id = $1', [ed.id]);
        mergedConflictYears += 1;
      } else {
        await client.query('update tournament_editions set tournament_id = $1, updated_at = now() where id = $2', [
          canonicalId,
          ed.id,
        ]);
        movedEditions += 1;
      }
    }

    const remaining = await client.query<{ cnt: string }>(
      'select count(*) as cnt from tournament_editions where tournament_id = $1',
      [ghostId]
    );
    const ghostDeleted = Number(remaining.rows[0].cnt) === 0;
    if (ghostDeleted) await client.query('delete from tournaments where id = $1', [ghostId]);

    return { movedEditions, mergedConflictYears, ghostDeleted };
  });
}
