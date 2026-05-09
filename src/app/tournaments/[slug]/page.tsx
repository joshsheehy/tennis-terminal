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
    ? `${formatDate(edition.start_date)} - ${formatDate(edition.end_date)}`
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
  return rank ? String(rank) : 'No data yet';
}

function challengerDoublesCutText(cutoff: CutoffSnapshot) {
  const advance = cutoff.challenger_doubles_advanced_cut_rank;
  const onsite = cutoff.challenger_doubles_onsite_cut_rank;

  if (advance && onsite) return `Adv ${advance} / on-site ${onsite}`;
  if (advance) return `Adv ${advance}`;
  if (onsite) return `on-site ${onsite}`;
  return rankText(cutoff.last_direct_acceptance_rank);
}

function CutoffTable({ cutoffs, level }: { cutoffs: CutoffSnapshot[]; level: string }) {
  if (cutoffs.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-400">
        No cut data imported yet for this year.
      </div>
    );
  }

  const isChallenger = isChallengerLevel(level);

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <thead className="bg-neutral-900 text-neutral-400">
          <tr>
            <th className="p-3 font-medium">Draw</th>
            <th className="p-3 font-medium">Cut</th>
            <th className="p-3 font-medium">Alternates in draw</th>
          </tr>
        </thead>
        <tbody>
          {cutoffs
            .filter((cutoff) => !(isChallenger && cutoff.event_type === 'doubles' && cutoff.draw_type === 'qualifying'))
            .map((cutoff) => (
            <tr key={cutoff.id} className="border-t border-neutral-800 text-neutral-200">
              <td className="p-3">{cutoffLabel(cutoff)}</td>
              <td className="p-3">
                {isChallenger && cutoff.event_type === 'doubles'
                  ? challengerDoublesCutText(cutoff)
                  : rankText(cutoff.last_direct_acceptance_rank)}
              </td>
              <td className="p-3">{cutoff.alternate_entries_count ?? 0}</td>
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

  // Show only editions up to the selected year, with depth based on how far back we have data:
  // 2024 → 1 edition (we have no 2023), 2025 → 2 (2025+2024), 2026 → 3 (2026+2025+2024)
  const editionLimit = Math.max(1, year - 2023);
  const rows = await getTournamentDetailRowsBySlug(slug, editionLimit, year);

  if (rows.length === 0) notFound();

  const current = rows[0].edition;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <Link href={year !== 2026 ? `/?year=${year}` : '/'} className="text-sm text-neutral-400 hover:text-white">
        ← Back to {year} schedule
      </Link>

      <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-950 p-6">
        <p className="text-sm uppercase tracking-[0.2em] text-neutral-500">Tournament</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{current.name}</h1>
        <p className="mt-2 text-neutral-400">
          {current.city}
          {current.country ? `, ${current.country}` : ''}
        </p>
        <div className="mt-5 grid gap-3 text-sm text-neutral-300 sm:grid-cols-4">
          <div>
            <div className="text-neutral-500">Viewing year</div>
            <div>{year}</div>
          </div>
          <div>
            <div className="text-neutral-500">Week</div>
            <div>{current.week ?? 'NA'}</div>
          </div>
          <div>
            <div className="text-neutral-500">Level</div>
            <div>{current.level}</div>
          </div>
          <div>
            <div className="text-neutral-500">Start</div>
            <div>{formatDate(current.start_date)}</div>
          </div>
        </div>
      </section>

      <section className="mt-8 space-y-6">
        {rows.map((row) => (
          <article key={row.edition.edition_id} className="rounded-2xl border border-neutral-800 bg-black p-5">
            <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div>
                <h3 className="text-lg font-semibold">{row.edition.year}</h3>
                <p className="text-sm text-neutral-400">
                  {editionSummary(row.edition)}
                </p>
              </div>

              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-xl border border-neutral-800 px-3 py-2">
                  Level vs previous year: {compareLabel(row.same_level_as_previous_year)}
                </div>
                <div className="rounded-xl border border-neutral-800 px-3 py-2">
                  Week vs previous year: {compareLabel(row.same_week_as_previous_year)}
                </div>
              </div>
            </div>

            {row.edition.status === 'not_held' ? (
              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-400">
                Tournament not held this year.
              </div>
            ) : (
              <CutoffTable cutoffs={row.cutoffs} level={row.edition.level} />
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
