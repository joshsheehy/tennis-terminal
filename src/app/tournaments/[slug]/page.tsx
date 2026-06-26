import type { Metadata } from 'next';
import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTournamentDetailRowsBySlug } from '@/lib/db';
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
      <div style={{ padding: '12px 16px', background: 'var(--surface-subtle)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 14 }}>
        Invitation-only / team format — no ranking-based cutoff applies.
      </div>
    );
  }

  if (isItfLevel(level)) {
    return (
      <div style={{ padding: '12px 16px', background: 'var(--surface-subtle)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 14 }}>
        ITF World Tennis Tour event — cuts are not tracked here. Entries close
        via IPIN sign-in; acceptance lists are published on itftennis.com.
      </div>
    );
  }

  const isChallenger = isChallengerLevel(level);
  const expected = expectedDrawsForLevel(level);

  return (
    <div style={{ borderRadius: 8, border: '1px solid var(--border-table)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 16px', background: 'var(--surface-table-head)', borderBottom: '2px solid var(--border-table-head)' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Draw</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cut · ALT/LL</span>
      </div>

      {/* Rows */}
      {expected.map((draw, i) => {
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
          cutDisplay = <span style={{ color: 'var(--text-placeholder)', fontStyle: 'italic', fontSize: 13 }}>Not yet imported</span>;
        } else if (!hasRank || tombstoned) {
          cutDisplay = <span style={{ color: 'var(--text-placeholder)', fontStyle: 'italic', fontSize: 13 }}>Not on record</span>;
        } else if (isChallenger && eventType === 'doubles') {
          cutDisplay = <span style={{ color: 'var(--text-strong)', fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{challengerDoublesCutText(cutoff)}</span>;
        } else if (cutoff.last_alternate_rank != null) {
          // Hand-sourced "real" cut after alternates/withdrawals — show it as the
          // primary number (matches the swing checker), with the direct cut noted
          // beneath for transparency.
          cutDisplay = (
            <>
              <span style={{ color: 'var(--text-strong)', fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{rankText(cutoff.last_alternate_rank)}</span>
              {cutoff.last_direct_acceptance_rank != null && (
                <div style={{ fontSize: 11, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{rankText(cutoff.last_direct_acceptance_rank)} direct</div>
              )}
            </>
          );
        } else {
          cutDisplay = <span style={{ color: 'var(--text-strong)', fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>{rankText(cutoff.last_direct_acceptance_rank)}</span>;
        }

        return (
          <div
            key={draw}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 16,
              padding: '14px 16px',
              background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-alt)',
              borderTop: i === 0 ? 'none' : '1px solid var(--border-table)',
            }}
          >
            {/* Left: draw label + PDF link */}
            <div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{drawLabel(draw)}</div>
              {href && !tombstoned && (
                <a href={href} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--text-faint)', textDecoration: 'underline' }}>
                  {isGS ? 'View draw' : 'PDF source'}
                </a>
              )}
            </div>

            {/* Right: cut rank + ALT/LL stacked */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div>{cutDisplay}</div>
              {hasRank && cutoff && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                  {altLlText(cutoff)}
                </div>
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
  const { year: yearParam } = await searchParams;
  const year = yearParam && isAvailableSeason(Number(yearParam)) ? Number(yearParam) : CURRENT_SEASON;

  try {
    const rows = await getCachedDetail(slug, 1, year);
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

  // Show the viewed year plus everything back to the earliest imported season.
  const editionLimit = Math.max(1, year - (EARLIEST_SEASON - 1));
  const rows = await getCachedDetail(slug, editionLimit, year);

  if (rows.length === 0) notFound();

  const current = rows[0].edition;

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px', background: 'var(--bg)', color: 'var(--text)', minHeight: 'calc(100dvh - var(--nav-h))' }}>
      <Link href={year !== CURRENT_SEASON ? `/cuts?year=${year}` : '/cuts'} style={{ fontSize: 14, color: 'var(--text-muted)' }}>
        ← Back to {year} schedule
      </Link>

      <div style={{ marginTop: 24, paddingBottom: 20, borderBottom: '1px solid var(--border-table)' }}>
        <p style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--text-faint)', marginBottom: 6 }}>
          Tournament
        </p>
        <h1 style={{ margin: 0, marginBottom: 4, fontSize: 28, fontWeight: 700 }}>{displayName(current.name)}</h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15 }}>
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
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-faint)', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {rows.map((row, i) => {
          const prevRow = rows[i + 1] ?? null;
          return (
          <div key={row.edition.edition_id} style={{ border: '1px solid var(--border-table)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ background: 'var(--surface-raised)', padding: '14px 16px', borderBottom: '1px solid var(--border-table)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{row.edition.year}</h3>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{editionSummary(row.edition)}</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--border-tag)', borderRadius: 6, color: 'var(--text-muted)' }}>
                  Level: <strong>{fallback(row.edition.level)}</strong>
                  {row.same_level_as_previous_year === false && prevRow && (
                    <span style={{ color: 'var(--text-faint)' }}> ← was {fallback(prevRow.edition.level)}</span>
                  )}
                </span>
                <span style={{ fontSize: 12, padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--border-tag)', borderRadius: 6, color: 'var(--text-muted)' }}>
                  Week: <strong>{fallback(row.edition.week)}</strong>
                  {row.same_week_as_previous_year === false && prevRow && (
                    <span style={{ color: 'var(--text-faint)' }}> ← was {fallback(prevRow.edition.week)}</span>
                  )}
                </span>
              </div>
            </div>
            <div style={{ padding: 16 }}>
              {row.edition.status === 'not_held' ? (
                <div style={{ padding: '12px 16px', background: 'var(--surface-subtle)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 14 }}>
                  Tournament not held this year.
                </div>
              ) : row.edition.start_date && new Date(row.edition.start_date) > new Date() ? (
                <div style={{ padding: '12px 16px', background: 'var(--surface-subtle)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 14 }}>
                  Tournament has not started yet.
                </div>
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
    </main>
  );
}
