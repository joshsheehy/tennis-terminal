import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';

type ImportedEdition = {
  tournament: {
    slug: string;
    name: string;
    city: string;
    country: string | null;
  };
  edition: {
    year: number;
    week: number | null;
    start_date: string;
    end_date: string | null;
    level: string;
    surface: string;
    indoor: boolean | null;
    source: 'atp_tour_pdf' | 'atp_challenger_pdf';
    source_url: string;
    status: 'held' | 'not_held';
  };
};

const ATP_TOUR_CALENDAR_URL =
  'https://www.atptour.com/-/media/files/calendar-pdfs/2025/2026-atp-tour-calendar-december-2025.pdf';

const ATP_CHALLENGER_CALENDAR_URL =
  'https://www.atptour.com/-/media/files/calendar-pdfs/2026/2026-27-atp-challenger-calendar-as-of-10-march-2026-updated.pdf';

const importedEditions: ImportedEdition[] = [
  {
    tournament: {
      slug: 'brisbane-international-presented-by-anz-brisbane',
      name: 'Brisbane International Presented by ANZ',
      city: 'Brisbane',
      country: 'Australia',
    },
    edition: {
      year: 2026,
      week: 1,
      start_date: '2026-01-05',
      end_date: null,
      level: 'ATP 250',
      surface: 'Hard',
      indoor: false,
      source: 'atp_tour_pdf',
      source_url: ATP_TOUR_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'bank-of-china-hong-kong-tennis-open-hong-kong',
      name: 'Bank of China Hong Kong Tennis Open',
      city: 'Hong Kong',
      country: 'Hong Kong',
    },
    edition: {
      year: 2026,
      week: 1,
      start_date: '2026-01-05',
      end_date: null,
      level: 'ATP 250',
      surface: 'Hard',
      indoor: false,
      source: 'atp_tour_pdf',
      source_url: ATP_TOUR_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'bengaluru-1-bengaluru',
      name: 'Bengaluru 1',
      city: 'Bengaluru',
      country: 'India',
    },
    edition: {
      year: 2026,
      week: 1,
      start_date: '2026-01-05',
      end_date: null,
      level: 'Challenger 125',
      surface: 'Hard',
      indoor: false,
      source: 'atp_challenger_pdf',
      source_url: ATP_CHALLENGER_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'canberra-canberra',
      name: 'Canberra',
      city: 'Canberra',
      country: 'Australia',
    },
    edition: {
      year: 2026,
      week: 1,
      start_date: '2026-01-05',
      end_date: null,
      level: 'Challenger 125',
      surface: 'Hard',
      indoor: false,
      source: 'atp_challenger_pdf',
      source_url: ATP_CHALLENGER_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'noumea-noumea',
      name: 'Nouméa',
      city: 'Nouméa',
      country: 'New Caledonia',
    },
    edition: {
      year: 2026,
      week: 1,
      start_date: '2026-01-05',
      end_date: null,
      level: 'Challenger 75',
      surface: 'Hard',
      indoor: false,
      source: 'atp_challenger_pdf',
      source_url: ATP_CHALLENGER_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'nonthaburi-1-nonthaburi',
      name: 'Nonthaburi 1',
      city: 'Nonthaburi',
      country: 'Thailand',
    },
    edition: {
      year: 2026,
      week: 1,
      start_date: '2026-01-05',
      end_date: null,
      level: 'Challenger 50',
      surface: 'Hard',
      indoor: false,
      source: 'atp_challenger_pdf',
      source_url: ATP_CHALLENGER_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'nottingham-1-nottingham',
      name: 'Nottingham 1',
      city: 'Nottingham',
      country: 'Great Britain',
    },
    edition: {
      year: 2026,
      week: 1,
      start_date: '2026-01-05',
      end_date: null,
      level: 'Challenger 50',
      surface: 'Indoor Hard',
      indoor: true,
      source: 'atp_challenger_pdf',
      source_url: ATP_CHALLENGER_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'adelaide-international-adelaide',
      name: 'Adelaide International',
      city: 'Adelaide',
      country: 'Australia',
    },
    edition: {
      year: 2026,
      week: 2,
      start_date: '2026-01-12',
      end_date: null,
      level: 'ATP 250',
      surface: 'Hard',
      indoor: false,
      source: 'atp_tour_pdf',
      source_url: ATP_TOUR_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'asb-classic-auckland',
      name: 'ASB Classic',
      city: 'Auckland',
      country: 'New Zealand',
    },
    edition: {
      year: 2026,
      week: 2,
      start_date: '2026-01-12',
      end_date: null,
      level: 'ATP 250',
      surface: 'Hard',
      indoor: false,
      source: 'atp_tour_pdf',
      source_url: ATP_TOUR_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'nonthaburi-2-nonthaburi',
      name: 'Nonthaburi 2',
      city: 'Nonthaburi',
      country: 'Thailand',
    },
    edition: {
      year: 2026,
      week: 2,
      start_date: '2026-01-12',
      end_date: null,
      level: 'Challenger 75',
      surface: 'Hard',
      indoor: false,
      source: 'atp_challenger_pdf',
      source_url: ATP_CHALLENGER_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'buenos-aires-challenger-buenos-aires',
      name: 'Buenos Aires Challenger',
      city: 'Buenos Aires',
      country: 'Argentina',
    },
    edition: {
      year: 2026,
      week: 2,
      start_date: '2026-01-12',
      end_date: null,
      level: 'Challenger 50',
      surface: 'Clay',
      indoor: false,
      source: 'atp_challenger_pdf',
      source_url: ATP_CHALLENGER_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'glasgow-glasgow',
      name: 'Glasgow',
      city: 'Glasgow',
      country: 'Great Britain',
    },
    edition: {
      year: 2026,
      week: 2,
      start_date: '2026-01-12',
      end_date: null,
      level: 'Challenger 50',
      surface: 'Indoor Hard',
      indoor: true,
      source: 'atp_challenger_pdf',
      source_url: ATP_CHALLENGER_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'oeiras-1-oeiras',
      name: 'Oeiras 1',
      city: 'Oeiras',
      country: 'Portugal',
    },
    edition: {
      year: 2026,
      week: 3,
      start_date: '2026-01-19',
      end_date: null,
      level: 'Challenger 100',
      surface: 'Indoor Hard',
      indoor: true,
      source: 'atp_challenger_pdf',
      source_url: ATP_CHALLENGER_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'itajai-itajai',
      name: 'Itajaí',
      city: 'Itajaí',
      country: 'Brazil',
    },
    edition: {
      year: 2026,
      week: 3,
      start_date: '2026-01-19',
      end_date: null,
      level: 'Challenger 75',
      surface: 'Clay',
      indoor: false,
      source: 'atp_challenger_pdf',
      source_url: ATP_CHALLENGER_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'open-occitanie-montpellier',
      name: 'Open Occitanie',
      city: 'Montpellier',
      country: 'France',
    },
    edition: {
      year: 2026,
      week: 5,
      start_date: '2026-02-02',
      end_date: null,
      level: 'ATP 250',
      surface: 'Indoor Hard',
      indoor: true,
      source: 'atp_tour_pdf',
      source_url: ATP_TOUR_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'dallas-open-dallas',
      name: 'Dallas Open',
      city: 'Dallas',
      country: 'United States',
    },
    edition: {
      year: 2026,
      week: 6,
      start_date: '2026-02-09',
      end_date: null,
      level: 'ATP 500',
      surface: 'Indoor Hard',
      indoor: true,
      source: 'atp_tour_pdf',
      source_url: ATP_TOUR_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'abn-amro-open-rotterdam',
      name: 'ABN AMRO Open',
      city: 'Rotterdam',
      country: 'Netherlands',
    },
    edition: {
      year: 2026,
      week: 6,
      start_date: '2026-02-09',
      end_date: null,
      level: 'ATP 500',
      surface: 'Indoor Hard',
      indoor: true,
      source: 'atp_tour_pdf',
      source_url: ATP_TOUR_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'ieb-argentina-open-buenos-aires',
      name: 'IEB+ Argentina Open',
      city: 'Buenos Aires',
      country: 'Argentina',
    },
    edition: {
      year: 2026,
      week: 6,
      start_date: '2026-02-09',
      end_date: null,
      level: 'ATP 250',
      surface: 'Clay',
      indoor: false,
      source: 'atp_tour_pdf',
      source_url: ATP_TOUR_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'qatar-exxonmobil-open-doha',
      name: 'Qatar ExxonMobil Open',
      city: 'Doha',
      country: 'Qatar',
    },
    edition: {
      year: 2026,
      week: 7,
      start_date: '2026-02-16',
      end_date: null,
      level: 'ATP 500',
      surface: 'Hard',
      indoor: false,
      source: 'atp_tour_pdf',
      source_url: ATP_TOUR_CALENDAR_URL,
      status: 'held',
    },
  },
  {
    tournament: {
      slug: 'rio-open-presented-by-claro-rio-de-janeiro',
      name: 'Rio Open Presented by Claro',
      city: 'Rio de Janeiro',
      country: 'Brazil',
    },
    edition: {
      year: 2026,
      week: 7,
      start_date: '2026-02-16',
      end_date: null,
      level: 'ATP 500',
      surface: 'Clay',
      indoor: false,
      source: 'atp_tour_pdf',
      source_url: ATP_TOUR_CALENDAR_URL,
      status: 'held',
    },
  },
];

