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
  if (value === null) return 'No prior year / not held';
  return value ? 'Same' : 'Different';
}

function isChallengerLevel(level: string) {
  return level.toLowerCase().includes('challenger');
}

function editionSummary(edition: {
  start_date: string | null;
  end_date?: string | null;
  week: number | null;
  level: string;
  surface: string;
  status: string;
}) {
  if (edition.status === 'not_held') return 'Not Held / NA';
  const dateRange = edition.end_date
    ? `${formatDate(edition.start_date)} – ${formatDate(edition.end_date)}`
    : formatDate(edition.start_date);
  return `${dateRange} · Week ${edition.week ?? 'NA'} · ${edition.level} · ${edition.surface}`;
}

function cutoffLabel(cutoff: CutoffSnapshot) {
  if (cutoff.event_type === 'singles' && cutoff.draw_type === 'main') return 'Singles main';
  if (cutoff.event_type === 'singles' && cutoff.draw_type === 'qualifying') return 'Singles qualifying';
  if (cutoff.event_type === 'doubles' && cutoff.draw_type === 'main') return 'Doubles main';
  return 'Doubles qualifying';
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

function CutoffTable({ cutoffs, level }: { cutoffs: CutoffSnapshot[]; level: string }) {
  if (cutoffs.length === 0) {
    return (
      <div style={{
        padding: '12px 16px',
        background: '#f5f5f5',
        borderRadius: 8,
        color: '#888',
        fontSize: 14,
      }}>
        No cut data imported yet for this year.
      </div>
    );
  }

  const isChallenger = isChallengerLevel(level);
  const rows = cutoffs.filter(
    (cutoff) => !(isChallenger && cutoff.event_type === 'doubles' && cutoff.draw_type === 'qualifying')
  );

  return (
    <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #e0e0e0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#f0f0f0', borderBottom: '2px solid #d0d0d0' }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#666' }}>Draw</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#666' }}>Cut</th>
            <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#666' }}>ALT / LL in draw</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((cutoff, i) => (
            <tr
              key={cutoff.id}
              style={{
                background: i % 2 === 0 ? '#ffffff' : '#fafafa',
                borderBottom: '1px solid #e8e8e8',
              }}
            >
              <td style={{ padding: '12px 16px', color: '#555' }}>{cutoffLabel(cutoff)}</td>
              <td style={{ padding: '12px 16px', fontWeight: 700, color: '#111', fontVariantNumeric: 'tabular-nums' }}>
                {isChallenger && cutoff.event_type === 'doubles'
                  ? challengerDoublesCutText(cutoff)
                  : rankText(cutoff.last_direct_acceptance_rank)}
              </td>
              <td style={{ padding: '12px 16px', color: '#555', fontVariantNumeric: 'tabular-nums' }}>{altLlText(cutoff)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const VALID_YEARS = [2024, 2025, 2026];

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
  const rows = await getTournamentDetailRowsBySlug(slug, editionLimit, year);

  if (rows.length === 0) notFound();

  const current = rows[0].edition;

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px', background: '#ffffff', color: '#111', minHeight: '100vh' }}>
      <Link href={year !== 2026 ? `/?year=${year}` : '/'} style={{ fontSize: 14, color: '#888' }}>
        ← Back to {year} schedule
      </Link>

      <div style={{ marginTop: 24, paddingBottom: 20, borderBottom: '1px solid #e8e8e8' }}>
        <p style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#999', marginBottom: 6 }}>
          Tournament
        </p>
        <h1 style={{ margin: 0, marginBottom: 4, fontSize: 28, fontWeight: 700 }}>{displayName(current.name)}</h1>
        <p style={{ margin: 0, color: '#666', fontSize: 15 }}>
          {current.city}{current.country ? `, ${current.country}` : ''}
        </p>
        <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            ['Viewing year', year],
            ['Week', current.week ?? 'NA'],
            ['Level', current.level],
            ['Start', formatDate(current.start_date)],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#999', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {rows.map((row) => (
          <div key={row.edition.edition_id} style={{ border: '1px solid #e0e0e0', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ background: '#f8f8f8', padding: '14px 16px', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{row.edition.year}</h3>
                <p style={{ margin: 0, fontSize: 13, color: '#666', marginTop: 2 }}>{editionSummary(row.edition)}</p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, padding: '4px 10px', background: '#fff', border: '1px solid #ddd', borderRadius: 6, color: '#555' }}>
                  Level: <strong>{compareLabel(row.same_level_as_previous_year)}</strong>
                </span>
                <span style={{ fontSize: 12, padding: '4px 10px', background: '#fff', border: '1px solid #ddd', borderRadius: 6, color: '#555' }}>
                  Week: <strong>{compareLabel(row.same_week_as_previous_year)}</strong>
                </span>
              </div>
            </div>
            <div style={{ padding: 16 }}>
              {row.edition.status === 'not_held' ? (
                <div style={{ padding: '12px 16px', background: '#f5f5f5', borderRadius: 8, color: '#888', fontSize: 14 }}>
                  Tournament not held this year.
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
