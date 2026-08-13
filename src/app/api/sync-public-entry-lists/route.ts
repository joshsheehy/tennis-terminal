import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { pool, withTransaction } from '@/lib/db';
import {
  parseSpazioChallengerWeekHtml,
  type PublicEntryRow,
  type PublicEntryTournament,
} from '@/lib/spazio-entry-list-parser';
import { tallyRoutes, type RouteTally } from '@/lib/entry-codes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WEEK_START = '2026-08-17';
const SOURCE_KEY = 'spaziotennis-week33';
const SOURCE_URL =
  'https://www.spaziotennis.com/wp-json/wp/v2/posts/139834';
const DISPLAY_URL =
  'https://www.spaziotennis.com/trn/ent/entry-list-atp-challenger-2026-week-33-cancun-quebec-city-kingston-praga-roehampton-sion/139834';

type StoredSnapshot = {
  parsed_payload: PublicEntryTournament[];
};

function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .sort()
    .join(' ');
}

function fingerprint(parts: Array<string | number | null>): string {
  return createHash('sha256').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex');
}

function rowMovement(row: PublicEntryRow, section: 'main' | 'main_alt') {
  if (row.marker === 'active') return null;
  if (section === 'main_alt' && row.marker === 'in') {
    return {
      movementType: 'md_alt_to_md',
      fromSection: 'main_alt',
      toSection: 'main',
      qSpotsDelta: 0,
      detail: 'Public source marks MD alternate IN',
    } as const;
  }
  if (row.marker === 'out' && section === 'main') {
    return {
      movementType: 'md_withdrawal',
      fromSection: 'main',
      toSection: 'out',
      qSpotsDelta: 0,
      detail: 'Public source explicitly marks main-draw player OUT',
    } as const;
  }
  return {
    movementType: 'removed_unknown',
    fromSection: section,
    toSection: 'out',
    qSpotsDelta: 0,
    detail: `Public source marks row ${row.marker}; exact reason not verified`,
  } as const;
}

function flatten(snapshot: PublicEntryTournament[]) {
  const rows = new Map<string, { tournamentSlug: string; section: 'main' | 'main_alt'; row: PublicEntryRow; position: number }>();
  for (const tournament of snapshot) {
    tournament.main.forEach((row, index) => {
      rows.set(`${tournament.slug}|main|${nameKey(row.name)}`, {
        tournamentSlug: tournament.slug,
        section: 'main',
        row,
        position: index + 1,
      });
    });
    tournament.alternates.forEach((row, index) => {
      rows.set(`${tournament.slug}|main_alt|${nameKey(row.name)}`, {
        tournamentSlug: tournament.slug,
        section: 'main_alt',
        row,
        position: index + 1,
      });
    });
  }
  return rows;
}

/**
 * A player has left a list when the source marks them gone. What counts as gone
 * differs by section: on the main draw only OUT and a struck row remove a
 * player, while on the alternate queue an IN also removes them — they moved up
 * and hold a main-draw place instead.
 */
function departedFrom(section: 'main' | 'main_alt', marker: PublicEntryRow['marker']) {
  if (section === 'main') return marker === 'out' || marker === 'struck';
  return marker !== 'active';
}

function compositionFor(tournament: PublicEntryTournament): Array<{ draw: string; tally: RouteTally }> {
  const sections: Array<[('main' | 'main_alt'), PublicEntryRow[]]> = [
    ['main', tournament.main],
    ['main_alt', tournament.alternates],
  ];
  return sections.flatMap(([draw, rows]) =>
    tallyRoutes(
      rows.map((row) => ({ code: row.entryCode, departed: departedFrom(draw, row.marker) }))
    ).map((tally) => ({ draw, tally }))
  );
}

