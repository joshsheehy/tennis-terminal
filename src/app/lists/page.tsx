import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AUG17_MAIN_SOURCE,
  AUG17_QUAL_SOURCE,
  type Aug17EntryList,
} from '@/lib/aug17-entry-lists';
import {
  AUG17_SEEDED_MOVEMENTS,
  activeEventForPosition,
  getTrackedAug17Events,
  type EntryMovementLedgerRow,
  type MovementKind,
  type TrackedEntryRow,
} from '@/lib/aug17-entry-history';
import type { PublicEntryRow, PublicEntryTournament } from '@/lib/spazio-entry-list-parser';
import { pool } from '@/lib/db';
import WhereDoIStand from '@/components/WhereDoIStand';
import { flagFor } from '@/lib/country-flag';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Entry Lists — Aug 17, 2026',
  description: 'Live movement and entry-list planning view for the ATP Challenger week of August 17, 2026.',
  robots: { index: false, follow: false },
};

const WEEK_START = '2026-08-17';
const SPAZIO_URL =
  'https://www.spaziotennis.com/trn/ent/entry-list-atp-challenger-2026-week-33-cancun-quebec-city-kingston-praga-roehampton-sion/139834';

type Appearance = {
  event: string;
  eventSlug: string;
  kind: 'MD' | 'MD ALT' | 'Q';
  position: number;
};

type PublicHistory = {
  tournaments: PublicEntryTournament[];
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  movements: EntryMovementLedgerRow[];
};

type DbMovement = {
  tournament_slug: string;
  player_name: string;
  movement_type: string;
  from_section: string;
  to_section: string;
  observed_at: string | Date;
  source_key: string;
  source_url: string | null;
  raw_text: string | null;
  q_spots_delta: number;
};

function keyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function sortedNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .sort()
    .join(' ');
}

function playerZoneRow(name: string, country: string, entryRank: number, marker: PublicEntryRow['marker'] = 'active'): PublicEntryRow {
  return { name, country, entryRank, entryCode: null, marker, rawText: `${name} ${country} ${entryRank}` };
}

/**
 * Spazio currently stops the visible Kingston alternate queue at Erel. The
 * PlayerZone screenshots supplied Aug 12 prove rows 11-18 as well. Keep those
 * original rows as last-known evidence until a public source exposes equal or
 * deeper coverage. A public source can update them later; it cannot erase them
 * merely by being shallower.
 */
function supplementPublicTournaments(tournaments: PublicEntryTournament[]): PublicEntryTournament[] {
  const kingstonExtras = [
    playerZoneRow('Igor Marcondes', 'BRA', 296),
    playerZoneRow('Philip Sekulic', 'AUS', 301, 'struck'),
    playerZoneRow('Daniel Milavsky', 'USA', 325),
    playerZoneRow('Paul Jubb', 'GBR', 335),
    playerZoneRow('Tyler Zink', 'USA', 343),
    playerZoneRow('Blaise Bicknell', 'JAM', 344),
    playerZoneRow('Mitchell Krueger', 'USA', 346),
    playerZoneRow('Ivan Marrero Curbelo', 'ESP', 356),
  ];

  return tournaments.map((tournament) => {
    if (tournament.slug !== 'kingston') return tournament;
    const existing = new Set(tournament.alternates.map((row) => sortedNameKey(row.name)));
    return {
      ...tournament,
      alternates: [
        ...tournament.alternates,
        ...kingstonExtras.filter((row) => !existing.has(sortedNameKey(row.name))),
      ],
    };
  });
}

function movementKind(value: string): MovementKind {
  const map: Record<string, MovementKind> = {
    md_withdrawal: 'md-withdrawal',
    md_alt_to_md: 'md-alt-to-main',
    q_to_md: 'q-to-main',
    q_withdrawal: 'q-withdrawal',
    q_alt_to_q: 'q-alt-to-q',
    q_alt_to_md: 'q-alt-to-main',
    q_alt_withdrawal: 'q-alt-withdrawal',
    removed_unknown: 'removed-unknown',
  };
  return map[value] ?? 'removed-unknown';
}

