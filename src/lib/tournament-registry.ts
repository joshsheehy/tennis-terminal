import slugify from 'slugify';

export const ATP_TOUR_CALENDAR_URL =
  'https://www.atptour.com/-/media/files/calendar-pdfs/2025/2026-atp-tour-calendar-december-2025.pdf';

export const ATP_CHALLENGER_CALENDAR_URL =
  'https://www.atptour.com/-/media/files/calendar-pdfs/2026/2026-27-atp-challenger-calendar-as-of-10-march-2026-updated.pdf';

export type TournamentLevel = 'ATP 250' | 'ATP 500' | 'ATP 1000' | `Challenger ${number}`;
export type TournamentSource = 'atp_tour_pdf' | 'atp_challenger_pdf';

export type TournamentRegistryEntry = {
  slug: string;
  name: string;
  city: string;
  country: string | null;
  year: number;
  week: number | null;
  start_date: string;
  end_date: string | null;
  level: TournamentLevel;
  surface: string;
  indoor: boolean | null;
  source: TournamentSource;
  source_url: string;
  protennislive_code: string | null;
  has_doubles_qualifying: boolean;
};

type SeedParams = Omit<TournamentRegistryEntry, 'slug'>;

function makeSlug(name: string, city: string) {
  return slugify(`${name}-${city}`, { lower: true, strict: true, trim: true });
}

function event(params: SeedParams): TournamentRegistryEntry {
  return {
    ...params,
    slug: makeSlug(params.name, params.city),
  };
}

