import type { Metadata } from 'next';
import Link from 'next/link';
import { pool } from '@/lib/db';
import { buildWeekView, type WeekEntry } from '@/lib/depth-week';
import type { Discipline } from '@/lib/depth';
import { CURRENT_SEASON, AVAILABLE_SEASONS } from '@/lib/seasons';
import { getAtpWeekForSeason } from '@/lib/atp-week';

export const dynamic = 'force-dynamic';

// Hidden surface: not linked from SiteNav, not in the sitemap, noindex.
export const metadata: Metadata = {
  title: 'Week competition — which events are easiest to enter',
  robots: { index: false, follow: false },
};

function Pick({
  href,
  on,
  children,
}: {
  href: string;
  on: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={on ? 'chip chip--on' : 'chip'} prefetch={false}>
      {children}
    </Link>
  );
}

function Entry({
  entry,
  rank,
  total,
  unit,
}: {
  entry: WeekEntry;
  rank: number;
  total: number;
  unit: string;
}) {
  // Easiest is rank 1. With only one event there is nothing to compare against.
  const band =
    total < 2 ? null : rank === 1 ? 'Easiest to enter' : rank === total ? 'Hardest to enter' : null;
  const bandColor = rank === 1 ? '#1a7f47' : '#b3261e';

  return (
    <li
      className="card"
      style={{ padding: 16, marginBottom: 10, display: 'block' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'baseline',
        }}
      >
        <div>
          <strong style={{ fontSize: 17 }}>{entry.name}</strong>
          <span style={{ marginLeft: 10, opacity: 0.7, fontSize: 14 }}>
            {entry.level} · {entry.surface}
            {entry.indoor ? ' (indoor)' : ''}
          </span>
        </div>
        {band ? (
          <span style={{ color: bandColor, fontWeight: 600, fontSize: 13 }}>{band}</span>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>≈{entry.spotsNearby}</div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>
            {unit} within reach at this level or better
          </div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 600 }}>
            {entry.lastYearCut ?? '—'}
          </div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>
            last year&apos;s cut
            {entry.lastYearLevel && entry.lastYearLevel !== entry.level
              ? ` (was ${entry.lastYearLevel})`
              : ''}
          </div>
        </div>
        {entry.thisYearCut != null ? (
          <div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{entry.thisYearCut}</div>
            <div style={{ fontSize: 12, opacity: 0.65 }}>this year&apos;s cut</div>
          </div>
        ) : null}
      </div>

      <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 14, opacity: 0.8 }}>
        {entry.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </li>
  );
}

export default async function DepthPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; week?: string; discipline?: string }>;
}) {
  const sp = await searchParams;
  const year =
    sp.year && AVAILABLE_SEASONS.includes(Number(sp.year))
      ? Number(sp.year)
      : CURRENT_SEASON;
  const discipline: Discipline = sp.discipline === 'doubles' ? 'doubles' : 'singles';
  const thisWeek = getAtpWeekForSeason(new Date(), year) ?? 1;
  const week = sp.week ? Number(sp.week) : thisWeek;

  const view = await buildWeekView(pool, year, week, discipline);
  // buildWeekView snaps to the nearest week that actually holds events, so the
  // pickers and heading must follow the resolved week, not the requested one.
  const qs = (o: Record<string, string | number>) =>
    `/depth?${new URLSearchParams({
      year: String(year),
      week: String(view.week),
      discipline,
      ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])),
    }).toString()}`;

  return (
    <main className="page">
      <p className="eyebrow">Internal preview</p>
      <h1>Which events are easiest to enter?</h1>
      <p style={{ maxWidth: 720, opacity: 0.85 }}>
        For one week, events that draw on the same players are grouped together and ranked.
        The more places there are nearby at your level or better, the thinner the field
        spreads — and the easier the event is to get into.
      </p>

      <div className="chip-row" style={{ marginTop: 20 }}>
        {AVAILABLE_SEASONS.map((y) => (
          <Pick key={y} href={qs({ year: y })} on={y === year}>
            {y}
          </Pick>
        ))}
      </div>
      <div className="chip-row" style={{ marginTop: 8 }}>
        <Pick href={qs({ discipline: 'singles' })} on={discipline === 'singles'}>
          Singles
        </Pick>
        <Pick href={qs({ discipline: 'doubles' })} on={discipline === 'doubles'}>
          Doubles
        </Pick>
      </div>
      <div className="chip-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        {view.availableWeeks.map((w) => (
          <Pick key={w} href={qs({ week: w })} on={w === view.week}>
            w{w}
          </Pick>
        ))}
      </div>

      <h2 style={{ marginTop: 28 }}>
        Week {view.week}, {year} · {discipline}
      </h2>

      {view.regions.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No events recorded for this week.</p>
      ) : (
        view.regions.map((region) => (
          <section key={region.label} style={{ marginTop: 24 }}>
            <h3>{region.label}</h3>
            <ol style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
              {region.entries.map((e, i) => (
                <Entry
                  key={e.slug}
                  entry={e}
                  rank={i + 1}
                  total={region.entries.length}
                  unit={view.unit}
                />
              ))}
            </ol>
          </section>
        ))
      )}

      <div style={{ marginTop: 40, fontSize: 13, opacity: 0.7, maxWidth: 720 }}>
        <p>
          <strong>What this does not tell you.</strong> The ranking compares events against
          each other <em>inside one week</em>, which is the only claim the data supports. It
          does not predict a cut, and it deliberately does not say whether a cut will be
          tougher or easier than last year&apos;s — that was tested against 685 paired
          seasons and added nothing. Last year&apos;s cut is shown as a fact to anchor
          against, not as a forecast.
        </p>
        <p>
          Place counts are estimates from standard draw sizes per level, not from published
          entry lists. <Link href="/depth/validation">See the validation</Link>.
        </p>
      </div>
    </main>
  );
}