function dbMovementToLedger(row: DbMovement): EntryMovementLedgerRow {
  const fromMap: Record<string, EntryMovementLedgerRow['fromSection']> = {
    main: 'main', main_alt: 'main-alt', qualifying: 'qualifying', qualifying_alt: 'qualifying-alt', unknown: 'unknown',
  };
  const toMap: Record<string, EntryMovementLedgerRow['toSection']> = {
    main: 'main', qualifying: 'qualifying', out: 'out', unknown: 'unknown',
  };
  return {
    tournamentSlug: row.tournament_slug,
    playerName: row.player_name,
    kind: movementKind(row.movement_type),
    fromSection: fromMap[row.from_section] ?? 'unknown',
    toSection: toMap[row.to_section] ?? 'unknown',
    observedAt: new Date(row.observed_at).toISOString(),
    sourceLabel: row.source_key === 'spaziotennis-week33' ? 'SpazioTennis hourly sync' : row.source_key,
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    detail: row.raw_text ?? `${row.from_section} → ${row.to_section}`,
    qSpotsDelta: row.q_spots_delta ?? 0,
  };
}

async function loadPublicHistory(): Promise<PublicHistory> {
  try {
    const [snapshot, status, movements] = await Promise.all([
      pool.query<{ parsed_payload: PublicEntryTournament[] }>(
        `select parsed_payload
         from entry_list_source_snapshots
         where week_start = $1::date and source_key = 'spaziotennis-week33'
         order by fetched_at desc
         limit 1`,
        [WEEK_START]
      ),
      pool.query<{ last_checked_at: string | Date | null; last_changed_at: string | Date | null }>(
        `select last_checked_at, last_changed_at
         from entry_list_source_status
         where week_start = $1::date and source_key = 'spaziotennis-week33'`,
        [WEEK_START]
      ),
      pool.query<DbMovement>(
        `select tournament_slug, player_name, movement_type, from_section, to_section,
                observed_at, source_key, source_url, raw_text, q_spots_delta
         from entry_list_movements
         where week_start = $1::date
         order by observed_at desc`,
        [WEEK_START]
      ),
    ]);
    return {
      tournaments: supplementPublicTournaments(snapshot.rows[0]?.parsed_payload ?? []),
      lastCheckedAt: status.rows[0]?.last_checked_at ? new Date(status.rows[0].last_checked_at).toISOString() : null,
      lastChangedAt: status.rows[0]?.last_changed_at ? new Date(status.rows[0].last_changed_at).toISOString() : null,
      movements: movements.rows.map(dbMovementToLedger),
    };
  } catch {
    // Production may render once before the idempotent setup endpoint creates the
    // new history tables. The seeded PlayerZone/public observations remain usable.
    return { tournaments: [], lastCheckedAt: null, lastChangedAt: null, movements: [] };
  }
}

function buildAppearanceIndex(events: Aug17EntryList[]): Map<string, Appearance[]> {
  const index = new Map<string, Appearance[]>();
  const add = (event: Aug17EntryList, players: Aug17EntryList['main'], kind: Appearance['kind']) => {
    players.forEach((player, i) => {
      const key = keyName(player.name);
      index.set(key, [...(index.get(key) ?? []), { event: event.name, eventSlug: event.slug, kind, position: i + 1 }]);
    });
  };
  events.forEach((event) => {
    add(event, event.main, 'MD');
    add(event, event.mainNext, 'MD ALT');
    add(event, event.qualifying, 'Q');
  });
  return index;
}

function selectedCrossEntries(event: Aug17EntryList, events: Aug17EntryList[]) {
  const appearances = buildAppearanceIndex(events);
  const people = new Map<string, { name: string; elsewhere: Appearance[] }>();
  [...event.main, ...event.mainNext, ...event.qualifying].forEach((player) => {
    const elsewhere = (appearances.get(keyName(player.name)) ?? []).filter((item) => item.eventSlug !== event.slug);
    if (elsewhere.length) people.set(keyName(player.name), { name: player.name, elsewhere });
  });
  return [...people.values()].sort((a, b) => b.elsewhere.length - a.elsewhere.length || a.name.localeCompare(b.name));
}

function formatAppearance(a: Appearance): string {
  return a.kind === 'MD ALT' ? `${a.event} MD ALT ${a.position}` : `${a.event} ${a.kind}`;
}

function formatTime(value: string | null): string {
  if (!value) return 'Awaiting first automated check';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: 'short',
  }).format(new Date(value));
}

function rowClass(row: TrackedEntryRow, section: 'main' | 'alt' | 'q') {
  const departed = row.state === 'withdrawn' || row.state === 'removed-unknown' ||
    ((section === 'alt' || section === 'q') && row.state === 'promoted-main');
  return departed ? styles.departedRow : undefined;
}

