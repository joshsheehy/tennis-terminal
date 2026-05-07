import slugify from 'slugify';
import { pool } from '@/lib/db';

const ATP_TOUR_CALENDAR_URL =
  'https://www.atptour.com/-/media/files/calendar-pdfs/2025/2026-atp-tour-calendar-december-2025.pdf';

const ATP_CHALLENGER_CALENDAR_URL =
  'https://www.atptour.com/-/media/files/calendar-pdfs/2026/2026-27-atp-challenger-calendar-as-of-10-march-2026-updated.pdf';

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

function makeSlug(name: string, city: string) {
  return slugify(`${name}-${city}`, { lower: true, strict: true, trim: true });
}

function tourEvent(
  name: string,
  city: string,
  country: string | null,
  year: number,
  week: number | null,
  startDate: string,
  endDate: string | null,
  level: string,
  surface: string,
  indoor: boolean | null
): ImportedEdition {
  return {
    tournament: { slug: makeSlug(name, city), name, city, country },
    edition: {
      year,
      week,
      start_date: startDate,
      end_date: endDate,
      level,
      surface,
      indoor,
      source: 'atp_tour_pdf',
      source_url: ATP_TOUR_CALENDAR_URL,
      status: 'held',
    },
  };
}

function challengerEvent(
  name: string,
  city: string,
  country: string | null,
  year: number,
  week: number | null,
  startDate: string,
  endDate: string | null,
  level: string,
  surface: string,
  indoor: boolean | null
): ImportedEdition {
  return {
    tournament: { slug: makeSlug(name, city), name, city, country },
    edition: {
      year,
      week,
      start_date: startDate,
      end_date: endDate,
      level,
      surface,
      indoor,
      source: 'atp_challenger_pdf',
      source_url: ATP_CHALLENGER_CALENDAR_URL,
      status: 'held',
    },
  };
}

const importedEditions: ImportedEdition[] = [
  // 2026 ATP Tour events.
  tourEvent('Brisbane International Presented by ANZ', 'Brisbane', 'Australia', 2026, 1, '2026-01-05', null, 'ATP 250', 'Hard', false),
  tourEvent('Bank of China Hong Kong Tennis Open', 'Hong Kong', 'Hong Kong', 2026, 1, '2026-01-05', null, 'ATP 250', 'Hard', false),
  tourEvent('Adelaide International', 'Adelaide', 'Australia', 2026, 2, '2026-01-12', null, 'ATP 250', 'Hard', false),
  tourEvent('ASB Classic', 'Auckland', 'New Zealand', 2026, 2, '2026-01-12', null, 'ATP 250', 'Hard', false),
  tourEvent('Open Occitanie', 'Montpellier', 'France', 2026, 5, '2026-02-02', null, 'ATP 250', 'Indoor Hard', true),
  tourEvent('Dallas Open', 'Dallas', 'United States', 2026, 6, '2026-02-09', null, 'ATP 500', 'Indoor Hard', true),
  tourEvent('ABN AMRO Open', 'Rotterdam', 'Netherlands', 2026, 6, '2026-02-09', null, 'ATP 500', 'Indoor Hard', true),
  tourEvent('IEB Argentina Open', 'Buenos Aires', 'Argentina', 2026, 6, '2026-02-09', null, 'ATP 250', 'Clay', false),
  tourEvent('Qatar ExxonMobil Open', 'Doha', 'Qatar', 2026, 7, '2026-02-16', null, 'ATP 500', 'Hard', false),
  tourEvent('Rio Open Presented by Claro', 'Rio de Janeiro', 'Brazil', 2026, 7, '2026-02-16', null, 'ATP 500', 'Clay', false),

  // 2026 ATP Masters 1000 events.
  tourEvent('BNP Paribas Open', 'Indian Wells', 'United States', 2026, 10, '2026-03-04', '2026-03-15', 'ATP 1000', 'Hard', false),
  tourEvent('Miami Open presented by Itau', 'Miami', 'United States', 2026, 12, '2026-03-18', '2026-03-29', 'ATP 1000', 'Hard', false),
  tourEvent('Rolex Monte-Carlo Masters', 'Monte-Carlo', 'Monaco', 2026, 14, '2026-04-05', '2026-04-12', 'ATP 1000', 'Clay', false),
  tourEvent('Mutua Madrid Open', 'Madrid', 'Spain', 2026, 17, '2026-04-22', '2026-05-03', 'ATP 1000', 'Clay', false),
  tourEvent("Internazionali BNL d'Italia", 'Rome', 'Italy', 2026, 19, '2026-05-06', '2026-05-17', 'ATP 1000', 'Clay', false),
  tourEvent('National Bank Open presented by Rogers', 'Montreal', 'Canada', 2026, 31, '2026-08-02', '2026-08-13', 'ATP 1000', 'Hard', false),
  tourEvent('Cincinnati Open', 'Cincinnati', 'United States', 2026, 33, '2026-08-13', '2026-08-23', 'ATP 1000', 'Hard', false),
  tourEvent('Rolex Shanghai Masters', 'Shanghai', 'China', 2026, 41, '2026-10-07', '2026-10-18', 'ATP 1000', 'Hard', false),
  tourEvent('Rolex Paris Masters', 'Paris', 'France', 2026, 45, '2026-11-02', '2026-11-08', 'ATP 1000', 'Indoor Hard', true),

  // 2026 Challenger events currently seeded in the app.
  challengerEvent('Bengaluru 1', 'Bengaluru', 'India', 2026, 1, '2026-01-05', null, 'Challenger 125', 'Hard', false),
  challengerEvent('Canberra', 'Canberra', 'Australia', 2026, 1, '2026-01-05', null, 'Challenger 125', 'Hard', false),
  challengerEvent('Nouméa', 'Nouméa', 'New Caledonia', 2026, 1, '2026-01-05', null, 'Challenger 75', 'Hard', false),
  challengerEvent('Nonthaburi 1', 'Nonthaburi', 'Thailand', 2026, 1, '2026-01-05', null, 'Challenger 50', 'Hard', false),
  challengerEvent('Nottingham 1', 'Nottingham', 'Great Britain', 2026, 1, '2026-01-05', null, 'Challenger 50', 'Indoor Hard', true),
  challengerEvent('Nonthaburi 2', 'Nonthaburi', 'Thailand', 2026, 2, '2026-01-12', null, 'Challenger 75', 'Hard', false),
  challengerEvent('Buenos Aires Challenger', 'Buenos Aires', 'Argentina', 2026, 2, '2026-01-12', null, 'Challenger 50', 'Clay', false),
  challengerEvent('Glasgow', 'Glasgow', 'Great Britain', 2026, 2, '2026-01-12', null, 'Challenger 50', 'Indoor Hard', true),
  challengerEvent('Oeiras 1', 'Oeiras', 'Portugal', 2026, 3, '2026-01-19', null, 'Challenger 100', 'Indoor Hard', true),
  challengerEvent('Itajaí', 'Itajaí', 'Brazil', 2026, 3, '2026-01-19', null, 'Challenger 75', 'Clay', false),
];

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
