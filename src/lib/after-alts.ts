/**
 * "Cut after alts": the lowest-ranked player who got into a draw as an alternate, ranked on the list in
 * effect the day before the draw was made (the Monday before the tournament week).
 *
 * Rules:
 *  - singles and qualifying: singles ranking; a player with none (doubles-only or unranked) → "unranked";
 *  - doubles: each player counts at the better of singles and doubles ranking, the team at the sum;
 *  - nothing is guessed. A name that could be two players, or looks like a differently-spelled ranked
 *    player, leaves the draw incomplete and nothing is written.
 */
import type { Alternate, DrawAlternates } from './draw-alternates';

/** [rank, surname, first name, country code or ''] */
export type RankedPlayer = [number, string, string, string];

export type AfterAlts =
  | { complete: true; best: number | null; lowest: number | null; unranked: boolean }
  | { complete: false; reason: string };

const AMBIGUOUS = 'ambiguous';
type Found = number | null | typeof AMBIGUOUS;

type Indexed = { rank: number; tokens: string[]; surname: string[]; nat: string };
export type RankingIndex = { players: Indexed[] };

function strip(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Sheets and rankings disagree on umlauts ("Müller" / "Mueller"), so both spellings are tried.
function expand(text: string): string {
  return strip(
    text
      .replace(/ü/gi, 'ue')
      .replace(/ö/gi, 'oe')
      .replace(/ä/gi, 'ae')
      .replace(/ß/g, 'ss')
      .replace(/ø/gi, 'o')
      .replace(/æ/gi, 'ae')
      .replace(/ł/gi, 'l')
      .replace(/đ/gi, 'd')
  );
}

const words = (text: string) => text.split(' ').filter(Boolean);

export function indexRanking(players: RankedPlayer[]): RankingIndex {
  return {
    players: players.map(([rank, surname, first, nat]) => ({
      rank,
      tokens: words(strip(`${first} ${surname}`)),
      surname: words(strip(surname)),
      nat: (nat || '').toUpperCase(),
    })),
  };
}

function resolve(hits: Indexed[]): Found {
  const ranks = new Set(hits.map((h) => h.rank));
  return ranks.size === 1 ? hits[0].rank : AMBIGUOUS;
}

function search(index: RankingIndex, player: Alternate, spell: (s: string) => string): Found {
  const nat = (player.nat ?? '').toUpperCase();
  // A blank country (neutral athletes, some list sources) matches anyone.
  const sameCountry = (hits: Indexed[]) => {
    if (!nat) return hits;
    const same = hits.filter((h) => h.nat === nat);
    return same.length ? same : hits.filter((h) => !h.nat);
  };

  const cut = player.surname.endsWith('…');
  const surname = words(spell(player.surname.replace(/…$/, '')));
  if (cut) {
    const prefix = surname.join(' ');
    if (!nat || prefix.length < 7) return null;
    const hits = index.players.filter((p) => p.nat === nat && p.surname.join(' ').startsWith(prefix));
    return hits.length ? resolve(hits) : null;
  }

  const first = words(spell(player.first.replace(/…$/, '')));
  const all = [...first, ...surname];
  if (!surname.length || !all.length) return null;
  const letters = [...all.join('')].sort().join('');
  const initial = first[0]?.[0];

  const tiers: Array<(p: Indexed) => boolean> = [
    (p) => p.tokens.join(' ') === all.join(' '),
    (p) => all.every((t) => p.tokens.includes(t)),
    (p) => [...p.tokens.join('')].sort().join('') === letters,
    // last name plus first initial
    (p) => initial !== undefined && p.tokens[p.tokens.length - 1] === surname[surname.length - 1] && p.tokens[0][0] === initial,
  ];
  for (const tier of tiers) {
    const hits = sameCountry(index.players.filter(tier));
    if (hits.length) return resolve(hits);
  }
  return null;
}

export function findRank(index: RankingIndex, player: Alternate): Found {
  const found = search(index, player, expand);
  return found === null ? search(index, player, strip) : found;
}

/** A name too broken to say "has no ranking" about. */
function garbled(player: Alternate): boolean {
  const name = `${player.first} ${player.surname}`;
  return (
    player.first.replace(/\./g, '').trim().length < 3 ||
    player.surname.trim().length < 2 ||
    /…|-$|^-|- |\/|\d/.test(name)
  );
}

/** A ranked player who might be this one under another spelling: shares a surname word and the initial. */
function lookalike(index: RankingIndex, player: Alternate): boolean {
  const surname = words(strip(player.surname)).filter((t) => t.length >= 4);
  const initial = strip(player.first)[0];
  const joined = strip(`${player.first} ${player.surname}`).replace(/ /g, '');
  return index.players.some(
    (p) => p.tokens.join('') === joined || (p.tokens[0]?.[0] === initial && surname.some((t) => p.tokens.slice(1).includes(t)))
  );
}

const label = (p: Alternate) => `${p.first} ${p.surname}`.trim();

export function computeAfterAlts(
  alternates: DrawAlternates,
  singles: RankingIndex,
  doubles: RankingIndex | null
): AfterAlts {
  if (!alternates.complete) return { complete: false, reason: 'a slot in the bracket could not be read' };
  if (!alternates.count) return { complete: false, reason: 'no alternates' };
  if (alternates.event === 'doubles' && !doubles) return { complete: false, reason: 'waiting for a full doubles ranking list' };

  const values: number[] = [];
  let unranked = false;
  for (const slot of alternates.slots) {
    let total = 0;
    let whole = true;
    for (const player of slot) {
      const lists = alternates.event === 'doubles' ? [singles, doubles as RankingIndex] : [singles];
      const found = lists.map((list) => findRank(list, player));
      if (found.includes(AMBIGUOUS)) return { complete: false, reason: `two ranked players match ${label(player)}` };
      const ranks = found.filter((r): r is number => typeof r === 'number');
      if (!ranks.length) {
        if (garbled(player) || lists.some((list) => lookalike(list, player))) {
          return { complete: false, reason: `cannot place ${label(player)}` };
        }
        unranked = true;
        whole = false;
        continue;
      }
      total += Math.min(...ranks);
    }
    if (whole) values.push(total);
  }
  return {
    complete: true,
    best: values.length ? Math.min(...values) : null,
    lowest: values.length ? Math.max(...values) : null,
    unranked,
  };
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The ranking date a draw is judged on: seven days before the tournament week's Monday. */
export function rankingDateFor(startDate: string): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  const day = start.getUTCDay();
  // A Saturday or Sunday start belongs to the week that begins the following Monday.
  const toMonday = day === 6 ? 2 : day === 0 ? 1 : 1 - day;
  return iso(new Date(start.getTime() + (toMonday - 7) * DAY));
}

export type SnapshotInfo = { listDate: string; lastSeen: string };

/**
 * The list in effect on `target`, or null when it was never captured. A list older than the target counts
 * only if it was still the published one after the target day (no list comes out in the second week of a
 * two-week event, or for weeks in December); otherwise a newer list may simply have been missed.
 */
export function pickSnapshot<T extends SnapshotInfo>(snapshots: T[], target: string): T | null {
  const candidate = snapshots
    .filter((s) => s.listDate <= target)
    .sort((a, b) => b.listDate.localeCompare(a.listDate))[0];
  if (!candidate) return null;
  if (candidate.listDate === target) return candidate;
  return candidate.lastSeen.slice(0, 10) > target ? candidate : null;
}
