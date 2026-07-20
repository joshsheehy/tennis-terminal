import { unstable_cache } from 'next/cache';
import WeekTournamentPicker, { type RowCutInfo } from '@/components/WeekTournamentPicker';
import YearPicker from '@/components/YearPicker';
import { getScheduleForYear, pool } from '@/lib/db';
import { CURRENT_SEASON, isAvailableSeason } from '@/lib/seasons';
import { deadlinesForEdition } from '@/lib/entry-deadlines';
import type { ScheduleRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

const getCachedSchedule = unstable_cache(
  async (year: number) => getScheduleForYear(year),
  ['schedule'],
  // Tag lets /api/sync-canonical and /api/hide-edition bust this cache
  // immediately via revalidateTag('schedule') instead of waiting 5 minutes.
  { revalidate: 300, tags: ['schedule'] },
);

// Singles-main cut per edition so calendar rows can show the number (and the
// viewer's verdict) without a click. Falls back to the freshest projection for
// events whose real cut hasn't landed yet.
const getCachedRowCuts = unstable_cache(
  async (year: number): Promise<Record<string, RowCutInfo>> => {
    const [cuts, projections] = await Promise.all([
      pool.query<{ edition_id: string; cut: number | null }>(
        `select te.id as edition_id,
                coalesce(cs.last_alternate_rank, cs.last_direct_acceptance_rank) as cut
           from tournament_editions te
           join cutoff_snapshots cs on cs.tournament_edition_id = te.id
          where te.year = $1 and cs.event_type = 'singles' and cs.draw_type = 'main'`,
        [year]
      ),
      pool
        .query<{ edition_id: string; cut: number }>(
          `select distinct on (tournament_edition_id) tournament_edition_id as edition_id, predicted_cut as cut
             from cut_predictions cp
             join tournament_editions te on te.id = cp.tournament_edition_id
            where te.year = $1 and cp.event_type = 'singles' and cp.draw_type = 'main'
            order by tournament_edition_id, horizon_weeks asc, predicted_at desc`,
          [year]
        )
        .catch(() => ({ rows: [] as Array<{ edition_id: string; cut: number }> })),
    ]);
    const out: Record<string, RowCutInfo> = {};
    for (const r of projections.rows) out[r.edition_id] = { cut: r.cut, projected: true };
    for (const r of cuts.rows) {
      if (r.cut != null) out[r.edition_id] = { cut: r.cut, projected: false };
    }
    return out;
  },
  ['cuts-row-cuts'],
  { revalidate: 300, tags: ['schedule'] }
);

// Player-language empty state: when there's no cut yet, say when entries close.
function closesText(row: ScheduleRow): string | null {
  const main = deadlinesForEdition(row).find((d) => d.kind === 'main' || d.kind === 'entry');
  if (!main) return null;
  if (new Date(main.deadlineAtIso).getTime() < Date.now()) return null;
  const date = new Date(`${main.deadlineDate}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `entries close ${date}`;
}

export default async function CutsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; week?: string }>;
}) {
  const { year: yearParam, week: weekParam } = await searchParams;
  const year = yearParam && isAvailableSeason(Number(yearParam)) ? Number(yearParam) : CURRENT_SEASON;

  const tournaments = await getCachedSchedule(year);
  const rowCuts = await getCachedRowCuts(year);
  const cutInfo: Record<string, RowCutInfo> = {};
  for (const row of tournaments) {
    const known = rowCuts[row.edition_id];
    cutInfo[row.edition_id] = known ?? { cut: null, projected: false, closes: closesText(row) };
  }

  return (
    <main className="page">
      <div style={{ marginBottom: 24 }}>
        <p className="eyebrow">Entry cuts</p>

        <h1 className="page-title" style={{ marginBottom: 16 }}>Every cut, week by week</h1>

        <YearPicker currentYear={year} />

        <p className="page-lede">
          Open a week to see its tournaments; open a tournament for its full cut history
          and this year&apos;s projection.
        </p>
      </div>

      {tournaments.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)' }}>No tournaments found for {year}.</div>
      ) : (
        <WeekTournamentPicker
          tournaments={tournaments}
          year={year}
          defaultWeekKey={weekParam}
          cutInfo={cutInfo}
        />
      )}

      <p className="page-footnote">
        Questions, comments, or just want to talk?{' '}
        <a href="mailto:josh@tenniscuts.com">josh@tenniscuts.com</a>
      </p>
    </main>
  );
}
