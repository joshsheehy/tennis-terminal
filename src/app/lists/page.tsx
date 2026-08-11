import type { Metadata } from 'next';
import Link from 'next/link';
import { pool } from '@/lib/db';
import type { EntryPlayer } from '@/lib/entry-list-source';
import { impliedCut } from '@/lib/entry-list-source';

/** Shape stored by /api/sync-central-entry-lists. Deliberately NOT
 * EntryListTournament: the sync renames the alternate queue to
 * `qualifyingNextIn` and carries the matched edition's name, so reading it as
 * the parser type crashes on undefined arrays. */
type StoredTournament = {
  editionId: string | null;
  tournament: string;
  city: string;
  startDate: string;
  level: string | null;
  sourceName: string;
  surface: string | null;
  main: EntryPlayer[];
  wildCards: EntryPlayer[];
  qualifying: EntryPlayer[];
  qualifyingNextIn: EntryPlayer[];
  released: boolean;
};

export const dynamic = 'force-dynamic';

// Hidden surface: not linked from SiteNav, not in the sitemap, noindex.
export const metadata: Metadata = {
  title: 'Entry lists — who is in, and how the queue is moving',
  robots: { index: false, follow: false },
};

type SnapshotRow = {
  id: string;
  week_start: string;
  source_type: string;
  source_updated_text: string | null;
  tournament_count: number;
  tournaments: StoredTournament[];
  created_at: string;
};

async function loadSnapshots(week: string | null): Promise<SnapshotRow[]> {
  try {
    const res = await pool.query<SnapshotRow>(
      `select id, week_start, source_type, source_updated_text,
              tournament_count, tournaments, created_at
         from central_entry_list_week_snapshots
        where tour = 'atp'
          and ($1::date is null or week_start = $1::date)
        order by week_start desc, created_at desc
        limit 40`,
      [week]
    );
    return res.rows;
  } catch {
    return []; // table not created yet
  }
}

const iso = (v: string | Date) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

/** Where a player sits in a list: a direct acceptance, or Nth in the queue. */
function positionsOf(t: StoredTournament): Map<string, string> {
  const out = new Map<string, string>();
  (t.main ?? []).forEach((p) => out.set(p.name, 'DA'));
  (t.qualifying ?? []).forEach((p) => out.set(p.name, 'Q'));
  (t.qualifyingNextIn ?? []).forEach((p, i) => out.set(p.name, `ALT ${i + 1}`));
  return out;
}

function Movement({
  latest,
  previous,
}: {
  latest: StoredTournament;
  previous: StoredTournament | undefined;
}) {
  if (!previous) return null;
  const before = positionsOf(previous);
  const now = positionsOf(latest);
  const moved: Array<{ name: string; from: string; to: string }> = [];
  for (const [name, to] of now) {
    const from = before.get(name);
    if (from && from !== to) moved.push({ name, from, to });
  }
  const gone = [...before.keys()].filter((n) => !now.has(n));
  if (moved.length === 0 && gone.length === 0) return null;

  return (
    <div style={{ marginTop: 10, fontSize: 13 }}>
      {moved.slice(0, 8).map((m) => (
        <div key={m.name} style={{ opacity: 0.85 }}>
          <strong>{m.name}</strong> {m.from} → <strong>{m.to}</strong>
        </div>
      ))}
      {gone.length > 0 ? (
        <div style={{ opacity: 0.6, marginTop: 4 }}>
          withdrawn: {gone.slice(0, 6).join(', ')}
          {gone.length > 6 ? ` +${gone.length - 6}` : ''}
        </div>
      ) : null}
    </div>
  );
}

