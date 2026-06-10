import { NextRequest, NextResponse } from 'next/server';
import { pool, withTransaction } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CANONICAL_SLUGS = new Set(ALL_EDITIONS.map((e) => e.tournament.slug));

// Codes that were intentionally reassigned to a new city/tournament and must
// NOT be collapsed by dedupe-by-code even though multiple slugs share the code.
// 496: Open Provence Marseille (2024-2025) → Grand Prix Auvergne-Rhône-Alpes Lyon (2026+)
const SKIP_MERGE_CODES = new Set(['496']);

// Merges tournament rows that share the same ProTennisLive code. The bug:
// the challenger importer was generating slugs like "burnie-ch-burnie-ch"
// while the canonical/imported "burnie-burnie" or "burnie" represents the
// exact same tournament. Both end up with the same code (from the same PTL
// posting URL) and identical editions. This endpoint groups by code, picks
// a winner per group, moves the ghost's editions onto the winner, merges
// any cutoff_snapshots that conflict, and deletes the ghost row.
//
// Dry run by default; ?apply=true to commit.

type TournamentRow = {
  id: string;
  slug: string;
  name: string;
  city: string;
  country: string | null;
  edition_count: number;
};

type CodeGroup = {
  code: string;
  tournaments: TournamentRow[];
};

function scoreSlug(slug: string): number {
  // Higher score = better winner. Canonical wins big; clean (non-doubled)
  // slugs beat the "-ch-x-ch-x" doubled JeffSackmann mess; shorter beats
  // longer.
  let score = 0;
  if (CANONICAL_SLUGS.has(slug)) score += 1000;
  if (!/\b(ch)\b/.test(slug)) score += 50;
  // Detect doubled patterns like "x-y-x-y" or "x-ch-x-ch".
  const half = Math.floor(slug.length / 2);
  if (slug.length % 2 === 1 && slug[half] === '-' && slug.slice(0, half) === slug.slice(half + 1)) {
    score -= 200;
  }
  score -= slug.length;
  return score;
}

function pickWinner(rows: TournamentRow[]): TournamentRow {
  return [...rows].sort((a, b) => scoreSlug(b.slug) - scoreSlug(a.slug))[0];
}

async function findGroups(): Promise<CodeGroup[]> {
  const result = await pool.query<{
    id: string;
    slug: string;
    name: string;
    city: string;
    country: string | null;
    edition_count: string;
    codes: string[];
  }>(
    `
    with code_per_tournament as (
      select
        t.id,
        t.slug,
        t.name,
        t.city,
        t.country,
        (
          select array_agg(distinct code)
          from (
            select substring(te.source_url from '/posting/\\d+/(\\d+)/') as code
            from tournament_editions te
            where te.tournament_id = t.id and te.source_url is not null
            union
            select substring(te.source_url from '/archive/[^/]+/(\\d+)/\\d{4}/results') as code
            from tournament_editions te
            where te.tournament_id = t.id and te.source_url is not null
            union
            select substring(te.source_url from '/tournaments/[^/]+/(\\d+)/') as code
            from tournament_editions te
            where te.tournament_id = t.id and te.source_url is not null
            union
            select substring(cs.source_notes from '/posting/\\d+/(\\d+)/') as code
            from cutoff_snapshots cs
            join tournament_editions te on te.id = cs.tournament_edition_id
            where te.tournament_id = t.id and cs.source_notes is not null
          ) extracted
          where code is not null
        ) as codes,
        (select count(*) from tournament_editions te where te.tournament_id = t.id)::text as edition_count
      from tournaments t
    )
    select id, slug, name, city, country, edition_count, coalesce(codes, '{}') as codes
    from code_per_tournament
    where codes is not null and array_length(codes, 1) > 0
    `
  );

  // Bucket tournaments by code. Tournaments may appear in multiple buckets if
  // their editions have different codes; only the buckets with >1 tournament
  // are interesting for merging.
  const byCode = new Map<string, TournamentRow[]>();
  for (const row of result.rows) {
    const tr: TournamentRow = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      city: row.city,
      country: row.country,
      edition_count: Number(row.edition_count),
    };
    for (const code of row.codes) {
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code)!.push(tr);
    }
  }

  const groups: CodeGroup[] = [];
  const seenPair = new Set<string>();
  for (const [code, tournaments] of byCode) {
    if (SKIP_MERGE_CODES.has(code)) continue;
    if (tournaments.length < 2) continue;
    // Dedupe tournaments within the bucket (same row added twice for two editions).
    const unique = Array.from(new Map(tournaments.map((t) => [t.id, t])).values());
    if (unique.length < 2) continue;
    // Avoid emitting the same {a,b,...} group twice when two codes overlap.
    const key = unique.map((t) => t.id).sort().join('|');
    if (seenPair.has(key)) continue;
    seenPair.add(key);
    groups.push({ code, tournaments: unique });
  }
  return groups;
}

