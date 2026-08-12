import type { Metadata } from 'next';
import Link from 'next/link';
import { pool } from '@/lib/db';
import { buildStrengthView, type StrengthRow } from '@/lib/field-strength-data';
import type { Discipline } from '@/lib/depth';
import { CURRENT_SEASON, AVAILABLE_SEASONS } from '@/lib/seasons';

export const dynamic = 'force-dynamic';

// Hidden surface: not linked from SiteNav, not in the sitemap, noindex.
export const metadata: Metadata = {
  title: 'Stronger or weaker than last year',
  robots: { index: false, follow: false },
};

// THE ONLY QUESTION THIS PAGE ANSWERS
//
// Will this tournament's field be stronger or weaker than last year's?
//
// An earlier version scored every event 0-100 against every cut ever recorded
// at its level. That was solving a problem nobody has: a percentile makes an
// ATP 250 comparable with a Challenger 75, but the comparison people actually
// make is an event against ITSELF a year ago — same event, same level. For that
// the cut numbers already compare directly, and #312 -> #394 says more to a
// tennis player than "98/100" ever could. The scale has been removed.

/** How much the cut moved, as a share of last year's. Relative rather than
 * absolute because 50 places at a Challenger 50 (cuts near 450) is ordinary,
 * while 50 places at a Challenger 125 (cuts near 150) is a different event. */
type Verdict = {
  label: string;
  detail: string;
  color: string;
} | null;

function verdictFor(row: StrengthRow): Verdict {
  if (row.cut == null || row.priorCut == null) return null;

  // A projection whose bounds span a huge cut range cannot support a direction.
  if (row.basis === 'projected' && row.scoreLow != null && row.scoreHigh != null) {
    if (row.scoreHigh - row.scoreLow > 40) return null;
  }

  const move = row.cut - row.priorCut;
  const share = Math.abs(move) / row.priorCut;
  const places = Math.abs(move);

  if (share < 0.1) {
    return {
      label: 'About the same',
      detail: `${places} places different`,
      color: '#8a8a8a',
    };
  }
  // A LOWER cut means better players got in: a stronger field, harder to enter.
  const stronger = move < 0;
  const much = share >= 0.25 ? 'Much ' : '';
  return {
    label: stronger ? `${much}stronger field` : `${much}weaker field`,
    detail: stronger
      ? `${places} places tougher to get in`
      : `${places} places easier to get in`,
    color: stronger ? '#b3261e' : '#1a7f47',
  };
}

function Pick({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={on ? 'chip chip--on' : 'chip'} prefetch={false}>
      {children}
    </Link>
  );
}

function Row_({ row, year }: { row: StrengthRow; year: number }) {
  const v = verdictFor(row);
  const projected = row.basis === 'projected';

  return (
    <li className="card" style={{ padding: 14, marginBottom: 8, display: 'block' }}>
      <div
        style={{
          display: 'flex',
          gap: 20,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ minWidth: 230 }}>
          <strong style={{ fontSize: 16 }}>{row.name}</strong>
          <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>
            w{row.week} · {row.level}
            {row.levelChanged && row.priorLevel ? ` · was ${row.priorLevel}` : ''}
          </div>
        </div>

        <div style={{ fontSize: 15, minWidth: 200 }}>
          <span style={{ opacity: 0.6 }}>{year - 1} cut </span>
          <strong>#{row.priorCut ?? '—'}</strong>
          <span style={{ opacity: 0.6 }}> → {year} </span>
          <strong>
            {row.cut == null ? '—' : `${projected ? '~#' : '#'}${row.cut}`}
          </strong>
        </div>

        <div style={{ minWidth: 190, textAlign: 'right' }}>
          {v ? (
            <>
              <div style={{ color: v.color, fontWeight: 700, fontSize: 15 }}>{v.label}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{v.detail}</div>
              {projected ? (
                <div style={{ fontSize: 11, opacity: 0.55 }}>projected, not played yet</div>
              ) : null}
            </>
          ) : (
            <div style={{ fontSize: 13, opacity: 0.55 }}>
              {row.priorCut == null
                ? `No ${year - 1} cut to compare`
                : row.cut == null
                  ? 'No projection yet'
                  : 'Too uncertain to call'}
            </div>
          )}
        </div>
      </div>

      {row.levelChanged ? (
        <p style={{ fontSize: 12, opacity: 0.65, margin: '8px 0 0' }}>
          Changed level since last season, so the two cuts are not like-for-like.
        </p>
      ) : null}
    </li>
  );
}

export default async function StrongerOrWeakerPage({
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
    const size = (r: StrengthRow) =>
      r.cut != null && r.priorCut != null ? Math.abs(r.cut - r.priorCut) / r.priorCut : -1;
    rows.sort((a, b) => size(b) - size(a));
  }

  const qs = (o: Record<string, string | number>) =>
    `/depth?${new URLSearchParams({
      year: String(year),
      discipline,
      draw: drawType,
      sort,
      ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])),
    }).toString()}`;

  const comparable = rows.filter((r) => verdictFor(r) != null).length;

  return (
    <main className="page">
      <p className="eyebrow">Internal preview</p>
      <h1>Stronger or weaker than last year</h1>
      <p style={{ maxWidth: 700, opacity: 0.85 }}>
        Each event&apos;s cut this year against the same event last year. A{' '}
        <strong>lower cut means a stronger field</strong> — better players entered, so it was
        harder to get in.
      </p>

      <div className="chip-row" style={{ marginTop: 20 }}>
        {AVAILABLE_SEASONS.map((y) => (
          <Pick key={y} href={qs({ year: y })} on={y === year}>
            {y}
          </Pick>
        ))}
      </div>
      <div className="chip-row" style={{ marginTop: 8 }}>
        <Pick
          href={qs({ discipline: 'singles', draw: 'main' })}
          on={discipline === 'singles' && drawType === 'main'}
        >
          Singles
        </Pick>
        <Pick
          href={qs({ discipline: 'singles', draw: 'qualifying' })}
          on={discipline === 'singles' && drawType === 'qualifying'}
        >
          Qualifying
        </Pick>
        <Pick href={qs({ discipline: 'doubles', draw: 'main' })} on={discipline === 'doubles'}>
          Doubles
        </Pick>
        <span className="chip-row__spacer" />
        <Pick href={qs({ sort: 'week' })} on={sort === 'week'}>
          By week
        </Pick>
        <Pick href={qs({ sort: 'move' })} on={sort === 'move'}>
          Biggest movers
        </Pick>
      </div>

      <p style={{ marginTop: 18, fontSize: 13, opacity: 0.65 }}>
        {comparable} of {rows.length} events can be compared with {year - 1}
        {view.counts.projected > 0 ? ` · ${view.counts.projected} still projected` : ''}
      </p>

      {rows.length === 0 ? (
        <p style={{ opacity: 0.7, marginTop: 20 }}>Nothing recorded for {year} yet.</p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: '16px 0 0' }}>
          {rows.map((r) => (
            <Row_ key={`${r.slug}-${r.week}`} row={r} year={year} />
          ))}
        </ol>
      )}

      <p style={{ marginTop: 28, fontSize: 13, opacity: 0.65, maxWidth: 700 }}>
        Events already played show their real cut. Events still to come show the nightly
        model&apos;s projection, marked <code>~</code>. Where that projection is too uncertain
        to point either way, the row says so rather than guessing a direction.
      </p>
    </main>
  );
}
