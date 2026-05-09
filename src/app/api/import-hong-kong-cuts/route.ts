import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';

type CutImport = {
  year: number;
  event_type: 'singles' | 'doubles';
  draw_type: 'main' | 'qualifying';
  last_direct_acceptance_rank: number | null;
  last_direct_acceptance_player_name: string | null;
  last_alternate_rank: number | null;
  last_alternate_player_name: string | null;
  alternate_entries_count: number;
  lucky_loser_count: number;
  source_notes: string;
};

const HONG_KONG_SLUG = 'bank-of-china-hong-kong-tennis-open-hong-kong';

const cuts: CutImport[] = [
  {
    year: 2024,
    event_type: 'singles',
    draw_type: 'main',
    last_direct_acceptance_rank: 73,
    last_direct_acceptance_player_name: 'Benjamin Bonzi',
    last_alternate_rank: null,
    last_alternate_player_name: null,
    alternate_entries_count: 0,
    lucky_loser_count: 0,
    source_notes:
      'Official ProTennisLive 2024 Hong Kong main singles PDF: LAST DIRECT ACCEPTANCE AT DEADLINE / IN DRAW Bonzi, Benjamin - 73; Alternates/Lucky Losers section shows no entries. https://www.protennislive.com/posting/2024/336/mds.pdf',
  },
  {
    year: 2024,
    event_type: 'singles',
    draw_type: 'qualifying',
    last_direct_acceptance_rank: 232,
    last_direct_acceptance_player_name: 'Aziz Dougaz',
    last_alternate_rank: null,
    last_alternate_player_name: null,
    alternate_entries_count: 0,
    lucky_loser_count: 0,
    source_notes:
      'Official ProTennisLive 2024 Hong Kong qualifying singles PDF: LAST DIRECT ACCEPTANCE Dougaz, Aziz - 232; Alternates section shows no entries. https://www.protennislive.com/posting/2024/336/qs.pdf',
  },
  {
    year: 2024,
    event_type: 'doubles',
    draw_type: 'main',
    last_direct_acceptance_rank: 132,
    last_direct_acceptance_player_name: 'Evan King / Reese Stalder',
    last_alternate_rank: null,
    last_alternate_player_name: null,
    alternate_entries_count: 0,
    lucky_loser_count: 0,
    source_notes:
      'Official ProTennisLive 2024 Hong Kong main doubles PDF: LAST DIRECT ACCEPTANCE King, Evan / Stalder, Reese - 132; Alternates/Lucky Losers section shows no entries. https://www.protennislive.com/posting/2024/336/mdd.pdf',
  },
  {
    year: 2025,
    event_type: 'singles',
    draw_type: 'main',
    last_direct_acceptance_rank: 67,
    last_direct_acceptance_player_name: 'Alexandre Muller',
    last_alternate_rank: null,
    last_alternate_player_name: null,
    alternate_entries_count: 0,
    lucky_loser_count: 0,
    source_notes:
      'Official ProTennisLive 2025 Hong Kong main singles PDF: Last direct acceptance A. Muller - 67; Alternates/Lucky Losers section shows no entries. https://www.protennislive.com/posting/2025/336/mds.pdf',
  },
  {
    year: 2025,
    event_type: 'singles',
    draw_type: 'qualifying',
    last_direct_acceptance_rank: 246,
    last_direct_acceptance_player_name: 'Denis Yevseyev',
    last_alternate_rank: null,
    last_alternate_player_name: null,
    alternate_entries_count: 0,
    lucky_loser_count: 0,
    source_notes:
      'Official ProTennisLive 2025 Hong Kong qualifying singles PDF: Last direct acceptance D. Yevseyev - 246; Alternates section shows no entries. https://www.protennislive.com/posting/2025/336/qs.pdf',
  },
  {
    year: 2025,
    event_type: 'doubles',
    draw_type: 'main',
    last_direct_acceptance_rank: 124,
    last_direct_acceptance_player_name: 'Roberto Carballes Baena / Alexandre Muller',
    last_alternate_rank: null,
    last_alternate_player_name: 'Gabriel Diallo / Francesco Passaro',
    alternate_entries_count: 1,
    lucky_loser_count: 0,
    source_notes:
      'Official ProTennisLive 2025 Hong Kong main doubles PDF: Last direct acceptance R. Carballes Baena / A. Muller - 124; Alternates/Lucky Losers lists G. Diallo / F. Passaro (Alt). https://www.protennislive.com/posting/2025/336/mdd.pdf',
  },
];

async function getEditionId(client: PoolClient, year: number) {
  const result = await client.query<{ id: string }>(
    `
    select te.id
    from tournament_editions te
    join tournaments t on t.id = te.tournament_id
    where t.slug = $1
      and te.year = $2
    limit 1
    `,
    [HONG_KONG_SLUG, year]
  );

  return result.rows[0]?.id ?? null;
}

export async function GET() {
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    await client.query(`
      alter table cutoff_snapshots
      add column if not exists alternate_entries_count int;
    `);

    await client.query(`
      alter table cutoff_snapshots
      add column if not exists lucky_loser_count int not null default 0;
    `);

    let imported = 0;
    const missingYears = new Set<number>();

    for (const cut of cuts) {
      const editionId = await getEditionId(client, cut.year);

      if (!editionId) {
        missingYears.add(cut.year);
        continue;
      }

      await client.query(
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
          alternate_entries_count,
          lucky_loser_count,
          parsed_at,
          parser_version,
          source_notes,
          updated_at
        )
        values ($1, $2, $3, 'official_pdf_manual_v1', $4, $5, $6, $7, $8, $9, now(), 'hong-kong-manual-v1', $10, now())
        on conflict (tournament_edition_id, event_type, draw_type)
        do update set
          source_type = excluded.source_type,
          last_direct_acceptance_rank = excluded.last_direct_acceptance_rank,
          last_direct_acceptance_player_name = excluded.last_direct_acceptance_player_name,
          last_alternate_rank = excluded.last_alternate_rank,
          last_alternate_player_name = excluded.last_alternate_player_name,
          alternate_entries_count = excluded.alternate_entries_count,
          lucky_loser_count = excluded.lucky_loser_count,
          parsed_at = excluded.parsed_at,
          parser_version = excluded.parser_version,
          source_notes = excluded.source_notes,
          updated_at = now()
        `,
        [
          editionId,
          cut.event_type,
          cut.draw_type,
          cut.last_direct_acceptance_rank,
          cut.last_direct_acceptance_player_name,
          cut.last_alternate_rank,
          cut.last_alternate_player_name,
          cut.alternate_entries_count,
          cut.lucky_loser_count,
          cut.source_notes,
        ]
      );

      imported += 1;
    }

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      importedCutSnapshots: imported,
      missingYears: Array.from(missingYears).sort(),
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }

    console.error(error);

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  } finally {
    if (client) client.release();
  }
}