function statusClass(row: TrackedEntryRow) {
  if (row.state === 'active') return styles.statusActive;
  if (row.state === 'promoted-main') return styles.statusIn;
  if (row.state === 'withdrawn') return styles.statusOut;
  return styles.statusUnknown;
}

function HistoryTable({ rows, section }: { rows: TrackedEntryRow[]; section: 'main' | 'alt' | 'q' }) {
  // The first alternate who has not withdrawn or been promoted is next in
  // line. Marking it gives the eye somewhere to land, the way the red row does
  // in the ATP app.
  const nextInIndex =
    section === 'alt'
      ? rows.findIndex((r) => r.state === 'active')
      : -1;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>#</th><th>Player</th><th className={styles.rank}>Rank</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={`${section}-${row.name}-${index}`}
              className={[rowClass(row, section), index === nextInIndex ? styles.nextInRow : null]
                .filter(Boolean)
                .join(' ')}
            >
              {/* One position column. The live alternate number is the one a
                  player acts on, so it wins where it exists; otherwise the
                  original label stands. Showing both side by side made every
                  row carry a redundant column and an em dash. */}
              <td className={styles.pos}>
                {section === 'alt' && row.effectivePosition
                  ? row.effectivePosition
                  : section === 'q'
                    ? ''
                    : row.originalLabel}
              </td>
              <td className={styles.playerCell}>
                <span className={styles.playerName}>{row.name}</span>
                {row.country ? (
                  <span className={styles.country} title={row.country}>
                    {flagFor(row.country) ?? row.country}
                  </span>
                ) : null}
                {row.note ? <span className={styles.note}>{row.note}</span> : null}
                {row.detail ? <span className={styles.rowDetail}>{row.detail}</span> : null}
              </td>
              <td className={styles.rank}>{row.rank ?? ''}</td>
              <td>
                {row.statusLabel && row.statusLabel !== 'In' ? (
                  <span className={`${styles.statusBadge} ${statusClass(row)}`}>
                    {row.statusLabel}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function movementLabel(kind: MovementKind) {
  const labels: Record<MovementKind, string> = {
    'md-withdrawal': 'MD → OUT',
    'md-alt-to-main': 'MD ALT → MD',
    'q-to-main': 'Q → MD',
    'q-withdrawal': 'Q → OUT',
    'q-alt-to-q': 'Q ALT → Q',
    'q-alt-to-main': 'Q ALT → MD',
    'q-alt-withdrawal': 'Q ALT → OUT',
    'removed-unknown': 'Removed · reason pending',
  };
  return labels[kind];
}

function dedupeMovements(rows: EntryMovementLedgerRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.tournamentSlug}|${keyName(row.playerName)}|${row.kind}|${row.fromSection}|${row.toSection}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function ListsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const [{ event: eventParam }, publicHistory] = await Promise.all([searchParams, loadPublicHistory()]);
  const trackedEvents = getTrackedAug17Events(publicHistory.tournaments);
  const activeEvents = trackedEvents.map(activeEventForPosition);
  const event = trackedEvents.find((item) => item.slug === eventParam) ?? trackedEvents[0];
  const activeEvent = activeEventForPosition(event);
  const crossEntries = selectedCrossEntries(activeEvent, activeEvents);
  const movements = dedupeMovements([
    ...publicHistory.movements.filter((row) => row.tournamentSlug === event.slug),
    ...AUG17_SEEDED_MOVEMENTS.filter((row) => row.tournamentSlug === event.slug),
  ]).sort((a, b) => b.observedAt.localeCompare(a.observedAt));

  return (
    <main className="page">
      <div className={styles.hero}>
        <p className="eyebrow">Entry lists · live movement tracker</p>
        <h1 className="page-title">Week of Aug 17, 2026</h1>
        <p className="page-lede">
          Original list position stays frozen. Departures remain visible. Live alternate position compresses as players above move out or into the draw.
        </p>
        <div className={styles.sourceNote}>
          <strong>Last public-source check:</strong> {formatTime(publicHistory.lastCheckedAt)}. Entry rank is the ranking attached to the published list, not today&apos;s ATP ranking. Qualifying alternates are intentionally blank until an ordered Q-alt source is verified.
        </div>
      </div>

      <div className={styles.eventGrid} aria-label="Aug 17 tournaments">
        {trackedEvents.map((item) => {
          const on = item.slug === event.slug;
          const md = item.mainHistory.filter((row) => row.state === 'active' || row.state === 'promoted-main').length;
          const alt = item.mainAltHistory.filter((row) => row.state === 'active').length;
          const q = item.qualifyingHistory.filter((row) => row.state === 'active').length;
          return (
            <Link key={item.slug} href={`/lists?event=${item.slug}`} prefetch={false} className={`${styles.eventCard}${on ? ` ${styles.eventCardOn}` : ''}`}>
              <div className={styles.eventName}>{item.name}</div>
              <div className={styles.eventMeta}>{item.level} · {item.surface} · ATP {item.atpCode}</div>
              <div className={styles.eventCounts}><span className={styles.badge}>MD {md}</span><span className={styles.badge}>ALT {alt}</span><span className={styles.badge}>Q {q}</span></div>
            </Link>
          );
        })}
      </div>

      <section>
        <div className={styles.eventHeader}>
          <div><h2 className={styles.eventTitle}>{event.name}</h2><div className={styles.eventSub}>{event.level} · {event.surface} · ATP tournament code {event.atpCode}</div></div>
          <div className={styles.sourceLinks}>
            <a href={SPAZIO_URL} target="_blank" rel="noreferrer">Movement source ↗</a>
            <a href={AUG17_MAIN_SOURCE.url} target="_blank" rel="noreferrer">MD cross-check ↗</a>
            <a href={AUG17_QUAL_SOURCE.url} target="_blank" rel="noreferrer">Q snapshot ↗</a>
          </div>
        </div>

        <div className={styles.legend}>
          <span>Alternate numbers are live — players who left or moved up are already removed.</span>
          <span>Struck rows stay visible so movement is auditable.</span>
        </div>

        <div className={styles.columns}>
          <div className={styles.panel}>
            <div className={styles.panelHead}><h3 className={styles.panelTitle}>Main draw</h3><div className={styles.panelMeta}>Original rows + current promotions</div></div>
            <HistoryTable rows={event.mainHistory} section="main" />
            <div className={styles.sectionTitle}>Main-draw alternates · original order</div>
            <HistoryTable rows={event.mainAltHistory} section="alt" />
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}><h3 className={styles.panelTitle}>Qualifying</h3><div className={styles.panelMeta}>Frozen Aug. 10 acceptance snapshot + verified MD promotions</div></div>
            <div className={styles.sectionTitle}>Qualifying acceptance</div>
            <HistoryTable rows={event.qualifyingHistory} section="q" />
            <div className={styles.qAltMissing}>
              <strong>Qualifying alternates · awaiting verified ordered list</strong>
              <span>No ranking-based reconstruction. Once a true Q-alt queue is found, the same Orig/Live/history model will populate here automatically.</span>
            </div>
          </div>
        </div>

        <details className={styles.movementPanel} open>
          <summary>Movement history · {movements.length} tracked changes</summary>
          {movements.length ? (
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.movementTable}`}>
                <thead><tr><th>Observed</th><th>Player</th><th>Movement</th><th>Effect</th><th>Source</th></tr></thead>
                <tbody>{movements.map((movement, index) => (
                  <tr key={`${movement.playerName}-${movement.kind}-${index}`}>
                    <td>{formatTime(movement.observedAt)}</td>
                    <td><strong>{movement.playerName}</strong></td>
                    <td>{movementLabel(movement.kind)}</td>
                    <td>{movement.qSpotsDelta > 0 ? `+${movement.qSpotsDelta} Q vacancy` : movement.detail}</td>
                    <td>{movement.sourceUrl ? <a href={movement.sourceUrl} target="_blank" rel="noreferrer">{movement.sourceLabel} ↗</a> : movement.sourceLabel}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className={styles.emptyMovement}>No verified movement recorded yet.</p>}
        </details>

        {crossEntries.length > 0 ? (
          <div className={styles.cross}>
            <h3 className={styles.crossTitle}>Cross-entry signals</h3>
            <p className={styles.crossIntro}>Active players on {event.name}&apos;s visible lists who also appear in another Aug. 17 Challenger.</p>
            <ul className={styles.crossList}>{crossEntries.map((person) => (
              <li key={person.name} className={styles.crossItem}><strong>{person.name}</strong><span className={styles.crossWhere}>{person.elsewhere.map(formatAppearance).join(' · ')}</span></li>
            ))}</ul>
          </div>
        ) : null}

        <p className={styles.foot}>
          The automated public poll runs hourly and saves a new raw snapshot only when the source changes. Every explicit OUT/IN/strike is written to a deduplicated movement ledger. PlayerZone/ATP remains authoritative; public-source uncertainty is labeled rather than guessed.
        </p>
      </section>

      <WhereDoIStand events={activeEvents} />
    </main>
  );
}
