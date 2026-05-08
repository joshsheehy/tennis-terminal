import slugify from 'slugify';

export const ATP_TOUR_CALENDAR_URL =
  'https://www.atptour.com/-/media/files/calendar-pdfs/2025/2026-atp-tour-calendar-december-2025.pdf';

export const ATP_CHALLENGER_CALENDAR_URL =
  'https://www.atptour.com/-/media/files/calendar-pdfs/2026/2026-27-atp-challenger-calendar-as-of-10-march-2026-updated.pdf';

export type TournamentEdition = {
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
    protennislive_code: string | null;
    has_doubles_qualifying: boolean;
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
  indoor: boolean | null,
  protennisliveCode: string | null,
  hasDoublesQualifying: boolean
): TournamentEdition {
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
      protennislive_code: protennisliveCode,
      has_doubles_qualifying: hasDoublesQualifying,
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
  indoor: boolean | null,
  protennisliveCode: string | null,
  hasDoublesQualifying: boolean
): TournamentEdition {
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
      protennislive_code: protennisliveCode,
      has_doubles_qualifying: hasDoublesQualifying,
    },
  };
}

export const ALL_EDITIONS: TournamentEdition[] = [
  // ─── WEEK 1 (Jan 5) ──────────────────────────────────────────────────────────
  tourEvent('Brisbane International Presented by ANZ', 'Brisbane', 'Australia', 2026, 1, '2026-01-05', null, 'ATP 250', 'Hard', false, '339', false),
  tourEvent('Bank of China Hong Kong Tennis Open', 'Hong Kong', 'Hong Kong', 2026, 1, '2026-01-05', null, 'ATP 250', 'Hard', false, '336', false),
  challengerEvent('Bengaluru 1', 'Bengaluru', 'India', 2026, 1, '2026-01-05', null, 'Challenger 125', 'Hard', false, '7808', false),
  challengerEvent('Canberra', 'Canberra', 'Australia', 2026, 1, '2026-01-05', null, 'Challenger 125', 'Hard', false, '7393', false),
  challengerEvent('Nouméa', 'Nouméa', 'New Caledonia', 2026, 1, '2026-01-05', null, 'Challenger 75', 'Hard', false, '2205', false),
  challengerEvent('Nonthaburi 1', 'Nonthaburi', 'Thailand', 2026, 1, '2026-01-05', null, 'Challenger 50', 'Hard', false, '2791', false),
  challengerEvent('Nottingham 1', 'Nottingham', 'Great Britain', 2026, 1, '2026-01-05', null, 'Challenger 50', 'Indoor Hard', true, '2907', false),

  // ─── WEEK 2 (Jan 12) — Australian Open begins ────────────────────────────────
  tourEvent('Adelaide International', 'Adelaide', 'Australia', 2026, 2, '2026-01-12', null, 'ATP 250', 'Hard', false, '8998', false),
  tourEvent('ASB Classic', 'Auckland', 'New Zealand', 2026, 2, '2026-01-12', null, 'ATP 250', 'Hard', false, '301', false),
  challengerEvent('Nonthaburi 2', 'Nonthaburi', 'Thailand', 2026, 2, '2026-01-12', null, 'Challenger 75', 'Hard', false, '2795', false),
  challengerEvent('Buenos Aires Challenger', 'Buenos Aires', 'Argentina', 2026, 2, '2026-01-12', null, 'Challenger 50', 'Clay', false, '1210', false),
  challengerEvent('Glasgow', 'Glasgow', 'Great Britain', 2026, 2, '2026-01-12', null, 'Challenger 50', 'Indoor Hard', true, '7916', false),

  // ─── WEEK 3 (Jan 19) — Australian Open ───────────────────────────────────────
  tourEvent('Cordoba Open', 'Cordoba', 'Argentina', 2026, 3, '2026-01-19', null, 'ATP 250', 'Clay', false, '9158', false),
  challengerEvent('Oeiras 1', 'Oeiras', 'Portugal', 2026, 3, '2026-01-19', null, 'Challenger 100', 'Indoor Hard', true, '2831', false),
  challengerEvent('Itajaí', 'Itajaí', 'Brazil', 2026, 3, '2026-01-19', null, 'Challenger 75', 'Clay', false, '3053', false),

  // ─── WEEK 5 (Feb 2) ──────────────────────────────────────────────────────────
  tourEvent('Open Occitanie', 'Montpellier', 'France', 2026, 5, '2026-02-02', null, 'ATP 250', 'Indoor Hard', true, '375', false),

  // ─── WEEK 6 (Feb 9) ──────────────────────────────────────────────────────────
  tourEvent('Dallas Open', 'Dallas', 'United States', 2026, 6, '2026-02-09', null, 'ATP 500', 'Indoor Hard', true, '424', true),
  tourEvent('ABN AMRO Open', 'Rotterdam', 'Netherlands', 2026, 6, '2026-02-09', null, 'ATP 500', 'Indoor Hard', true, '407', true),
  tourEvent('IEB Argentina Open', 'Buenos Aires', 'Argentina', 2026, 6, '2026-02-09', null, 'ATP 250', 'Clay', false, '506', false),
  tourEvent('Open Provence', 'Marseille', 'France', 2026, 6, '2026-02-09', null, 'ATP 250', 'Indoor Hard', true, '496', false),

  // ─── WEEK 7 (Feb 16) ─────────────────────────────────────────────────────────
  tourEvent('Qatar ExxonMobil Open', 'Doha', 'Qatar', 2026, 7, '2026-02-16', null, 'ATP 500', 'Hard', false, '451', true),
  tourEvent('Rio Open Presented by Claro', 'Rio de Janeiro', 'Brazil', 2026, 7, '2026-02-16', null, 'ATP 500', 'Clay', false, '6932', true),

  // ─── WEEK 8 (Feb 23) ─────────────────────────────────────────────────────────
  tourEvent('Dubai Duty Free Tennis Championships', 'Dubai', 'United Arab Emirates', 2026, 8, '2026-02-23', null, 'ATP 500', 'Hard', false, '495', true),
  tourEvent('Abierto Mexicano Telcel', 'Acapulco', 'Mexico', 2026, 8, '2026-02-23', null, 'ATP 500', 'Hard', false, '807', true),

  // ─── WEEK 9 (Mar 2) ──────────────────────────────────────────────────────────
  tourEvent('Delray Beach Open', 'Delray Beach', 'United States', 2026, 8, '2026-02-23', null, 'ATP 250', 'Hard', false, '499', false),
  tourEvent('Santiago Open', 'Santiago', 'Chile', 2026, 8, '2026-02-23', null, 'ATP 250', 'Clay', false, '8996', false),

  // ─── WEEK 10 (Mar 4) — ATP 1000 ──────────────────────────────────────────────
  tourEvent('BNP Paribas Open', 'Indian Wells', 'United States', 2026, 9, '2026-03-04', '2026-03-15', 'ATP 1000', 'Hard', false, '404', false),

  // ─── WEEK 12 (Mar 18) — ATP 1000 ─────────────────────────────────────────────
  tourEvent('Miami Open presented by Itau', 'Miami', 'United States', 2026, 12, '2026-03-18', '2026-03-29', 'ATP 1000', 'Hard', false, '403', false),

  // ─── WEEK 13 (Mar 30) ────────────────────────────────────────────────────────
  tourEvent('Houston Open', 'Houston', 'United States', 2026, 13, '2026-03-30', null, 'ATP 250', 'Clay', false, '717', false),

  // ─── WEEK 14 (Apr 5) — ATP 1000 ──────────────────────────────────────────────
  tourEvent('Rolex Monte-Carlo Masters', 'Monte-Carlo', 'Monaco', 2026, 14, '2026-04-05', '2026-04-12', 'ATP 1000', 'Clay', false, '410', false),

  // ─── WEEK 15 (Apr 13) ────────────────────────────────────────────────────────
  tourEvent('Grand Prix Hassan II', 'Marrakech', 'Morocco', 2026, 15, '2026-04-13', null, 'ATP 250', 'Clay', false, '360', false),

  // ─── WEEK 16 (Apr 20) ────────────────────────────────────────────────────────
  tourEvent('Barcelona Open Banc Sabadell', 'Barcelona', 'Spain', 2026, 16, '2026-04-20', null, 'ATP 500', 'Clay', false, '425', true),
  tourEvent('BMW Open', 'Munich', 'Germany', 2026, 15, '2026-04-13', null, 'ATP 500', 'Clay', false, '308', true),
  tourEvent('Millennium Estoril Open', 'Estoril', 'Portugal', 2026, 15, '2026-04-13', null, 'ATP 500', 'Clay', false, '7290', false),

  // ─── WEEK 17 (Apr 22) — ATP 1000 ─────────────────────────────────────────────
  tourEvent('Mutua Madrid Open', 'Madrid', 'Spain', 2026, 17, '2026-04-22', '2026-05-03', 'ATP 1000', 'Clay', false, '1536', false),

  // ─── WEEK 19 (May 6) — ATP 1000 ──────────────────────────────────────────────
  tourEvent("Internazionali BNL d'Italia", 'Rome', 'Italy', 2026, 18, '2026-05-06', '2026-05-17', 'ATP 1000', 'Clay', false, '416', false),

  // ─── WEEK 20 (May 17) — clay before Roland Garros ───────────────────────────
  tourEvent('Open Parc Auvergne-Rhône-Alpes', 'Lyon', 'France', 2026, 20, '2026-05-18', null, 'ATP 250', 'Clay', false, '7309', false),
  tourEvent('Gonet Geneva Open', 'Geneva', 'Switzerland', 2026, 20, '2026-05-17', null, 'ATP 250', 'Clay', false, '322', false),

  // ─── WEEKS 21–23: Roland Garros (Grand Slam — excluded) ──────────────────────

  // ─── WEEK 23 (Jun 8) — grass season opens ────────────────────────────────────
  tourEvent('Boss Open', 'Stuttgart', 'Germany', 2026, 23, '2026-06-08', null, 'ATP 250', 'Grass', false, '321', false),

  // ─── WEEK 24 (Jun 15) ────────────────────────────────────────────────────────
  tourEvent('Terra Wortmann Open', 'Halle', 'Germany', 2026, 24, '2026-06-15', null, 'ATP 500', 'Grass', false, '500', true),
  tourEvent('HSBC Championships', 'London', 'Great Britain', 2026, 24, '2026-06-15', null, 'ATP 500', 'Grass', false, '311', true),
  tourEvent('Libema Open', 's-Hertogenbosch', 'Netherlands', 2026, 24, '2026-06-15', null, 'ATP 250', 'Grass', false, '440', false),

  // ─── WEEK 25 (Jun 22) ────────────────────────────────────────────────────────
  tourEvent('Lexus Eastbourne Open', 'Eastbourne', 'Great Britain', 2026, 25, '2026-06-22', null, 'ATP 250', 'Grass', false, '741', false),
  tourEvent('Mallorca Championships', 'Mallorca', 'Spain', 2026, 25, '2026-06-22', null, 'ATP 250', 'Grass', false, '8994', false),

  // ─── WEEKS 26–27: Wimbledon (Grand Slam — excluded) ──────────────────────────

  // ─── WEEK 28 (Jul 13) — post-Wimbledon clay ──────────────────────────────────
  tourEvent('SkiStar Swedish Open', 'Bastad', 'Sweden', 2026, 28, '2026-07-13', null, 'ATP 250', 'Clay', false, '316', false),
  tourEvent('Hamburg Open', 'Hamburg', 'Germany', 2026, 28, '2026-07-13', null, 'ATP 250', 'Clay', false, '414', false),
  tourEvent('EFG Swiss Open', 'Gstaad', 'Switzerland', 2026, 28, '2026-07-13', null, 'ATP 250', 'Clay', false, '314', false),
  tourEvent('Plava Laguna Croatia Open', 'Umag', 'Croatia', 2026, 28, '2026-07-13', null, 'ATP 250', 'Clay', false, '439', false),

  // ─── WEEK 29 (Jul 20) ────────────────────────────────────────────────────────
  tourEvent('Generali Open', 'Kitzbühel', 'Austria', 2026, 29, '2026-07-20', null, 'ATP 250', 'Clay', false, '319', false),
  tourEvent('Abierto de Tenis Mifel', 'Los Cabos', 'Mexico', 2026, 29, '2026-07-20', null, 'ATP 250', 'Hard', false, '7480', false),

  // ─── WEEK 30 (Jul 27) ────────────────────────────────────────────────────────
  tourEvent('Citi Open', 'Washington', 'United States', 2026, 30, '2026-07-27', null, 'ATP 500', 'Hard', false, '418', true),

  // ─── WEEK 31 (Aug 2) — ATP 1000 ──────────────────────────────────────────────
  tourEvent('National Bank Open presented by Rogers', 'Montreal', 'Canada', 2026, 31, '2026-08-02', '2026-08-13', 'ATP 1000', 'Hard', false, '421', false),

  // ─── WEEK 33 (Aug 13) — ATP 1000 ─────────────────────────────────────────────
  tourEvent('Cincinnati Open', 'Cincinnati', 'United States', 2026, 33, '2026-08-13', '2026-08-23', 'ATP 1000', 'Hard', false, '422', false),

  // ─── WEEK 34 (Aug 24) ────────────────────────────────────────────────────────
  tourEvent('Winston-Salem Open', 'Winston-Salem', 'United States', 2026, 34, '2026-08-24', null, 'ATP 250', 'Hard', false, '6242', false),

  // ─── WEEKS 35–37: US Open (Grand Slam — excluded) ────────────────────────────

  // ─── WEEK 38 (Sep 14) — Asian hard court swing ───────────────────────────────
  tourEvent('Chengdu Open', 'Chengdu', 'China', 2026, 38, '2026-09-14', null, 'ATP 250', 'Hard', false, '7581', false),
  tourEvent('Zhuhai Championships', 'Zhuhai', 'China', 2026, 38, '2026-09-14', null, 'ATP 250', 'Hard', false, '9164', false),

  // ─── WEEK 39 (Sep 21) ────────────────────────────────────────────────────────
  tourEvent('China Open', 'Beijing', 'China', 2026, 39, '2026-09-21', null, 'ATP 500', 'Hard', false, '747', true),

  // ─── WEEK 40 (Sep 28) ────────────────────────────────────────────────────────
  tourEvent('Rakuten Japan Open', 'Tokyo', 'Japan', 2026, 40, '2026-09-28', null, 'ATP 500', 'Hard', false, '329', true),

  // ─── WEEK 41 (Oct 7) — ATP 1000 ──────────────────────────────────────────────
  tourEvent('Rolex Shanghai Masters', 'Shanghai', 'China', 2026, 41, '2026-10-07', '2026-10-18', 'ATP 1000', 'Hard', false, '5014', false),

  // ─── WEEK 42 (Oct 19) ────────────────────────────────────────────────────────
  tourEvent('Moselle Open', 'Metz', 'France', 2026, 42, '2026-10-19', null, 'ATP 250', 'Indoor Hard', true, '341', false),

  // ─── WEEK 43 (Oct 26) ────────────────────────────────────────────────────────
  tourEvent('Erste Bank Open', 'Vienna', 'Austria', 2026, 43, '2026-10-26', null, 'ATP 500', 'Indoor Hard', true, '337', true),
  tourEvent('Swiss Indoors', 'Basel', 'Switzerland', 2026, 43, '2026-10-26', null, 'ATP 500', 'Indoor Hard', true, '328', true),
  tourEvent('If Stockholm Open', 'Stockholm', 'Sweden', 2026, 43, '2026-10-26', null, 'ATP 250', 'Indoor Hard', true, '429', false),

  // ─── WEEK 45 (Nov 2) — ATP 1000 ──────────────────────────────────────────────
  tourEvent('Rolex Paris Masters', 'Paris', 'France', 2026, 45, '2026-11-02', '2026-11-08', 'ATP 1000', 'Indoor Hard', true, '352', false),

];
