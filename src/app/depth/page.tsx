import type { Metadata } from 'next';
import Link from 'next/link';
import { pool } from '@/lib/db';
import { buildStrengthView, type StrengthRow } from '@/lib/field-strength-data';
import { BAND_LABEL, BAND_COLOR } from '@/lib/field-strength';
import type { Discipline } from '@/lib/depth';
import { CURRENT_SEASON, AVAILABLE_SEASONS } from '@/lib/seasons';

export const dynamic = 'force-dynamic';

// Hidden surface: not linked from SiteNav, not in the sitemap, noindex.
export const metadata: Metadata = {
  title: 'Field strength — how each event compares to last year',
  robots: { index: false, follow: false },
};

function Pick({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={on ? 'chip chip--on' : 'chip'} prefetch={false}>
      {children}
    </Link>
  );
}

/** Two stacked bars: last year's strength and this year's, on one 0-100 axis.
 * The comparison is the point, so they share a scale and sit adjacent. */
function StrengthBars({ row, year }: { row: StrengthRow; year: number }) {
  const color = row.band ? BAND_COLOR[row.band] : '#8a8a8a';
  const Bar = ({
    value,
    label,
    dim,
    projected = false,
  }: {
    value: number | null;
    label: string;
    dim: boolean;
    projected?: boolean;
  }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
      <span style={{ fontSize: 11, opacity: 0.6, width: 34, textAlign: 'right' }}>{label}</span>
      <div
        style={{
          flex: 1,
          height: 10,
          borderRadius: 5,
          background: 'rgba(128,128,128,0.18)',
          overflow: 'hidden',
          maxWidth: 260,
        }}
      >
        {value != null ? (
          <div
            style={{
              width: `${value}%`,
              height: '100%',
              background: dim ? 'rgba(128,128,128,0.55)' : color,
              opacity: projected ? 0.65 : 1,
            }}
          />
        ) : null}
      </div>
      <span style={{ fontSize: 12, width: 26, fontWeight: dim ? 400 : 600 }}>
        {value ?? '—'}
      </span>
    </div>
  );
  return (
    <div style={{ minWidth: 260 }}>
      <Bar value={row.priorScore} label={String(year - 1).slice(2)} dim />
      <Bar
        value={row.score}
        label={String(year).slice(2)}
        dim={false}
        projected={row.basis === 'projected'}
      />
      {row.basis === 'projected' && row.scoreLow != null && row.scoreHigh != null ? (
        <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2, paddingLeft: 42 }}>
          projected · could land {row.scoreLow}–{row.scoreHigh}
        </div>
      ) : null}
    </div>
  );
}

function Row_({ row, year }: { row: StrengthRow; year: number }) {
  const color = row.band ? BAND_COLOR[row.band] : '#8a8a8a';
  return (
    <li className="card" style={{ padding: 14, marginBottom: 8, display: 'block' }}>
      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ minWidth: 220 }}>
          <strong style={{ fontSize: 16 }}>{row.name}</strong>
          <div style={{ fontSize: 13, opacity: 0.65, marginTop: 2 }}>
            w{row.week} · {row.level}
            {row.levelChanged && row.priorLevel ? (
              <span style={{ color: '#c2691e' }}> · was {row.priorLevel}</span>
            ) : null}
          </div>
        </div>

        <StrengthBars row={row} year={year} />

        <div style={{ minWidth: 150, textAlign: 'right' }}>
          {row.band ? (
            <>
              <div style={{ color, fontWeight: 700, fontSize: 15 }}>
                {row.delta! > 0 ? '↑' : row.delta! < 0 ? '↓' : '='} {BAND_LABEL[row.band]}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {row.delta! > 0 ? '+' : ''}
                {row.delta} pts · cut {row.priorCut} →{' '}
                {row.basis === 'projected' ? '~' : ''}
                {row.cut}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, opacity: 0.6 }}>
              {row.score == null
                ? row.cut == null
                  ? 'Not played yet, no projection'
                  : 'Not enough cuts at this level to score'
                : row.priorCut == null
                  ? 'No cut recorded last year'
                  : '—'}
            </div>
          )}
        </div>
      </div>
      {row.itfNote ? (
        <p
          style={{
            fontSize: 12,
            opacity: 0.75,
            margin: '8px 0 0',
            color: row.itf?.exposure === 'high' ? '#c2691e' : undefined,
          }}
        >
          {row.itfNote}
        </p>
      ) : null}
      {row.levelChanged ? (
        <p style={{ fontSize: 12, opacity: 0.7, margin: '8px 0 0' }}>
          Level changed since last season, so each year is scored against a different
          cohort — the move is not like-for-like.
        </p>
      ) : null}
    </li>
  );
}

