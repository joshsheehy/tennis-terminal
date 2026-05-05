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
  if (value === null) return 'No prior year';
  return value ? 'Same' : 'Different';
}

function cutoffLabel(cutoff: CutoffSnapshot) {
  if (cutoff.event_type === 'singles' && cutoff.draw_type === 'main') return 'Singles main';
  if (cutoff.event_type === 'singles' && cutoff.draw_type === 'qualifying') return 'Singles qualifying';
  if (cutoff.event_type === 'doubles' && cutoff.draw_type === 'main') return 'Doubles main';
  return 'Doubles qualifying';
}

function rankText(rank: number | null, name: string | null) {
  if (!rank && !name) return 'No data yet';
  if (!rank) return name ?? 'No data yet';
  return name ? `${rank} — ${name}` : String(rank);
}

function CutoffTable({ cutoffs }: { cutoffs: CutoffSnapshot[] }) {
  if (cutoffs.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-sm text-neutral-400">
        No cut data imported yet for this year.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead className="bg-neutral-900 text-neutral-400">
          <tr>
            <th className="p-3 font-medium">Draw</th>
            <th className="p-3 font-medium">Last direct accepted</th>
            <th className="p-3 font-medium">Last alternate</th>
            <th className="p-3 font-medium">Alternates in draw</th>
            <th className="p-3 font-medium">Challenger doubles advanced</th>
            <th className="p-3 font-medium">Challenger doubles on-site</th>
          </tr>
        </thead>
        <tbody>
          {cutoffs.map((cutoff) => (
            <tr key={cutoff.id} className="border-t border-neutral-800 text-neutral-200">
              <td className="p-3">{cutoffLabel(cutoff)}</td>
              <td className="p-3">
                {rankText(
                  cutoff.last_direct_acceptance_rank,
                  cutoff.last_direct_acceptance_player_name
                )}
              </td>
              <td className="p-3">
                {rankText(cutoff.last_alternate_rank, cutoff.last_alternate_player_name)}
              </td>
              <td className="p-3">{cutoff.alternate_entries_count ?? 0}</td>
              <td className="p-3">
                {rankText(
                  cutoff.challenger_doubles_advanced_cut_rank,
                  cutoff.challenger_doubles_advanced_team_name
                )}
              </td>
              <td className="p-3">
                {rankText(
                  cutoff.challenger_doubles_onsite_cut_rank,
                  cutoff.challenger_doubles_onsite_team_name
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function TournamentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const rows = await getTournamentDetailRowsBySlug(slug, 3);

  if (rows.length === 0) notFound();

  const current = rows[0].edition;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <Link href="/schedule" className="text-sm text-neutral-400 hover:text-white">
        ← Back to schedule
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
            <div className="text-neutral-500">Current year</div>
            <div>{current.year}</div>
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
        <div>
          <h2 className="text-xl font-semibold">Last 3 years of cuts</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Shows 2026 plus the previous three calendar editions when available. Level and week are compared against the immediately previous year.
          </p>
        </div>

        {rows.map((row) => (
          <article key={row.edition.edition_id} className="rounded-2xl border border-neutral-800 bg-black p-5">
            <div className="mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div>
                <h3 className="text-lg font-semibold">{row.edition.year}</h3>
                <p className="text-sm text-neutral-400">
                  {formatDate(row.edition.start_date)} · Week {row.edition.week ?? 'NA'} · {row.edition.level} · {row.edition.surface}
                </p>
              </div>

              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-xl border border-neutral-800 px-3 py-2">
                  <div className="text-neutral-500">Same level as previous year</div>
                  <div>{compareLabel(row.same_level_as_previous_year)}</div>
                </div>
                <div className="rounded-xl border border-neutral-800 px-3 py-2">
                  <div className="text-neutral-500">Same week as previous year</div>
                  <div>{compareLabel(row.same_week_as_previous_year)}</div>
                </div>
              </div>
            </div>

            <CutoffTable cutoffs={row.cutoffs} />
          </article>
        ))}
      </section>
    </main>
  );
}
