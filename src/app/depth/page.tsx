import type { Metadata } from 'next';
import { pool } from '@/lib/db';
import { runDepthValidation } from '@/lib/depth-validate';
import type { Discipline } from '@/lib/depth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Hidden diagnostic surface: not linked from SiteNav and not indexed. While the
// build spec's Part 2 gate is open this page IS the deliverable — it renders
// the validation that decides whether the depth feature ships at all. The
// weekly calendar table replaces it only once V1 passes.
export const metadata: Metadata = {
  title: 'Competitive depth — validation',
  robots: { index: false, follow: false },
};

type Coverage = {
  observations: number;
  withDirectAcceptanceCut: number;
  withAlternateCut: number;
  rowsWhereTheTwoDefinitionsDiffer: number;
  alternateDrift: { mean: number | null; median: number | null; sd: number | null };
  saturatedExcluded: number;
  saturationThreshold: number;
  eventsGeocoded: number;
  eventsTotal: number;
};

type Ordering = {
  comparableClusters: number;
  exactOrderMatches: number;
  exactOrderRate: number | null;
  concordantPairRate: number | null;
  concordantPairs: number;
  spearmanOverall: number | null;
  observationsUsed: number;
  failures: Array<{
    year: number;
    week: number;
    events: Array<{ slug: string; level: string; depth: number | null; cut: number }>;
  }>;
};

type Delta = {
  n: number;
  mean: number | null;
  sd: number | null;
  countAbs7OrMore: number;
  countAbs3OrMore: number;
  shareRestructured: number | null;
  largestSwings: Array<{
    slug: string;
    year: number;
    week: number;
    level: string;
    depth: number | null;
    priorDepth: number | null;
    delta: number | null;
    cut: number;
    priorCut: number;
  }>;
};

type Cell = {
  n: number;
  baselineMae: number | null;
  modelMae: number | null;
  improvementPct: number | null;
};

type HeldOut = { baseline: string; stable: Cell; restructured: Cell };

type Pool_ = {
  n: number;
  totalSdOfCut: number | null;
  meanWithinBinSd: number | null;
  varianceRatio: number | null;
  bins: Array<{ depthBin: string; n: number; medianCut: number | null; sdCut: number | null }>;
};

type DisciplineReport = {
  v0_coverage: Coverage;
  v1_ordering: Ordering;
  v2_curve: Record<string, Pool_>;
  v3_delta: Delta;
  v4_restructuredWeeks: Array<{
    slug: string;
    year: number;
    week: number;
    level: string;
    depthNow: number | null;
    depthPrior: number | null;
    delta: number | null;
    cutNow: number;
    cutPrior: number;
    directionAgrees: boolean;
  }>;
  v5_heldOut: HeldOut;
};

type Report = {
  generatedAt: string;
  regionKm: number;
  absorptionSanity: Array<{
    level: string;
    singlesSlotsAbsorbed: number;
    doublesTeamsAbsorbed: number;
    singlesInChallengerDraws: number | null;
    doublesInChallengerDraws: number | null;
  }>;
  disciplines: Record<string, DisciplineReport>;
};

const num = (v: number | null | undefined, dp = 2) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(dp);

