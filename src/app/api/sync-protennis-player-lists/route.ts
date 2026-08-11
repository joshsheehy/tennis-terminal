import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { ALL_EDITIONS } from '@/lib/tournament-data';
import { fetchProTennisPlayerList } from '@/lib/protennis-player-list';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SOURCE_TYPE = 'official_protennislive_api';

type EditionRow = {
  edition_id: string;
  slug: string;
  name: string;
  year: number;
  start_date: string | Date;
  level: string;
  source_url: string | null;
  source_notes: string | null;
};

function nextMondayUtc(now = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay();
  const days = day === 1 ? 7 : (8 - day) % 7;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function requestedWeekStart(request: NextRequest): string | null {
  const raw = request.nextUrl.searchParams.get('week') ?? nextMondayUtc();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function codeFromText(value: string | null): string | null {
  if (!value) return null;
  const archive = value.match(/\/archive\/[^/]+\/(\d+)\/\d{4}\/results/i);
  if (archive?.[1]) return archive[1];
  const posting = value.match(/\/posting\/\d+\/(\d+)\//i);
  return posting?.[1] ?? null;
}

function staticCodeByEdition(): Map<string, string> {
  const codes = new Map<string, string>();
  for (const entry of ALL_EDITIONS) {
    const code = entry.edition.protennislive_code;
    if (!code) continue;
    codes.set(`${entry.tournament.slug}:${entry.edition.year}`, code);
  }
  return codes;
}

function contentHash(playerListType: string | null, entries: unknown[]): string {
  return createHash('sha256')
    .update(JSON.stringify({ playerListType, entries }))
    .digest('hex');
}

export async function GET(request: NextRequest) {
  const bearerToken = process.env.PROTENNISLIVE_TOKEN?.trim();
  if (!bearerToken) {
    return NextResponse.json(
      {
        ok: false,
        error: 'PROTENNISLIVE_TOKEN is not configured. Official PlayerList sync remains disabled.',
      },
      { status: 503 }
    );
  }

  const weekStart = requestedWeekStart(request);
  if (!weekStart) {
    return NextResponse.json({ ok: false, error: 'week must be YYYY-MM-DD' }, { status: 400 });
  }

  const editions = await pool.query<EditionRow>(
    `
    select
      te.id as edition_id,
      t.slug,
      t.name,
      te.year,
      te.start_date,
      te.level,
      te.source_url,
      string_agg(cs.source_notes, ' ' order by cs.updated_at desc)
        filter (where cs.source_notes is not null) as source_notes
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    left join cutoff_snapshots cs on cs.tournament_edition_id = te.id
    where te.status = 'held'
      and te.level not ilike 'ITF%'
      and te.start_date >= $1::date
      and te.start_date < $1::date + interval '7 days'
    group by te.id, t.slug, t.name, te.year, te.start_date, te.level, te.source_url
    order by te.start_date, t.name
    `,
    [weekStart]
  );

  const fallbackCodes = staticCodeByEdition();
  const results: Array<Record<string, unknown>> = [];

  for (const edition of editions.rows) {
    const code =
      codeFromText(edition.source_url) ??
      codeFromText(edition.source_notes) ??
      fallbackCodes.get(`${edition.slug}:${edition.year}`) ??
      null;

    if (!code || !/^\d+$/.test(code)) {
      results.push({
        tournament: edition.name,
        slug: edition.slug,
        year: edition.year,
        status: 'missing_atp_code',
      });
      continue;
    }

    const sourceUrl = `https://api.protennislive.com/feeds/PlayerList/${edition.year}/${code}`;
    try {
      const parsed = await fetchProTennisPlayerList(
        edition.year,
        Number(code),
        bearerToken
      );

      const storedLists: Array<Record<string, unknown>> = [];
      for (const list of parsed.lists) {
        if (list.entries.length === 0) continue;

        const hash = contentHash(list.playerListType, list.entries);
        const source = await pool.query<{ id: string; last_content_hash: string | null }>(
          `
          insert into acceptance_list_sources (
            tournament_edition_id, event_type, draw_type, atp_code,
            source_type, source_url, active, last_checked_at,
            failure_count, last_error, updated_at
          ) values ($1, $2, $3, $4, $5, $6, true, now(), 0, null, now())
          on conflict (tournament_edition_id, event_type, draw_type, source_url)
          do update set
            atp_code = excluded.atp_code,
            source_type = excluded.source_type,
            active = true,
            last_checked_at = now(),
            failure_count = 0,
            last_error = null,
            updated_at = now()
          returning id, last_content_hash
          `,
          [
            edition.edition_id,
            list.eventType,
            list.drawType,
            code,
            SOURCE_TYPE,
            sourceUrl,
          ]
        );

        const sourceId = source.rows[0].id;
        const changed = source.rows[0].last_content_hash !== hash;
        if (changed) {
          await pool.query(
            `
            insert into acceptance_list_snapshots (
              source_id, fetched_at, list_date, ranking_date,
              original_cutoff_rank, player_list_type, parse_status,
              entry_count, entries, content_hash
            ) values ($1, now(), null, null, null, $2, 'parsed', $3, $4::jsonb, $5)
            on conflict (source_id, content_hash) do nothing
            `,
            [
              sourceId,
              list.playerListType,
              list.entries.length,
              JSON.stringify(list.entries),
              hash,
            ]
          );
          await pool.query(
            `
            update acceptance_list_sources
            set last_content_hash = $2,
                last_changed_at = now(),
                last_checked_at = now(),
                updated_at = now()
            where id = $1
            `,
            [sourceId, hash]
          );
        }

        storedLists.push({
          eventType: list.eventType,
          drawType: list.drawType,
          playerListType: list.playerListType,
          entries: list.entries.length,
          alternates: list.entries.filter((entry) => entry.alternate).length,
          changed,
        });
      }

      results.push({
        tournament: edition.name,
        slug: edition.slug,
        year: edition.year,
        code,
        status: 'ok',
        lists: storedLists,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await pool.query(
        `
        update acceptance_list_sources
        set last_checked_at = now(),
            failure_count = failure_count + 1,
            last_error = $3,
            updated_at = now()
        where tournament_edition_id = $1
          and atp_code = $2
          and source_type = $4
        `,
        [edition.edition_id, code, message.slice(0, 1000), SOURCE_TYPE]
      );
      results.push({
        tournament: edition.name,
        slug: edition.slug,
        year: edition.year,
        code,
        status: 'error',
        error: message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    weekStart,
    sourceType: SOURCE_TYPE,
    tournaments: editions.rows.length,
    results,
  });
}
