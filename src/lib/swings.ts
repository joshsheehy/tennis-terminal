// Swing detection (Swings phase 2). Pure functions only — no database
// access — so the chain rules are unit-testable in isolation.
//
// A swing is a chain of tournaments in consecutive weeks close enough to play
// back-to-back without major travel. Events are nodes; an edge connects an
// event in week n to an event in week n+1 when:
//   - both are in the SAME COUNTRY (always connects, regardless of distance —
//     CROSS_BORDER_MAX_KM never applies to same-country pairs), or
//   - they are in different countries on the SAME CONTINENT within
//     CROSS_BORDER_MAX_KM (haversine).
// A hop between continents never connects. A swing is a connected component
// spanning at least MIN_SWING_WEEKS consecutive weeks; multiple events in the
// same week inside a component are alternatives within that swing-week, not
// separate swings.

/** Max distance for a cross-border hop. Tunable; same-country pairs ignore it. */
export const CROSS_BORDER_MAX_KM = 600;

/** Minimum number of consecutive weeks for a chain to count as a swing. */
export const MIN_SWING_WEEKS = 2;

export type SwingEventInput = {
  editionId: string;
  tournamentId: string;
  slug: string;
  name: string;
  city: string;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  /** ATP season week (already recomputed from start_date upstream). */
  week: number;
  startDate: string;
  level: string;
  surface: string;
  indoor: boolean | null;
};

export type SwingWeek = {
  week: number;
  events: SwingEventInput[];
};

export type DetectedSwing = {
  label: string;
  startWeek: number;
  endWeek: number;
  totalWeeks: number;
  weeks: SwingWeek[];
  surfaceConsistent: boolean;
  surfaces: string[];
  tierMix: string;
  /** Display names, ordered by first appearance in the chain. */
  countries: string[];
};

export type SwingConfig = {
  crossBorderMaxKm: number;
  minSwingWeeks: number;
};