const pct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(0)}%`;

function Verdict({ r }: { r: DisciplineReport }) {
  const spearman = r.v1_ordering.spearmanOverall;
  const enough = r.v1_ordering.comparableClusters >= 20;
  // Depth and cut rank must move TOGETHER: more slots at or above you means a
  // weaker field and a higher (easier) rank number.
  const pass = enough && spearman != null && spearman > 0.15;
  const inverted = enough && spearman != null && spearman < -0.15;

  const label = !enough
    ? 'INSUFFICIENT DATA'
    : pass
      ? 'V1 PASSES — construct reproduces observed ordering'
      : inverted
        ? 'V1 FAILS, INVERTED — depth predicts the opposite ordering'
        : 'V1 FAILS — depth does not order the week';
  const color = !enough ? '#8a8a8a' : pass ? '#1a7f47' : '#b3261e';

  return (
    <div
      className="card"
      style={{ borderLeft: `4px solid ${color}`, marginBottom: 16, padding: 16 }}
    >
      <strong style={{ color }}>{label}</strong>
      <div style={{ fontSize: 14, marginTop: 6, opacity: 0.85 }}>
        Spearman(depth, cut) = {num(spearman, 3)} across {r.v1_ordering.observationsUsed}{' '}
        observations in {r.v1_ordering.comparableClusters} multi-event regional weeks. Expected
        sign is positive.
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', opacity: 0.6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
      {hint ? <div style={{ fontSize: 12, opacity: 0.6 }}>{hint}</div> : null}
    </div>
  );
}

function Row({ cells, head = false }: { cells: React.ReactNode[]; head?: boolean }) {
  return (
    <tr>
      {cells.map((c, i) => {
        const Tag = head ? 'th' : 'td';
        return (
          <Tag
            key={i}
            style={{
              textAlign: i === 0 ? 'left' : 'right',
              padding: '6px 10px',
              borderBottom: '1px solid rgba(128,128,128,0.2)',
              fontSize: 14,
              whiteSpace: 'nowrap',
            }}
          >
            {c}
          </Tag>
        );
      })}
    </tr>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <Row cells={head} head />
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <Row key={i} cells={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DisciplineBlock({ name, r }: { name: string; r: DisciplineReport }) {
  const c = r.v0_coverage;
  const o = r.v1_ordering;
  const d = r.v3_delta;
  const h = r.v5_heldOut;
  const unit = name === 'doubles' ? 'teams' : 'slots';

  return (
    <section style={{ marginTop: 40 }}>
      <h2 style={{ textTransform: 'capitalize' }}>{name}</h2>
      <Verdict r={r} />

      <h3>V0 — coverage</h3>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '12px 0 20px' }}>
        <Stat label="Observations" value={String(c.observations)} />
        <Stat
          label="With DA cut"
          value={String(c.withDirectAcceptanceCut)}
          hint="before alternates"
        />
        <Stat label="With alternate cut" value={String(c.withAlternateCut)} />
        <Stat
          label="Definitions differ"
          value={String(c.rowsWhereTheTwoDefinitionsDiffer)}
          hint={`drift median ${num(c.alternateDrift.median, 1)}`}
        />
        <Stat
          label="Saturated (excluded)"
          value={String(c.saturatedExcluded)}
          hint={`cut > ${c.saturationThreshold} or list unfilled`}
        />
        <Stat
          label="Geocoded events"
          value={`${c.eventsGeocoded}/${c.eventsTotal}`}
        />
      </div>

      <h3>V1 — within-week ordering (decisive)</h3>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '12px 0 20px' }}>
        <Stat label="Spearman" value={num(o.spearmanOverall, 3)} hint="expected positive" />
        <Stat
          label="Exact order"
          value={pct(o.exactOrderRate)}
          hint={`${o.exactOrderMatches}/${o.comparableClusters} weeks`}
        />
        <Stat
          label="Concordant pairs"
          value={pct(o.concordantPairRate)}
          hint={`${o.concordantPairs} pairs`}
        />
      </div>
      {o.failures.length > 0 ? (
        <details>
          <summary style={{ cursor: 'pointer', marginBottom: 8 }}>
            {o.failures.length} weeks where the ordering did not match exactly
          </summary>
          <Table
            head={['Week', 'Events (depth → cut)']}
            rows={o.failures.slice(0, 20).map((f) => [
              `${f.year} w${f.week}`,
              f.events
                .map((e) => `${e.slug} ${e.level} d=${num(e.depth, 1)} c=${e.cut}`)
                .join('  ·  '),
            ])}
          />
        </details>
      ) : null}

      <h3 style={{ marginTop: 28 }}>V2 — curve stability</h3>
      <Table
        head={['Pool', 'n', 'Total SD', 'Mean within-bin SD', 'Variance ratio']}
        rows={Object.entries(r.v2_curve).map(([pool, v]) => [
          pool,
          v.n,
          num(v.totalSdOfCut, 1),
          num(v.meanWithinBinSd, 1),
          num(v.varianceRatio, 3),
        ])}
      />
      <p style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>
        A variance ratio near 1 means knowing the depth bin tells you as little as knowing
        nothing.
      </p>

      <h3 style={{ marginTop: 28 }}>V3 — Δdepth distribution</h3>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', margin: '12px 0 20px' }}>
        <Stat label="Paired obs" value={String(d.n)} />
        <Stat label="Mean Δ" value={num(d.mean, 2)} hint={unit} />
        <Stat label="SD Δ" value={num(d.sd, 2)} />
        <Stat
          label="|Δ| ≥ 7"
          value={String(d.countAbs7OrMore)}
          hint="hundreds → fit it; dozens → context only"
        />
        <Stat
          label="|Δ| ≥ 3"
          value={String(d.countAbs3OrMore)}
          hint={`${pct(d.shareRestructured)} of weeks`}
        />
      </div>

      <h3 style={{ marginTop: 28 }}>V5 — held-out vs “same cut as last year”</h3>
      <Table
        head={['Cell', 'n', 'Baseline MAE', 'Model MAE', 'Improvement']}
        rows={[
          [
            'Stable weeks',
            h.stable.n,
            num(h.stable.baselineMae, 1),
            num(h.stable.modelMae, 1),
            h.stable.improvementPct == null ? '—' : `${h.stable.improvementPct}%`,
          ],
          [
            'Restructured weeks',
            h.restructured.n,
            num(h.restructured.baselineMae, 1),
            num(h.restructured.modelMae, 1),
            h.restructured.improvementPct == null
              ? '—'
              : `${h.restructured.improvementPct}%`,
          ],
        ]}
      />
      <p style={{ fontSize: 13, opacity: 0.7, marginTop: 8 }}>
        The correction is fitted through the origin, so Δdepth = 0 leaves a prediction
        untouched and stable weeks cannot be degraded by construction.
      </p>

      {r.v4_restructuredWeeks.length > 0 ? (
        <>
          <h3 style={{ marginTop: 28 }}>V4 — largest real restructures</h3>
          <Table
            head={['Event', 'Year', 'Wk', 'Level', 'Depth', 'Prior', 'Δ', 'Cut', 'Prior cut', 'Dir']}
            rows={r.v4_restructuredWeeks.map((w) => [
              w.slug,
              w.year,
              w.week,
              w.level,
              num(w.depthNow, 1),
              num(w.depthPrior, 1),
              num(w.delta, 1),
              w.cutNow,
              w.cutPrior,
              w.directionAgrees ? '✓' : '✗',
            ])}
          />
        </>
      ) : null}
    </section>
  );
}

export default async function DepthPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; week?: string; discipline?: string }>;
}) {
  const { year, week, discipline } = await searchParams;
  const only = discipline === 'singles' || discipline === 'doubles' ? [discipline] : undefined;

  const report = (await runDepthValidation(pool, {
    disciplines: only as Discipline[] | undefined,
    year: year ? Number(year) : undefined,
    week: week ? Number(week) : undefined,
  })) as unknown as Report;

  return (
    <main className="page">
      <p className="eyebrow">Internal · not indexed</p>
      <h1>Competitive depth — validation</h1>
      <p style={{ maxWidth: 760, opacity: 0.85 }}>
        Depth counts acceptance slots at or above an event&apos;s level within travel range in
        the same week. The pool of players in a region is roughly fixed, so fewer slots means
        the same players chasing fewer places — a <strong>tougher cut, a lower rank number</strong>.
        Depth and cut rank move together.
      </p>
      <p style={{ maxWidth: 760, opacity: 0.85 }}>
        This is the gate from Part 2 of the build spec. The weekly calendar table, the
        comparability badge and any Δdepth correction ship only if V1 passes here.{' '}
        <a href="/api/depth-validate">Raw JSON</a>.
      </p>

      <h2 style={{ marginTop: 32 }}>Absorption sanity</h2>
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Slots each above-stack event removes from the Challenger pool, expressed in whole
        Challenger draws. Seeded from draw sizes, not fitted.
      </p>
      <Table
        head={['Level', 'Singles slots', 'in C-draws', 'Doubles teams', 'in C-draws']}
        rows={report.absorptionSanity.map((a) => [
          a.level,
          a.singlesSlotsAbsorbed,
          num(a.singlesInChallengerDraws, 2),
          a.doublesTeamsAbsorbed,
          num(a.doublesInChallengerDraws, 2),
        ])}
      />

      {Object.entries(report.disciplines).map(([name, r]) => (
        <DisciplineBlock key={name} name={name} r={r} />
      ))}

      <p style={{ marginTop: 40, fontSize: 12, opacity: 0.6 }}>
        Generated {report.generatedAt} · region radius {report.regionKm} km
      </p>
    </main>
  );
}