export async function GET() {
  let client: PoolClient | undefined;

  try {
    client = await pool.connect();

    await client.query('BEGIN');

    await client.query(`create extension if not exists pgcrypto;`);

    await client.query(`
      create table if not exists tournaments (
        id uuid primary key default gen_random_uuid(),
        slug text not null unique,
        name text not null,
        city text not null,
        country text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);

    await client.query(`
      create table if not exists tournament_editions (
        id uuid primary key default gen_random_uuid(),
        tournament_id uuid not null references tournaments(id) on delete cascade,
        year int not null,
        week int,
        start_date date not null,
        end_date date,
        level text not null,
        surface text not null,
        indoor boolean,
        source text not null,
        source_url text,
        status text not null default 'held' check (status in ('held', 'not_held')),
        singles_draw_size int,
        qualifying_draw_size int,
        doubles_draw_size int,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tournament_id, year)
      );
    `);

    await client.query(`
      create table if not exists cutoff_snapshots (
        id uuid primary key default gen_random_uuid(),
        tournament_edition_id uuid not null references tournament_editions(id) on delete cascade,
        event_type text not null check (event_type in ('singles', 'doubles')),
        draw_type text not null check (draw_type in ('main', 'qualifying')),
        source_type text not null default 'official_pdf',
        last_direct_acceptance_rank int,
        last_direct_acceptance_player_name text,
        last_alternate_rank int,
        last_alternate_player_name text,
        challenger_doubles_advanced_cut_rank int,
        challenger_doubles_advanced_team_name text,
        challenger_doubles_onsite_cut_rank int,
        challenger_doubles_onsite_team_name text,
        parsed_at timestamptz,
        parser_version text,
        source_notes text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (tournament_edition_id, event_type, draw_type)
      );
    `);

    await client.query(`
      create index if not exists tournament_editions_start_date_idx on tournament_editions(start_date);
      create index if not exists tournament_editions_level_idx on tournament_editions(level);
      create index if not exists cutoff_snapshots_tournament_edition_idx on cutoff_snapshots(tournament_edition_id);
    `);

    for (const item of importedEditions) {
      const tournamentResult = await client.query<{ id: string }>(
        `
        insert into tournaments (slug, name, city, country, updated_at)
        values ($1, $2, $3, $4, now())
        on conflict (slug)
        do update set
          name = excluded.name,
          city = excluded.city,
          country = excluded.country,
          updated_at = now()
        returning id
        `,
        [item.tournament.slug, item.tournament.name, item.tournament.city, item.tournament.country]
      );

      const tournamentId = tournamentResult.rows[0].id;

      await client.query(
        `
        insert into tournament_editions (
          tournament_id,
          year,
          week,
          start_date,
          end_date,
          level,
          surface,
          indoor,
          source,
          source_url,
          status,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
        on conflict (tournament_id, year)
        do update set
          week = excluded.week,
          start_date = excluded.start_date,
          end_date = excluded.end_date,
          level = excluded.level,
          surface = excluded.surface,
          indoor = excluded.indoor,
          source = excluded.source,
          source_url = excluded.source_url,
          status = excluded.status,
          updated_at = now()
        `,
        [
          tournamentId,
          item.edition.year,
          item.edition.week,
          item.edition.start_date,
          item.edition.end_date,
          item.edition.level,
          item.edition.surface,
          item.edition.indoor,
          item.edition.source,
          item.edition.source_url,
          item.edition.status,
        ]
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      tournamentsImported: importedEditions.length,
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
