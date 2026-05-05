import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type EventType = 'singles' | 'doubles';
type DrawType = 'main' | 'qualifying';

type DrawImportTarget = {
  slug: string;
  year: number;
  event_type: EventType;
  draw_type: DrawType;
  draw_url: string;
};

type ParsedDrawMarkers = {
  alternate_entries_count: number;
  lucky_loser_entries_count: number;
  qualifying_entries_count: number;
  wildcard_entries_count: number;
  special_exempt_entries_count: number;
};

const drawImportTargets: DrawImportTarget[] = [
  {
    slug: 'brisbane-international-presented-by-anz-brisbane',
    year: 2026,
    event_type: 'singles',
    draw_type: 'main',
    draw_url: 'https://www.atptour.com/en/scores/archive/brisbane/339/2026/draws?matchtype=singles',
  },
  {
    slug: 'brisbane-international-presented-by-anz-brisbane',
    year: 2026,
    event_type: 'singles',
    draw_type: 'qualifying',
    draw_url: 'https://www.atptour.com/en/scores/archive/brisbane/339/2026/draws?matchtype=qualifiersingles',
  },
  {
    slug: 'brisbane-international-presented-by-anz-brisbane',
    year: 2026,
    event_type: 'doubles',
    draw_type: 'main',
    draw_url: 'https://www.atptour.com/en/scores/archive/brisbane/339/2026/draws?matchtype=doubles',
  },
  {
    slug: 'bank-of-china-hong-kong-tennis-open-hong-kong',
    year: 2026,
    event_type: 'singles',
    draw_type: 'main',
    draw_url: 'https://www.atptour.com/en/scores/archive/hong-kong/336/2026/draws?matchtype=singles',
  },
  {
    slug: 'bank-of-china-hong-kong-tennis-open-hong-kong',
    year: 2026,
    event_type: 'singles',
    draw_type: 'qualifying',
    draw_url: 'https://www.atptour.com/en/scores/archive/hong-kong/336/2026/draws?matchtype=qualifiersingles',
  },
  {
    slug: 'bank-of-china-hong-kong-tennis-open-hong-kong',
    year: 2026,
    event_type: 'doubles',
    draw_type: 'main',
    draw_url: 'https://www.atptour.com/en/scores/archive/hong-kong/336/2026/draws?matchtype=doubles',
  },
  {
    slug: 'adelaide-international-adelaide',
    year: 2026,
    event_type: 'singles',
    draw_type: 'main',
    draw_url: 'https://www.atptour.com/en/scores/archive/adelaide/8998/2026/draws?matchtype=singles',
  },
  {
    slug: 'adelaide-international-adelaide',
    year: 2026,
    event_type: 'singles',
    draw_type: 'qualifying',
    draw_url: 'https://www.atptour.com/en/scores/archive/adelaide/8998/2026/draws?matchtype=qualifiersingles',
  },
  {
    slug: 'adelaide-international-adelaide',
    year: 2026,
    event_type: 'doubles',
    draw_type: 'main',
    draw_url: 'https://www.atptour.com/en/scores/archive/adelaide/8998/2026/draws?matchtype=doubles',
  },
  {
    slug: 'asb-classic-auckland',
    year: 2026,
    event_type: 'singles',
    draw_type: 'main',
    draw_url: 'https://www.atptour.com/en/scores/archive/auckland/301/2026/draws?matchtype=singles',
  },
  {
    slug: 'asb-classic-auckland',
    year: 2026,
    event_type: 'singles',
    draw_type: 'qualifying',
    draw_url: 'https://www.atptour.com/en/scores/archive/auckland/301/2026/draws?matchtype=qualifiersingles',
  },
  {
    slug: 'asb-classic-auckland',
    year: 2026,
    event_type: 'doubles',
    draw_type: 'main',
    draw_url: 'https://www.atptour.com/en/scores/archive/auckland/301/2026/draws?matchtype=doubles',
  },
];

function countMarker(text: string, marker: string) {
  const pattern = new RegExp(`\\(${marker}\\)`, 'gi');
  return text.match(pattern)?.length ?? 0;
}

