// Matching one player's name to the same player written differently.
//
// The sources do not agree on a format. The published lists print "Gómez,
// Federico" and "Prado Angelo, Juan Carlos"; our own data holds "Federico
// Agustin Gomez" and "Juan Carlos Prado Angelo". An exact key over either form
// fails, and so does sorting the words, because one form carries a middle name
// the other omits.
//
// That failure is quiet and it matters. A name that does not match is a player
// whose withdrawal never reaches the row, and a cross-entry that never appears.
//
// Two names are treated as the same player when one set of name parts contains
// the other and they share at least two parts. Sets rather than sequences, so
// "Last, First" and "First Last" agree; containment rather than equality, so a
// missing middle name is not a mismatch; two shared parts, so a lone surname
// never sweeps up everyone who happens to share it.

const ACCENTS = /[̀-ͯ]/g;

export function nameParts(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(ACCENTS, '')
    .toLowerCase()
    // Apostrophes are dropped rather than split on, so O'Connell stays one part
    // and still matches a source that writes OConnell.
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function samePlayer(a: string, b: string): boolean {
  const left = new Set(nameParts(a));
  const right = new Set(nameParts(b));
  if (left.size === 0 || right.size === 0) return false;

  const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
  let shared = 0;
  for (const part of smaller) {
    if (!larger.has(part)) return false;
    shared += 1;
  }
  // A single shared part is a coincidence of surnames, not a person.
  return shared >= 2 || (shared === 1 && smaller.size === 1 && larger.size === 1);
}

/**
 * A key that groups names loosely enough to be worth comparing, and no looser.
 *
 * Containment cannot be hashed, so this only narrows the field — every
 * candidate sharing a part lands in the same bucket, and `samePlayer` decides.
 * Sorted parts alone would put "Gómez, Federico" and "Federico Agustin Gomez"
 * in different buckets, which is the bug this exists to avoid.
 */
export function nameBuckets(name: string): string[] {
  return nameParts(name).filter((part) => part.length > 2);
}

/**
 * Display form: "Gómez, Federico" becomes "Federico Gómez".
 *
 * Only the comma form is rearranged, and only when both sides are non-empty —
 * anything else is returned untouched, since guessing at which word is the
 * surname of an unpunctuated name gets compound surnames wrong.
 */
export function displayName(name: string): string {
  const match = name.match(/^([^,]+),\s*(.+)$/);
  if (!match) return name.trim();
  const [, surname, given] = match;
  if (!surname.trim() || !given.trim()) return name.trim();
  return `${given.trim()} ${surname.trim()}`;
}
