// What the boss (scripts/boss/orchestrate.mjs) actually does for a case, decided from data the audit
// already attached to the finding — never from free text, and never by asking a model. Every remedy here
// is one the app can already perform through its own admin API; see PLAYBOOK.md for the full list and why
// the rest (a missing PTL code, a duplicate to merge, a surface call) go to the user instead.

import { isSheetUrl } from './boss-policy';

export type Remedy =
  | { kind: 'reimport'; slug: string; year: number; event: 'singles' | 'doubles'; draw: 'main' | 'qualifying'; url: string }
  | { kind: 'cleanup-anomalies' }
  | { kind: 'none'; reason: string };

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;

/** `row.data` as the audit attaches it: see monday-audit.mjs's `causeItem` (A1/A2) and V1's `item(...)` call. */
export function remedyFor(row: { check_id: string; data: unknown }): Remedy {
  // A cleanup sweep fixes every implausible value in one call; there is nothing case-specific to check.
  if (row.check_id === 'C1') return { kind: 'cleanup-anomalies' };

  const d = (row.data ?? {}) as Record<string, unknown>;
  if (d.remedy !== 'reimport') return { kind: 'none', reason: `no automated remedy for ${row.check_id}` };

  const { slug, year, event, draw, url } = d;
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return { kind: 'none', reason: 'reimport data has no usable slug' };
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 2020 || year > 2030)
    return { kind: 'none', reason: 'reimport data has no usable year' };
  if (event !== 'singles' && event !== 'doubles') return { kind: 'none', reason: 'reimport data has no usable event' };
  if (draw !== 'main' && draw !== 'qualifying') return { kind: 'none', reason: 'reimport data has no usable draw' };
  if (typeof url !== 'string' || !isSheetUrl(url)) return { kind: 'none', reason: 'reimport data has no usable sheet url' };

  return { kind: 'reimport', slug, year, event, draw, url };
}
