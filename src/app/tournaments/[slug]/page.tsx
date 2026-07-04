import type { Metadata } from 'next';
import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import CutTrendChart, { type CutTrendPoint, type CutTrendSeries } from '@/components/CutTrendChart';
import { getTournamentDetailRowsBySlug, getItfPriorYearCutEditions } from '@/lib/db';
import { CutoffSnapshot } from '@/lib/types';
import { ALL_EDITIONS } from '@/lib/tournament-data';
import { CURRENT_SEASON, EARLIEST_SEASON, isAvailableSeason } from '@/lib/seasons';
import { SITE_NAME, SITE_URL } from '@/lib/brand';

// Look up the most recent protennislive_code we know for a slug, so the
// CutoffTable can render a "PDF source" link even when no cuts snapshot
// exists yet (or the PDF doesn't carry a LAST DIRECT ACCEPTANCE line).
function getProtennislivCodeForSlug(slug: string): string | null {
  let bestCode: string | null = null;
  let bestYear = -Infinity;
  for (const entry of ALL_EDITIONS) {
    if (entry.tournament.slug !== slug) continue;
    if (!entry.edition.protennislive_code) continue;
    if (entry.edition.year > bestYear) {
      bestYear = entry.edition.year;
      bestCode = entry.edition.protennislive_code;
    }
  }
  return bestCode;
}

function fallbackPdfUrl(
  code: string,
  year: number,
  event: 'singles' | 'doubles',
  draw: 'main' | 'qualifying'
): string {
  const base = `https://www.protennislive.com/posting/${year}/${code}`;
  if (event === 'singles' && draw === 'main') return `${base}/mds.pdf`;
  if (event === 'singles' && draw === 'qualifying') return `${base}/qs.pdf`;
  if (event === 'doubles' && draw === 'main') return `${base}/mdd.pdf`;
  return `${base}/qdd.pdf`;
}

function isGrandSlamLevel(level: string): boolean {
  return level.toLowerCase().includes('grand slam');
}

// Official ProTennisLive tournament fact/detail sheet for a given year.
// Pattern: /posting/{year}/{code}/ds.pdf — same code we already store for the
// draw sheets, just a different filename. One per edition/year.
function detailSheetUrl(code: string, year: number): string {
  return `https://www.protennislive.com/posting/${year}/${code}/ds.pdf`;
}

// Detail sheets only exist for ATP Tour and Challenger events (ProTennisLive
// postings). Grand Slams, ITF, and team events (Cups/Finals) have no ds.pdf.
function isAtpTourLevel(level: string): boolean {
  return /\batp\s*(250|500|1000)\b/i.test(level);
}
function levelGetsDetailSheet(level: string): boolean {
  return isChallengerLevel(level) || isAtpTourLevel(level);
}

// Recover the ProTennisLive code for an edition. Prefer the static catalogue
// (stable code per slug); fall back to the code embedded in the DB source_url
// for tournaments discovered from the calendar (e.g. post-September challengers
// that aren't in tournament-data.ts).
function resolveProTennisLiveCode(slug: string, sourceUrl: string | null | undefined): string | null {
  const fromCatalogue = getProtennislivCodeForSlug(slug);
  if (fromCatalogue) return fromCatalogue;
  const m = (sourceUrl ?? '').match(/protennislive\.com\/posting\/\d{4}\/(\d+)/i);
  return m ? m[1] : null;
}

// Grand Slams have no protennislive draw-sheet, so the standard PTL fallback
// link doesn't apply. Instead link each draw to its Wikipedia bracket
// article, which is deterministic per (year, slam, event/draw), shows the
// full draw, and exists for every season — far more reliable than the
// official slam SPAs, which have no stable historical URLs.
function grandSlamWikipediaBase(slug: string): string | null {
  if (slug.startsWith('australian-open')) return 'Australian Open';
  if (slug.startsWith('roland-garros')) return 'French Open';
  if (slug.startsWith('wimbledon')) return 'Wimbledon Championships';
  if (slug.startsWith('us-open')) return 'US Open';
  return null;
}

function grandSlamDrawUrl(
  slug: string,
  year: number,
  event: 'singles' | 'doubles',
  draw: 'main' | 'qualifying'
): string | null {
  const base = grandSlamWikipediaBase(slug);
  if (!base) return null;
  const suffix =
    draw === 'qualifying'
      ? "Men's singles qualifying"
      : event === 'doubles'
        ? "Men's doubles"
        : "Men's singles";
  const title = `${year} ${base} – ${suffix}`.replace(/ /g, '_');
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;
}