export const DEFAULT_SWING_CONFIG: SwingConfig = {
  crossBorderMaxKm: CROSS_BORDER_MAX_KM,
  minSwingWeeks: MIN_SWING_WEEKS,
};

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  latA: number,
  lonA: number,
  latB: number,
  lonB: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(latB - latA);
  const dLon = toRad(lonB - lonA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// Continent assignment is tennis-pragmatic rather than strictly geographic
// (e.g. Turkey and the Caucasus compete in Tennis Europe). Keys are
// lowercased country names as they appear in the tournaments table.
const CONTINENTS: Record<string, string[]> = {
  Europe: [
    'albania', 'andorra', 'armenia', 'austria', 'azerbaijan', 'belarus',
    'belgium', 'bosnia and herzegovina', 'bulgaria', 'croatia', 'cyprus',
    'czech republic', 'czechia', 'denmark', 'estonia', 'finland', 'france',
    'georgia', 'germany', 'great britain', 'greece', 'hungary', 'iceland',
    'ireland', 'italy', 'kosovo', 'latvia', 'lithuania', 'luxembourg',
    'malta', 'moldova', 'monaco', 'montenegro', 'netherlands',
    'north macedonia', 'norway', 'poland', 'portugal', 'romania', 'russia',
    'san marino', 'serbia', 'slovakia', 'slovak republic', 'slovenia',
    'spain', 'sweden', 'switzerland', 'turkey', 'türkiye', 'ukraine',
    'united kingdom',
  ],
  Asia: [
    'bahrain', 'bangladesh', 'cambodia', 'china', 'china, p.r.',
    'chinese taipei', 'hong kong', 'hong kong, china', 'india', 'indonesia',
    'iran', 'iraq', 'israel', 'japan', 'jordan', 'kazakhstan', 'korea',
    'korea, rep.', 'kuwait', 'kyrgyzstan', 'laos', 'lebanon', 'macau',
    'macau, china', 'malaysia', 'mongolia', 'myanmar', 'nepal', 'oman',
    'pakistan', 'philippines', 'qatar', 'saudi arabia', 'singapore',
    'south korea', 'sri lanka', 'taiwan', 'tajikistan', 'thailand',
    'turkmenistan', 'uae', 'united arab emirates', 'uzbekistan', 'vietnam',
  ],
  Africa: [
    'algeria', 'angola', 'benin', 'botswana', 'burkina faso', 'burundi',
    'cameroon', "cote d'ivoire", "côte d'ivoire", 'egypt', 'ethiopia',
    'gabon', 'ghana', 'kenya', 'libya', 'madagascar', 'malawi', 'mali',
    'mauritius', 'morocco', 'mozambique', 'namibia', 'nigeria', 'rwanda',
    'senegal', 'seychelles', 'south africa', 'sudan', 'tanzania', 'togo',
    'tunisia', 'uganda', 'zambia', 'zimbabwe',
  ],
  'North America': [
    'antigua and barbuda', 'bahamas', 'barbados', 'belize', 'bermuda',
    'canada', 'costa rica', 'cuba', 'dominica', 'dominican republic',
    'el salvador', 'guatemala', 'haiti', 'honduras', 'jamaica', 'mexico',
    'nicaragua', 'panama', 'puerto rico', 'trinidad and tobago',
    'united states', 'united states of america', 'usa',
  ],
  'South America': [
    'argentina', 'bolivia', 'brazil', 'chile', 'colombia', 'ecuador',
    'guyana', 'paraguay', 'peru', 'suriname', 'uruguay', 'venezuela',
  ],
  Oceania: [
    'australia', 'fiji', 'guam', 'new caledonia', 'new zealand',
    'papua new guinea', 'tahiti',
  ],
};

const COUNTRY_TO_CONTINENT: Map<string, string> = new Map(
  Object.entries(CONTINENTS).flatMap(([continent, countries]) =>
    countries.map((country) => [country, continent] as [string, string])
  )
);

export function continentForCountry(country: string | null): string | null {
  if (!country) return null;
  return COUNTRY_TO_CONTINENT.get(country.toLowerCase().trim()) ?? null;
}

// Short display names for labels and tier strings.
const COUNTRY_DISPLAY: Record<string, string> = {
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  'united kingdom': 'UK',
  'great britain': 'UK',
  'china, p.r.': 'China',
  'chinese taipei': 'Taiwan',
  'hong kong, china': 'Hong Kong',
  'macau, china': 'Macau',
  'korea, rep.': 'South Korea',
  'czech republic': 'Czechia',
  'united arab emirates': 'UAE',
};

export function countryDisplayName(country: string): string {
  return COUNTRY_DISPLAY[country.toLowerCase().trim()] ?? country;
}

function sameCountry(a: SwingEventInput, b: SwingEventInput): boolean {
  if (!a.country || !b.country) return false;
  return a.country.toLowerCase().trim() === b.country.toLowerCase().trim();
}

/**
 * Whether two events in adjacent weeks are close enough to chain.
 * Exported for direct unit testing of the edge rules.
 */
export function eventsConnect(
  a: SwingEventInput,
  b: SwingEventInput,
  config: SwingConfig = DEFAULT_SWING_CONFIG
): boolean {
  // Same country always connects — the km threshold never applies here.
  if (sameCountry(a, b)) return true;

  // Cross-border: never across continents (when both are known).
  const continentA = continentForCountry(a.country);
  const continentB = continentForCountry(b.country);
  if (continentA && continentB && continentA !== continentB) return false;

  // Cross-border needs coordinates to evaluate the distance rule.
  if (a.latitude == null || a.longitude == null) return false;
  if (b.latitude == null || b.longitude == null) return false;

  return (
    haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) <=
    config.crossBorderMaxKm
  );
}

// --- Tier mix -------------------------------------------------------------

