import { pool } from '@/lib/db';
import { getRegistryByYear, type TournamentRegistryEntry } from '@/lib/tournament-registry';

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

const importedEditions: ImportedEdition[] = getRegistryByYear(2026).map((event: TournamentRegistryEntry) => ({
  tournament: {
    slug: event.slug,
    name: event.name,
    city: event.city,
    country: event.country,
  },
  edition: {
    year: event.year,
    week: event.week,
    start_date: event.start_date,
    end_date: event.end_date,
    level: event.level,
    surface: event.surface,
    indoor: event.indoor,
    source: event.source,
    source_url: event.source_url,
    status: 'held',
  },
}));

async function upsertTournamentAndEdition(item: ImportedEdition) {
  const tournamentResult = await pool.query<{ id: string }>(
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

  await pool.query(
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

async function main() {
  for (const item of importedEditions) {
    await upsertTournamentAndEdition(item);
    console.log(`Imported ${item.tournament.name} (${item.edition.year})`);
  }

  console.log(`Done. Imported ${importedEditions.length} tournament editions.`);
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
