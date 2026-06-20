// Swing detection (Swings phase 2). Pure functions only — no database
// access — so the chain rules are unit-testable in isolation.
//
// A swing is a chain of tournaments in consecutive weeks close enough to play
// back-to-back without major travel. Events are nodes; an edge connects an
// event in week n to an event in week n+1 when:
//   - both are in the SAME COUNTRY (always connects, regardless of distance —
//     CROSS_BORDER_MAX_KM never applies to same-country pairs), or
//   - they are in different but NEIGHBORING countries on the same continent
//     within CROSS_BORDER_MAX_KM (haversine).
// A hop between continents (or non-neighboring countries) never connects, and
// a change of surface family (clay/grass/hard) breaks the chain. A swing is a
// connected component spanning at least MIN_SWING_WEEKS consecutive weeks;
// multiple events in the same week inside a component are alternatives within
// that swing-week, not separate swings.
//
// Level filtering: events carry a level group (atp / challenger / itf). The
// caller picks which groups to include (a "scope") so the same data yields a
// tour-only view, an all-levels view including ITF, etc.

/** Max distance for a cross-border hop. Tunable; same-country pairs ignore it. */
export const CROSS_BORDER_MAX_KM = 600;

/** Minimum number of consecutive weeks for a chain to count as a swing. */
export const MIN_SWING_WEEKS = 2;

/** Soft ceiling on a swing's span. Longer chains are split at their biggest
 * internal travel jump until each piece fits, so seams fall at natural
 * break points rather than an arbitrary week. */
export const MAX_SWING_WEEKS = 8;

/** A run that never leaves one city is a "series" (residency), not a swing,
 * once it exceeds this many weeks. Short same-city pairs (Tenerife 1->2)
 * stay swings. */
export const SAME_CITY_MAX_SWING_WEEKS = 3;

// --- Level groups & scopes --------------------------------------------------

export type LevelGroup = 'atp' | 'challenger' | 'itf';

/** Display order = most prestigious first; also the canonical scope ordering. */
export const ALL_LEVEL_GROUPS: readonly LevelGroup[] = ['atp', 'challenger', 'itf'];

export const DEFAULT_LEVEL_SCOPE: LevelGroup[] = ['atp', 'challenger'];

/** Classify a raw level string into a group, or null if it isn't a tour/ITF level. */
export function levelGroup(level: string): LevelGroup | null {
  const l = level.trim().toLowerCase();
  if (l.startsWith('itf')) return 'itf';
  if (l.startsWith('challenger')) return 'challenger';
  if (l.startsWith('atp') || l === 'grand slam') return 'atp';
  return null;
}

/** Prestige rank of a level (higher = more prestigious), for sorting. */
export function levelRank(level: string): number {
  const l = level.trim().toLowerCase();
  if (l.includes('grand slam')) return 100;
  if (/atp\s*1000/.test(l)) return 90;
  if (/atp\s*500/.test(l)) return 80;
  if (/atp\s*250/.test(l)) return 70;
  if (/challenger\s*175/.test(l)) return 60;
  if (/challenger\s*125/.test(l)) return 55;
  if (/challenger\s*100/.test(l)) return 50;
  if (/challenger\s*75/.test(l)) return 45;
  if (/challenger\s*50/.test(l)) return 40;
  if (l.includes('challenger')) return 35;
  if (/m25|itf.*25/.test(l)) return 20;
  if (/m15|itf.*15/.test(l)) return 15;
  if (l.includes('itf')) return 10;
  return 0;
}

/** Canonical, order-stable key for a set of groups, e.g. "atp+challenger". */
export function scopeKey(groups: readonly LevelGroup[]): string {
  return ALL_LEVEL_GROUPS.filter((g) => groups.includes(g)).join('+');
}

/** Parse a scope key back into groups; unknown tokens are ignored. */
export function parseScopeKey(key: string): LevelGroup[] {
  const tokens = new Set(key.split('+').map((t) => t.trim().toLowerCase()));
  return ALL_LEVEL_GROUPS.filter((g) => tokens.has(g));
}

/** Every non-empty subset of the level groups (7 total), canonical order. */
export function allLevelScopes(): LevelGroup[][] {
  const groups = ALL_LEVEL_GROUPS;
  const result: LevelGroup[][] = [];
  for (let mask = 1; mask < 1 << groups.length; mask += 1) {
    result.push(groups.filter((_, i) => mask & (1 << i)));
  }
  return result;
}

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

