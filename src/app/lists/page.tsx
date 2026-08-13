import type { Metadata } from 'next';
import Link from 'next/link';
import type { Aug17EntryList } from '@/lib/aug17-entry-lists';
import {
  activeEventForPosition,
  getTrackedAug17Events,
  type TrackedEntryRow,
} from '@/lib/aug17-entry-history';
import type { PublicEntryRow, PublicEntryTournament } from '@/lib/spazio-entry-list-parser';
import { entryCodeLabel, rankingDisplay, routeLabel, tallyRoutes } from '@/lib/entry-codes';
import { pool } from '@/lib/db';
import WhereDoIStand from '@/components/WhereDoIStand';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Entry Lists — Aug 17, 2026',
  description: 'Entry lists for the ATP Challenger week of August 17, 2026.',
  robots: { index: false, follow: false },
};

const WEEK_START = '2026-08-17';

type Appearance = {
  event: string;
  eventSlug: string;
  kind: 'MD' | 'MD ALT' | 'Q';
  position: number;
};

type PublicHistory = {
  tournaments: PublicEntryTournament[];
  lastCheckedAt: string | null;
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

async function loadPublicHistory(): Promise<PublicHistory> {
  try {
    const [snapshot, status] = await Promise.all([
      pool.query<{ parsed_payload: PublicEntryTournament[] }>(
        `select parsed_payload
         from entry_list_source_snapshots
         where week_start = $1::date and source_key = 'spaziotennis-week33'
         order by fetched_at desc
         limit 1`,
        [WEEK_START]
      ),
      pool.query<{ last_checked_at: string | Date | null }>(
        `select last_checked_at
         from entry_list_source_status
         where week_start = $1::date and source_key = 'spaziotennis-week33'`,
        [WEEK_START]
      ),
    ]);
    return {
      tournaments: supplementPublicTournaments(snapshot.rows[0]?.parsed_payload ?? []),
      lastCheckedAt: status.rows[0]?.last_checked_at ? new Date(status.rows[0].last_checked_at).toISOString() : null,
    };
  } catch {
    // Production may render once before the idempotent setup endpoint creates the
    // new history tables. The seeded PlayerZone/public observations remain usable.
    return { tournaments: [], lastCheckedAt: null };
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

type Section = 'main' | 'alt' | 'q';

/**
 * A row is struck when the player is no longer on this particular list: they
 * withdrew, or — on the alternate and qualifying lists — they moved up into the
 * main draw and hold a place there instead.
 */
function hasDeparted(row: TrackedEntryRow, section: Section) {
  return (
    row.state === 'withdrawn' ||
    row.state === 'removed-unknown' ||
    ((section === 'alt' || section === 'q') && row.state === 'promoted-main')
  );
}

function rowClass(row: TrackedEntryRow, section: Section) {
  return hasDeparted(row, section) ? styles.departedRow : undefined;
}

/**
 * How many players this list actually holds. Struck rows stay visible for
 * provenance but are not on the list any more, so they never count — the same
 * predicate decides both, which is why the number can never disagree with what
 * is on screen.
 */
function liveCount(rows: TrackedEntryRow[], section: Section) {
  return rows.filter((row) => !hasDeparted(row, section)).length;
}

/**
 * How a list was filled, route by route.
 *
 * There is no fixed acceptance number to check against: the accelerator
 * pathways differ by Challenger level — Next Gen runs across the levels, while
 * the junior and college pathways exist only at 50 and 75 — and wildcards and
 * protected rankings vary event by event. So the composition is read off the
 * list itself rather than asserted from a constant, and it is shown in full so
 * the parts visibly sum to the total.
 */
function DrawComposition({ rows, section }: { rows: TrackedEntryRow[]; section: Section }) {
  const tallies = tallyRoutes(
    rows.map((row) => ({ code: row.entryCode, departed: hasDeparted(row, section) }))
  ).filter((tally) => tally.live > 0);
  if (tallies.length === 0) return null;
  return (
    <ul className={styles.composition}>
      {tallies.map((tally) => (
        <li key={tally.route} className={styles.compositionItem} title={routeLabel(tally.route)}>
          <b>{tally.live}</b> {tally.route}
        </li>
      ))}
    </ul>
  );
}

/**
 * One player per line: name, country code, entry rank.
 *
 * Only the alternate list carries a number, because there the number is the
 * whole point — it is the queue position, and it counts live, moving up as
 * players above leave. Main draw and qualifying are plain lists.
 *
 * The old "MD 12" / "ALT 9" labels repeated the heading on every row and, being
 * two words, wrapped inside the number column — which is what put each
 * main-draw player on two lines.
 */
function HistoryTable({ rows, section }: { rows: TrackedEntryRow[]; section: 'main' | 'alt' | 'q' }) {
  return (
    <ol className={styles.entryList}>
      {rows.map((row, index) => {
        const position = section === 'alt' ? row.effectivePosition ?? '' : '';
        return (
          <li
            key={`${section}-${row.name}-${index}`}
            className={[styles.entryRow, rowClass(row, section)].filter(Boolean).join(' ')}
          >
            {position ? <span className={styles.pos}>{position}</span> : null}
            <span className={styles.playerName}>{row.name}</span>
            {row.country ? <span className={styles.country}>{row.country}</span> : null}
            {/* Junior and college accelerator numbers come from the ITF junior
                and ITA collegiate rankings, so the code stands in for them.
                Next Gen and protected rankings are real ATP rankings and keep
                their number. */}
            <span className={styles.rank} title={entryCodeLabel(row.entryCode) ?? undefined}>
              {rankingDisplay(row.rank, row.entryCode)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default async function ListsPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const [{ event: eventParam }, publicHistory] = await Promise.all([searchParams, loadPublicHistory()]);
  const trackedEvents = getTrackedAug17Events(publicHistory.tournaments);
  const activeEvents = trackedEvents.map(activeEventForPosition);
  const event = trackedEvents.find((item) => item.slug === eventParam) ?? trackedEvents[0];
  const activeEvent = activeEventForPosition(event);
  const crossEntries = selectedCrossEntries(activeEvent, activeEvents);

  return (
    <main className="page">
      <div className={styles.hero}>
        <p className="eyebrow">Entry lists</p>
        <h1 className="page-title">Week of Aug 17, 2026</h1>
        <p className="page-lede">
          Players who have pulled out stay on the list, crossed out. Alternate numbers move up as the players above them leave.
        </p>
        <div className={styles.sourceNote}>
          <strong>Last checked:</strong> {formatTime(publicHistory.lastCheckedAt)}. Rank is the one attached to the published list, not today&apos;s ATP ranking.
        </div>
      </div>

      <div className={styles.eventGrid} aria-label="Aug 17 tournaments">
        {trackedEvents.map((item) => {
          const on = item.slug === event.slug;
          return (
            <Link key={item.slug} href={`/lists?event=${item.slug}`} prefetch={false} className={`${styles.eventCard}${on ? ` ${styles.eventCardOn}` : ''}`}>
              <div className={styles.eventName}>{item.name}</div>
              <div className={styles.eventMeta}>{item.level} · {item.surface}</div>
            </Link>
          );
        })}
      </div>

      <section>
        <div className={styles.eventHeader}>
          <div><h2 className={styles.eventTitle}>{event.name}</h2><div className={styles.eventSub}>{event.level} · {event.surface}</div></div>
        </div>

        {/* Each list runs top to bottom in its own block, one after the other.
            Side-by-side columns forced both lists to scroll independently and
            made a long main draw read as a wall rather than a list. */}
        <div className={styles.lists}>
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h3 className={styles.panelTitle}>Main draw</h3>
              <span className={styles.panelCount}>{liveCount(event.mainHistory, 'main')} accepted</span>
            </div>
            <DrawComposition rows={event.mainHistory} section="main" />
            <HistoryTable rows={event.mainHistory} section="main" />
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h3 className={styles.panelTitle}>Main-draw alternates</h3>
              <span className={styles.panelCount}>{liveCount(event.mainAltHistory, 'alt')} waiting</span>
            </div>
            <DrawComposition rows={event.mainAltHistory} section="alt" />
            <HistoryTable rows={event.mainAltHistory} section="alt" />
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h3 className={styles.panelTitle}>Qualifying</h3>
              {/* Deliberately not called "accepted". The main-draw count is the
                  published acceptance list and lands on the same number for
                  every event; the qualifying list is a frozen Aug 10 capture
                  whose depth varies by event, so claiming it is the full
                  acceptance would be asserting more than the source shows. */}
              <span className={styles.panelCount}>{liveCount(event.qualifyingHistory, 'q')} on the Aug 10 list</span>
            </div>
            <DrawComposition rows={event.qualifyingHistory} section="q" />
            <HistoryTable rows={event.qualifyingHistory} section="q" />
            <div className={styles.qAltMissing}>
              <strong>Qualifying alternates · awaiting verified ordered list</strong>
              <span>No ranking-based reconstruction. Once a true Q-alt queue is found, the same model will populate here automatically.</span>
            </div>
          </div>
        </div>

        {/* No movement ledger. A player who pulls out is struck on the list
            itself, which is the same information in the place people look. */}

        {crossEntries.length > 0 ? (
          <div className={styles.cross}>
            <h3 className={styles.crossTitle}>Cross-entry signals</h3>
            <p className={styles.crossIntro}>Active players on {event.name}&apos;s visible lists who also appear in another Aug. 17 Challenger.</p>
            <ul className={styles.crossList}>{crossEntries.map((person) => (
              <li key={person.name} className={styles.crossItem}><strong>{person.name}</strong><span className={styles.crossWhere}>{person.elsewhere.map(formatAppearance).join(' · ')}</span></li>
            ))}</ul>
          </div>
        ) : null}

      </section>

      <WhereDoIStand events={activeEvents} />
    </main>
  );
}