export default async function FieldStrengthPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; discipline?: string; draw?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const year =
    sp.year && AVAILABLE_SEASONS.includes(Number(sp.year)) ? Number(sp.year) : CURRENT_SEASON;
  const discipline: Discipline = sp.discipline === 'doubles' ? 'doubles' : 'singles';
  const drawType = sp.draw === 'qualifying' ? 'qualifying' : 'main';
  const sort = sp.sort === 'move' ? 'move' : 'week';

  const view = await buildStrengthView(pool, year, discipline, drawType);
  const rows = [...view.rows];
  if (sort === 'move') {
    rows.sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity));
  }

  const qs = (o: Record<string, string | number>) =>
    `/depth?${new URLSearchParams({
      year: String(year),
      discipline,
      draw: drawType,
      sort,
      ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])),
    }).toString()}`;

  return (
    <main className="page">
      <p className="eyebrow">Internal preview</p>
      <h1>Field strength vs last year</h1>
      <p style={{ maxWidth: 730, opacity: 0.85 }}>
        Every event scored <strong>0–100</strong> against every other cut ever recorded at its
        own level. <strong>100</strong> is the strongest field on record for that level,{' '}
        <strong>50</strong> is a completely typical edition, <strong>0</strong> is the weakest.
        Scoring within level is what makes an ATP 250 and a Challenger 75 comparable.
      </p>
      <p style={{ maxWidth: 730, opacity: 0.85 }}>
        Events already played are <strong>measured</strong> from their real cut. Events still
        to come are <strong>projected</strong> from the nightly cut model, shown faded with the
        range they could land in — that is the number to plan against, and it is the least
        certain thing here. Challenger, ATP and Grand Slam only, since ITF cuts are not
        collected.
      </p>

      <div className="chip-row" style={{ marginTop: 20 }}>
        {AVAILABLE_SEASONS.map((y) => (
          <Pick key={y} href={qs({ year: y })} on={y === year}>
            {y}
          </Pick>
        ))}
      </div>
      <div className="chip-row" style={{ marginTop: 8 }}>
        <Pick href={qs({ discipline: 'singles', draw: 'main' })} on={discipline === 'singles' && drawType === 'main'}>
          Singles main
        </Pick>
        <Pick href={qs({ discipline: 'singles', draw: 'qualifying' })} on={discipline === 'singles' && drawType === 'qualifying'}>
          Singles qualifying
        </Pick>
        <Pick href={qs({ discipline: 'doubles', draw: 'main' })} on={discipline === 'doubles'}>
          Doubles
        </Pick>
      </div>
      <div className="chip-row" style={{ marginTop: 8 }}>
        <Pick href={qs({ sort: 'week' })} on={sort === 'week'}>
          By week
        </Pick>
        <Pick href={qs({ sort: 'move' })} on={sort === 'move'}>
          Biggest movers
        </Pick>
      </div>

      <p style={{ marginTop: 20, fontSize: 13, opacity: 0.7 }}>
        {view.counts.total} events · {view.counts.scored} scored ·{' '}
        {view.counts.compared} with a {year - 1} cut to compare against ·{' '}
        {view.counts.projected} projected
        {view.unscoredLevels.length > 0
          ? ` · too few cuts to score: ${view.unscoredLevels.join(', ')}`
          : ''}
      </p>

      {view.seasonMedianDelta != null ? (
        <p
          className="card"
          style={{ padding: 12, fontSize: 13, marginTop: 12, maxWidth: 730 }}
        >
          <strong>
            The whole calendar moved {view.seasonMedianDelta > 0 ? '+' : ''}
            {view.seasonMedianDelta} points this season.
          </strong>{' '}
          Fields drift tour-wide, so an event that moved by about this much held its
          position rather than genuinely changing. Read each row against this number, not
          against zero.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p style={{ opacity: 0.7, marginTop: 20 }}>No cuts recorded for {year} yet.</p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: '16px 0 0' }}>
          {rows.map((r) => (
            <Row_ key={`${r.slug}-${r.week}`} row={r} year={year} />
          ))}
        </ol>
      )}

      <p style={{ marginTop: 32, fontSize: 13, opacity: 0.7, maxWidth: 730 }}>
        A score compares an event only with its own level, so a Challenger 75 at 80 had a
        strong field <em>for a Challenger 75</em> — not a stronger field than an ATP 250 at 60.{' '}
        <Link href="/depth/validation">Validation</Link>.
      </p>
    </main>
  );
}