/** A multi-week travel chain ('swing') or a single-city residency ('series'). */
export type SwingKind = 'swing' | 'series';

export type DetectedSwing = {
  kind: SwingKind;
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
  /** Distinct cities (cleaned) touched, ordered by first appearance. */
  cities: string[];
};

export type SwingConfig = {
  crossBorderMaxKm: number;
  minSwingWeeks: number;
  /** Cross-border hops additionally require the two countries to be
   * neighbors (NEIGHBORING_COUNTRIES). Keeps dense regions like Europe from
   * chaining transitively into continent-wide blobs. */
  requireNeighboringCountries: boolean;
  /** Never chain across a change of surface family (clay/grass/hard).
   * Splits e.g. the European clay season from the grass swing. */
  splitOnSurfaceChange: boolean;
  /** Soft ceiling on weeks; longer chains split at the biggest travel jump. */
  maxSwingWeeks: number;
  /** Single-city runs longer than this become a 'series', not a 'swing'. */
  sameCityMaxSwingWeeks: number;
};

export const REQUIRE_NEIGHBORING_COUNTRIES = true;
export const SPLIT_ON_SURFACE_CHANGE = true;

export const DEFAULT_SWING_CONFIG: SwingConfig = {
  crossBorderMaxKm: CROSS_BORDER_MAX_KM,
  minSwingWeeks: MIN_SWING_WEEKS,
  requireNeighboringCountries: REQUIRE_NEIGHBORING_COUNTRIES,
  splitOnSurfaceChange: SPLIT_ON_SURFACE_CHANGE,
  maxSwingWeeks: MAX_SWING_WEEKS,
  sameCityMaxSwingWeeks: SAME_CITY_MAX_SWING_WEEKS,
};

/** Hard and Indoor Hard are one planning block; clay and grass are their own. */
export function surfaceFamily(surface: string): string {
  const s = surface.toLowerCase();
  if (s.includes('grass')) return 'grass';
  if (s.includes('clay')) return 'clay';
  if (s.includes('hard') || s.includes('carpet')) return 'hard';
  return s.trim();
}

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

/** Canonical comparison key so "USA"/"United States" or "Great Britain"/
 * "United Kingdom" (mixed import sources) count as the same country. */
function countryKey(country: string): string {
  return countryDisplayName(country).toLowerCase().trim();
}

function sameCountry(a: SwingEventInput, b: SwingEventInput): boolean {
  if (!a.country || !b.country) return false;
  return countryKey(a.country) === countryKey(b.country);
}