const TIER_RANKS: Array<{ match: RegExp; code: (level: string) => string; rank: number }> = [
  { match: /^grand slam$/i, code: () => 'GS', rank: 100 },
  { match: /^atp\s*1000/i, code: () => 'ATP1000', rank: 90 },
  { match: /^atp\s*500/i, code: () => 'ATP500', rank: 80 },
  { match: /^atp\s*250/i, code: () => 'ATP250', rank: 70 },
  { match: /^challenger\s*175/i, code: () => 'CH175', rank: 60 },
  { match: /^challenger\s*125/i, code: () => 'CH125', rank: 50 },
  { match: /^challenger\s*100/i, code: () => 'CH100', rank: 40 },
  { match: /^challenger\s*75/i, code: () => 'CH75', rank: 30 },
  { match: /^challenger\s*50/i, code: () => 'CH50', rank: 20 },
  { match: /^challenger/i, code: () => 'CH', rank: 10 },
];

function tierCode(level: string): { code: string; rank: number } {
  for (const tier of TIER_RANKS) {
    if (tier.match.test(level.trim())) return { code: tier.code(level), rank: tier.rank };
  }
  return { code: level, rank: 0 };
}

/** "CH75 + 2× CH50" style summary, highest tier first. */
export function formatTierMix(levels: string[]): string {
  const counts = new Map<string, { count: number; rank: number }>();
  for (const level of levels) {
    const { code, rank } = tierCode(level);
    const entry = counts.get(code) ?? { count: 0, rank };
    entry.count += 1;
    counts.set(code, entry);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].rank - a[1].rank || a[0].localeCompare(b[0]))
    .map(([code, { count }]) => (count > 1 ? `${count}× ${code}` : code))
    .join(' + ');
}

// --- Labeling ---------------------------------------------------------------

