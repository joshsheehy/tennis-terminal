import type { Metadata } from 'next';
import Link from 'next/link';
import { pool } from '@/lib/db';
import { buildStrengthView, type StrengthRow } from '@/lib/field-strength-data';
import {
  BAND_LABEL,
  BAND_FIELD_LABEL,
  BAND_COLOR,
  scoreMeaning,
  entryMeaning,
} from '@/lib/field-strength';
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
                {BAND_LABEL[row.band]}
              </div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                {BAND_FIELD_LABEL[row.band]} than {year - 1}
              </div>
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
                cut #{row.priorCut} → {row.basis === 'projected' ? '~#' : '#'}
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
      {row.score != null ? (
        <p style={{ fontSize: 12, opacity: 0.75, margin: '10px 0 0' }}>
          <strong>{row.score}/100</strong> — {scoreMeaning(row.score, row.level)}.{' '}
          {entryMeaning(row.score)[0].toUpperCase() + entryMeaning(row.score).slice(1)}
          {row.basis === 'projected' ? ', on this year\u2019s projection' : ''}.
        </p>
      ) : null}
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
        Each event gets a <strong>strength score out of 100</strong>. It answers one question:{' '}
        <em>how good was the field compared with every other edition of this same level we
        have on record?</em>
      </p>

      <div className="card" style={{ padding: 16, marginTop: 16, maxWidth: 730 }}>
        <div
          style={{
            height: 14,
            borderRadius: 7,
            background: 'linear-gradient(90deg,#0f6b3a 0%,#8a8a8a 50%,#b3261e 100%)',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
          {[
            ['0', 'Weakest field', 'easiest to get into'],
            ['50', 'Totally normal', 'for this level'],
            ['100', 'Strongest field', 'hardest to get into'],
          ].map(([n, a, b], i) => (
            <div
              key={n}
              style={{
                textAlign: i === 0 ? 'left' : i === 1 ? 'center' : 'right',
                fontSize: 12,
                lineHeight: 1.35,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 15 }}>{n}</div>
              <div>{a}</div>
              <div style={{ opacity: 0.6 }}>{b}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 13, marginTop: 14, marginBottom: 0, opacity: 0.85 }}>
          <strong>Higher always means a stronger field.</strong> A 75 had a better field than
          a 52 — more good players entered, so the cut was lower and it was harder to get in.
          A score is only ever compared with the same level, so a Challenger 75 scoring 80 was
          strong <em>for a Challenger 75</em> — it does not mean it was stronger than an ATP
          250 scoring 60.
        </p>
        <p style={{ fontSize: 13, marginTop: 10, marginBottom: 0, opacity: 0.85 }}>
          <span style={{ color: '#1a7f47', fontWeight: 700 }}>Green</span> means the event got{' '}
          <strong>easier to get into</strong> than last year — the opening you can use.{' '}
          <span style={{ color: '#b3261e', fontWeight: 700 }}>Red</span> means it got tougher.
        </p>
      </div>
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
