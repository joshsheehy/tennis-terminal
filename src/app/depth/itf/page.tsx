import type { Metadata } from 'next';
import Link from 'next/link';
import { pool } from '@/lib/db';
import { runItfBacktest } from '@/lib/itf-backtest';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const metadata: Metadata = {
  title: 'ITF drain — does it move a Challenger cut?',
  robots: { index: false, follow: false },
};

type Summary = {
  n: number;
  note?: string;
  meanDeltaItf?: number | null;
  sdDeltaItf?: number | null;
  spearman?: number | null;
  beta?: number | null;
};

type HeldOut = {
  n: number;
  baselineMae: number | null;
  modelMae: number | null;
  improvementPct: number | null;
};

type Block = {
  overall: Summary;
  heldOut: HeldOut;
  byExposure: Record<string, Summary & { heldOut: HeldOut }>;
  weeksWhereItfSupplyChanged: Summary & { share: number | null };
};

const n = (v: number | null | undefined, dp = 3) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(dp);

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                style={{
                  textAlign: i === 0 ? 'left' : 'right',
                  padding: '6px 10px',
                  borderBottom: '1px solid rgba(128,128,128,0.3)',
                  whiteSpace: 'nowrap',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td
                  key={j}
                  style={{
                    textAlign: j === 0 ? 'left' : 'right',
                    padding: '6px 10px',
                    borderBottom: '1px solid rgba(128,128,128,0.15)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Verdict({ b }: { b: Block }) {
  const s = b.overall.spearman;
  const imp = b.heldOut.improvementPct;
  const enough = b.overall.n >= 50;
  // Predicted POSITIVE: more ITF nearby means a higher (weaker) cut.
  const rightSign = s != null && s > 0.05;
  const helps = imp != null && imp > 1;
  const pass = enough && rightSign && helps;
  const wrongWay = enough && s != null && s < -0.05;

  const label = !enough
    ? 'NOT ENOUGH DATA'
    : pass
      ? 'SHIP IT — right sign and it beats the baseline'
      : wrongWay
        ? 'DO NOT SHIP — effect runs the OPPOSITE way to the mechanism'
        : rightSign
          ? 'DO NOT SHIP — right sign, but no held-out improvement'
          : 'DO NOT SHIP — no measurable effect';
  const color = !enough ? '#8a8a8a' : pass ? '#1a7f47' : '#b3261e';

  return (
    <div className="card" style={{ borderLeft: `4px solid ${color}`, padding: 14, margin: '12px 0' }}>
      <strong style={{ color }}>{label}</strong>
      <div style={{ fontSize: 13, opacity: 0.85, marginTop: 6 }}>
        Spearman(Δ ITF places, Δ log cut) = {n(s)} over {b.overall.n} paired seasons ·
        held-out MAE {n(b.heldOut.baselineMae, 1)} → {n(b.heldOut.modelMae, 1)} (
        {imp == null ? '—' : `${imp}%`})
      </div>
    </div>
  );
}

export default async function ItfValidationPage() {
  const report = (await runItfBacktest(pool)) as unknown as {
    mechanism: string;
    singles: Block;
    doubles: Block;
  };

  return (
    <main className="page">
      <p className="eyebrow">Internal · not indexed</p>
      <h1>Does ITF supply drain a Challenger field?</h1>
      <p style={{ maxWidth: 740, opacity: 0.85 }}>{report.mechanism}</p>
      <p style={{ maxWidth: 740, opacity: 0.85, fontSize: 14 }}>
        A cut is set by the Nth best entrant, so losing players ranked worse than the cut
        cannot move it. ITF fields draw roughly the 250–700 band, so the effect should be
        concentrated in <strong>high</strong> exposure (Challenger 50/75/80) and near absent
        in <strong>low</strong> (Challenger 100/125). A uniform effect across both would
        suggest something else is being fitted.
      </p>

      {(['singles', 'doubles'] as const).map((d) => {
        const b = report[d];
        return (
          <section key={d} style={{ marginTop: 32 }}>
            <h2 style={{ textTransform: 'capitalize' }}>{d}</h2>
            <Verdict b={b} />

            <h3>By level exposure</h3>
            <Table
              head={['Exposure', 'n', 'Spearman', 'β', 'Baseline MAE', 'Model MAE', 'Change']}
              rows={(['high', 'low'] as const).map((ex) => {
                const e = b.byExposure[ex];
                return [
                  ex === 'high' ? 'high — C50/75/80' : 'low — C100/125',
                  e?.n ?? 0,
                  n(e?.spearman),
                  n(e?.beta, 5),
                  n(e?.heldOut?.baselineMae, 1),
                  n(e?.heldOut?.modelMae, 1),
                  e?.heldOut?.improvementPct == null
                    ? '—'
                    : `${e.heldOut.improvementPct}%`,
                ];
              })}
            />

            <h3 style={{ marginTop: 24 }}>Weeks where ITF supply actually changed</h3>
            <p style={{ fontSize: 13, opacity: 0.7 }}>
              Only these can carry signal — everywhere else Δ is zero and adds noise.
            </p>
            <Table
              head={['n', 'share of all', 'mean Δ places', 'sd', 'Spearman', 'β']}
              rows={[
                [
                  b.weeksWhereItfSupplyChanged.n,
                  b.weeksWhereItfSupplyChanged.share == null
                    ? '—'
                    : `${Math.round(b.weeksWhereItfSupplyChanged.share * 100)}%`,
                  n(b.weeksWhereItfSupplyChanged.meanDeltaItf, 1),
                  n(b.weeksWhereItfSupplyChanged.sdDeltaItf, 1),
                  n(b.weeksWhereItfSupplyChanged.spearman),
                  n(b.weeksWhereItfSupplyChanged.beta, 5),
                ],
              ]}
            />
          </section>
        );
      })}

      <p style={{ marginTop: 32, fontSize: 13, opacity: 0.7 }}>
        Nothing here changes a projection. The ITF drain is only wired into the model if the
        sign matches the mechanism and it beats the baseline on held-out seasons.{' '}
        <Link href="/depth">Back to field strength</Link>.
      </p>
    </main>
  );
}
