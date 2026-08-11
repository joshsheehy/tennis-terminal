// Validation gate for the competitive-depth feature. Nothing in Part 3 of the
// build spec ships until these report, and V1 is decisive: if depth does not
// reproduce the within-week ordering that actually happened, the construct is
// wrong and everything downstream is worthless.
//
// Shared by /api/depth-validate (JSON) and /depth (the rendered report) so
// both show the same numbers from one implementation. Reads only: it writes
// nothing and changes no prediction.

import type { Pool } from 'pg';
import { haversineKm, tierGroup } from './cut-prediction';
import { levelRank } from './swings';
import {
  computeDepth,
  sameWeekScope,
  isAboveChallengerStack,
  daSlots,
  absorptionSlots,
  type DepthEvent,
  type Discipline,
} from './depth';
import {
  loadDepthEvents,
  loadDepthObservations,
  isSaturated,
  SATURATION_CUT,
  type DepthObservation,
} from './depth-data';
import {
  mean,
  sd,
  median,
  spearman,
  olsThroughOrigin,
  mae,
  concordantPairs,
  round,
} from './depth-stats';

/** Radius used to decide that two events are in the same regional market for
 * the V1 ordering test. Deliberately wider than swings.ts's CROSS_BORDER_MAX_KM
 * (600), which asks whether two events form a travel chain; V1 asks the looser
 * question of whether they competed for one pool in a single week. */
const REGION_KM = 1500;

type Cluster = { year: number; week: number; events: DepthEvent[] };

/** Greedy single-link clustering inside a week. Good enough: tennis weeks form
 * obvious geographic blocks (a European block, an American block, an Asian
 * block) and the exact partition barely moves the ordering test. */
