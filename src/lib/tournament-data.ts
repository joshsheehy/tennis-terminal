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

// A Grand Slam spans two builder weeks: qualifying (singles only) the week
// before, then the main draw (singles + doubles) the next. We model that as two
// editions; the "Grand Slam Qualifying" level marks the singles-only week so the
// builder hides the doubles pill there.
function grandSlam(
  name: string,
  city: string,
  country: string,
  year: number,
  qualiWeek: number,
  qualiDate: string,
  mainWeek: number,
  mainDate: string,
  surface: string
): TournamentEdition[] {
  const base = {
    year,
    end_date: null,
    surface,
    indoor: false,
    source: 'atp_tour_pdf' as const,
    source_url: ATP_TOUR_CALENDAR_URL,
    status: 'held' as const,
    protennislive_code: null,
    has_doubles_qualifying: false,
  };
  return [
    {
      tournament: { slug: makeSlug(`${name} Qualifying`, city), name: `${name} Qualifying`, city, country },
      edition: { ...base, week: qualiWeek, start_date: qualiDate, level: 'Grand Slam Qualifying' },
    },
    {
      tournament: { slug: makeSlug(name, city), name, city, country },
      edition: { ...base, week: mainWeek, start_date: mainDate, level: 'Grand Slam' },
    },
  ];
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
  // ─── GRAND SLAMS ─────────────────────────────────────────────────────────────
  // Each Slam = qualifying (singles only) one week, then main draw + doubles the
  // next. Weeks align with the reserved slots elsewhere in this file.
  ...grandSlam('Australian Open', 'Melbourne', 'Australia', 2026, 2, '2026-01-12', 3, '2026-01-19', 'Hard'),
  ...grandSlam('Roland Garros', 'Paris', 'France', 2026, 21, '2026-05-25', 22, '2026-06-01', 'Clay'),
  ...grandSlam('Wimbledon', 'London', 'Great Britain', 2026, 25, '2026-06-22', 26, '2026-06-29', 'Grass'),
  ...grandSlam('US Open', 'New York', 'United States', 2026, 35, '2026-08-31', 36, '2026-09-07', 'Hard'),

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
  // (Cordoba Open dropped off the 2026 ATP Tour calendar; Cordoba now runs only
  // as a Challenger — see "Córdoba Challenger", code 2981, in week 19.)
  challengerEvent('Oeiras 1', 'Oeiras', 'Portugal', 2026, 3, '2026-01-19', null, 'Challenger 100', 'Indoor Hard', true, '2831', false),
  challengerEvent('Itajaí', 'Itajaí', 'Brazil', 2026, 3, '2026-01-19', null, 'Challenger 75', 'Clay', false, '3053', false),
  challengerEvent('Soma Bay', 'Soma Bay', 'Egypt', 2026, 3, '2026-01-19', null, 'Challenger 75', 'Hard', false, '3039', false),
  challengerEvent('Phan Thiết 1', 'Phan Thiết', 'Vietnam', 2026, 3, '2026-01-19', null, 'Challenger 50', 'Hard', false, null, false),

  // ─── WEEK 4 (Jan 26) ─────────────────────────────────────────────────────────
  challengerEvent('Manama', 'Manama', 'Bahrain', 2026, 4, '2026-01-26', null, 'Challenger 125', 'Hard', false, '9635', false),
  challengerEvent('Quimper', 'Quimper', 'France', 2026, 4, '2026-01-26', null, 'Challenger 125', 'Indoor Hard', true, '6239', false),
  challengerEvent('Concepción', 'Concepción', 'Chile', 2026, 4, '2026-01-26', null, 'Challenger 100', 'Clay', false, '9452', false),
  challengerEvent('San Diego, CA', 'San Diego', 'United States', 2026, 4, '2026-01-26', null, 'Challenger 100', 'Hard', false, '2971', false),
  challengerEvent('Oeiras 2', 'Oeiras', 'Portugal', 2026, 4, '2026-01-26', null, 'Challenger 75', 'Indoor Hard', true, '2833', false),
  challengerEvent('Phan Thiết 2', 'Phan Thiết', 'Vietnam', 2026, 4, '2026-01-26', null, 'Challenger 50', 'Hard', false, null, false),

  // ─── WEEK 5 (Feb 2) ──────────────────────────────────────────────────────────
  challengerEvent('Rosario', 'Rosario', 'Argentina', 2026, 5, '2026-02-02', null, 'Challenger 125', 'Clay', false, '2965', false),
  challengerEvent('Brisbane 1', 'Brisbane', 'Australia', 2026, 5, '2026-02-02', null, 'Challenger 75', 'Hard', false, '2967', false),
  challengerEvent('Cleveland, OH', 'Cleveland', 'United States', 2026, 5, '2026-02-02', null, 'Challenger 75', 'Indoor Hard', true, '9154', false),
  challengerEvent('Tenerife 1', 'Tenerife', 'Spain', 2026, 5, '2026-02-02', null, 'Challenger 75', 'Hard', false, '9623', false),
  challengerEvent('Cesenatico', 'Cesenatico', 'Italy', 2026, 5, '2026-02-02', null, 'Challenger 50', 'Indoor Hard', true, null, false),
  challengerEvent('Koblenz', 'Koblenz', 'Germany', 2026, 5, '2026-02-02', null, 'Challenger 50', 'Indoor Hard', true, '7652', false),

  // ─── WEEK 5 (Feb 2) ──────────────────────────────────────────────────────────
  tourEvent('Open Occitanie', 'Montpellier', 'France', 2026, 5, '2026-02-02', null, 'ATP 250', 'Indoor Hard', true, '375', false),

  // ─── WEEK 6 (Feb 9) ──────────────────────────────────────────────────────────
  tourEvent('Dallas Open', 'Dallas', 'United States', 2026, 6, '2026-02-09', null, 'ATP 500', 'Indoor Hard', true, '424', true),
  tourEvent('ABN AMRO Open', 'Rotterdam', 'Netherlands', 2026, 6, '2026-02-09', null, 'ATP 500', 'Indoor Hard', true, '407', true),
  tourEvent('IEB Argentina Open', 'Buenos Aires', 'Argentina', 2026, 6, '2026-02-09', null, 'ATP 250', 'Clay', false, '506', false),
  // ─── WEEK 7 (Feb 16) ─────────────────────────────────────────────────────────
  tourEvent('Qatar ExxonMobil Open', 'Doha', 'Qatar', 2026, 7, '2026-02-16', null, 'ATP 500', 'Hard', false, '451', true),
  tourEvent('Rio Open Presented by Claro', 'Rio de Janeiro', 'Brazil', 2026, 7, '2026-02-16', null, 'ATP 500', 'Clay', false, '6932', true),

  // ─── WEEK 8 (Feb 23) ─────────────────────────────────────────────────────────
  tourEvent('Dubai Duty Free Tennis Championships', 'Dubai', 'United Arab Emirates', 2026, 8, '2026-02-23', null, 'ATP 500', 'Hard', false, '495', true),
  tourEvent('Abierto Mexicano Telcel', 'Acapulco', 'Mexico', 2026, 8, '2026-02-23', null, 'ATP 500', 'Hard', false, '807', true),

  challengerEvent('Pau', 'Pau', 'France', 2026, 6, '2026-02-09', null, 'Challenger 125', 'Indoor Hard', true, '9162', false),
  challengerEvent('Brisbane 2', 'Brisbane', 'Australia', 2026, 6, '2026-02-09', null, 'Challenger 75', 'Hard', false, '2969', false),
  challengerEvent('Tenerife 2', 'Tenerife', 'Spain', 2026, 6, '2026-02-09', null, 'Challenger 75', 'Hard', false, '2839', false),
  challengerEvent('Baton Rouge, LA', 'Baton Rouge', 'United States', 2026, 6, '2026-02-09', null, 'Challenger 50', 'Indoor Hard', true, null, false),
  challengerEvent('Chennai', 'Chennai', 'India', 2026, 6, '2026-02-09', null, 'Challenger 50', 'Hard', false, '7849', false),

  // ─── WEEK 7 (Feb 16) ─────────────────────────────────────────────────────────
  challengerEvent('Lille', 'Lille', 'France', 2026, 7, '2026-02-16', null, 'Challenger 125', 'Indoor Hard', true, '7874', false),
  challengerEvent('Metepec', 'Metepec', 'Mexico', 2026, 7, '2026-02-16', null, 'Challenger 75', 'Hard', false, null, false),
  challengerEvent('New Delhi', 'New Delhi', 'India', 2026, 7, '2026-02-16', null, 'Challenger 75', 'Hard', false, '6961', false),
  challengerEvent('Tigre 1', 'Tigre', 'Argentina', 2026, 7, '2026-02-16', null, 'Challenger 50', 'Clay', false, '9678', false),

  // ─── WEEK 8 (Feb 23) ─────────────────────────────────────────────────────────
  challengerEvent('Saint-Brieuc', 'Saint-Brieuc', 'France', 2026, 8, '2026-02-23', null, 'Challenger 100', 'Indoor Hard', true, '1796', false),
  challengerEvent('Lugano', 'Lugano', 'Switzerland', 2026, 8, '2026-02-23', null, 'Challenger 75', 'Indoor Hard', true, '9516', false),
  challengerEvent('Pune', 'Pune', 'India', 2026, 8, '2026-02-23', null, 'Challenger 75', 'Hard', false, '7100', false),
  challengerEvent('Tigre 2', 'Tigre', 'Argentina', 2026, 8, '2026-02-23', null, 'Challenger 50', 'Clay', false, null, false),

  // ─── WEEK 10 (Mar 9) ─────────────────────────────────────────────────────────
  challengerEvent('Cap Cana', 'Cap Cana', 'Dominican Republic', 2026, 10, '2026-03-09', null, 'Challenger 175', 'Hard', false, '2975', false),
  challengerEvent('Phoenix, AZ', 'Phoenix', 'United States', 2026, 10, '2026-03-09', null, 'Challenger 175', 'Hard', false, '9167', false),
  challengerEvent('Kigali 2', 'Kigali', 'Rwanda', 2026, 10, '2026-03-09', null, 'Challenger 100', 'Clay', false, '2915', false),
  challengerEvent('Cherbourg-en-Cotentin', 'Cherbourg-en-Cotentin', 'France', 2026, 10, '2026-03-09', null, 'Challenger 75', 'Indoor Hard', true, '398', false),
  challengerEvent('Santiago Challenger', 'Santiago', 'Chile', 2026, 10, '2026-03-09', null, 'Challenger 75', 'Clay', false, '3406', false),
  challengerEvent('Hersonissos 2', 'Hersonissos', 'Greece', 2026, 10, '2026-03-09', null, 'Challenger 50', 'Hard', false, '2985', false),

  // ─── WEEK 11 (Mar 16) ────────────────────────────────────────────────────────
  challengerEvent('Asunción (Rakiura)', 'Asunción', 'Paraguay', 2026, 11, '2026-03-16', null, 'Challenger 75', 'Clay', false, '2909', false),
  challengerEvent('Cuernavaca', 'Cuernavaca', 'Mexico', 2026, 11, '2026-03-16', null, 'Challenger 75', 'Hard', false, '6963', false),
  challengerEvent('Murcia', 'Murcia', 'Spain', 2026, 11, '2026-03-16', null, 'Challenger 75', 'Clay', false, '9171', false),
  challengerEvent('Zadar', 'Zadar', 'Croatia', 2026, 11, '2026-03-16', null, 'Challenger 75', 'Clay', false, '9472', false),

  // ─── WEEK 12 (Mar 23) ────────────────────────────────────────────────────────
  challengerEvent('Morelia', 'Morelia', 'Mexico', 2026, 12, '2026-03-23', null, 'Challenger 125', 'Hard', false, '2991', false),
  challengerEvent('Naples', 'Naples', 'Italy', 2026, 12, '2026-03-23', null, 'Challenger 125', 'Clay', false, '2911', false),
  challengerEvent('Alicante (Montemar)', 'Alicante', 'Spain', 2026, 12, '2026-03-23', null, 'Challenger 100', 'Clay', false, '2955', false),
  challengerEvent('São Paulo', 'São Paulo', 'Brazil', 2026, 12, '2026-03-23', null, 'Challenger 100', 'Clay', false, '2953', false),
  challengerEvent('Bucaramanga (Floridablanca)', 'Bucaramanga', 'Colombia', 2026, 12, '2026-03-23', null, 'Challenger 50', 'Clay', false, null, false),
  challengerEvent('Split', 'Split', 'Croatia', 2026, 12, '2026-03-23', null, 'Challenger 50', 'Clay', false, '8388', false),
  challengerEvent('Yokkaichi', 'Yokkaichi', 'Japan', 2026, 12, '2026-03-23', null, 'Challenger 50', 'Hard', false, '8268', false),

  // ─── WEEK 7 (Feb 16) ─────────────────────────────────────────────────────────
  tourEvent('Delray Beach Open', 'Delray Beach', 'United States', 2026, 7, '2026-02-16', null, 'ATP 250', 'Hard', false, '499', false),
  // ─── WEEK 8 (Feb 23) ─────────────────────────────────────────────────────────
  tourEvent('Santiago Open', 'Santiago', 'Chile', 2026, 8, '2026-02-23', null, 'ATP 250', 'Clay', false, '8996', false),

  // ─── WEEK 10 (Mar 4) — ATP 1000 ──────────────────────────────────────────────
  tourEvent('BNP Paribas Open', 'Indian Wells', 'United States', 2026, 9, '2026-03-04', '2026-03-15', 'ATP 1000', 'Hard', false, '404', false),

  // ─── WEEK 11 (Mar 16) — ATP 1000 ─────────────────────────────────────────────
  tourEvent('Miami Open presented by Itau', 'Miami', 'United States', 2026, 11, '2026-03-18', '2026-03-29', 'ATP 1000', 'Hard', false, '403', false),

  // ─── WEEK 13 (Mar 30) ────────────────────────────────────────────────────────
  tourEvent('Houston Open', 'Houston', 'United States', 2026, 13, '2026-03-30', null, 'ATP 250', 'Clay', false, '717', false),

  challengerEvent('Menorca', 'Menorca', 'Spain', 2026, 13, '2026-03-30', null, 'Challenger 100', 'Clay', false, '2987', false),
  challengerEvent('Barletta', 'Barletta', 'Italy', 2026, 13, '2026-03-30', null, 'Challenger 75', 'Clay', false, '7494', false),
  challengerEvent('San Luis Potosí', 'San Luis Potosí', 'Mexico', 2026, 13, '2026-03-30', null, 'Challenger 75', 'Clay', false, '213', false),
  challengerEvent('São Leopoldo', 'São Leopoldo', 'Brazil', 2026, 13, '2026-03-30', null, 'Challenger 75', 'Clay', false, '2821', false),
  challengerEvent('Miyazaki', 'Miyazaki', 'Japan', 2026, 13, '2026-03-30', null, 'Challenger 50', 'Hard', false, null, false),

  // ─── WEEK 14 (Apr 6) ─────────────────────────────────────────────────────────
  challengerEvent('Mexico City', 'Mexico City', 'Mexico', 2026, 14, '2026-04-06', null, 'Challenger 125', 'Clay', false, '8375', false),
  challengerEvent('Monza', 'Monza', 'Italy', 2026, 14, '2026-04-06', null, 'Challenger 125', 'Clay', false, '2989', false),
  challengerEvent('Campinas', 'Campinas', 'Brazil', 2026, 14, '2026-04-06', null, 'Challenger 75', 'Clay', false, '6307', false),
  challengerEvent('Madrid Challenger', 'Madrid', 'Spain', 2026, 14, '2026-04-06', null, 'Challenger 75', 'Clay', false, '9687', false),
  challengerEvent('Sarasota, FL', 'Sarasota', 'United States', 2026, 14, '2026-04-06', null, 'Challenger 75', 'Clay', false, '5069', false),
  challengerEvent('Wuning 1', 'Wuning', 'China', 2026, 14, '2026-04-06', null, 'Challenger 50', 'Hard', false, null, false),

  // ─── WEEK 15 (Apr 13) ────────────────────────────────────────────────────────
  challengerEvent('Busan', 'Busan', 'South Korea', 2026, 15, '2026-04-13', null, 'Challenger 125', 'Hard', false, '1741', false),
  challengerEvent('Oeiras 3', 'Oeiras', 'Portugal', 2026, 15, '2026-04-13', null, 'Challenger 125', 'Clay', false, '2979', false),
  challengerEvent('Santa Cruz de la Sierra', 'Santa Cruz de la Sierra', 'Bolivia', 2026, 15, '2026-04-13', null, 'Challenger 75', 'Clay', false, '9479', false),
  challengerEvent('Tallahassee, FL', 'Tallahassee', 'United States', 2026, 15, '2026-04-13', null, 'Challenger 75', 'Clay', false, '692', false),
  challengerEvent('Wuning 2', 'Wuning', 'China', 2026, 15, '2026-04-13', null, 'Challenger 50', 'Hard', false, null, false),

  // ─── WEEK 16 (Apr 20) ────────────────────────────────────────────────────────
  challengerEvent('Gwangju', 'Gwangju', 'South Korea', 2026, 16, '2026-04-20', null, 'Challenger 75', 'Hard', false, '7490', false),
  challengerEvent('Rome Challenger', 'Rome', 'Italy', 2026, 16, '2026-04-20', null, 'Challenger 75', 'Clay', false, '2151', false),
  challengerEvent('Savannah, GA', 'Savannah', 'United States', 2026, 16, '2026-04-20', null, 'Challenger 75', 'Clay', false, '5067', false),
  challengerEvent('Abidjan 1', 'Abidjan', "Côte d'Ivoire", 2026, 16, '2026-04-20', null, 'Challenger 50', 'Hard', false, '2995', false),
  challengerEvent('Shymkent 1', 'Shymkent', 'Kazakhstan', 2026, 16, '2026-04-20', null, 'Challenger 50', 'Clay', false, null, false),

  // ─── WEEK 14 (Apr 6) — ATP 1000 ──────────────────────────────────────────────
  // Monte-Carlo starts Sunday Apr 5; store the Monday so the computed week is 14.
  tourEvent('Rolex Monte-Carlo Masters', 'Monte-Carlo', 'Monaco', 2026, 14, '2026-04-06', '2026-04-12', 'ATP 1000', 'Clay', false, '410', false),

  // ─── WEEK 15 (Apr 13) ────────────────────────────────────────────────────────
  tourEvent('Grand Prix Hassan II', 'Marrakech', 'Morocco', 2026, 13, '2026-03-30', null, 'ATP 250', 'Clay', false, '360', false),
  tourEvent('Tiriac Open', 'Bucharest', 'Romania', 2026, 13, '2026-03-30', null, 'ATP 250', 'Clay', false, '4462', false),

  // ─── WEEK 16 (Apr 20) ────────────────────────────────────────────────────────
  tourEvent('Barcelona Open Banc Sabadell', 'Barcelona', 'Spain', 2026, 15, '2026-04-13', null, 'ATP 500', 'Clay', false, '425', true),
  tourEvent('BMW Open', 'Munich', 'Germany', 2026, 15, '2026-04-13', null, 'ATP 500', 'Clay', false, '308', true),

  // ─── WEEK 17 (Apr 27) ────────────────────────────────────────────────────────
  challengerEvent('Aix-en-Provence', 'Aix-en-Provence', 'France', 2026, 17, '2026-04-27', null, 'Challenger 175', 'Clay', false, '7009', false),
  challengerEvent('Cagliari', 'Cagliari', 'Italy', 2026, 17, '2026-04-27', null, 'Challenger 175', 'Clay', false, '2861', false),
  challengerEvent('Mauthausen', 'Mauthausen', 'Austria', 2026, 17, '2026-04-27', null, 'Challenger 100', 'Clay', false, '9697', false),
  challengerEvent('Jiujiang', 'Jiujiang', 'China', 2026, 17, '2026-04-27', null, 'Challenger 75', 'Hard', false, null, false),
  challengerEvent('Ostrava', 'Ostrava', 'Czech Republic', 2026, 17, '2026-04-27', null, 'Challenger 75', 'Clay', false, '1797', false),
  challengerEvent('Abidjan 2', 'Abidjan', "Côte d'Ivoire", 2026, 17, '2026-04-27', null, 'Challenger 75', 'Hard', false, '2997', false),
  challengerEvent('Shymkent 2', 'Shymkent', 'Kazakhstan', 2026, 17, '2026-04-27', null, 'Challenger 50', 'Clay', false, '9192', false),

  // ─── WEEK 18 (May 4) ─────────────────────────────────────────────────────────
  challengerEvent('Wuxi', 'Wuxi', 'China', 2026, 18, '2026-05-04', null, 'Challenger 100', 'Hard', false, '2921', false),
  challengerEvent('Francavilla al Mare', 'Francavilla al Mare', 'Italy', 2026, 18, '2026-05-04', null, 'Challenger 75', 'Clay', false, '7707', false),
  challengerEvent('Prague', 'Prague', 'Czech Republic', 2026, 18, '2026-05-04', null, 'Challenger 75', 'Clay', false, '600', false),
  challengerEvent('Brazzaville', 'Brazzaville', 'Republic of the Congo', 2026, 18, '2026-05-04', null, 'Challenger 50', 'Clay', false, '2961', false),
  challengerEvent('Santos', 'Santos', 'Brazil', 2026, 18, '2026-05-04', null, 'Challenger 50', 'Clay', false, '2923', false),

  // ─── WEEK 19 (May 11) ────────────────────────────────────────────────────────
  challengerEvent('Bordeaux', 'Bordeaux', 'France', 2026, 19, '2026-05-11', null, 'Challenger 175', 'Clay', false, '3824', false),
  challengerEvent('Valencia', 'Valencia', 'Spain', 2026, 19, '2026-05-11', null, 'Challenger 175', 'Clay', false, '2823', false),
  challengerEvent('Oeiras 4', 'Oeiras', 'Portugal', 2026, 19, '2026-05-11', null, 'Challenger 100', 'Clay', false, '9514', false),
  challengerEvent('Tunis', 'Tunis', 'Tunisia', 2026, 19, '2026-05-11', null, 'Challenger 75', 'Clay', false, '1541', false),
  challengerEvent('Zagreb', 'Zagreb', 'Croatia', 2026, 19, '2026-05-11', null, 'Challenger 75', 'Clay', false, '9500', false),
  challengerEvent('Bengaluru 2', 'Bengaluru', 'India', 2026, 19, '2026-05-11', null, 'Challenger 50', 'Hard', false, null, false),
  challengerEvent('Córdoba Challenger', 'Córdoba', 'Argentina', 2026, 19, '2026-05-11', null, 'Challenger 50', 'Clay', false, '2981', false),

  // ─── WEEK 20 (May 18) ────────────────────────────────────────────────────────
  challengerEvent('İstanbul (İstinye)', 'İstanbul', 'Turkey', 2026, 20, '2026-05-18', null, 'Challenger 75', 'Clay', false, '7083', false),
  challengerEvent('Bengaluru 3', 'Bengaluru', 'India', 2026, 20, '2026-05-18', null, 'Challenger 50', 'Hard', false, null, false),
  challengerEvent('Cervia', 'Cervia', 'Italy', 2026, 20, '2026-05-18', null, 'Challenger 50', 'Clay', false, null, false),

  // ─── WEEK 21 (May 25) ────────────────────────────────────────────────────────
  challengerEvent('Chișinău', 'Chișinău', 'Moldova', 2026, 21, '2026-05-25', null, 'Challenger 100', 'Clay', false, '2993', false),
  challengerEvent('Little Rock, AR', 'Little Rock', 'United States', 2026, 21, '2026-05-25', null, 'Challenger 75', 'Hard', false, '9188', false),
  challengerEvent('Vicenza', 'Vicenza', 'Italy', 2026, 21, '2026-05-25', null, 'Challenger 75', 'Clay', false, '7015', false),
  challengerEvent('Centurion 1', 'Centurion', 'South Africa', 2026, 21, '2026-05-25', null, 'Challenger 50', 'Hard', false, null, false),
  challengerEvent('Košice', 'Košice', 'Slovakia', 2026, 21, '2026-05-25', null, 'Challenger 50', 'Clay', false, null, false),

  // ─── WEEK 22 (Jun 1) ─────────────────────────────────────────────────────────
  challengerEvent('Birmingham', 'Birmingham', 'Great Britain', 2026, 22, '2026-06-01', null, 'Challenger 125', 'Grass', false, '4940', false),
  challengerEvent('Perugia', 'Perugia', 'Italy', 2026, 22, '2026-06-01', null, 'Challenger 125', 'Clay', false, '9001', false),
  challengerEvent('Bad Rappenau', 'Bad Rappenau', 'Germany', 2026, 22, '2026-06-01', null, 'Challenger 100', 'Clay', false, null, false),
  challengerEvent('Prostějov', 'Prostějov', 'Czech Republic', 2026, 22, '2026-06-01', null, 'Challenger 100', 'Clay', false, '558', false),
  challengerEvent('Tyler, TX', 'Tyler', 'United States', 2026, 22, '2026-06-01', null, 'Challenger 75', 'Hard', false, '2873', false),
  challengerEvent('Centurion 2', 'Centurion', 'South Africa', 2026, 22, '2026-06-01', null, 'Challenger 50', 'Hard', false, null, false),

  // ─── WEEK 23 (Jun 8) ─────────────────────────────────────────────────────────
  challengerEvent('Ilkley', 'Ilkley', 'Great Britain', 2026, 23, '2026-06-08', null, 'Challenger 125', 'Grass', false, '9005', false),
  challengerEvent('Bratislava', 'Bratislava', 'Slovakia', 2026, 23, '2026-06-08', null, 'Challenger 100', 'Clay', false, '9003', false),
  challengerEvent('Lyon Challenger', 'Lyon', 'France', 2026, 23, '2026-06-08', null, 'Challenger 100', 'Clay', false, '7536', false),
  challengerEvent('Cattolica', 'Cattolica', 'Italy', 2026, 23, '2026-06-08', null, 'Challenger 75', 'Clay', false, null, false),
  challengerEvent('San Miguel de Tucumán', 'San Miguel de Tucumán', 'Argentina', 2026, 23, '2026-06-08', null, 'Challenger 50', 'Clay', false, '2927', false),

  // ─── WEEK 24 (Jun 15) ────────────────────────────────────────────────────────
  challengerEvent('Nottingham 2', 'Nottingham', 'Great Britain', 2026, 24, '2026-06-15', null, 'Challenger 125', 'Grass', false, '7740', false),
  challengerEvent('Parma', 'Parma', 'Italy', 2026, 24, '2026-06-15', null, 'Challenger 125', 'Clay', false, null, false),
  challengerEvent('Poznań', 'Poznań', 'Poland', 2026, 24, '2026-06-15', null, 'Challenger 100', 'Clay', false, '786', false),
  challengerEvent('Dublin', 'Dublin', 'Ireland', 2026, 24, '2026-06-15', null, 'Challenger 75', 'Grass', false, null, false),
  challengerEvent('Asunción (CIT)', 'Asunción', 'Paraguay', 2026, 24, '2026-06-15', null, 'Challenger 50', 'Clay', false, null, false),
  challengerEvent('Royan', 'Royan', 'France', 2026, 24, '2026-06-15', null, 'Challenger 50', 'Clay', false, '4942', false),

  // ─── WEEK 25 (Jun 22) ────────────────────────────────────────────────────────
  challengerEvent('Târgu Mureș', 'Târgu Mureș', 'Romania', 2026, 25, '2026-06-22', null, 'Challenger 75', 'Clay', false, '3021', false),
  // Durham, NC dropped from the 2026 Challenger calendar (event cancelled).
  // Removed from canonical; sync-canonical's stale-row sweep marks the prior
  // 2026 Durham row not_held on the next sync so it disappears from the
  // schedule. Re-add here if it returns in 2027+.
  challengerEvent('Piracicaba', 'Piracicaba', 'Brazil', 2026, 25, '2026-06-22', null, 'Challenger 50', 'Clay', false, '2835', false),

  // ─── WEEK 26 (Jun 29) ────────────────────────────────────────────────────────
  challengerEvent('Brașov', 'Brașov', 'Romania', 2026, 26, '2026-06-29', null, 'Challenger 75', 'Clay', false, '2931', false),
  challengerEvent('Cary, NC', 'Cary', 'United States', 2026, 26, '2026-06-29', null, 'Challenger 75', 'Hard', false, '7316', false),
  challengerEvent('Milan Challenger', 'Milan', 'Italy', 2026, 26, '2026-06-29', null, 'Challenger 75', 'Clay', false, '3463', false),
  challengerEvent('Quito', 'Quito', 'Ecuador', 2026, 26, '2026-06-29', null, 'Challenger 50', 'Clay', false, null, false),
  challengerEvent('Troyes', 'Troyes', 'France', 2026, 26, '2026-06-29', null, 'Challenger 50', 'Clay', false, '1214', false),

  // ─── WEEK 27 (Jul 6) ─────────────────────────────────────────────────────────
  challengerEvent('Braunschweig', 'Braunschweig', 'Germany', 2026, 27, '2026-07-06', null, 'Challenger 125', 'Clay', false, '526', false),
  challengerEvent('Newport, RI', 'Newport', 'United States', 2026, 27, '2026-07-06', null, 'Challenger 125', 'Grass', false, '315', false),
  challengerEvent('Iași', 'Iași', 'Romania', 2026, 27, '2026-07-06', null, 'Challenger 100', 'Clay', false, '8394', false),
  challengerEvent('Bogotá', 'Bogotá', 'Colombia', 2026, 27, '2026-07-06', null, 'Challenger 75', 'Clay', false, '7389', false),
  challengerEvent('Trieste', 'Trieste', 'Italy', 2026, 27, '2026-07-06', null, 'Challenger 75', 'Clay', false, '9351', false),
  challengerEvent('Liège', 'Liège', 'Belgium', 2026, 27, '2026-07-06', null, 'Challenger 50', 'Clay', false, null, false),
  challengerEvent('Nottingham 3', 'Nottingham', 'Great Britain', 2026, 27, '2026-07-06', null, 'Challenger 50', 'Grass', false, '3007', false),

  // ─── WEEK 28 (Jul 13) ────────────────────────────────────────────────────────
  challengerEvent('Bunschoten', 'Bunschoten', 'Netherlands', 2026, 28, '2026-07-13', null, 'Challenger 75', 'Clay', false, '9198', false),
  challengerEvent('Cordenons', 'Cordenons', 'Italy', 2026, 28, '2026-07-13', null, 'Challenger 75', 'Clay', false, '2120', false),
  challengerEvent('Granby', 'Granby', 'Canada', 2026, 28, '2026-07-13', null, 'Challenger 75', 'Hard', false, '877', false),
  challengerEvent('Lincoln, NE', 'Lincoln', 'United States', 2026, 28, '2026-07-13', null, 'Challenger 75', 'Hard', false, '2941', false),
  challengerEvent('Pozoblanco', 'Pozoblanco', 'Spain', 2026, 28, '2026-07-13', null, 'Challenger 75', 'Hard', false, '472', false),

  // ─── WEEK 29 (Jul 20) ────────────────────────────────────────────────────────
  challengerEvent('Bloomfield Hills, MI', 'Bloomfield Hills', 'United States', 2026, 29, '2026-07-20', null, 'Challenger 125', 'Hard', false, '2883', false),
  challengerEvent('Zug', 'Zug', 'Switzerland', 2026, 29, '2026-07-20', null, 'Challenger 125', 'Clay', false, '2785', false),
  challengerEvent('Segovia', 'Segovia', 'Spain', 2026, 29, '2026-07-20', null, 'Challenger 75', 'Hard', false, '783', false),
  challengerEvent('Tampere', 'Tampere', 'Finland', 2026, 29, '2026-07-20', null, 'Challenger 75', 'Clay', false, '221', false),
  challengerEvent('Winnipeg', 'Winnipeg', 'Canada', 2026, 29, '2026-07-20', null, 'Challenger 75', 'Hard', false, '7542', false),

  // ─── WEEK 30 (Jul 27) ────────────────────────────────────────────────────────
  challengerEvent('San Marino', 'San Marino', 'San Marino', 2026, 30, '2026-07-27', null, 'Challenger 125', 'Clay', false, '9540', false),
  challengerEvent('Vancouver', 'Vancouver', 'Canada', 2026, 30, '2026-07-27', null, 'Challenger 125', 'Hard', false, null, false),
  challengerEvent('Bonn', 'Bonn', 'Germany', 2026, 30, '2026-07-27', null, 'Challenger 75', 'Clay', false, '2935', false),
  challengerEvent('Liberec', 'Liberec', 'Czech Republic', 2026, 30, '2026-07-27', null, 'Challenger 75', 'Clay', false, '6795', false),
  challengerEvent('Centurion 3', 'Centurion', 'South Africa', 2026, 30, '2026-07-27', null, 'Challenger 50', 'Hard', false, null, false),

  // ─── WEEK 31 (Aug 3) ─────────────────────────────────────────────────────────
  challengerEvent('Hagen', 'Hagen', 'Germany', 2026, 31, '2026-08-03', null, 'Challenger 100', 'Clay', false, '9542', false),
  challengerEvent('Grodzisk Mazowiecki', 'Grodzisk Mazowiecki', 'Poland', 2026, 31, '2026-08-03', null, 'Challenger 75', 'Hard', false, '2789', false),
  challengerEvent('Lexington, KY', 'Lexington', 'United States', 2026, 31, '2026-08-03', null, 'Challenger 75', 'Hard', false, '586', false),
  challengerEvent('Centurion 4', 'Centurion', 'South Africa', 2026, 31, '2026-08-03', null, 'Challenger 75', 'Hard', false, null, false),
  challengerEvent('İstanbul (Enka)', 'İstanbul', 'Turkey', 2026, 31, '2026-08-03', null, 'Challenger 50', 'Hard', false, null, false),

  // ─── WEEK 16 (Apr 22) — ATP 1000 ─────────────────────────────────────────────
  tourEvent('Mutua Madrid Open', 'Madrid', 'Spain', 2026, 16, '2026-04-22', '2026-05-03', 'ATP 1000', 'Clay', false, '1536', false),

  // ─── WEEK 19 (May 6) — ATP 1000 ──────────────────────────────────────────────
  tourEvent("Internazionali BNL d'Italia", 'Rome', 'Italy', 2026, 18, '2026-05-06', '2026-05-17', 'ATP 1000', 'Clay', false, '416', false),

  // ─── WEEK 20 (May 18) — clay before Roland Garros ───────────────────────────
  // Week is computed from start_date at read time; the Monday (May 18) lands in
  // week 20. A Sunday (May 17) start would compute to week 19.
  tourEvent('Gonet Geneva Open', 'Geneva', 'Switzerland', 2026, 20, '2026-05-18', null, 'ATP 250', 'Clay', false, '322', false),
  tourEvent('Bitpanda Hamburg Open', 'Hamburg', 'Germany', 2026, 20, '2026-05-18', null, 'ATP 500', 'Clay', false, '414', true),

  // ─── WEEKS 21–23: Roland Garros (Grand Slam — excluded) ──────────────────────

  // ─── WEEK 23 (Jun 8) — grass season opens ────────────────────────────────────
  tourEvent('Boss Open', 'Stuttgart', 'Germany', 2026, 23, '2026-06-08', null, 'ATP 250', 'Grass', false, '321', false),

  // ─── WEEK 24 (Jun 15) ────────────────────────────────────────────────────────
  tourEvent('Terra Wortmann Open', 'Halle', 'Germany', 2026, 24, '2026-06-15', null, 'ATP 500', 'Grass', false, '500', true),
  tourEvent('HSBC Championships', 'London', 'Great Britain', 2026, 24, '2026-06-15', null, 'ATP 500', 'Grass', false, '311', true),
  tourEvent('Libema Open', 's-Hertogenbosch', 'Netherlands', 2026, 23, '2026-06-08', null, 'ATP 250', 'Grass', false, '440', false),

  // ─── WEEK 25 (Jun 22) ────────────────────────────────────────────────────────
  tourEvent('Lexus Eastbourne Open', 'Eastbourne', 'Great Britain', 2026, 25, '2026-06-22', null, 'ATP 250', 'Grass', false, '741', false),
  // Mallorca starts Sunday Jun 21; store the Monday so the computed week is 25.
  tourEvent('Mallorca Championships presented by Ecotrans Group', 'Mallorca', 'Spain', 2026, 25, '2026-06-22', null, 'ATP 250', 'Grass', false, '8994', false),

  // ─── WEEKS 26–27: Wimbledon (Grand Slam — excluded) ──────────────────────────

  // ─── WEEK 28 (Jul 13) — post-Wimbledon clay ──────────────────────────────────
  tourEvent('SkiStar Swedish Open', 'Bastad', 'Sweden', 2026, 28, '2026-07-13', null, 'ATP 250', 'Clay', false, '316', false),
  tourEvent('EFG Swiss Open', 'Gstaad', 'Switzerland', 2026, 28, '2026-07-13', null, 'ATP 250', 'Clay', false, '314', false),
  tourEvent('Plava Laguna Croatia Open', 'Umag', 'Croatia', 2026, 28, '2026-07-13', null, 'ATP 250', 'Clay', false, '439', false),

  // ─── WEEK 29 (Jul 20) ────────────────────────────────────────────────────────
  tourEvent('Generali Open', 'Kitzbühel', 'Austria', 2026, 29, '2026-07-20', null, 'ATP 250', 'Clay', false, '319', false),
  // Estoril rejoins the 2026 calendar as an ATP 250 in week 29.
  tourEvent('Millennium Estoril Open', 'Estoril', 'Portugal', 2026, 29, '2026-07-20', null, 'ATP 250', 'Clay', false, '7290', false),
  // Los Cabos is week 30 (Jul 27) on the 2026 calendar, alongside Washington.
  tourEvent('Abierto de Tenis Mifel', 'Los Cabos', 'Mexico', 2026, 30, '2026-07-27', null, 'ATP 250', 'Hard', false, '7480', false),

  // ─── WEEK 30 (Jul 27) ────────────────────────────────────────────────────────
  tourEvent('Citi Open', 'Washington', 'United States', 2026, 30, '2026-07-27', null, 'ATP 500', 'Hard', false, '418', true),

  // ─── WEEK 31 (Aug 3) — ATP 1000 ──────────────────────────────────────────────
  // Montreal starts Sunday Aug 2; store the Monday so the computed week is 31.
  tourEvent('National Bank Open presented by Rogers', 'Montreal', 'Canada', 2026, 31, '2026-08-03', '2026-08-13', 'ATP 1000', 'Hard', false, '421', false),

  // ─── WEEK 32 (Aug 13) — ATP 1000 ─────────────────────────────────────────────
  tourEvent('Cincinnati Open', 'Cincinnati', 'United States', 2026, 32, '2026-08-13', '2026-08-23', 'ATP 1000', 'Hard', false, '422', false),

  // ─── WEEK 34 (Aug 24) ────────────────────────────────────────────────────────
  tourEvent('Winston-Salem Open', 'Winston-Salem', 'United States', 2026, 34, '2026-08-24', null, 'ATP 250', 'Hard', false, '6242', false),

  // ─── WEEKS 35–37: US Open (Grand Slam — excluded) ────────────────────────────

  // ─── WEEK 38 (Sep 21) — Asian hard court swing ───────────────────────────────
  // Chengdu + Hangzhou (Wed Sep 23 start; Monday Sep 21 anchors the week).
  // Zhuhai is gone from the 2026 calendar; Hangzhou Open takes the week-38 slot.
  tourEvent('Chengdu Open', 'Chengdu', 'China', 2026, 38, '2026-09-21', null, 'ATP 250', 'Hard', false, '7581', false),
  tourEvent('Hangzhou Open', 'Hangzhou', 'China', 2026, 38, '2026-09-21', null, 'ATP 250', 'Hard', false, '4713', false),

  // ─── WEEK 39 (Sep 28) ────────────────────────────────────────────────────────
  // Beijing + Tokyo share week 39 (Wed Sep 30 start; Monday Sep 28 anchors it).
  tourEvent('China Open', 'Beijing', 'China', 2026, 39, '2026-09-28', null, 'ATP 500', 'Hard', false, '747', true),
  tourEvent('Rakuten Japan Open', 'Tokyo', 'Japan', 2026, 39, '2026-09-28', null, 'ATP 500', 'Hard', false, '329', true),

  // ─── WEEK 40 (Oct 5) — ATP 1000 ──────────────────────────────────────────────
  tourEvent('Rolex Shanghai Masters', 'Shanghai', 'China', 2026, 40, '2026-10-07', '2026-10-18', 'ATP 1000', 'Hard', false, '5014', false),

  // ─── WEEK 42 (Oct 19) ────────────────────────────────────────────────────────
  tourEvent('Almaty Open', 'Almaty', 'Kazakhstan', 2026, 42, '2026-10-19', null, 'ATP 250', 'Indoor Hard', true, '9410', false),
  // European Open moved from Antwerp to Brussels for 2025+. Slug reflects the
  // current host city so the tournament URL doesn't read "antwerp" on a page
  // that's been in Brussels for two seasons.
  {
    tournament: { slug: 'european-open-brussels', name: 'BNP Paribas Fortis European Open', city: 'Brussels', country: 'Belgium' },
    edition: {
      year: 2026, week: 42, start_date: '2026-10-19', end_date: null,
      level: 'ATP 250', surface: 'Indoor Hard', indoor: true,
      source: 'atp_tour_pdf' as const, source_url: ATP_TOUR_CALENDAR_URL,
      status: 'held' as const, protennislive_code: '7485', has_doubles_qualifying: false,
    },
  },
  // Lyon uses PTL code 496 — the same code that Marseille (Open Provence) used
  // through 2025. The ATP reassigned the license to this new city+venue. Code 496
  // is in SKIP_MERGE_CODES in dedupe-by-code so the two distinct tournament rows
  // are never auto-collapsed.
  tourEvent('Grand Prix Auvergne-Rhône-Alpes', 'Lyon', 'France', 2026, 42, '2026-10-19', null, 'ATP 250', 'Indoor Hard', true, '496', false),

  // ─── WEEK 43 (Oct 26) ────────────────────────────────────────────────────────
  tourEvent('Erste Bank Open', 'Vienna', 'Austria', 2026, 43, '2026-10-26', null, 'ATP 500', 'Indoor Hard', true, '337', true),
  tourEvent('Swiss Indoors', 'Basel', 'Switzerland', 2026, 43, '2026-10-26', null, 'ATP 500', 'Indoor Hard', true, '328', true),

  // ─── WEEK 45 (Nov 9) ─────────────────────────────────────────────────────────
  // Stockholm moved from October to November for 2026 (Sun Nov 8 start; Monday
  // Nov 9 anchors the week).
  tourEvent('If Stockholm Open', 'Stockholm', 'Sweden', 2026, 45, '2026-11-09', null, 'ATP 250', 'Indoor Hard', true, '429', false),

  // ─── WEEK 44 (Nov 2) — ATP 1000 ──────────────────────────────────────────────
  tourEvent('Rolex Paris Masters', 'Paris', 'France', 2026, 44, '2026-11-02', '2026-11-08', 'ATP 1000', 'Indoor Hard', true, '352', false),

  // ─── HISTORICAL EDITIONS (level changes, demotions, promotions) ───────────
  // Add entries here for prior-year editions missing from the main 2026 list.
  // The slug must match the current entry so history is stitched together correctly.

  // Open Provence Marseille — ATP 250 that ran through 2025, then discontinued.
  {
    tournament: { slug: makeSlug('Open Provence', 'Marseille'), name: 'Open Provence', city: 'Marseille', country: 'France' },
    edition: {
      year: 2025,
      week: 6,
      start_date: '2025-02-10',
      end_date: null,
      level: 'ATP 250',
      surface: 'Indoor Hard',
      indoor: true,
      source: 'atp_tour_pdf' as const,
      source_url: 'https://www.protennislive.com/posting/2025/496/',
      status: 'held' as const,
      protennislive_code: '496',
      has_doubles_qualifying: false,
    },
  },
  {
    tournament: { slug: makeSlug('Open Provence', 'Marseille'), name: 'Open Provence', city: 'Marseille', country: 'France' },
    edition: {
      year: 2024,
      week: 6,
      start_date: '2024-02-09',
      end_date: null,
      level: 'ATP 250',
      surface: 'Indoor Hard',
      indoor: true,
      source: 'atp_tour_pdf' as const,
      source_url: 'https://www.protennislive.com/posting/2024/496/',
      status: 'held' as const,
      protennislive_code: '496',
      has_doubles_qualifying: false,
    },
  },

  // Asunción (Rakiura) 2025 — same level/surface as 2026, just a missing year entry.
  {
    tournament: { slug: makeSlug('Asunción (Rakiura)', 'Asunción'), name: 'Asunción (Rakiura)', city: 'Asunción', country: 'Paraguay' },
    edition: {
      year: 2025,
      week: 11,
      start_date: '2025-03-17',
      end_date: '2025-03-23',
      level: 'Challenger 75',
      surface: 'Clay',
      indoor: false,
      source: 'atp_challenger_pdf',
      source_url: 'https://www.atptour.com/en/scores/archive/asuncion/2909/2025/results',
      status: 'held',
      protennislive_code: '2909',
      has_doubles_qualifying: false,
    },
  },

  // Newport was an ATP 250 in 2024 (its final year on Tour) before dropping to Challenger 125.
  {
    tournament: { slug: makeSlug('Newport, RI', 'Newport'), name: 'Newport, RI', city: 'Newport', country: 'United States' },
    edition: {
      year: 2024,
      week: 29,
      start_date: '2024-07-15',
      end_date: '2024-07-21',
      level: 'ATP 250',
      surface: 'Grass',
      indoor: false,
      source: 'atp_tour_pdf',
      source_url: 'https://www.atptour.com/en/scores/archive/newport/315/2024/results',
      status: 'held',
      protennislive_code: '315',
      has_doubles_qualifying: false,
    },
  },

  // Dallas Open was an ATP 250 in 2022/2023/2024 (32-player Indoor Hard, replacing
  // the New York Open) and was promoted to ATP 500 starting in 2025. The 2026 entry
  // above stores ATP 500; this historical row carries the correct 2024 level so the
  // tournament page doesn't backfill 2024 with the new ATP 500 metadata. Same PTL
  // code (424) across all years.
  {
    tournament: { slug: makeSlug('Dallas Open', 'Dallas'), name: 'Dallas Open', city: 'Dallas', country: 'United States' },
    edition: {
      year: 2024,
      week: 6,
      start_date: '2024-02-05',
      end_date: '2024-02-11',
      level: 'ATP 250',
      surface: 'Indoor Hard',
      indoor: true,
      source: 'atp_tour_pdf',
      source_url: 'https://www.protennislive.com/posting/2024/424/',
      status: 'held',
      protennislive_code: '424',
      has_doubles_qualifying: false,
    },
  },

  // BNP Paribas Fortis European Open Brussels 2025 — same tournament as the
  // european-open-brussels entry above; the venue moved from Antwerp (2022–)
  // to Brussels (2023–). PDFs don't carry a LAST DIRECT ACCEPTANCE line; cuts
  // are set manually via set-cut.
  {
    tournament: { slug: 'european-open-brussels', name: 'BNP Paribas Fortis European Open', city: 'Brussels', country: 'Belgium' },
    edition: {
      year: 2025,
      week: 42,
      start_date: '2025-10-20',
      end_date: '2025-10-26',
      level: 'ATP 250',
      surface: 'Indoor Hard',
      indoor: true,
      source: 'atp_tour_pdf' as const,
      source_url: 'https://www.protennislive.com/posting/2025/7485/',
      status: 'held' as const,
      protennislive_code: '7485',
      has_doubles_qualifying: false,
    },
  },

  // İstanbul (İstinye) 2024 and 2025 — same venue/code as the 2026 entry (code 7083).
  {
    tournament: { slug: makeSlug('İstanbul (İstinye)', 'İstanbul'), name: 'İstanbul (İstinye)', city: 'İstanbul', country: 'Turkey' },
    edition: {
      year: 2025,
      week: 20,
      start_date: '2025-05-19',
      end_date: null,
      level: 'Challenger 75',
      surface: 'Clay',
      indoor: false,
      source: 'atp_challenger_pdf',
      source_url: 'https://www.protennislive.com/posting/2025/7083/',
      status: 'held',
      protennislive_code: '7083',
      has_doubles_qualifying: false,
    },
  },
  {
    tournament: { slug: makeSlug('İstanbul (İstinye)', 'İstanbul'), name: 'İstanbul (İstinye)', city: 'İstanbul', country: 'Turkey' },
    edition: {
      year: 2024,
      week: 20,
      start_date: '2024-05-13',
      end_date: null,
      level: 'Challenger 75',
      surface: 'Clay',
      indoor: false,
      source: 'atp_challenger_pdf',
      source_url: 'https://www.protennislive.com/posting/2024/7083/',
      status: 'held',
      protennislive_code: '7083',
      has_doubles_qualifying: false,
    },
  },

];