function formatDate(dateString: string | null) {
  if (!dateString) return 'NA';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(dateString));
}

function displayName(name: string): string {
  return name.replace(/,\s*[A-Z]{2}$/, '');
}

function isChallengerLevel(level: string) {
  return level.toLowerCase().includes('challenger');
}

function isItfLevel(level: string) {
  return level.toLowerCase().startsWith('itf');
}

function fallback(value: string | number | null | undefined, placeholder = 'N/A') {
  if (value === null || value === undefined) return placeholder;
  const text = String(value).trim();
  return text.length === 0 ? placeholder : text;
}

function editionSummary(edition: {
  start_date: string | null;
  end_date?: string | null;
  week: number | null;
  level: string;
  surface: string;
  status: string;
}) {
  const dateRange = edition.start_date
    ? edition.end_date
      ? `${formatDate(edition.start_date)} – ${formatDate(edition.end_date)}`
      : formatDate(edition.start_date)
    : 'N/A';
  const week = `Week ${fallback(edition.week)}`;
  const level = fallback(edition.level);
  const surface = fallback(edition.surface);
  return `${dateRange} · ${week} · ${level} · ${surface}`;
}

function rankText(rank: number | null) {
  return rank ? String(rank) : '—';
}

function challengerDoublesCutText(cutoff: CutoffSnapshot) {
  const advance = cutoff.challenger_doubles_advanced_cut_rank;
  const onsite = cutoff.challenger_doubles_onsite_cut_rank;

  if (advance && onsite) return `Adv ${advance} / on-site ${onsite}`;
  if (advance) return `Adv ${advance}`;
  if (onsite) return `on-site ${onsite}`;
  return rankText(cutoff.last_direct_acceptance_rank);
}

function altLlText(cutoff: CutoffSnapshot) {
  const alt = cutoff.alternate_entries_count ?? 0;
  const ll = cutoff.lucky_loser_count ?? 0;
  return `${alt} ALT / ${ll} LL`;
}

function sourceHref(cutoff: CutoffSnapshot) {
  const notes = cutoff.source_notes ?? '';
  const match = notes.match(/https:\/\/[^\s|]+\.pdf/i);
  return match?.[0] ?? null;
}

function isTombstone(cutoff: CutoffSnapshot) {
  return cutoff.source_notes === 'PDF_NOT_FOUND';
}

function isInvitationOnlyLevel(level: string): boolean {
  const t = level.toLowerCase();
  return (
    t.includes('laver cup') ||
    t.includes('united cup') ||
    t.includes('davis cup') ||
    t.includes('atp finals') ||
    t.includes('next gen')
  );
}

type DrawKey = 'singles_main' | 'singles_qualifying' | 'doubles_main' | 'doubles_qualifying';

function expectedDrawsForLevel(level: string): DrawKey[] {
  const draws: DrawKey[] = ['singles_main', 'singles_qualifying', 'doubles_main'];
  if (level === 'ATP 500') draws.push('doubles_qualifying');
  return draws;
}

function findCutoff(cutoffs: CutoffSnapshot[], event: 'singles' | 'doubles', draw: 'main' | 'qualifying') {
  return cutoffs.find((c) => c.event_type === event && c.draw_type === draw) ?? null;
}

function drawLabel(draw: DrawKey): string {
  switch (draw) {
    case 'singles_main': return 'Singles main';
    case 'singles_qualifying': return 'Singles qualifying';
    case 'doubles_main': return 'Doubles main';
    case 'doubles_qualifying': return 'Doubles qualifying';
  }
}

// ITF cut display. The 2025 ITF strength sheet gives a main-draw cut (always a
// rank) and a qualifying cut (a rank, or "Unranked"/"National ranking"/"Draw
// not full") plus the number of byes in qualifying. No alts/lucky-losers.
function itfCutText(c: CutoffSnapshot | null): string {
  if (!c) return '—';
  if (c.last_direct_acceptance_rank != null) {
    const itf = (c.source_notes ?? '').includes('ITF World Ranking');
    return `${itf ? 'ITF ' : ''}#${c.last_direct_acceptance_rank}`;
  }
  const n = c.source_notes ?? '';
  if (n.includes('draw was not full')) return 'Draw not full';
  if (n.includes('unranked')) return 'Unranked';
  if (n.includes('national ranking')) return 'National ranking';
  return '—';
}

