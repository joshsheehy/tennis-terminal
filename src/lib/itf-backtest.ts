// Does regional ITF supply actually move a Challenger cut?
//
// THE MECHANISM BEING TESTED
//
// A player near the boundary of a Challenger acceptance list faces a choice
// between a place they are not sure of and an ITF main draw they are. Taking
// the guaranteed entry removes them from the Challenger list. The list is then
// filled further down, so the last direct acceptance is a WORSE-ranked player:
//
//   more ITF nearby  ->  fewer marginal entrants  ->  HIGHER cut number
//                    ->  weaker field, LOWER strength score
//
// So the predicted sign is POSITIVE between the change in ITF supply and the
// change in cut. A negative fitted coefficient would mean the mechanism is
// backwards and the feature must not ship.
//
// WHY IT SHOULD BE LEVEL-DEPENDENT
//
// A cut is set by the Nth best entrant, so losing players ranked WORSE than the
// cut cannot move it. ITF fields draw roughly the 250-700 band, so the overlap
// is real at Challenger 50/75/80 ('high' exposure), marginal at 100/125
// ('low'), and absent above. If the effect is genuine it should be visibly
// concentrated in the high-exposure group; a uniform effect across every level
// would suggest we are fitting something else.
//
// This is measured against the same "same cut as last year" baseline the cut
// model is scored on, held out by season.

import type { Pool } from 'pg';
import { loadDepthEvents, loadDepthObservations } from './depth-data';
import type { Discipline, DepthEvent } from './depth';
import { itfNearby, itfExposure, type ItfExposure } from './itf-drain';
import { mean, sd, spearman, olsThroughOrigin, mae, round } from './depth-stats';

type Sample = {
  slug: string;
  year: number;
  level: string;
  exposure: ItfExposure;
  itfPlaces: number;
  priorItfPlaces: number;
  deltaItf: number;
  cut: number;
  priorCut: number;
  logRatio: number;
};

function buildSamples(
  events: DepthEvent[],
  observations: Awaited<ReturnType<typeof loadDepthObservations>>
): Sample[] {
  const eventBySlugYear = new Map(events.map((e) => [`${e.slug}:${e.year}`, e]));
  const byWeek = new Map<string, DepthEvent[]>();
  for (const e of events) {
    const k = `${e.year}:${e.week}`;
    const list = byWeek.get(k);
    if (list) list.push(e);
    else byWeek.set(k, [e]);
  }

  const obsBySlugYear = new Map(observations.map((o) => [`${o.slug}:${o.year}`, o]));
  const samples: Sample[] = [];

  for (const o of observations) {
    const exposure = itfExposure(o.level);
    if (exposure === 'none') continue; // only Challengers overlap the ITF band
    if (o.daCut == null) continue;

    const prior = obsBySlugYear.get(`${o.slug}:${o.year - 1}`);
    if (!prior?.daCut) continue;

    const now = eventBySlugYear.get(`${o.slug}:${o.year}`);
    const before = eventBySlugYear.get(`${o.slug}:${o.year - 1}`);
    if (!now || !before) continue;

    const itfNow = itfNearby(now, byWeek.get(`${now.year}:${now.week}`) ?? []);
    const itfBefore = itfNearby(before, byWeek.get(`${before.year}:${before.week}`) ?? []);

    samples.push({
      slug: o.slug,
      year: o.year,
      level: o.level,
      exposure,
      itfPlaces: itfNow.places,
      priorItfPlaces: itfBefore.places,
      deltaItf: itfNow.places - itfBefore.places,
      cut: o.daCut,
      priorCut: prior.daCut,
      logRatio: Math.log(o.daCut / prior.daCut),
    });
  }
  return samples;
}

function summarize(samples: Sample[]) {
  if (samples.length < 10) return { n: samples.length, note: 'too few samples' };
  const dx = samples.map((s) => s.deltaItf);
  const dy = samples.map((s) => s.logRatio);
  return {
    n: samples.length,
    meanDeltaItf: round(mean(dx), 1),
    sdDeltaItf: round(sd(dx), 1),
    // Predicted POSITIVE: more ITF nearby means a higher (weaker) cut.
    spearman: round(spearman(dx, dy)),
    beta: round(olsThroughOrigin(dx, dy), 6),
  };
}

/** Leave-one-season-out against the "same cut as last year" baseline. */
function heldOut(samples: Sample[]) {
  const years = [...new Set(samples.map((s) => s.year))].sort();
  const baseErr: number[] = [];
  const modelErr: number[] = [];
  const betas: Array<{ heldOutYear: number; beta: number | null; trainN: number }> = [];

  for (const y of years) {
    const train = samples.filter((s) => s.year !== y);
    const test = samples.filter((s) => s.year === y);
    if (train.length < 30 || test.length === 0) continue;
    const beta = olsThroughOrigin(
      train.map((s) => s.deltaItf),
      train.map((s) => s.logRatio)
    );
    betas.push({ heldOutYear: y, beta: round(beta, 6), trainN: train.length });
    for (const s of test) {
      baseErr.push(s.priorCut - s.cut);
      modelErr.push(s.priorCut * Math.exp(beta * s.deltaItf) - s.cut);
    }
  }

  const b = mae(baseErr);
  const m = mae(modelErr);
  return {
    n: baseErr.length,
    betas,
    baselineMae: round(b, 1),
    modelMae: round(m, 1),
    improvementPct: Number.isFinite(b) && b > 0 ? round(((b - m) / b) * 100, 1) : null,
  };
}

export async function runItfBacktest(pool: Pool): Promise<Record<string, unknown>> {
  const events = await loadDepthEvents(pool);
  const out: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    mechanism:
      'Players near the boundary take a guaranteed ITF main draw over an uncertain Challenger place. ' +
      'Fewer marginal entrants means the list fills further down, so the cut number rises. Predicted sign: POSITIVE.',
    itfPlacesPerEvent: 24,
  };

  for (const discipline of ['singles', 'doubles'] as Discipline[]) {
    const observations = await loadDepthObservations(pool, discipline, 'main');
    const samples = buildSamples(events, observations);

    const byExposure: Record<string, unknown> = {};
    for (const ex of ['high', 'low'] as ItfExposure[]) {
      const subset = samples.filter((s) => s.exposure === ex);
      byExposure[ex] = { ...summarize(subset), heldOut: heldOut(subset) };
    }

    // Weeks where regional ITF supply actually changed are the only ones that
    // can carry signal; everything else is noise around a zero delta.
    const moved = samples.filter((s) => Math.abs(s.deltaItf) >= 24);

    out[discipline] = {
      overall: summarize(samples),
      heldOut: heldOut(samples),
      byExposure,
      weeksWhereItfSupplyChanged: {
        ...summarize(moved),
        n: moved.length,
        share: samples.length ? round(moved.length / samples.length) : null,
      },
    };
  }

  return out;
}