function clusterWeek(events: DepthEvent[]): DepthEvent[][] {
  const located = events.filter((e) => e.latitude != null && e.longitude != null);
  const unassigned = [...located];
  const clusters: DepthEvent[][] = [];
  while (unassigned.length > 0) {
    const seed = unassigned.shift()!;
    const cluster = [seed];
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = unassigned.length - 1; i >= 0; i--) {
        const cand = unassigned[i];
        const near = cluster.some(
          (c) =>
            haversineKm(c.latitude!, c.longitude!, cand.latitude!, cand.longitude!) <= REGION_KM
        );
        if (near) {
          cluster.push(cand);
          unassigned.splice(i, 1);
          grew = true;
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function keyOf(year: number, week: number): string {
  return `${year}-${week}`;
}

type Prepared = {
  discipline: Discipline;
  events: DepthEvent[];
  byWeek: Map<string, DepthEvent[]>;
  observations: DepthObservation[];
  obsByEdition: Map<string, DepthObservation>;
  depthByEdition: Map<string, number>;
};

function prepare(
  events: DepthEvent[],
  observations: DepthObservation[],
  discipline: Discipline
): Prepared {
  const byWeek = new Map<string, DepthEvent[]>();
  for (const e of events) {
    const k = keyOf(e.year, e.week);
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k)!.push(e);
  }

  const eventById = new Map(events.map((e) => [e.editionId, e]));
  const depthByEdition = new Map<string, number>();
  for (const e of events) {
    const scope = sameWeekScope(events, e.year, e.week);
    depthByEdition.set(e.editionId, computeDepth(e, scope, discipline).depth);
  }

  return {
    discipline,
    events,
    byWeek,
    observations: observations.filter((o) => eventById.has(o.editionId)),
    obsByEdition: new Map(observations.map((o) => [o.editionId, o])),
    depthByEdition,
  };
}

// --- V0: does the data support any of this? ---------------------------------

function v0Coverage(observations: DepthObservation[], discipline: Discipline, events: DepthEvent[]) {
  const total = observations.length;
  const withDa = observations.filter((o) => o.daCut != null).length;
  const withAlt = observations.filter((o) => o.alternateCut != null).length;
  const bothDiffer = observations.filter(
    (o) => o.daCut != null && o.alternateCut != null && o.daCut !== o.alternateCut
  );
  const drift = bothDiffer.map((o) => o.alternateCut! - o.daCut!);
  const saturated = observations.filter((o) => isSaturated(o, discipline)).length;
  const geocoded = events.filter((e) => e.latitude != null).length;

  return {
    observations: total,
    withDirectAcceptanceCut: withDa,
    withAlternateCut: withAlt,
    // If this is large, every fitted constant in cut-prediction.ts was trained
    // on a MIXTURE of the two definitions, not on one of them.
    rowsWhereTheTwoDefinitionsDiffer: bothDiffer.length,
    alternateDrift: {
      mean: round(mean(drift), 1),
      median: round(median(drift), 1),
      sd: round(sd(drift), 1),
    },
    saturatedExcluded: saturated,
    saturationThreshold: SATURATION_CUT[discipline],
    eventsGeocoded: geocoded,
    eventsTotal: events.length,
  };
}

// --- V1: within-week ordering (decisive) ------------------------------------

function v1Ordering(p: Prepared) {
  const usableWeeks: Cluster[] = [];
  for (const [k, weekEvents] of p.byWeek) {
    const [year, week] = k.split('-').map(Number);
    for (const cluster of clusterWeek(weekEvents)) {
      usableWeeks.push({ year, week, events: cluster });
    }
  }

  let exactMatches = 0;
  let comparableClusters = 0;
  let agree = 0;
  let pairs = 0;
  const allDepths: number[] = [];
  const allCuts: number[] = [];
  const failures: Array<Record<string, unknown>> = [];

  for (const cluster of usableWeeks) {
    const scored = cluster.events
      .map((e) => {
        const obs = p.obsByEdition.get(e.editionId);
        if (!obs || isSaturated(obs, p.discipline)) return null;
        const depth = p.depthByEdition.get(e.editionId);
        if (depth == null) return null;
        return { slug: e.slug, level: e.level, depth, cut: obs.daCut! };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);

    if (scored.length < 2) continue;
    comparableClusters++;

    const depths = scored.map((s) => s.depth);
    const cuts = scored.map((s) => s.cut);
    allDepths.push(...depths);
    allCuts.push(...cuts);

    const byDepth = [...scored].sort((a, b) => a.depth - b.depth).map((s) => s.slug);
    const byCut = [...scored].sort((a, b) => a.cut - b.cut).map((s) => s.slug);
    const exact = byDepth.every((s, i) => s === byCut[i]);
    if (exact) exactMatches++;

    const c = concordantPairs(depths, cuts);
    agree += c.agree;
    pairs += c.total;

    if (!exact && failures.length < 40) {
      failures.push({
        year: cluster.year,
        week: cluster.week,
        predictedOrder: byDepth,
        observedOrder: byCut,
        events: scored.map((s) => ({
          slug: s.slug,
          level: s.level,
          depth: round(s.depth, 1),
          cut: s.cut,
        })),
      });
    }
  }

  return {
    // Depth and cut rank are expected to move TOGETHER: more slots at or above
    // you means a weaker field and a higher (easier) rank number.
    expectedSign: 'positive',
    comparableClusters,
    exactOrderMatches: exactMatches,
    exactOrderRate: comparableClusters ? round(exactMatches / comparableClusters) : null,
    concordantPairRate: pairs ? round(agree / pairs) : null,
    concordantPairs: pairs,
    spearmanOverall: round(spearman(allDepths, allCuts)),
    observationsUsed: allDepths.length,
    failures,
  };
}

// --- V2: curve stability ----------------------------------------------------

function v2Curve(p: Prepared) {
  const rows = p.observations
    .filter((o) => !isSaturated(o, p.discipline))
    .map((o) => ({
      depth: p.depthByEdition.get(o.editionId),
      cut: o.daCut!,
      // Reuses the model's own tier grouping (gs / tour / challenger) so the
      // pools here line up with the ones cut-prediction.ts already reports on.
      group: tierGroup(o.level) ?? 'other',
      aboveStack: isAboveChallengerStack(o.level),
    }))
    .filter((r): r is { depth: number; cut: number; group: string; aboveStack: boolean } =>
      r.depth != null
    );

  const byPool = (subset: typeof rows) => {
    const totalSd = sd(subset.map((r) => r.cut));
    const bins = new Map<number, number[]>();
    for (const r of subset) {
      const bin = Math.floor(r.depth / 10) * 10;
      if (!bins.has(bin)) bins.set(bin, []);
      bins.get(bin)!.push(r.cut);
    }
    const binRows = [...bins.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bin, cuts]) => ({
        depthBin: `${bin}-${bin + 10}`,
        n: cuts.length,
        medianCut: round(median(cuts), 1),
        sdCut: round(sd(cuts), 1),
      }))
      .filter((r) => r.n >= 5);
    const withinSd = mean(binRows.filter((r) => r.sdCut != null).map((r) => r.sdCut as number));
    return {
      n: subset.length,
      totalSdOfCut: round(totalSd, 1),
      meanWithinBinSd: round(withinSd, 1),
      // If this is close to 1, depth carries no signal: knowing the depth bin
      // tells you as little as knowing nothing.
      varianceRatio: round(withinSd / totalSd),
      bins: binRows,
    };
  };

  const pools: Record<string, unknown> = { all: byPool(rows) };
  for (const g of ['challenger', 'tour', 'gs']) {
    const subset = rows.filter((r) => r.group === g);
    if (subset.length >= 20) pools[g] = byPool(subset);
  }
  return pools;
}

// --- V3: Δdepth distribution ------------------------------------------------

type DeltaRow = {
  editionId: string;
  slug: string;
  year: number;
  week: number;
  level: string;
  depth: number;
  priorDepth: number;
  delta: number;
  cut: number;
  priorCut: number;
};

function deltaRows(p: Prepared): DeltaRow[] {
  const bySlugYear = new Map<string, DepthEvent>();
  for (const e of p.events) bySlugYear.set(`${e.slug}:${e.year}`, e);

  const rows: DeltaRow[] = [];
  for (const obs of p.observations) {
    if (isSaturated(obs, p.discipline)) continue;
    const prior = bySlugYear.get(`${obs.slug}:${obs.year - 1}`);
    if (!prior) continue;
    const priorObs = p.obsByEdition.get(prior.editionId);
    if (!priorObs || isSaturated(priorObs, p.discipline)) continue;
    const depth = p.depthByEdition.get(obs.editionId);
    const priorDepth = p.depthByEdition.get(prior.editionId);
    if (depth == null || priorDepth == null) continue;
    rows.push({
      editionId: obs.editionId,
      slug: obs.slug,
      year: obs.year,
      week: obs.week,
      level: obs.level,
      depth,
      priorDepth,
      delta: depth - priorDepth,
      cut: obs.daCut!,
      priorCut: priorObs.daCut!,
    });
  }
  return rows;
}

function v3Delta(rows: DeltaRow[]) {
  const deltas = rows.map((r) => r.delta);
  const big = rows.filter((r) => Math.abs(r.delta) >= 7);
  const moderate = rows.filter((r) => Math.abs(r.delta) >= 3);
  return {
    n: rows.length,
    mean: round(mean(deltas), 2),
    sd: round(sd(deltas), 2),
    // The decision number: hundreds means fit a correction, dozens means ship
    // context only.
    countAbs7OrMore: big.length,
    countAbs3OrMore: moderate.length,
    shareRestructured: rows.length ? round(moderate.length / rows.length) : null,
    largestSwings: [...rows]
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 15)
      .map((r) => ({
        slug: r.slug,
        year: r.year,
        week: r.week,
        level: r.level,
        depth: round(r.depth, 1),
        priorDepth: round(r.priorDepth, 1),
        delta: round(r.delta, 1),
        cut: r.cut,
        priorCut: r.priorCut,
      })),
  };
}

