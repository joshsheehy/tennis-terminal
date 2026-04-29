import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCutoffSnapshotsForEditionIds, getTournamentHistoryBySlug } from '@/lib/db';
import { CutoffSnapshot } from '@/lib/types';

export const dynamic = 'force-dynamic';

function formatDate(dateString: string | null) {
  if (!dateString) return 'NA';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(dateString));
}

function getSnapshot(
  snapshots: CutoffSnapshot[],
  editionId: string,
  eventType: 'singles' | 'doubles',
  drawType: 'main' | 'qualifying'
) {
  return (
    snapshots.find(
      (snapshot) =>
        snapshot.tournament_edition_id === editionId &&
        snapshot.event_type === eventType &&
        snapshot.draw_type === drawType
    ) ?? null
  );
}

function valueOrNA(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 'NA';
  return value;
}

function CutSection({
  title,
  snapshot,
  isChallenger,
}: {
  title: string;
  snapshot: CutoffSnapshot | null;
  isChallenger?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>

      {!snapshot ? (
        <p className="mt-3 text-sm text-neutral-400">No historical cut data yet.</p>
      ) : (
        <div className="mt-3 space-y-2 text-sm text-neutral-300">
          <div className="flex items-center justify-between gap-4">
            <span className="text-neutral-500">Last direct accepted</span>
            <span>{valueOrNA(snapshot.last_direct_acceptance_rank)}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-neutral-500">Direct accepted player/team</span>
            <span className="text-right">
              {valueOrNA(snapshot.last_direct_acceptance_player_name)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-neutral-500">Last alternate</span>
            <span>{valueOrNA(snapshot.last_alternate_rank)}</span>
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-neutral-500">Alternate player/team</span>
            <span className="text-right">
              {valueOrNA(snapshot.last_alternate_player_name)}
            </span>
          </div>

          {isChallenger && (
            <>
              <div className="mt-4 border-t border-neutral-800 pt-4 text-xs uppercase tracking-[0.18em] text-neutral-500">
                Challenger doubles fields
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-neutral-500">Advanced cut</span>
                <span>{valueOrNA(snapshot.challenger_doubles_advanced_cut_rank)}</span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-neutral-500">Advanced team</span>
                <span className="text-right">
                  {valueOrNA(snapshot.challenger_doubles_advanced_team_name)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-neutral-500">On-site cut</span>
                <span>{valueOrNA(snapshot.challenger_doubles_onsite_cut_rank)}</span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-neutral-500">On-site team</span>
                <span className="text-right">
                  {valueOrNA(snapshot.challenger_doubles_onsite_team_name)}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default async function TournamentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const history = await getTournamentHistoryBySlug(slug);

  if (history.length === 0) {
    notFound();
  }

  const editionIds = history.map((row) => row.edition_id);
  const snapshots = await getCutoffSnapshotsForEditionIds(editionIds);

  const tournament = history[0];

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <Link href="/schedule" className="text-sm text-neutral-400 hover:text-white">
          ← Back to schedule
        </Link>

        <p className="mt-6 text-xs uppercase tracking-[0.2em] text-neutral-500">
          Tournament detail
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{tournament.name}</h1>
        <p className="mt-2 text-sm text-neutral-400">
          {tournament.city}
          {tournament.country ? `, ${tournament.country}` : ''}
        </p>
      </div>

      <div className="space-y-6">
        {history.map((edition) => {
          const singlesMain = getSnapshot(
            snapshots,
            edition.edition_id,
            'singles',
            'main'
          );
          const singlesQualifying = getSnapshot(
            snapshots,
            edition.edition_id,
            'singles',
            'qualifying'
          );
          const doublesMain = getSnapshot(
            snapshots,
            edition.edition_id,
            'doubles',
            'main'
          );

          const isChallenger = edition.level.toLowerCase().includes('challenger');

          return (
            <section
              key={edition.edition_id}
              className="rounded-3xl border border-neutral-800 bg-black p-5"
            >
              <div className="mb-5 flex flex-col gap-2 border-b border-neutral-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-white">{edition.year}</h2>
                  <p className="mt-1 text-sm text-neutral-400">
                    {edition.level} · {edition.surface}
                  </p>
                </div>

                <div className="text-sm text-neutral-400">
                  <div>Week: {valueOrNA(edition.week)}</div>
                  <div>
                    Dates: {formatDate(edition.start_date)} – {formatDate(edition.end_date)}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <CutSection title="Singles main draw" snapshot={singlesMain} />
                <CutSection title="Singles qualifying" snapshot={singlesQualifying} />
                <CutSection
                  title="Doubles"
                  snapshot={doublesMain}
                  isChallenger={isChallenger}
                />
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