export const TOURNAMENT_REGISTRY: TournamentRegistryEntry[] = [
  event({ name: 'Brisbane International Presented by ANZ', city: 'Brisbane', country: 'Australia', year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'ATP 250', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '339', has_doubles_qualifying: false }),
  event({ name: 'Bank of China Hong Kong Tennis Open', city: 'Hong Kong', country: 'Hong Kong', year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'ATP 250', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '336', has_doubles_qualifying: false }),
  event({ name: 'Adelaide International', city: 'Adelaide', country: 'Australia', year: 2026, week: 2, start_date: '2026-01-12', end_date: null, level: 'ATP 250', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '8998', has_doubles_qualifying: false }),
  event({ name: 'ASB Classic', city: 'Auckland', country: 'New Zealand', year: 2026, week: 2, start_date: '2026-01-12', end_date: null, level: 'ATP 250', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '301', has_doubles_qualifying: false }),
  event({ name: 'Open Occitanie', city: 'Montpellier', country: 'France', year: 2026, week: 5, start_date: '2026-02-02', end_date: null, level: 'ATP 250', surface: 'Indoor Hard', indoor: true, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '375', has_doubles_qualifying: false }),
  event({ name: 'Dallas Open', city: 'Dallas', country: 'United States', year: 2026, week: 6, start_date: '2026-02-09', end_date: null, level: 'ATP 500', surface: 'Indoor Hard', indoor: true, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '424', has_doubles_qualifying: true }),
  event({ name: 'ABN AMRO Open', city: 'Rotterdam', country: 'Netherlands', year: 2026, week: 6, start_date: '2026-02-09', end_date: null, level: 'ATP 500', surface: 'Indoor Hard', indoor: true, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '407', has_doubles_qualifying: true }),
  event({ name: 'IEB Argentina Open', city: 'Buenos Aires', country: 'Argentina', year: 2026, week: 6, start_date: '2026-02-09', end_date: null, level: 'ATP 250', surface: 'Clay', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '506', has_doubles_qualifying: false }),
  event({ name: 'Qatar ExxonMobil Open', city: 'Doha', country: 'Qatar', year: 2026, week: 7, start_date: '2026-02-16', end_date: null, level: 'ATP 500', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '451', has_doubles_qualifying: true }),
  event({ name: 'Rio Open Presented by Claro', city: 'Rio de Janeiro', country: 'Brazil', year: 2026, week: 7, start_date: '2026-02-16', end_date: null, level: 'ATP 500', surface: 'Clay', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '6932', has_doubles_qualifying: true }),
  // Expanded 2026 ATP Tour coverage with known ProTennisLive codes.
  event({ name: 'Open 13 Provence', city: 'Marseille', country: 'France', year: 2026, week: 8, start_date: '2026-02-23', end_date: null, level: 'ATP 250', surface: 'Indoor Hard', indoor: true, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '496', has_doubles_qualifying: false }),
  event({ name: 'Abierto Mexicano Telcel presentado por HSBC', city: 'Acapulco', country: 'Mexico', year: 2026, week: 8, start_date: '2026-02-23', end_date: null, level: 'ATP 500', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '807', has_doubles_qualifying: true }),
  event({ name: 'Dubai Duty Free Tennis Championships', city: 'Dubai', country: 'United Arab Emirates', year: 2026, week: 9, start_date: '2026-03-02', end_date: null, level: 'ATP 500', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '495', has_doubles_qualifying: true }),
  event({ name: 'BNP Paribas Open', city: 'Indian Wells', country: 'United States', year: 2026, week: 10, start_date: '2026-03-04', end_date: '2026-03-15', level: 'ATP 1000', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '404', has_doubles_qualifying: false }),
  event({ name: 'Miami Open presented by Itau', city: 'Miami', country: 'United States', year: 2026, week: 12, start_date: '2026-03-18', end_date: '2026-03-29', level: 'ATP 1000', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '403', has_doubles_qualifying: false }),
  event({ name: 'Rolex Monte-Carlo Masters', city: 'Monte-Carlo', country: 'Monaco', year: 2026, week: 14, start_date: '2026-04-05', end_date: '2026-04-12', level: 'ATP 1000', surface: 'Clay', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '410', has_doubles_qualifying: false }),
  event({ name: 'Mutua Madrid Open', city: 'Madrid', country: 'Spain', year: 2026, week: 17, start_date: '2026-04-22', end_date: '2026-05-03', level: 'ATP 1000', surface: 'Clay', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '1536', has_doubles_qualifying: false }),
  event({ name: "Internazionali BNL d'Italia", city: 'Rome', country: 'Italy', year: 2026, week: 19, start_date: '2026-05-06', end_date: '2026-05-17', level: 'ATP 1000', surface: 'Clay', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '416', has_doubles_qualifying: false }),
  event({ name: 'National Bank Open presented by Rogers', city: 'Montreal', country: 'Canada', year: 2026, week: 31, start_date: '2026-08-02', end_date: '2026-08-13', level: 'ATP 1000', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '421', has_doubles_qualifying: false }),
  event({ name: 'Cincinnati Open', city: 'Cincinnati', country: 'United States', year: 2026, week: 33, start_date: '2026-08-13', end_date: '2026-08-23', level: 'ATP 1000', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '422', has_doubles_qualifying: false }),
  event({ name: 'Rolex Shanghai Masters', city: 'Shanghai', country: 'China', year: 2026, week: 41, start_date: '2026-10-07', end_date: '2026-10-18', level: 'ATP 1000', surface: 'Hard', indoor: false, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '5014', has_doubles_qualifying: false }),
  event({ name: 'Rolex Paris Masters', city: 'Paris', country: 'France', year: 2026, week: 45, start_date: '2026-11-02', end_date: '2026-11-08', level: 'ATP 1000', surface: 'Indoor Hard', indoor: true, source: 'atp_tour_pdf', source_url: ATP_TOUR_CALENDAR_URL, protennislive_code: '352', has_doubles_qualifying: false }),

  event({ name: 'Bengaluru 1', city: 'Bengaluru', country: 'India', year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'Challenger 125', surface: 'Hard', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, protennislive_code: '7808', has_doubles_qualifying: false }),
  event({ name: 'Canberra', city: 'Canberra', country: 'Australia', year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'Challenger 125', surface: 'Hard', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, protennislive_code: '7393', has_doubles_qualifying: false }),
  event({ name: 'Nouméa', city: 'Nouméa', country: 'New Caledonia', year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'Challenger 75', surface: 'Hard', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, protennislive_code: '2205', has_doubles_qualifying: false }),
  event({ name: 'Nonthaburi 1', city: 'Nonthaburi', country: 'Thailand', year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'Challenger 50', surface: 'Hard', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, protennislive_code: '2791', has_doubles_qualifying: false }),
  event({ name: 'Nottingham 1', city: 'Nottingham', country: 'Great Britain', year: 2026, week: 1, start_date: '2026-01-05', end_date: null, level: 'Challenger 50', surface: 'Indoor Hard', indoor: true, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, protennislive_code: '2907', has_doubles_qualifying: false }),
  event({ name: 'Nonthaburi 2', city: 'Nonthaburi', country: 'Thailand', year: 2026, week: 2, start_date: '2026-01-12', end_date: null, level: 'Challenger 75', surface: 'Hard', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, protennislive_code: '2795', has_doubles_qualifying: false }),
  event({ name: 'Buenos Aires Challenger', city: 'Buenos Aires', country: 'Argentina', year: 2026, week: 2, start_date: '2026-01-12', end_date: null, level: 'Challenger 50', surface: 'Clay', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, protennislive_code: '1210', has_doubles_qualifying: false }),
  event({ name: 'Glasgow', city: 'Glasgow', country: 'Great Britain', year: 2026, week: 2, start_date: '2026-01-12', end_date: null, level: 'Challenger 50', surface: 'Indoor Hard', indoor: true, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, protennislive_code: '7916', has_doubles_qualifying: false }),
  event({ name: 'Oeiras 1', city: 'Oeiras', country: 'Portugal', year: 2026, week: 3, start_date: '2026-01-19', end_date: null, level: 'Challenger 100', surface: 'Indoor Hard', indoor: true, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, protennislive_code: '2831', has_doubles_qualifying: false }),
  event({ name: 'Itajaí', city: 'Itajaí', country: 'Brazil', year: 2026, week: 3, start_date: '2026-01-19', end_date: null, level: 'Challenger 75', surface: 'Clay', indoor: false, source: 'atp_challenger_pdf', source_url: ATP_CHALLENGER_CALENDAR_URL, protennislive_code: '3053', has_doubles_qualifying: false }),
];

export function getRegistryByYear(year: number) {
  return TOURNAMENT_REGISTRY.filter((entry) => entry.year === year);
}