// --- V4: the motivating case ------------------------------------------------

function v4Week(p: Prepared, year: number, week: number) {
  const scope = sameWeekScope(p.events, year, week);
  const inWeek = p.events.filter((e) => e.year === year && e.week === week);
  return {
    year,
    week,
    events: inWeek
      .map((e) => {
        const r = computeDepth(e, scope, p.discipline);
        const obs = p.obsByEdition.get(e.editionId);
        return {
          slug: e.slug,
          name: e.name,
          level: e.level,
          levelRank: levelRank(e.level),
          surface: e.surface,
          indoor: e.indoor,
          ownSlots: r.ownSlots,
          slotsAbove: round(r.slotsAbove, 2),
          depth: round(r.depth, 2),
          daCut: obs?.daCut ?? null,
          contributions: r.contributions.map((c) => ({
            from: c.slug,
            level: c.level,
            km: round(c.km, 0),
            wGeo: round(c.wGeo),
            wSurface: c.wSurface,
            slots: c.slots,
            adds: round(c.contribution, 2),
            kind: c.kind,
          })),
        };
      })
      .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0)),
  };
}

/** Weeks whose regional top level changed year over year — the population the
 * feature exists for. Reported so the motivating case can be checked against
 * real rows rather than only the synthetic unit test. */