async function insertMovement(args: {
  tournamentSlug: string;
  playerName: string;
  movementType: string;
  fromSection: string;
  toSection: string;
  entryRank: number | null;
  originalPosition: number | null;
  qSpotsDelta: number;
  rawText: string | null;
  evidence: Record<string, unknown>;
}) {
  const id = fingerprint([
    WEEK_START,
    args.tournamentSlug,
    args.playerName,
    args.movementType,
    args.fromSection,
    args.toSection,
    args.originalPosition,
    SOURCE_KEY,
  ]);
  const result = await pool.query(
    `insert into entry_list_movements (
       week_start, tournament_slug, event_type, player_name, movement_type,
       from_section, to_section, entry_rank, original_position, q_spots_delta,
       observed_at, source_key, source_url, raw_text, evidence, fingerprint
     ) values ($1, $2, 'singles', $3, $4, $5, $6, $7, $8, $9,
               now(), $10, $11, $12, $13::jsonb, $14)
     on conflict (fingerprint) do nothing
     returning id`,
    [
      WEEK_START,
      args.tournamentSlug,
      args.playerName,
      args.movementType,
      args.fromSection,
      args.toSection,
      args.entryRank,
      args.originalPosition,
      args.qSpotsDelta,
      SOURCE_KEY,
      DISPLAY_URL,
      args.rawText,
      JSON.stringify(args.evidence),
      id,
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function GET(request: NextRequest) {
  const requestedWeek = request.nextUrl.searchParams.get('week') ?? WEEK_START;
  if (requestedWeek !== WEEK_START) {
    return NextResponse.json(
      {
        ok: false,
        error: `The public pilot currently has a verified source map for ${WEEK_START} only.`,
      },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(SOURCE_URL, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'user-agent': 'Mozilla/5.0 (compatible; TennisTerminal/1.0; public list history)',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`SpazioTennis returned HTTP ${response.status}`);

    const rawPayload = await response.text();
    const hash = createHash('sha256').update(rawPayload).digest('hex');
    const json = JSON.parse(rawPayload) as {
      modified?: string;
      content?: { rendered?: string };
    };
    const rendered = json.content?.rendered ?? '';
    const parsed = parseSpazioChallengerWeekHtml(rendered);
    if (parsed.length < 6) {
      throw new Error(`Parsed only ${parsed.length} tournament blocks; refusing partial overwrite`);
    }

    const previousResult = await pool.query<StoredSnapshot>(
      `select parsed_payload
       from entry_list_source_snapshots
       where week_start = $1::date and source_key = $2
       order by fetched_at desc
       limit 1`,
      [WEEK_START, SOURCE_KEY]
    );
    const previous = previousResult.rows[0]?.parsed_payload ?? [];
    const previousRows = flatten(previous);
    const currentRows = flatten(parsed);

    let insertedMovements = 0;
    for (const item of currentRows.values()) {
      const movement = rowMovement(item.row, item.section);
      if (!movement) continue;
      if (
        await insertMovement({
          tournamentSlug: item.tournamentSlug,
          playerName: item.row.name,
          movementType: movement.movementType,
          fromSection: movement.fromSection,
          toSection: movement.toSection,
          entryRank: item.row.entryRank,
          originalPosition: item.position,
          qSpotsDelta: movement.qSpotsDelta,
          rawText: item.row.rawText,
          evidence: { marker: item.row.marker, section: item.section, sourceHeading: parsed.find((event) => event.slug === item.tournamentSlug)?.sourceHeading },
        })
      ) insertedMovements += 1;
    }

    // If a row disappears entirely between snapshots, record the disappearance
    // instead of silently deleting history. We deliberately classify it as
    // unknown until another source proves withdrawal vs promotion.
    for (const [rowKey, old] of previousRows) {
      if (currentRows.has(rowKey)) continue;
      if (
        await insertMovement({
          tournamentSlug: old.tournamentSlug,
          playerName: old.row.name,
          movementType: 'removed_unknown',
          fromSection: old.section,
          toSection: 'out',
          entryRank: old.row.entryRank,
          originalPosition: old.position,
          qSpotsDelta: 0,
          rawText: old.row.rawText,
          evidence: { reason: 'row_disappeared_between_public_snapshots' },
        })
      ) insertedMovements += 1;
    }

    const changed = previous.length === 0 || hash !== (
      await pool.query<{ last_content_hash: string | null }>(
        `select last_content_hash from entry_list_source_status where week_start = $1::date and source_key = $2`,
        [WEEK_START, SOURCE_KEY]
      )
    ).rows[0]?.last_content_hash;

    // A parser fix changes the stored rows without the source moving a byte.
    // Keying the write on the content hash alone left a bad parse frozen in the
    // table forever, because an unchanged source meant nothing was ever
    // rewritten. Rewrite whenever the source OR the parse differs.
    const reparsed = JSON.stringify(parsed) !== JSON.stringify(previous);

    await withTransaction(async (client) => {
      if (changed || reparsed) {
        await client.query(
          `insert into entry_list_source_snapshots (
             week_start, source_key, source_url, content_hash, raw_payload,
             parsed_payload, source_updated_text
           ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)
           on conflict (week_start, source_key, content_hash) do update
           set parsed_payload = excluded.parsed_payload,
               source_updated_text = excluded.source_updated_text`,
          [WEEK_START, SOURCE_KEY, DISPLAY_URL, hash, rawPayload, JSON.stringify(parsed), json.modified ?? null]
        );
      }
      // The composition is recomputed on every check, not only when something
      // changed, so a row exists for every draw from the first successful sync.
      for (const tournament of parsed) {
        for (const { draw, tally } of compositionFor(tournament)) {
          await client.query(
            `insert into entry_list_draw_composition (
               week_start, tournament_slug, draw, entry_route,
               live_count, departed_count, source_key, observed_at
             ) values ($1, $2, $3, $4, $5, $6, $7, now())
             on conflict (week_start, tournament_slug, draw, entry_route) do update
             set live_count = excluded.live_count,
                 departed_count = excluded.departed_count,
                 observed_at = now()`,
            [WEEK_START, tournament.slug, draw, tally.route, tally.live, tally.departed, SOURCE_KEY]
          );
        }
      }

      await client.query(
        `insert into entry_list_source_status (
           week_start, source_key, source_url, last_checked_at, last_changed_at,
           last_content_hash, last_error, updated_at
         ) values ($1, $2, $3, now(), case when $4 then now() else null end, $5, null, now())
         on conflict (week_start, source_key) do update
         set source_url = excluded.source_url,
             last_checked_at = now(),
             last_changed_at = case when $4 then now() else entry_list_source_status.last_changed_at end,
             last_content_hash = $5,
             last_error = null,
             updated_at = now()`,
        [WEEK_START, SOURCE_KEY, DISPLAY_URL, changed, hash]
      );
    });

    return NextResponse.json({
      ok: true,
      week: WEEK_START,
      source: SOURCE_KEY,
      checkedAt: new Date().toISOString(),
      changed,
      reparsed,
      tournaments: parsed.length,
      rows: parsed.map((event) => ({
        slug: event.slug,
        main: event.main.length,
        alternates: event.alternates.length,
        composition: compositionFor(event)
          .filter((item) => item.draw === 'main')
          .map((item) => `${item.tally.live} ${item.tally.route}`)
          .join(' · '),
      })),
      movementsAdded: insertedMovements,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `insert into entry_list_source_status (
         week_start, source_key, source_url, last_checked_at, last_error, updated_at
       ) values ($1, $2, $3, now(), $4, now())
       on conflict (week_start, source_key) do update
       set last_checked_at = now(), last_error = $4, updated_at = now()`,
      [WEEK_START, SOURCE_KEY, DISPLAY_URL, message]
    ).catch(() => undefined);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
