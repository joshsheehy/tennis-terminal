// ProTennisLive codes for tournaments nothing else can resolve.
//
// WHY THIS FILE EXISTS
//
// The cut importer builds a PDF URL from a tournament's PTL code. It gets that
// code from three places, in order: the static catalogue in tournament-data.ts,
// an earlier season's row in the database (a code belongs to the tournament and
// never changes, so anything that has run before already has one), and this
// file.
//
// That covers everything except a tournament's first appearance. For those,
// every automatic route is closed:
//
//   - Probing the posting space does not scale. protennislive.com allows a
//     burst of about forty requests and then refuses; a 250-code scan on a
//     GitHub runner hit a two-hour job timeout without finishing.
//   - atptour.com puts the code in its own URLs
//     (/en/tournaments/durham/3099/overview) and would be a slug-to-code table
//     for the whole tour in one page — but it returns 403 to Railway, to the
//     sandbox and to GitHub runners alike. Measured, not assumed.
//   - The official calendar PDF, which we already parse daily, does not carry
//     codes at all.
//
// What does work is a search: `site:protennislive.com/posting/<year> "<event
// name>"` returns the posting URLs, and the code is in the path. The ATP's own
// score pages carry the same number. Both take one query per tournament, so a
// season's worth of new events is a few minutes of work, once.
//
// A code never changes, so recording it once is permanent — and from the
// following season the database lookup finds it without this file. Roughly
// fifteen entries a year, each of which stops being needed after one season.
//
// ADDING ONE
//
// Search for the event, take the number out of the posting URL, and confirm the
// PDF's own header names that tournament before trusting it — codes near each
// other are unrelated events. 3061 and 3063 sit between two Phan Thiet codes
// and are Cesenatico and Baton Rouge.
//
// Three responses tell you what you have:
//   404, 1245 bytes   no posting under this code
//   200, 2616 bytes   right code, but "Tournament Information Not Yet
//                     Available" — the sheet was never published
//   200, real size    a draw sheet

export type PtlCodeOverride = {
  code: string;
  /** Season the code was confirmed against a posting header. */
  confirmedFor: number;
  /** What the posting's own header says, so a wrong entry is obvious. */
  header: string;
};

export const PTL_CODE_OVERRIDES: Record<string, PtlCodeOverride> = {
  'phan-thiet-3': { code: '3137', confirmedFor: 2026, header: 'SPORT FESTIVAL CHALLENGER — Phan Thiet, Vietnam' },
  'phan-thiet-4': { code: '3139', confirmedFor: 2026, header: 'SPORT FESTIVAL CHALLENGER II — Phan Thiet, Vietnam' },
  'plovdiv-2': { code: '3169', confirmedFor: 2026, header: 'PLOVDIV CHALLENGER — Plovdiv, Bulgaria' },
  'plovdiv-3': { code: '3171', confirmedFor: 2026, header: 'PLOVDIV CHALLENGER 3 — Plovdiv, Bulgaria' },
  'kingston-1': { code: '3121', confirmedFor: 2026, header: 'Kingston Open 1 — Kingston, Jamaica' },
  'kingston-2': { code: '3129', confirmedFor: 2026, header: 'Kingston Open 2 — Kingston, Jamaica' },
  'roehampton-1': { code: '3123', confirmedFor: 2026, header: 'LEXUS ROEHAMPTON CHALLENGER — Roehampton, Great Britain' },
  'roehampton-2': { code: '3125', confirmedFor: 2026, header: 'LEXUS ROEHAMPTON CHALLENGER 2 — Roehampton, Great Britain' },
  samsun: { code: '3167', confirmedFor: 2026, header: 'Samsun Open — Samsun, Turkiye' },
  brownsburg: { code: '3131', confirmedFor: 2026, header: 'Indiana Hardcourt Championships — Brownsburg, IN, U.S.A.' },
  'chisinau-1': { code: '2993', confirmedFor: 2026, header: 'Moldova Open — Chisinau, Moldova' },
  'fujairah-1': { code: '3067', confirmedFor: 2026, header: 'Fujairah Open — Fujairah, U.A.E.' },
  cancun: { code: '3009', confirmedFor: 2026, header: 'Cancun Country Open — Cancun, Mexico' },
  'quebec-city': { code: '3103', confirmedFor: 2026, header: 'CHALLENGER BANQUE NATIONALE QUEBEC — Quebec City, Canada' },
  sion: { code: '3133', confirmedFor: 2026, header: 'Sion, Switzerland' },

  // Correct codes whose draw sheet was never published — the posting returns
  // the 2616-byte "Tournament Information Not Yet Available" placeholder.
  // Recorded so the importer stops treating them as undiscovered, and so the
  // health check can tell "no sheet exists" from "we failed to fetch it".
  durham: { code: '3099', confirmedFor: 2026, header: 'Tournament Information Not Yet Available' },
  'centurion-3-centurion': { code: '3091', confirmedFor: 2026, header: 'Tournament Information Not Yet Available' },
  'centurion-4-centurion': { code: '3093', confirmedFor: 2026, header: 'Tournament Information Not Yet Available' },
};

/** Byte length of the "Tournament Information Not Yet Available" placeholder. */
export const UNPUBLISHED_PLACEHOLDER_BYTES = 2616;

export function overrideCodeFor(slug: string): string | null {
  return PTL_CODE_OVERRIDES[slug]?.code ?? null;
}
