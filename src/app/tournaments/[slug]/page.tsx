import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTournamentDetailRowsBySlug } from '@/lib/db';
import { CutoffSnapshot } from '@/lib/types';

function formatDate(dateString: string | null) {
  if (!dateString) return 'NA';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(dateString));
}

function displayName(name: string): string {
  return name.replace(/,\s*[A-Z]{2}$/, '');
}

function compareLabel(value: boolean | null) {
  if (value === null) return 'N/A';
  return value ? 'same' : 'different';
}

function isChallengerLevel(level: string) {
  return level.toLowerCase().includes('challenger');
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
  if (alt > 0 && ll > 0) return `${alt} ALT / ${ll} LL`;
  if (alt > 0) return `${alt} ALT`;
  if (ll > 0) return `${ll} LL`;
  return '0';
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

function CutoffTable({ cutoffs, level }: { cutoffs: CutoffSnapshot[]; level: string }) {
  if (isInvitationOnlyLevel(level)) {
    return (
      <div style={{
        padding: '12px 16px',
        background: 'var(--surface-subtle)',
        borderRadius: 8,
        color: 'var(--text-muted)',
        fontSize: 14,
      }}>
        Invitation-only / team format — no ranking-based cutoff applies.
      </div>
    );
  }

  const isChallenger = isChallengerLevel(level);
  const expected = expectedDrawsForLevel(level);

  return (
    <div
      className="cutoff-table-scroll"
      style={{
        position: 'relative',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        borderRadius: 8,
        border: '1px solid var(--border-table)',
      }}
    >
      <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: 'var(--surface-table-head)', borderBottom: '2px solid var(--border-table-head)' }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Draw</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Cut</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>ALT / LL in draw</th>
          </tr>
        </thead>
        <tbody>
          {expected.map((draw, i) => {
            const [eventType, drawType] = draw.split('_') as ['singles' | 'doubles', 'main' | 'qualifying'];
            const cutoff = findCutoff(cutoffs, eventType, drawType);
            const tombstoned = cutoff ? isTombstone(cutoff) : false;
            const href = cutoff ? sourceHref(cutoff) : null;
            const hasRank =
              cutoff !== null &&
              (cutoff.last_direct_acceptance_rank !== null ||
                cutoff.challenger_doubles_advanced_cut_rank !== null ||
                cutoff.challenger_doubles_onsite_cut_rank !== null);

            let cutCell: React.ReactNode;
            if (!cutoff) {
              cutCell = <span style={{ color: 'var(--text-placeholder)', fontStyle: 'italic', fontWeight: 500 }}>Not yet imported</span>;
            } else if (!hasRank || tombstoned) {
              cutCell = <span style={{ color: 'var(--text-placeholder)', fontStyle: 'italic', fontWeight: 500 }}>Not on record</span>;
            } else if (isChallenger && eventType === 'doubles') {
              cutCell = <span style={{ color: 'var(--text-strong)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{challengerDoublesCutText(cutoff)}</span>;
            } else {
              cutCell = <span style={{ color: 'var(--text-strong)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{rankText(cutoff.last_direct_acceptance_rank)}</span>;
            }

            const altCell = hasRank && cutoff ? altLlText(cutoff) : '—';

            return (
              <tr
                key={draw}
                style={{
                  background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface-alt)',
                  borderBottom: '1px solid var(--border-table)',
                }}
              >
                <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>
                  <div>{drawLabel(draw)}</div>
                  {href && !tombstoned ? (
                    <a href={href} target="_blank" rel="noreferrer" style={{ color: 'var(--text-faint)', fontSize: 11, textDecoration: 'underline' }}>
                      PDF source
                    </a>
                  ) : null}
                </td>
                <td style={{ padding: '12px 16px' }}>{cutCell}</td>
                <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{altCell}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const VALID_YEARS = [2024, 2025, 2026];

const getCachedDetail = unstable_cache(
  async (slug: string, limit: number, year: number) =>
    getTournamentDetailRowsBySlug(slug, limit, year),
  ['tournament-detail'],
  { revalidate: 300 },
);

export default async function TournamentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { slug } = await params;
  const { year: yearParam } = await searchParams;
  const year = yearParam && VALID_YEARS.includes(Number(yearParam)) ? Number(yearParam) : 2026;

  const editionLimit = Math.max(1, year - 2023);
  const rows = await getCachedDetail(slug, editionLimit, year);

  if (rows.length === 0) notFound();

  const current = rows[0].edition;

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px', background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh' }}>
      <Link href={year !== 2026 ? `/?year=${year}` : '/'} style={{ fontSize: 14, color: 'var(--text-muted)' }}>
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
        {rows.map((row) => (
          <div key={row.edition.edition_id} style={{ border: '1px solid var(--border-table)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ background: 'var(--surface-raised)', padding: '14px 16px', borderBottom: '1px solid var(--border-table)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{row.edition.year}</h3>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{editionSummary(row.edition)}</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--border-tag)', borderRadius: 6, color: 'var(--text-muted)' }}>
                  Level: <strong>{fallback(row.edition.level)}</strong> <span style={{ color: 'var(--text-faint)' }}>({compareLabel(row.same_level_as_previous_year)})</span>
                </span>
                <span style={{ fontSize: 12, padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--border-tag)', borderRadius: 6, color: 'var(--text-muted)' }}>
                  Week: <strong>{fallback(row.edition.week)}</strong> <span style={{ color: 'var(--text-faint)' }}>({compareLabel(row.same_week_as_previous_year)})</span>
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
                <CutoffTable cutoffs={row.cutoffs} level={row.edition.level} />
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
