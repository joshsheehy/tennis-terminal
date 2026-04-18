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

/**
 * Honest status of this file:
 * - this is not a real PDF parser yet
 * - it imports the first 10 ATP Tour + first 10 Challenger events
 * - each row is backed by the official source calendars linked above
 * - later we replace this file with true calendar parsing
 */
const importedEditions: ImportedEdition[] = [
  {
    tournament: { slug: makeSlug('Brisbane International Presented by ANZ', 'Brisbane'), name: 'Brisbane International Presented by ANZ', city: 'Brisbane', country: 'Australia' },
    edition: { year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'ATP 250', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Bank of China Hong Kong Tennis Open', 'Hong Kong'), name: 'Bank of China Hong Kong Tennis Open', city: 'Hong Kong', country: 'Hong Kong' },
    edition: { year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'ATP 250', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Bengaluru 1', 'Bengaluru'), name: 'Bengaluru 1', city: 'Bengaluru', country: 'India' },
    edition: { year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'Challenger 125', surface: 'Hard', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Canberra', 'Canberra'), name: 'Canberra', city: 'Canberra', country: 'Australia' },
    edition: { year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'Challenger 125', surface: 'Hard', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Noumea', 'Noumea'), name: 'Nouméa', city: 'Nouméa', country: 'New Caledonia' },
    edition: { year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'Challenger 75', surface: 'Hard', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Nonthaburi 1', 'Nonthaburi'), name: 'Nonthaburi 1', city: 'Nonthaburi', country: 'Thailand' },
    edition: { year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'Challenger 50', surface: 'Hard', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Nottingham 1', 'Nottingham'), name: 'Nottingham 1', city: 'Nottingham', country: 'Great Britain' },
    edition: { year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'Challenger 50', surface: 'Indoor Hard', indoor: true, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Adelaide International', 'Adelaide'), name: 'Adelaide International', city: 'Adelaide', country: 'Australia' },
    edition: { year: 2026, week: 2, start_date: '2026-01-12', end_date: null, level: 'ATP 250', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('ASB Classic', 'Auckland'), name: 'ASB Classic', city: 'Auckland', country: 'New Zealand' },
    edition: { year: 2026, week: 2, start_date: '2026-01-12', end_date: null, level: 'ATP 250', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Nonthaburi 2', 'Nonthaburi'), name: 'Nonthaburi 2', city: 'Nonthaburi', country: 'Thailand' },
    edition: { year: 2026, week: 2, start_date: '2026-01-12', end_date: null, level: 'Challenger 75', surface: 'Hard', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Buenos Aires Challenger', 'Buenos Aires'), name: 'Buenos Aires Challenger', city: 'Buenos Aires', country: 'Argentina' },
    edition: { year: 2026, week: 2, start_date: '2026-01-12', end_date: null, level: 'Challenger 50', surface: 'Clay', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Glasgow', 'Glasgow'), name: 'Glasgow', city: 'Glasgow', country: 'Great Britain' },
    edition: { year: 2026, week: 2, start_date: '2026-01-12', end_date: null, level: 'Challenger 50', surface: 'Indoor Hard', indoor: true, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Oeiras 1', 'Oeiras'), name: 'Oeiras 1', city: 'Oeiras', country: 'Portugal' },
    edition: { year: 2026, week: 3, start_date: '2026-01-19', end_date: null, level: 'Challenger 100', surface: 'Indoor Hard', indoor: true, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Itajai', 'Itajai'), name: 'Itajaí', city: 'Itajaí', country: 'Brazil' },
    edition: { year: 2026, week: 3, start_date: '2026-01-19', end_date: null, level: 'Challenger 75', surface: 'Clay', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Open Occitanie', 'Montpellier'), name: 'Open Occitanie', city: 'Montpellier', country: 'France' },
    edition: { year: 2026, week: 5, start_date: '2026-02-02', end_date: null, level: 'ATP 250', surface: 'Indoor Hard', indoor: true, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Dallas Open', 'Dallas'), name: 'Dallas Open', city: 'Dallas', country: 'United States' },
    edition: { year: 2026, week: 6, start_date: '2026-02-09', end_date: null, level: 'ATP 500', surface: 'Indoor Hard', indoor: true, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('ABN AMRO Open', 'Rotterdam'), name: 'ABN AMRO Open', city: 'Rotterdam', country: 'Netherlands' },
    edition: { year: 2026, week: 6, start_date: '2026-02-09', end_date: null, level: 'ATP 500', surface: 'Indoor Hard', indoor: true, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('IEB Argentina Open', 'Buenos Aires'), name: 'IEB+ Argentina Open', city: 'Buenos Aires', country: 'Argentina' },
    edition: { year: 2026, week: 6, start_date: '2026-02-09', end_date: null, level: 'ATP 250', surface: 'Clay', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Qatar ExxonMobil Open', 'Doha'), name: 'Qatar ExxonMobil Open', city: 'Doha', country: 'Qatar' },
    edition: { year: 2026, week: 7, start_date: '2026-02-16', end_date: null, level: 'ATP 500', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, status: 'held' },
  },
  {
    tournament: { slug: makeSlug('Rio Open Presented by Claro', 'Rio de Janeiro'), name: 'Rio Open Presented by Claro', city: 'Rio de Janeiro', country: 'Brazil' },
    edition: { year: 2026, week: 7, start_date: '2026-02-16', end_date: null, level: 'ATP 500', surface: 'Clay', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, status: 'held' },
  },
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