// Country adjacency for the cross-border rule, keyed by canonical display
// names (lowercased). Land borders plus curated short sea links that players
// routinely chain (UK–France/Ireland, Italy–Croatia, Doha–Dubai, etc.).
// Pairs are listed once; lookup checks both directions.
const NEIGHBOR_PAIRS: Array<[string, string]> = [
  // Western Europe
  ['portugal', 'spain'],
  ['spain', 'france'], ['spain', 'andorra'],
  ['france', 'andorra'], ['france', 'monaco'], ['france', 'belgium'],
  ['france', 'luxembourg'], ['france', 'germany'], ['france', 'switzerland'],
  ['france', 'italy'], ['france', 'uk'],
  ['belgium', 'netherlands'], ['belgium', 'luxembourg'], ['belgium', 'germany'],
  ['netherlands', 'germany'], ['netherlands', 'uk'],
  ['luxembourg', 'germany'],
  ['uk', 'ireland'], ['uk', 'belgium'],
  ['germany', 'switzerland'], ['germany', 'austria'], ['germany', 'czechia'],
  ['germany', 'poland'], ['germany', 'denmark'],
  ['switzerland', 'italy'], ['switzerland', 'austria'], ['switzerland', 'liechtenstein'],
  ['austria', 'liechtenstein'], ['austria', 'italy'], ['austria', 'slovenia'],
  ['austria', 'hungary'], ['austria', 'slovakia'], ['austria', 'czechia'],
  ['italy', 'slovenia'], ['italy', 'san marino'], ['italy', 'monaco'],
  ['italy', 'croatia'], ['italy', 'malta'],
  // Central / Eastern Europe
  ['czechia', 'poland'], ['czechia', 'slovakia'],
  ['slovakia', 'poland'], ['slovakia', 'hungary'], ['slovakia', 'ukraine'],
  ['poland', 'lithuania'], ['poland', 'belarus'], ['poland', 'ukraine'],
  ['hungary', 'slovenia'], ['hungary', 'croatia'], ['hungary', 'serbia'],
  ['hungary', 'romania'], ['hungary', 'ukraine'],
  ['slovenia', 'croatia'],
  ['croatia', 'serbia'], ['croatia', 'bosnia and herzegovina'], ['croatia', 'montenegro'],
  ['serbia', 'bosnia and herzegovina'], ['serbia', 'montenegro'], ['serbia', 'kosovo'],
  ['serbia', 'north macedonia'], ['serbia', 'bulgaria'], ['serbia', 'romania'],
  ['romania', 'bulgaria'], ['romania', 'moldova'], ['romania', 'ukraine'],
  ['bulgaria', 'greece'], ['bulgaria', 'north macedonia'], ['bulgaria', 'turkey'],
  ['greece', 'albania'], ['greece', 'north macedonia'], ['greece', 'turkey'],
  ['albania', 'montenegro'], ['albania', 'kosovo'], ['albania', 'north macedonia'],
  ['north macedonia', 'kosovo'], ['montenegro', 'kosovo'],
  ['montenegro', 'bosnia and herzegovina'],
  // Nordics / Baltics
  ['denmark', 'sweden'], ['sweden', 'norway'], ['sweden', 'finland'],
  ['norway', 'finland'], ['finland', 'estonia'],
  ['estonia', 'latvia'], ['latvia', 'lithuania'], ['lithuania', 'belarus'],
  ['estonia', 'russia'], ['latvia', 'russia'], ['latvia', 'belarus'],
  ['finland', 'russia'], ['belarus', 'russia'], ['ukraine', 'belarus'],
  ['ukraine', 'russia'], ['ukraine', 'moldova'],
  // Caucasus / Turkey
  ['turkey', 'georgia'], ['turkey', 'armenia'], ['turkey', 'azerbaijan'],
  ['georgia', 'armenia'], ['georgia', 'azerbaijan'], ['georgia', 'russia'],
  ['armenia', 'azerbaijan'], ['azerbaijan', 'russia'],
  // Middle East / Gulf
  ['qatar', 'uae'], ['qatar', 'bahrain'], ['qatar', 'saudi arabia'],
  ['uae', 'saudi arabia'], ['uae', 'oman'], ['bahrain', 'saudi arabia'],
  ['saudi arabia', 'kuwait'], ['saudi arabia', 'jordan'], ['saudi arabia', 'oman'],
  ['kuwait', 'iraq'], ['jordan', 'israel'], ['jordan', 'iraq'],
  ['israel', 'lebanon'],
  // Asia
  ['kazakhstan', 'russia'], ['kazakhstan', 'uzbekistan'], ['kazakhstan', 'kyrgyzstan'],
  ['kazakhstan', 'china'], ['uzbekistan', 'kyrgyzstan'], ['uzbekistan', 'tajikistan'],
  ['uzbekistan', 'turkmenistan'], ['kyrgyzstan', 'tajikistan'], ['kyrgyzstan', 'china'],
  ['tajikistan', 'china'],
  ['china', 'mongolia'], ['china', 'vietnam'], ['china', 'laos'],
  ['china', 'myanmar'], ['china', 'nepal'], ['china', 'india'],
  ['china', 'pakistan'], ['china', 'hong kong'], ['china', 'macau'],
  ['china', 'taiwan'], ['china', 'south korea'],
  ['hong kong', 'macau'], ['south korea', 'japan'],
  ['india', 'pakistan'], ['india', 'nepal'], ['india', 'bangladesh'],
  ['india', 'myanmar'], ['india', 'sri lanka'],
  ['thailand', 'malaysia'], ['thailand', 'myanmar'], ['thailand', 'laos'],
  ['thailand', 'cambodia'], ['vietnam', 'laos'], ['vietnam', 'cambodia'],
  ['cambodia', 'laos'], ['malaysia', 'singapore'], ['malaysia', 'indonesia'],
  ['singapore', 'indonesia'], ['indonesia', 'philippines'],
  // Africa
  ['morocco', 'algeria'], ['algeria', 'tunisia'], ['tunisia', 'libya'],
  ['libya', 'egypt'], ['egypt', 'sudan'],
  ['south africa', 'namibia'], ['south africa', 'botswana'],
  ['south africa', 'zimbabwe'], ['south africa', 'mozambique'],
  ['zimbabwe', 'zambia'], ['zimbabwe', 'botswana'], ['zimbabwe', 'mozambique'],
  ['kenya', 'tanzania'], ['kenya', 'uganda'], ['tanzania', 'uganda'],
  ['ghana', 'togo'], ['ghana', 'burkina faso'], ['togo', 'benin'],
  ["côte d'ivoire", 'ghana'], ["côte d'ivoire", 'burkina faso'],
  ["côte d'ivoire", 'mali'], ['senegal', 'mali'], ['nigeria', 'benin'],
  ['cameroon', 'nigeria'], ['rwanda', 'uganda'], ['rwanda', 'tanzania'],
  ['rwanda', 'burundi'], ['burundi', 'tanzania'],
  // Americas
  ['us', 'canada'], ['us', 'mexico'],
  ['mexico', 'guatemala'], ['mexico', 'belize'],
  ['guatemala', 'belize'], ['guatemala', 'el salvador'], ['guatemala', 'honduras'],
  ['el salvador', 'honduras'], ['honduras', 'nicaragua'],
  ['nicaragua', 'costa rica'], ['costa rica', 'panama'], ['panama', 'colombia'],
  ['colombia', 'venezuela'], ['colombia', 'ecuador'], ['colombia', 'peru'],
  ['colombia', 'brazil'], ['ecuador', 'peru'], ['peru', 'brazil'],
  ['peru', 'bolivia'], ['peru', 'chile'], ['bolivia', 'chile'],
  ['bolivia', 'brazil'], ['bolivia', 'paraguay'], ['bolivia', 'argentina'],
  ['chile', 'argentina'], ['argentina', 'paraguay'], ['argentina', 'brazil'],
  ['argentina', 'uruguay'], ['brazil', 'uruguay'], ['brazil', 'paraguay'],
  ['brazil', 'venezuela'], ['brazil', 'guyana'], ['brazil', 'suriname'],
  ['dominican republic', 'haiti'],
  // Oceania
  ['australia', 'new zealand'],
];