function v4Restructured(rows: DeltaRow[]) {
  return [...rows]
    .filter((r) => Math.abs(r.delta) >= 7)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 10)
    .map((r) => ({
      slug: r.slug,
      year: r.year,
      week: r.week,
      level: r.level,
      depthNow: round(r.depth, 1),
      depthPrior: round(r.priorDepth, 1),
      delta: round(r.delta, 1),
      cutNow: r.cut,
      cutPrior: r.priorCut,
      // Did the cut move the way depth says it should have?
      directionAgrees: Math.sign(r.delta) === Math.sign(r.cut - r.priorCut),
    }));
}

// --- V5: held-out comparison ------------------------------------------------

function v5HeldOut(rows: DeltaRow[]) {
  const years = [...new Set(rows.map((r) => r.year))].sort();
  const cells = {
    stable: { baseline: [] as number[], model: [] as number[] },
    restructured: { baseline: [] as number[], model: [] as number[] },
  };
  const fittedBetas: Array<{ heldOutYear: number; beta: number | null; trainN: number }> = [];

  for (const heldOut of years) {
    const train = rows.filter((r) => r.year !== heldOut);
    const test = rows.filter((r) => r.year === heldOut);
    if (train.length < 30 || test.length === 0) continue;

    // log(cut / priorCut) ~ beta * delta, through the origin so a stable
    // calendar (delta = 0) can never move the prediction. That property is the
    // whole argument for wiring this in at all.
    const xs = train.map((r) => r.delta);
    const ys = train.map((r) => Math.log(r.cut / r.priorCut));
    const beta = olsThroughOrigin(xs, ys);
    fittedBetas.push({ heldOutYear: heldOut, beta: round(beta, 5), trainN: train.length });

    for (const r of test) {
      const baselineErr = r.priorCut - r.cut;
      const modelErr = r.priorCut * Math.exp(beta * r.delta) - r.cut;
      const cell = Math.abs(r.delta) >= 3 ? cells.restructured : cells.stable;
      cell.baseline.push(baselineErr);
      cell.model.push(modelErr);
    }
  }

  const summarize = (c: { baseline: number[]; model: number[] }) => {
    const b = mae(c.baseline);
    const m = mae(c.model);
    return {
      n: c.baseline.length,
      baselineMae: round(b, 1),
      modelMae: round(m, 1),
      improvementPct: Number.isFinite(b) && b > 0 ? round(((b - m) / b) * 100, 1) : null,
    };
  };

  return {
    baseline: "the same event's cut from the prior year",
    fittedBetas,
    stable: summarize(cells.stable),
    restructured: summarize(cells.restructured),
  };
}

// --- Absorption sanity ------------------------------------------------------

function absorptionTable() {
  const levels = ['Grand Slam', 'ATP 1000', 'ATP 500', 'ATP 250'];
  const challengerSingles = daSlots('Challenger 100', 'singles').slots;
  const challengerDoubles = daSlots('Challenger 100', 'doubles').slots;
  return levels.map((level) => {
    const s = absorptionSlots(level, 'singles');
    const d = absorptionSlots(level, 'doubles');
    return {
      level,
      singlesSlotsAbsorbed: s,
      doublesTeamsAbsorbed: d,
      singlesInChallengerDraws: round(s / challengerSingles, 2),
      doublesInChallengerDraws: round(d / challengerDoubles, 2),
    };
  });
}

export type DepthValidationOptions = {
  disciplines?: Discipline[];
  /** Optional week to print full V4 intermediates for. */
  year?: number;
  week?: number;
};

export async function runDepthValidation(
  pool: Pool,
  opts: DepthValidationOptions = {}
): Promise<Record<string, unknown>> {
  const disciplines = opts.disciplines ?? (['singles', 'doubles'] as Discipline[]);
  const events = await loadDepthEvents(pool);

  const byDiscipline: Record<string, unknown> = {};
  for (const discipline of disciplines) {
    const observations = await loadDepthObservations(pool, discipline, 'main');
    const p = prepare(events, observations, discipline);
    const rows = deltaRows(p);
    byDiscipline[discipline] = {
      v0_coverage: v0Coverage(observations, discipline, events),
      v1_ordering: v1Ordering(p),
      v2_curve: v2Curve(p),
      v3_delta: v3Delta(rows),
      v4_restructuredWeeks: v4Restructured(rows),
      v4_week:
        opts.year != null && opts.week != null ? v4Week(p, opts.year, opts.week) : null,
      v5_heldOut: v5HeldOut(rows),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    regionKm: REGION_KM,
    absorptionSanity: absorptionTable(),
    disciplines: byDiscipline,
  };
}