// Rough US regions for labels like "US Midwest swing", from the chain's mean
// coordinates. Coarse on purpose; only used for display.
function usRegion(lat: number, lon: number): string {
  if (lon <= -105) return 'West';
  if (lat < 36.5) return 'South';
  if (lon <= -82) return 'Midwest';
  return 'Northeast';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startMonthAbbr(events: SwingEventInput[]): string {
  const earliest = events.reduce((min, e) => (e.startDate < min ? e.startDate : min), events[0].startDate);
  let month = Number(String(earliest).slice(5, 7));
  if (!Number.isInteger(month) || month < 1) {
    const parsed = new Date(earliest);
    if (!Number.isNaN(parsed.getTime())) month = parsed.getUTCMonth() + 1;
  }
  return MONTHS[month - 1] ?? '';
}

/** "Tenerife 2" / "Fujairah 1" style city fields name the edition, not the place. */
function cityLabelName(city: string): string {
  return city
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+\d+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseLabel(swing: { countries: string[]; weeks: SwingWeek[] }): string {
  const allEvents = swing.weeks.flatMap((w) => w.events);

  // Some imported tournaments have no country; fall back to city names so
  // the label is never blank ("Bengaluru swing", "Porto–Seville swing").
  if (swing.countries.length === 0) {
    const cities: string[] = [];
    for (const event of allEvents) {
      const name = cityLabelName(event.city);
      if (name && !cities.includes(name)) cities.push(name);
    }
    if (cities.length === 0) return 'Unlabeled swing';
    return `${cities.slice(0, 3).join('–')} swing`;
  }

  if (swing.countries.length === 1) {
    const country = swing.countries[0];
    if (country === 'US') {
      const located = allEvents.filter((e) => e.latitude != null && e.longitude != null);
      if (located.length > 0) {
        const lons = located.map((e) => e.longitude!);
        // A coast-to-coast chain is just a US swing, not one region's.
        if (Math.max(...lons) - Math.min(...lons) <= 18) {
          const lat = located.reduce((s, e) => s + e.latitude!, 0) / located.length;
          const lon = lons.reduce((s, v) => s + v, 0) / located.length;
          return `US ${usRegion(lat, lon)} swing`;
        }
      }
      return 'US swing';
    }
    return `${country} swing`;
  }

  if (swing.countries.length <= 3) return `${swing.countries.join('–')} swing`;

  // 4+ countries: name it after the dominant country plus a hint of breadth.
  const counts = new Map<string, number>();
  for (const event of allEvents) {
    if (!event.country) continue;
    const name = countryDisplayName(event.country);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return dominant ? `${dominant} + neighbors swing` : 'Multi-country swing';
}

// --- Detection ---------------------------------------------------------------

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    let root = this.parent.get(x) ?? x;
    if (root !== x) {
      root = this.find(root);
      this.parent.set(x, root);
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }
}

/**
 * Detect all swings in a year's events. Input events must already be filtered
 * to the levels that participate (ATP + Challenger, held editions).
 */
export function detectSwings(
  events: SwingEventInput[],
  config: SwingConfig = DEFAULT_SWING_CONFIG
): DetectedSwing[] {
  const byWeek = new Map<number, SwingEventInput[]>();
  for (const event of events) {
    if (!Number.isInteger(event.week)) continue;
    const list = byWeek.get(event.week) ?? [];
    list.push(event);
    byWeek.set(event.week, list);
  }

  // Connect adjacent-week pairs; union-find collects the chains, which also
  // merges same-week alternatives into one swing instead of duplicating it.
  const uf = new UnionFind();
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  for (const week of weeks) {
    const nextWeek = byWeek.get(week + 1);
    if (!nextWeek) continue;
    for (const a of byWeek.get(week)!) {
      for (const b of nextWeek) {
        if (eventsConnect(a, b, config)) uf.union(a.editionId, b.editionId);
      }
    }
  }

  const components = new Map<string, SwingEventInput[]>();
  for (const event of events) {
    if (!Number.isInteger(event.week)) continue;
    const root = uf.find(event.editionId);
    const list = components.get(root) ?? [];
    list.push(event);
    components.set(root, list);
  }

  const swings: DetectedSwing[] = [];
  for (const component of components.values()) {
    const weekNumbers = [...new Set(component.map((e) => e.week))].sort((a, b) => a - b);
    if (weekNumbers.length < config.minSwingWeeks) continue;

    const swingWeeks: SwingWeek[] = weekNumbers.map((week) => ({
      week,
      events: component
        .filter((e) => e.week === week)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));

    const orderedEvents = swingWeeks.flatMap((w) => w.events);
    const surfaces = [...new Set(orderedEvents.map((e) => e.surface))];
    const countries: string[] = [];
    for (const event of orderedEvents) {
      if (!event.country) continue;
      const name = countryDisplayName(event.country);
      if (!countries.includes(name)) countries.push(name);
    }

    swings.push({
      label: '',
      startWeek: weekNumbers[0],
      endWeek: weekNumbers[weekNumbers.length - 1],
      totalWeeks: weekNumbers.length,
      weeks: swingWeeks,
      surfaceConsistent: surfaces.length === 1,
      surfaces,
      tierMix: formatTierMix(orderedEvents.map((e) => e.level)),
      countries,
    });
  }

  swings.sort((a, b) => a.startWeek - b.startWeek || a.endWeek - b.endWeek);

  // Assign labels, disambiguating repeats ("Mexico swing (Mar)", then weeks).
  const labelCounts = new Map<string, number>();
  for (const swing of swings) {
    swing.label = baseLabel(swing);
    labelCounts.set(swing.label, (labelCounts.get(swing.label) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  for (const swing of swings) {
    const base = swing.label;
    if ((labelCounts.get(base) ?? 0) <= 1) continue;
    const month = startMonthAbbr(swing.weeks.flatMap((w) => w.events));
    let label = `${base} (${month})`;
    if (seen.has(label)) label = `${base} (W${swing.startWeek})`;
    seen.set(label, 1);
    swing.label = label;
  }

  return swings;
}