function ItfCutoffTable({ cutoffs, year }: { cutoffs: CutoffSnapshot[]; year: number }) {
  const sm = findCutoff(cutoffs, 'singles', 'main');
  const sq = findCutoff(cutoffs, 'singles', 'qualifying');
  const hasData =
    (sm?.last_direct_acceptance_rank != null) ||
    (sq != null && (sq.last_direct_acceptance_rank != null || sq.qualifying_byes_count != null));

  if (!hasData) {
    return (
      <div className="muted-panel">
        ITF World Tennis Tour event — no cut data on record for {year}. (2025
        cutoffs are imported from the official ITF strength sheet; other seasons
        aren&apos;t published in that format.)
      </div>
    );
  }

  const byes = sq?.qualifying_byes_count ?? null;
  const rows: Array<{ label: string; value: string; sub?: string }> = [
    { label: 'Singles main', value: itfCutText(sm) },
    {
      label: 'Singles qualifying',
      value: itfCutText(sq),
      sub: byes != null ? `${byes} ${byes === 1 ? 'bye' : 'byes'} in qualifying` : undefined,
    },
  ];

  return (
    <div className="cut-table">
      <div className="cut-table__head">
        <span>Draw</span>
        <span>Cut</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="cut-table__row">
          <div className="cut-table__label">{r.label}</div>
          <div className="cut-table__right">
            <div className="cut-value">{r.value}</div>
            {r.sub && <div className="cut-sub">{r.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function CutoffTable({
  cutoffs,
  level,
  slug,
  year,
}: {
  cutoffs: CutoffSnapshot[];
  level: string;
  slug: string;
  year: number;
}) {
  const ptlCode = getProtennislivCodeForSlug(slug);
  if (isInvitationOnlyLevel(level)) {
    return (
      <div className="muted-panel">
        Invitation-only / team format — no ranking-based cutoff applies.
      </div>
    );
  }

  if (isItfLevel(level)) {
    return <ItfCutoffTable cutoffs={cutoffs} year={year} />;
  }

  const isChallenger = isChallengerLevel(level);
  const expected = expectedDrawsForLevel(level);

  return (
    <div className="cut-table">
      {/* Header */}
      <div className="cut-table__head">
        <span>Draw</span>
        <span>Cut · ALT/LL</span>
      </div>

      {/* Rows */}
      {expected.map((draw) => {
        const [eventType, drawType] = draw.split('_') as ['singles' | 'doubles', 'main' | 'qualifying'];
        const cutoff = findCutoff(cutoffs, eventType, drawType);
        const tombstoned = cutoff ? isTombstone(cutoff) : false;
        // Prefer the URL embedded in source_notes by the importer / set-cut.
        // If the row was never created (cuts not yet imported, no PDF found)
        // or its source_notes lacks a URL, fall back to the canonical
        // ProTennisLive draw-sheet URL derived from the tournament's
        // protennislive_code — viewers can still open the official draw even
        // when we don't have a cut number yet.
        const snapshotHref = cutoff ? sourceHref(cutoff) : null;
        const isGS = isGrandSlamLevel(level);
        const href = snapshotHref
          ?? (isGS
            ? grandSlamDrawUrl(slug, year, eventType, drawType)
            : ptlCode && !tombstoned
              ? fallbackPdfUrl(ptlCode, year, eventType, drawType)
              : null);
        const hasRank =
          cutoff !== null &&
          (cutoff.last_direct_acceptance_rank !== null ||
            cutoff.last_alternate_rank !== null ||
            cutoff.challenger_doubles_advanced_cut_rank !== null ||
            cutoff.challenger_doubles_onsite_cut_rank !== null);

        let cutDisplay: React.ReactNode;
        if (!cutoff) {
          cutDisplay = <span className="cut-value cut-value--na">Not yet imported</span>;
        } else if (!hasRank || tombstoned) {
          cutDisplay = <span className="cut-value cut-value--na">Not on record</span>;
        } else if (isChallenger && eventType === 'doubles') {
          cutDisplay = <span className="cut-value">{challengerDoublesCutText(cutoff)}</span>;
        } else if (cutoff.last_alternate_rank != null) {
          // Hand-sourced "real" cut after alternates/withdrawals — show it as the
          // primary number (matches the swing checker), with the direct cut noted
          // beneath for transparency.
          cutDisplay = (
            <>
              <span className="cut-value">{rankText(cutoff.last_alternate_rank)}</span>
              {cutoff.last_direct_acceptance_rank != null && (
                <div className="cut-sub cut-sub--faint">{rankText(cutoff.last_direct_acceptance_rank)} direct</div>
              )}
            </>
          );
        } else {
          cutDisplay = <span className="cut-value">{rankText(cutoff.last_direct_acceptance_rank)}</span>;
        }

        return (
          <div key={draw} className="cut-table__row">
            {/* Left: draw label + PDF link */}
            <div>
              <div className="cut-table__label">{drawLabel(draw)}</div>
              {href && !tombstoned && (
                <a href={href} target="_blank" rel="noreferrer" className="src-link">
                  {isGS ? 'View draw' : 'PDF source'}
                </a>
              )}
            </div>

            {/* Right: cut rank + ALT/LL stacked */}
            <div className="cut-table__right">
              <div>{cutDisplay}</div>
              {hasRank && cutoff && (
                <div className="cut-sub">{altLlText(cutoff)}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const getCachedDetail = unstable_cache(
  async (slug: string, limit: number, year: number) =>
    getTournamentDetailRowsBySlug(slug, limit, year),
  ['tournament-detail'],
  { revalidate: 300 },
);

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ year?: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  await searchParams; // year no longer affects metadata (newest edition always wins)

  try {
    // Newest edition regardless of the viewed year — a ?year=2022 link to a
    // tournament that only has later data should still resolve metadata.
    const rows = await getCachedDetail(slug, 1, CURRENT_SEASON);
    if (rows.length === 0) return { title: 'Tournament not found' };

    const e = rows[0].edition;
    const name = displayName(e.name);
    const place = e.city ? `${e.city}${e.country ? `, ${e.country}` : ''}` : '';
    const title = `${name} — Entry Cutoffs & Schedule`;
    const description =
      `${e.level} entry cutoffs and draw history for ${name}${place ? ` (${place})` : ''}. ` +
      `Track the last direct acceptance and qualifying cut, year by year, on ${SITE_NAME}.`;
    const path = `/tournaments/${slug}`;

    return {
      title,
      description,
      alternates: { canonical: path },
      openGraph: {
        type: 'article',
        url: `${SITE_URL}${path}`,
        title: `${title} · ${SITE_NAME}`,
        description,
      },
      twitter: { card: 'summary_large_image', title: `${title} · ${SITE_NAME}`, description },
    };
  } catch {
    // Don't let a metadata/DB hiccup break the page render.
    return {};
  }
}

export default async function TournamentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { slug } = await params;
  const { year: yearParam } = await searchParams;
  const year = yearParam && isAvailableSeason(Number(yearParam)) ? Number(yearParam) : CURRENT_SEASON;

  // Show EVERY season on record for this tournament, no matter which year's
  // calendar the visitor arrived from — landing on Indian Wells via the 2022
  // schedule should still show 2023-2026 cuts. The viewed year only anchors
  // the hero and highlights its card below.
  const editionLimit = CURRENT_SEASON - EARLIEST_SEASON + 1;
  const rows = await getCachedDetail(slug, editionLimit, CURRENT_SEASON);

  if (rows.length === 0) notFound();

  const viewedRow = rows.find((r) => r.edition.year === year) ?? rows[0];
  const current = viewedRow.edition;

  // ITF events have no fixed code and each week is its own slug, so a current
  // ITF edition with no cut data (e.g. 2026, before that season's strength
  // sheet exists) can't show its own history. Pull the nearest prior-year
  // edition of the same tier + city by week as a "last year's cut" reference,
  // so you can gauge entry chances from 2025 data.
  const currentHasItfCut = viewedRow.cutoffs.some(
    (c) => c.event_type === 'singles' && c.draw_type === 'main' && c.last_direct_acceptance_rank != null
  );
  const itfReference =
    isItfLevel(current.level) && !currentHasItfCut
      ? await getItfPriorYearCutEditions(current.level, current.city, current.week, current.year)
      : [];

  // Cut per year for each draw, oldest→newest, for the hero trend chart.
  // Prefer the post-alternates ("real") cut when it was recorded; Challenger
  // doubles uses the advanced-entry team cut. ALT/LL counts ride along for
  // the bar tooltips.
  const trendPoints = (event: 'singles' | 'doubles', draw: 'main' | 'qualifying'): CutTrendPoint[] =>
    rows
      .map((row): CutTrendPoint | null => {
        const c = findCutoff(row.cutoffs, event, draw);
        if (!c || isTombstone(c)) return null;
        const cut =
          event === 'doubles'
            ? c.challenger_doubles_advanced_cut_rank ?? c.last_alternate_rank ?? c.last_direct_acceptance_rank
            : c.last_alternate_rank ?? c.last_direct_acceptance_rank;
        return cut != null
          ? {
              year: row.edition.year,
              cut,
              alt: c.alternate_entries_count ?? 0,
              ll: c.lucky_loser_count ?? 0,
            }
          : null;
      })
      .filter((p): p is CutTrendPoint => p !== null)
      .sort((a, b) => a.year - b.year);

  const cutTrend: CutTrendSeries[] = [
    { key: 'singles_main', label: 'Singles main', points: trendPoints('singles', 'main') },
    { key: 'singles_qualifying', label: 'Singles Qs', points: trendPoints('singles', 'qualifying') },
    { key: 'doubles_main', label: 'Doubles', points: trendPoints('doubles', 'main') },
  ];
  const hasTrend = cutTrend.some((s) => s.points.length >= 2);

  return (
    <main className="page">
      <Link href={year !== CURRENT_SEASON ? `/cuts?year=${year}` : '/cuts'} className="back-link">
        ← Back to {year} schedule
      </Link>

      <div className="detail-hero">
        <p className="eyebrow">Tournament</p>
        <h1 className="page-title" style={{ fontSize: 28, marginBottom: 4 }}>{displayName(current.name)}</h1>
        <p className="detail-hero__place">
          {current.city}{current.country ? `, ${current.country}` : ''}
        </p>
        <div className="meta-grid">
          {[
            ['Viewing year', year],
            ['Week', current.week ?? 'NA'],
            ['Level', current.level],
            ['Start', formatDate(current.start_date)],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <div className="meta-grid__label">{label}</div>
              <div className="meta-grid__value">{value}</div>
            </div>
          ))}
        </div>
        {hasTrend && <CutTrendChart series={cutTrend} />}
      </div>

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {rows.map((row, i) => {
          const prevRow = rows[i + 1] ?? null;
          const detailCode = levelGetsDetailSheet(row.edition.level)
            ? resolveProTennisLiveCode(row.edition.slug, row.edition.source_url)
            : null;
          return (
          <div
            key={row.edition.edition_id}
            id={`y-${row.edition.year}`}
            className={`edition-card${row.edition.year === year ? ' edition-card--viewing' : ''}`}
            style={{ scrollMarginTop: 'calc(var(--nav-h) + 12px)' }}
          >
            <div className="edition-card__head">
              <div>
                <h3 className="edition-card__year">
                  {row.edition.year}
                  {row.edition.year === year && rows.length > 1 && (
                    <span className="tag-soft tag-soft--brand" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                      Viewing
                    </span>
                  )}
                </h3>
                <p className="edition-card__meta">{editionSummary(row.edition)}</p>
                {detailCode && (
                  <a
                    href={detailSheetUrl(detailCode, row.edition.year)}
                    target="_blank"
                    rel="noreferrer"
                    className="src-link"
                    style={{ marginTop: 6 }}
                  >
                    Tournament detail sheet ↗
                  </a>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span className="pill-note">
                  Level: <strong>{fallback(row.edition.level)}</strong>
                  {row.same_level_as_previous_year === false && prevRow && (
                    <span className="was"> ← was {fallback(prevRow.edition.level)}</span>
                  )}
                </span>
                <span className="pill-note">
                  Week: <strong>{fallback(row.edition.week)}</strong>
                  {row.same_week_as_previous_year === false && prevRow && (
                    <span className="was"> ← was {fallback(prevRow.edition.week)}</span>
                  )}
                </span>
              </div>
            </div>
            <div className="edition-card__body">
              {row.edition.status === 'not_held' ? (
                <div className="muted-panel">Tournament not held this year.</div>
              ) : row.edition.start_date && new Date(row.edition.start_date) > new Date() ? (
                <div className="muted-panel">Tournament has not started yet.</div>
              ) : (
                <CutoffTable
                  cutoffs={row.cutoffs}
                  level={row.edition.level}
                  slug={row.edition.slug}
                  year={row.edition.year}
                />
              )}
            </div>
          </div>
          );
        })}
      </div>

      {itfReference.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px', color: 'var(--text-strong)' }}>Last year&apos;s cut (reference)</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>
            ITF events have no fixed tournament code, so this is the nearest prior-year
            {' '}{current.city} {current.level.replace(/^ITF\s*/, '')} by week — a guide to your entry chances, not the same draw.
          </p>
          <div style={{ display: 'grid', gap: 16 }}>
            {itfReference.map((ref) => (
              <div key={ref.edition.edition_id} className="edition-card">
                <div className="edition-card__head">
                  <div>
                    <h3 className="edition-card__year">{ref.edition.year}</h3>
                    <p className="edition-card__meta">{editionSummary(ref.edition)}</p>
                  </div>
                </div>
                <div className="edition-card__body">
                  <ItfCutoffTable cutoffs={ref.cutoffs} year={ref.edition.year} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