async function mergeGroup(group: CodeGroup) {
  const winner = pickWinner(group.tournaments);
  const ghosts = group.tournaments.filter((t) => t.id !== winner.id);

  let movedEditions = 0;
  let mergedSnapshots = 0;
  let deletedGhostEditions = 0;
  let upgradedWinnerMetadata = 0;

  for (const ghost of ghosts) {
    await withTransaction(async (client) => {
      const ghostEditions = await client.query<{ id: string; year: number }>(
        'select id, year from tournament_editions where tournament_id = $1',
        [ghost.id]
      );
      const winnerYears = await client.query<{ year: number; id: string }>(
        'select id, year from tournament_editions where tournament_id = $1',
        [winner.id]
      );
      const winnerYearMap = new Map(winnerYears.rows.map((r) => [r.year, r.id]));

      for (const ed of ghostEditions.rows) {
        const winnerEditionId = winnerYearMap.get(ed.year);
        if (winnerEditionId) {
          // If one duplicate has exact Challenger level metadata and the other
          // has older generic "Challenger" metadata, preserve the exact row's
          // level/date/surface on the surviving edition before deleting it.
          const metadataResult = await client.query(
            `update tournament_editions winner
             set
               week = case
                 when winner.level = 'Challenger' and ghost.level ~* '^Challenger\\s+(50|75|100|125|175)$'
                 then ghost.week else winner.week end,
               start_date = case
                 when winner.level = 'Challenger' and ghost.level ~* '^Challenger\\s+(50|75|100|125|175)$'
                 then ghost.start_date else winner.start_date end,
               end_date = case
                 when winner.level = 'Challenger' and ghost.level ~* '^Challenger\\s+(50|75|100|125|175)$'
                 then ghost.end_date else winner.end_date end,
               level = case
                 when winner.level = 'Challenger' and ghost.level ~* '^Challenger\\s+(50|75|100|125|175)$'
                 then ghost.level else winner.level end,
               surface = case
                 when winner.level = 'Challenger' and ghost.level ~* '^Challenger\\s+(50|75|100|125|175)$'
                 then ghost.surface else winner.surface end,
               indoor = case
                 when winner.level = 'Challenger' and ghost.level ~* '^Challenger\\s+(50|75|100|125|175)$'
                 then ghost.indoor else winner.indoor end,
               source_url = case
                 when ghost.source_url is null or ghost.source_url = '' then winner.source_url
                 when winner.source_url is null or winner.source_url = '' then ghost.source_url
                 when winner.source_url ilike '%' || ghost.source_url || '%' then winner.source_url
                 else winner.source_url || ' | ' || ghost.source_url
               end,
               updated_at = now()
             from tournament_editions ghost
             where winner.id = $1
               and ghost.id = $2
               and winner.level = 'Challenger'
               and ghost.level ~* '^Challenger\\s+(50|75|100|125|175)$'`,
            [winnerEditionId, ed.id]
          );
          upgradedWinnerMetadata += metadataResult.rowCount ?? 0;

          // Move cutoff_snapshots; on conflict prefer existing winner row if
          // its rank is filled, else replace with ghost's row.
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
             on conflict (tournament_edition_id, event_type, draw_type) do update set
               last_direct_acceptance_rank = coalesce(cutoff_snapshots.last_direct_acceptance_rank, excluded.last_direct_acceptance_rank),
               last_direct_acceptance_player_name = coalesce(cutoff_snapshots.last_direct_acceptance_player_name, excluded.last_direct_acceptance_player_name),
               challenger_doubles_advanced_cut_rank = coalesce(cutoff_snapshots.challenger_doubles_advanced_cut_rank, excluded.challenger_doubles_advanced_cut_rank),
               challenger_doubles_onsite_cut_rank = coalesce(cutoff_snapshots.challenger_doubles_onsite_cut_rank, excluded.challenger_doubles_onsite_cut_rank),
               source_notes = case when cutoff_snapshots.last_direct_acceptance_rank is null then excluded.source_notes else cutoff_snapshots.source_notes end,
               updated_at = now()`,
            [ed.id, winnerEditionId]
          );
          mergedSnapshots += 1;
          await client.query('delete from cutoff_snapshots where tournament_edition_id = $1', [ed.id]);
          await client.query('delete from tournament_editions where id = $1', [ed.id]);
          deletedGhostEditions += 1;
        } else {
          await client.query(
            'update tournament_editions set tournament_id = $1, updated_at = now() where id = $2',
            [winner.id, ed.id]
          );
          movedEditions += 1;
        }
      }

      await client.query('delete from tournaments where id = $1', [ghost.id]);
    });
  }

  return { winner: winner.slug, ghosts: ghosts.map((g) => g.slug), movedEditions, mergedSnapshots, deletedGhostEditions, upgradedWinnerMetadata };
}

export async function GET(request: NextRequest) {
  const apply = request.nextUrl.searchParams.get('apply') === 'true';
  const groups = await findGroups();

  if (!apply) {
    return NextResponse.json({
      ok: true,
      apply: false,
      groupCount: groups.length,
      groups: groups.map((g) => ({
        code: g.code,
        winner: pickWinner(g.tournaments).slug,
        members: g.tournaments.map((t) => ({ slug: t.slug, name: t.name, city: t.city, editions: t.edition_count })),
      })),
      message: 'Dry run. Append ?apply=true to merge.',
    });
  }

  const merged: Awaited<ReturnType<typeof mergeGroup>>[] = [];
  const errors: Array<{ code: string; error: string }> = [];
  for (const group of groups) {
    try {
      merged.push(await mergeGroup(group));
    } catch (err) {
      errors.push({ code: group.code, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    ok: true,
    apply: true,
    mergedGroupCount: merged.length,
    errorCount: errors.length,
    merged,
    errors,
  });
}