const NEIGHBORS: Map<string, Set<string>> = (() => {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!map.has(a)) map.set(a, new Set());
    map.get(a)!.add(b);
  };
  for (const [a, b] of NEIGHBOR_PAIRS) {
    add(a, b);
    add(b, a);
  }
  return map;
})();

export function areNeighboringCountries(a: string, b: string): boolean {
  return NEIGHBORS.get(countryKey(a))?.has(countryKey(b)) ?? false;
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
  // A change of surface family breaks the chain regardless of geography:
  // a player switching clay->grass is starting a new block, not continuing.
  if (config.splitOnSurfaceChange && surfaceFamily(a.surface) !== surfaceFamily(b.surface)) {
    return false;
  }

  // Same country always connects — the km threshold never applies here.
  if (sameCountry(a, b)) return true;

  // Cross-border: never across continents (when both are known).
  const continentA = continentForCountry(a.country);
  const continentB = continentForCountry(b.country);
  if (continentA && continentB && continentA !== continentB) return false;

  // Cross-border hops must be between neighboring countries — this is what
  // stops dense regions (Europe) from chaining transitively into one blob.
  // Only enforced when both countries are known; with a missing country we
  // can't evaluate adjacency, so we fall back to the distance rule below.
  if (config.requireNeighboringCountries && a.country && b.country) {
    if (!areNeighboringCountries(a.country, b.country)) return false;
  }

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

/** Cleaned, comparable city name (drops edition suffixes/parentheticals). */
function cityKey(city: string): string {
  return cityLabelName(city).toLowerCase();
}

function distinctCityKeys(events: SwingEventInput[]): Set<string> {
  return new Set(events.map((e) => cityKey(e.city)).filter(Boolean));
}

/** A single-city run longer than the same-city cap is a residency, not a swing. */
function isSeriesGroup(events: SwingEventInput[], config: SwingConfig): boolean {
  const weeks = new Set(events.map((e) => e.week)).size;
  return distinctCityKeys(events).size <= 1 && weeks > config.sameCityMaxSwingWeeks;
}

function weekCentroid(events: SwingEventInput[]): { lat: number; lng: number } | null {
  const located = events.filter((e) => e.latitude != null && e.longitude != null);
  if (located.length === 0) return null;
  return {
    lat: located.reduce((s, e) => s + e.latitude!, 0) / located.length,
    lng: located.reduce((s, e) => s + e.longitude!, 0) / located.length,
  };
}

/**
 * Split a chain spanning more than maxSwingWeeks into pieces, cutting at the
 * week boundary with the largest geographic jump (keeping both sides at least
 * minSwingWeeks). Recurses until every piece fits. Components have no internal
 * week gaps, so weeks are contiguous.
 */
function splitLongChain(events: SwingEventInput[], config: SwingConfig): SwingEventInput[][] {
  const weeks = [...new Set(events.map((e) => e.week))].sort((a, b) => a - b);
  if (weeks.length <= config.maxSwingWeeks) return [events];

  const centroids = weeks.map((w) => weekCentroid(events.filter((e) => e.week === w)));

  let bestPos = -1;
  let bestGap = -Infinity;
  for (let p = config.minSwingWeeks - 1; p <= weeks.length - 1 - config.minSwingWeeks; p += 1) {
    const a = centroids[p];
    const b = centroids[p + 1];
    const gap = a && b ? haversineKm(a.lat, a.lng, b.lat, b.lng) : 0;
    if (gap > bestGap) {
      bestGap = gap;
      bestPos = p;
    }
  }
  if (bestPos < 0) return [events]; // too short to split safely

  const leftWeeks = new Set(weeks.slice(0, bestPos + 1));
  const left = events.filter((e) => leftWeeks.has(e.week));
  const right = events.filter((e) => !leftWeeks.has(e.week));
  return [...splitLongChain(left, config), ...splitLongChain(right, config)];
}

/** Assemble a DetectedSwing from a group of events (label assigned later). */
function buildSwing(group: SwingEventInput[], kind: SwingKind): DetectedSwing {
  const weekNumbers = [...new Set(group.map((e) => e.week))].sort((a, b) => a - b);
  const swingWeeks: SwingWeek[] = weekNumbers.map((week) => ({
    week,
    events: group.filter((e) => e.week === week).sort((a, b) => a.name.localeCompare(b.name)),
  }));
  const orderedEvents = swingWeeks.flatMap((w) => w.events);
  const surfaces = [...new Set(orderedEvents.map((e) => e.surface))];

  const countries: string[] = [];
  for (const event of orderedEvents) {
    if (!event.country) continue;
    const name = countryDisplayName(event.country);
    if (!countries.includes(name)) countries.push(name);
  }
  const cities: string[] = [];
  for (const event of orderedEvents) {
    const name = cityLabelName(event.city);
    if (name && !cities.includes(name)) cities.push(name);
  }

  return {
    kind,
    label: '',
    startWeek: weekNumbers[0],
    endWeek: weekNumbers[weekNumbers.length - 1],
    totalWeeks: weekNumbers.length,
    weeks: swingWeeks,
    surfaceConsistent: surfaces.length === 1,
    surfaces,
    tierMix: formatTierMix(orderedEvents.map((e) => e.level)),
    countries,
    cities,
  };
}

/**
 * Detect all swings in a year's events. Input events must already be filtered
 * to the levels that participate (the chosen level scope, held editions).
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

  // Turn each connected component into one or more output groups: long
  // single-city runs become a 'series'; long multi-city chains are split at
  // their biggest internal travel jump until each piece fits maxSwingWeeks.
  const swings: DetectedSwing[] = [];
  for (const component of components.values()) {
    const distinctWeeks = new Set(component.map((e) => e.week)).size;
    if (distinctWeeks < config.minSwingWeeks) continue;

    if (isSeriesGroup(component, config)) {
      swings.push(buildSwing(component, 'series'));
      continue;
    }

    for (const piece of splitLongChain(component, config)) {
      const pieceWeeks = new Set(piece.map((e) => e.week)).size;
      if (pieceWeeks < config.minSwingWeeks) continue;
      // A split can isolate a same-city sub-run; re-classify each piece.
      swings.push(buildSwing(piece, isSeriesGroup(piece, config) ? 'series' : 'swing'));
    }
  }

  swings.sort((a, b) => a.startWeek - b.startWeek || a.endWeek - b.endWeek);

  // Assign labels, disambiguating repeats ("Mexico swing (Mar)", then weeks).
  // A series is named for its single city ("Sharm El Sheikh series").
  const labelCounts = new Map<string, number>();
  for (const swing of swings) {
    swing.label =
      swing.kind === 'series'
        ? `${swing.cities[0] ?? swing.countries[0] ?? 'Unlabeled'} series`
        : baseLabel(swing);
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