function parseDrawMarkers(html: string): ParsedDrawMarkers {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ');

  const altCount = countMarker(text, 'Alt');
  const llCount = countMarker(text, 'LL');

  return {
    alternate_entries_count: altCount + llCount,
    lucky_loser_entries_count: llCount,
    qualifying_entries_count: countMarker(text, 'Q'),
    wildcard_entries_count: countMarker(text, 'WC'),
    special_exempt_entries_count: countMarker(text, 'SE'),
  };
}

async function fetchDrawHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (compatible; TennisTerminalBot/0.1; +https://tennis-terminal-production.up.railway.app)',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} for ${url}`);
  }

  return response.text();
}

async function getEditionId(slug: string, year: number) {
  const result = await pool.query<{ id: string }>(
    `
    select te.id
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where t.slug = $1
      and te.year = $2
    limit 1
    `,
    [slug, year]
  );

  return result.rows[0]?.id ?? null;
}

async function upsertCutoffSnapshot(
  target: DrawImportTarget,
  editionId: string,
  parsed: ParsedDrawMarkers
) {
  await pool.query(
    `
    insert into cutoff_snapshots (
      tournament_edition_id,
      event_type,
      draw_type,
      source_type,
      last_direct_acceptance_rank,
      last_direct_acceptance_player_name,
      last_alternate_rank,
      last_alternate_player_name,
      challenger_doubles_advanced_cut_rank,
      challenger_doubles_advanced_team_name,
      challenger_doubles_onsite_cut_rank,
      challenger_doubles_onsite_team_name,
      parsed_at,
      parser_version,
      source_notes,
      alternate_entries_count,
      updated_at
    )
    values (
      $1,
      $2,
      $3,
      'atp_draw_page',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      now(),
      'atp-draw-marker-parser-v1',
      $4,
      $5,
      now()
    )
    on conflict (tournament_edition_id, event_type, draw_type)
    do update set
      source_type = excluded.source_type,
      last_direct_acceptance_rank = excluded.last_direct_acceptance_rank,
      last_direct_acceptance_player_name = excluded.last_direct_acceptance_player_name,
      last_alternate_rank = excluded.last_alternate_rank,
      last_alternate_player_name = excluded.last_alternate_player_name,
      challenger_doubles_advanced_cut_rank = excluded.challenger_doubles_advanced_cut_rank,
      challenger_doubles_advanced_team_name = excluded.challenger_doubles_advanced_team_name,
      challenger_doubles_onsite_cut_rank = excluded.challenger_doubles_onsite_cut_rank,
      challenger_doubles_onsite_team_name = excluded.challenger_doubles_onsite_team_name,
      parsed_at = excluded.parsed_at,
      parser_version = excluded.parser_version,
      source_notes = excluded.source_notes,
      alternate_entries_count = excluded.alternate_entries_count,
      updated_at = now()
    `,
    [
      editionId,
      target.event_type,
      target.draw_type,
      `Draw URL: ${target.draw_url}. Marker counts: LL=${parsed.lucky_loser_entries_count}, Alt=${parsed.alternate_entries_count - parsed.lucky_loser_entries_count}, Q=${parsed.qualifying_entries_count}, WC=${parsed.wildcard_entries_count}, SE=${parsed.special_exempt_entries_count}. Last-direct rank pending official PDF/acceptance-list parser.`,
      parsed.alternate_entries_count,
    ]
  );
}

export async function GET() {
  const imported = [];
  const skipped = [];
  const failed = [];

  for (const target of drawImportTargets) {
    try {
      const editionId = await getEditionId(target.slug, target.year);

      if (!editionId) {
        skipped.push({ target, reason: 'Tournament edition not found. Run calendar import first.' });
        continue;
      }

      const html = await fetchDrawHtml(target.draw_url);
      const parsed = parseDrawMarkers(html);

      await upsertCutoffSnapshot(target, editionId, parsed);

      imported.push({
        slug: target.slug,
        year: target.year,
        event_type: target.event_type,
        draw_type: target.draw_type,
        parsed,
      });
    } catch (error) {
      failed.push({
        target,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    importedCount: imported.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    imported,
    skipped,
    failed,
  });
}
