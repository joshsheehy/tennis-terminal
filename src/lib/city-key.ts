// A comparison key for a city name.
//
// The same place is written differently by different feeds. The ATP official
// calendar PDF gives "Mouilleron-le-Captif"; an earlier import gave "Mouilleron
// le Captif". A duplicate check that only folded accents treated those as two
// cities, so three separate tournament records for one Challenger survived every
// cleanup — and because they were separate records, the event's cut history was
// split across them.
//
// Punctuation and spacing carry no information in a city name, so the key drops
// both along with accents. Collapsing to letters and digits could in principle
// merge two genuinely different cities; no pair on the tour does so, and the
// alternative has demonstrably lost real history.

/**
 * The same folding as `CITY_KEY_SQL`, for use in TypeScript.
 *
 * Keep the two in step: the SQL groups the rows, this checks them.
 */
export function cityKey(city: string | null | undefined): string {
  if (!city) return '';
  return city
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function sameCity(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = cityKey(a);
  return left.length > 0 && left === cityKey(b);
}

// Postgres has no unaccent extension enabled here, so the fold is spelled out.
// The pairs must stay aligned character for character.
const ACCENTED =
  'áàãâäéèêëíìîïóòõôöúùûüçñắằẳẵặăấầẩẫậạảếềểễệẹẻẽịỉĩốồổỗộớờởỡợọỏơứừửữựụủưýỳỵỷỹđšśćčžźżłęąőűřůīāē';
const PLAIN =
  'aaaaaeeeeiiiiooooouuuucnaaaaaaaaaaaaaeeeeeeeeiiiooooooooooooouuuuuuuuyyyyydsscczzzleaouruiae';

/**
 * SQL that folds a city column the same way `cityKey` does.
 *
 * @param column the column expression to fold, e.g. `t.city`
 */
export function cityKeySql(column: string): string {
  return `regexp_replace(translate(lower(${column}), '${ACCENTED}', '${PLAIN}'), '[^a-z0-9]+', '', 'g')`;
}
