// Compact field-strength summary per tournament slug, for the swing builder's
// info popover.
//
// Replaces the week-competition line ("3rd easiest of 4 within reach"), which
// ranked an event against its neighbours. That ordering was validated, but it
// answered a question nobody asks — a player deciding whether to enter wants to
// know if the field will be stronger or weaker than the editions they remember,
// not where it sits in a list of alternatives.
//
// Carries only what the popover renders, since every field here ends up in the
// swings RSC payload for every event on the calendar.

import type { Pool } from 'pg';
import { buildStrengthView, type StrengthBasis } from './field-strength-data';
import type { StrengthBand } from './field-strength';

export type StrengthSummary = {
  /** 0-100 within this event's own level. */
  score: number | null;
  priorScore: number | null;
  delta: number | null;
  band: StrengthBand | null;
  basis: StrengthBasis | null;
  /** Range implied by the projection's own bounds; null on measured rows. */
  low: number | null;
  high: number | null;
};

export type StrengthByDraw = {
  m?: StrengthSummary;
  q?: StrengthSummary;
  d?: StrengthSummary;
};

const compact = (r: {
  score: number | null;
  priorScore: number | null;
  delta: number | null;
  band: StrengthBand | null;
  basis: StrengthBasis | null;
  scoreLow: number | null;
  scoreHigh: number | null;
}): StrengthSummary => ({
  score: r.score,
  priorScore: r.priorScore,
  delta: r.delta,
  band: r.band,
  basis: r.basis,
  low: r.scoreLow,
  high: r.scoreHigh,
});

export async function loadFieldStrength(
  pool: Pool,
  year: number
): Promise<Record<string, StrengthByDraw>> {
  const [singlesMain, singlesQual, doublesMain] = await Promise.all([
    buildStrengthView(pool, year, 'singles', 'main'),
    buildStrengthView(pool, year, 'singles', 'qualifying'),
    buildStrengthView(pool, year, 'doubles', 'main'),
  ]);

  const out: Record<string, StrengthByDraw> = {};
  for (const [key, view] of [
    ['m', singlesMain],
    ['q', singlesQual],
    ['d', doublesMain],
  ] as const) {
    for (const row of view.rows) {
      // Nothing to say when there is neither a number for this year nor one to
      // compare against; leaving the key absent keeps the payload small.
      if (row.score == null && row.priorScore == null) continue;
      (out[row.slug] ??= {})[key] = compact(row);
    }
  }
  return out;
}
