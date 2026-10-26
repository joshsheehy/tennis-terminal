import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { pool, withTransaction } from '@/lib/db';
import { ATP_SEASON_FOR_DATE_SQL, EDITION_IN_ITS_SEASON_SQL, getAtpWeekForSeason } from '@/lib/atp-week';
import { daysApart, DISTINCT_EVENT_MIN_DAYS } from '@/lib/official-calendar';
import { repointSavedTournaments } from '@/lib/saved-tournaments-repoint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Puts editions back in the season their date is actually in.
//
// Every importer used to file any December start under NEXT year's season,
// clamped to week 1 -- so the 7 and 14 December 2026 Challengers showed up in
// the first week of January 2027. getAtpEditionYearForStartDate now decides
// by date (only the Dec 29/30-style week right before next season's Week 1
// carries over), and this moves the rows already stored the old way:
//
//   - no edition of that tournament in the right season yet: the row's year
//     and week are corrected in place (same id, so codes, cuts, predictions
//     and entry lists all stay attached)
//   - one already exists for the SAME event (dates < 14 days apart, i.e. the
//     fixed importer already re-created it): the misfiled row's cuts are
//     folded into it, then the misfiled duplicate is dropped
//   - one exists for a DIFFERENT event: the row moves (same id) to a sibling
//     tournament "<slug>-2" for that season; reported as a conflict only if
//     no free sibling slug exists
//
// Idempotent; wired into the nightly official-calendar sync ahead of the
// import so nothing re-creates a row before it is moved.
//
//   GET /api/fix-season-years            dry run
//   GET /api/fix-season-years?apply=true

type Misfiled = {
  id: string;
  tournament_id: string;
  slug: string;
  year: number;
  target_year: number;
  start_date: string;
  level: string;
};

// First of <slug>-2..-4 that has no edition in that season yet.
async function siblingWithFreeSeason(tournamentId: string, slug: string, year: number): Promise<string | null> {
  for (const n of [2, 3, 4]) {
    const candidate = `${slug}-${n}`;
    const taken = await pool.query(
      `select 1 from tournament_editions te join tournaments t on t.id = te.tournament_id
       where t.slug = $1 and te.year = $2 and te.tournament_id <> $3`,
      [candidate, year, tournamentId]
    );
    if (taken.rowCount === 0) return candidate;
  }
  return null;
}

async function ensureSibling(tournamentId: string, siblingSlug: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `insert into tournaments (slug, name, city, country, updated_at)
     select $2, name, city, country, now() from tournaments where id = $1
     on conflict (slug) do update set updated_at = now()
     returning id`,
    [tournamentId, siblingSlug]
  );
  return result.rows[0].id;
}

export async function GET(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';

  const misfiled = await pool.query<Misfiled>(
    `select te.id, te.tournament_id, t.slug, te.year,
            ${ATP_SEASON_FOR_DATE_SQL('te.start_date')} as target_year,
            te.start_date::text as start_date, te.level
     from tournament_editions te
     join tournaments t on t.id = te.tournament_id
     where te.start_date is not null
       and not ${EDITION_IN_ITS_SEASON_SQL('te')}
       -- Only the old December bump: stored one season late. Anything else
       -- out of season is a different kind of stale row with its own fix.
       and ${ATP_SEASON_FOR_DATE_SQL('te.start_date')} = te.year - 1
       -- ITF never bumped December; its rows are already same-year.
       and te.level not ilike 'ITF%'
     order by te.start_date, t.slug`
  );

  const moved: Array<{ slug: string; from: number; to: number; startDate: string; week: number | null }> = [];
  const folded: Array<{ slug: string; from: number; to: number; startDate: string }> = [];
  const split: Array<{ slug: string; to: string; year: number; startDate: string; otherStartDate: string | null }> = [];
  const conflicts: Array<{ slug: string; year: number; startDate: string; otherStartDate: string | null }> = [];
  const errors: Array<{ slug: string; error: string }> = [];

  for (const row of misfiled.rows) {
    const week = getAtpWeekForSeason(row.start_date, row.target_year);
    try {
      const existing = await pool.query<{ id: string; start_date: string | null }>(
        `select id, start_date::text as start_date from tournament_editions
         where tournament_id = $1 and year = $2`,
        [row.tournament_id, row.target_year]
      );
      const other = existing.rows[0];

      if (!other) {
        if (apply) {
          await pool.query(
            `update tournament_editions set year = $2, week = $3, updated_at = now() where id = $1`,
            [row.id, row.target_year, week]
          );
        }
        moved.push({ slug: row.slug, from: row.year, to: row.target_year, startDate: row.start_date, week });
        continue;
      }

      if (other.start_date && daysApart(other.start_date, row.start_date) >= DISTINCT_EVENT_MIN_DAYS) {
        // A different event of the same tournament already holds that season.
        // Leaving this row where it is would hide it from every season, so it
        // moves (same id, everything attached) to a sibling tournament the way
        // upsertOfficialRow splits a city's second event of a season.
        const sibling = await siblingWithFreeSeason(row.tournament_id, row.slug, row.target_year);
        if (!sibling) {
          conflicts.push({ slug: row.slug, year: row.target_year, startDate: row.start_date, otherStartDate: other.start_date });
          continue;
        }
        if (apply) {
          const siblingId = await ensureSibling(row.tournament_id, sibling);
          await pool.query(
            `update tournament_editions set tournament_id = $2, year = $3, week = $4, updated_at = now() where id = $1`,
            [row.id, siblingId, row.target_year, week]
          );
        }
        split.push({ slug: row.slug, to: sibling, year: row.target_year, startDate: row.start_date, otherStartDate: other.start_date });
        continue;
      }

      if (apply) {
        await withTransaction(async (client) => {
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
            [row.id, other.id]
          );
          // Keep a ProTennisLive posting URL the misfiled row had found.
          await client.query(
            `update tournament_editions keep
             set source_url = coalesce(keep.source_url, '') || ' | ' ||
                   (regexp_match(misfiled.source_url, '(https?://[^ |]*/posting/\\d+/\\d+/)'))[1],
                 updated_at = now()
             from tournament_editions misfiled
             where keep.id = $2 and misfiled.id = $1
               and misfiled.source_url ~ '/posting/\\d+/\\d+/'
               and coalesce(keep.source_url, '') !~ '/posting/\\d+/\\d+/'`,
            [row.id, other.id]
          );
          await repointSavedTournaments(client, row.id, other.id);
          await client.query('delete from tournament_editions where id = $1', [row.id]);
        });
      }
      folded.push({ slug: row.slug, from: row.year, to: row.target_year, startDate: row.start_date });
    } catch (err) {
      errors.push({ slug: row.slug, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (apply && (moved.length || folded.length || split.length)) {
    try {
      revalidateTag('schedule');
    } catch {
      // revalidateTag can throw outside the cache runtime; safe to swallow.
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    apply,
    misfiledCount: misfiled.rows.length,
    movedCount: moved.length,
    foldedDuplicateCount: folded.length,
    splitCount: split.length,
    conflictCount: conflicts.length,
    moved,
    folded,
    split,
    conflicts,
    errors,
    message: apply ? undefined : 'Dry run. Append ?apply=true to move these rows.',
  });
}