function PlayerRows({ players, label }: { players: EntryPlayer[]; label: string }) {
  if (players.length === 0) return null;
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, opacity: 0.8 }}>
        {label} ({players.length})
      </summary>
      <ol style={{ margin: '8px 0 0', paddingLeft: 22, fontSize: 13, columns: 2 }}>
        {players.map((p, i) => (
          <li key={`${p.name}-${i}`} style={{ opacity: p.rank == null ? 0.6 : 1 }}>
            <span style={{ display: 'inline-block', minWidth: 42 }}>
              {p.rank ?? '—'}
            </span>
            {p.name} <span style={{ opacity: 0.55 }}>{p.country}</span>
            {p.flags.length ? (
              <span style={{ opacity: 0.55 }}> ({p.flags.join(',')})</span>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

export default async function EntryListsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const sp = await searchParams;
  const week = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? '') ? sp.week! : null;
  const snapshots = await loadSnapshots(week);

  const weeks = [...new Set(snapshots.map((s) => iso(s.week_start)))];
  const activeWeek = week ?? weeks[0] ?? null;
  const forWeek = snapshots.filter((s) => iso(s.week_start) === activeWeek);
  const latest = forWeek[0] ?? null;
  const previous = forWeek[1] ?? null;

  const prevByName = new Map(
    (previous?.tournaments ?? []).map((t) => [t.sourceName, t] as const)
  );

  return (
    <main className="page">
      <p className="eyebrow">Internal preview</p>
      <h1>Entry lists</h1>
      <p style={{ maxWidth: 730, opacity: 0.85 }}>
        Who is actually in each draw, and how the alternate queue is moving. Position in the
        queue is the useful number here, not ranking distance — a player at #340 can be ALT 8
        at one event and ALT 31 at another in the same week.
      </p>

      {snapshots.length === 0 ? (
        <div className="card" style={{ padding: 16, marginTop: 20, maxWidth: 730 }}>
          <strong>No snapshots captured yet.</strong>
          <p style={{ fontSize: 14, marginTop: 8, marginBottom: 8 }}>
            The capture route and parser both exist; nothing has been run against production,
            so there is nothing to show. One authenticated call fills this page:
          </p>
          <p style={{ fontSize: 13, opacity: 0.85, marginBottom: 8 }}>
            <code>/api/sync-central-entry-lists?week=YYYY-MM-DD&amp;apply=true&amp;key=…</code>
          </p>
          <p style={{ fontSize: 13, opacity: 0.75, marginBottom: 0 }}>
            This history is <strong>perishable</strong>. A list&apos;s movement can only be
            recorded while it is moving — once a tournament starts, how its queue drained that
            week is gone and cannot be reconstructed from any later source, official or not.
          </p>
        </div>
      ) : (
        <>
          <div className="chip-row" style={{ marginTop: 20 }}>
            {weeks.map((w) => (
              <Link
                key={w}
                href={`/lists?week=${w}`}
                className={w === activeWeek ? 'chip chip--on' : 'chip'}
                prefetch={false}
              >
                {w}
              </Link>
            ))}
          </div>

          <p style={{ fontSize: 13, opacity: 0.7, marginTop: 16 }}>
            {forWeek.length} snapshot{forWeek.length === 1 ? '' : 's'} for this week · latest{' '}
            {latest ? new Date(latest.created_at).toISOString().replace('T', ' ').slice(0, 16) : '—'}
            {latest?.source_updated_text ? ` · source says "${latest.source_updated_text}"` : ''}
            {latest ? ` · ${latest.source_type}` : ''}
          </p>

          {latest?.source_type?.includes('aggregator') ? (
            <p
              className="card"
              style={{ padding: 12, fontSize: 13, marginTop: 12, maxWidth: 730 }}
            >
              Captured from a third-party aggregate, not an official ATP document. Kept so the
              movement history exists; replace or cross-check with an official list when one
              is available for these events.
            </p>
          ) : null}

          <ol style={{ listStyle: 'none', padding: 0, margin: '20px 0 0' }}>
            {(latest?.tournaments ?? []).map((t) => {
              const cut = impliedCut(t.main ?? []);
              return (
                <li
                  key={t.sourceName}
                  className="card"
                  style={{ padding: 14, marginBottom: 10, display: 'block' }}
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
                    <strong style={{ fontSize: 16 }}>{t.tournament}</strong>
                    <span style={{ fontSize: 13, opacity: 0.7 }}>
                      {t.level ?? '—'} · {t.surface ?? '—'} · cut #{cut ?? '—'} ·{' '}
                      {(t.main ?? []).length} in · {(t.qualifyingNextIn ?? []).length} waiting
                    </span>
                  </div>

                  <Movement latest={t} previous={prevByName.get(t.sourceName)} />

                  <PlayerRows players={t.main ?? []} label="Main draw" />
                  <PlayerRows players={t.qualifying ?? []} label="Qualifying" />
                  <PlayerRows players={t.qualifyingNextIn ?? []} label="Alternates queue" />
                </li>
              );
            })}
          </ol>
        </>
      )}

      <p style={{ marginTop: 32, fontSize: 13, opacity: 0.7 }}>
        <Link href="/depth">Back to field strength</Link>
      </p>
    </main>
  );
}
