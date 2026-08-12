import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AUG17_ENTRY_LISTS,
  AUG17_MAIN_SOURCE,
  AUG17_QUAL_SOURCE,
  getAug17EntryList,
  type Aug17EntryList,
  type EntryListPlayer,
} from '@/lib/aug17-entry-lists';
import WhereDoIStand from '@/components/WhereDoIStand';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Entry Lists — Aug 17, 2026',
  description: 'Planning view for the ATP Challenger week of August 17, 2026.',
  robots: { index: false, follow: false },
};

type SectionKind = 'MD' | 'MD ALT' | 'Q' | 'Q ALT';

type Appearance = {
  event: string;
  eventSlug: string;
  kind: SectionKind;
  position: number;
};

function keyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function buildAppearanceIndex(): Map<string, Appearance[]> {
  const index = new Map<string, Appearance[]>();
  const add = (event: Aug17EntryList, players: EntryListPlayer[], kind: SectionKind) => {
    players.forEach((player, i) => {
      const key = keyName(player.name);
      const row = { event: event.name, eventSlug: event.slug, kind, position: i + 1 };
      index.set(key, [...(index.get(key) ?? []), row]);
    });
  };

  AUG17_ENTRY_LISTS.forEach((event) => {
    add(event, event.main, 'MD');
    add(event, event.mainNext, 'MD ALT');
    add(event, event.qualifying, 'Q');
  });
  return index;
}

const APPEARANCES = buildAppearanceIndex();

function PlayerRows({
  players,
  prefix,
  next = false,
}: {
  players: EntryListPlayer[];
  prefix: string;
  next?: boolean;
}) {
  return players.map((player, i) => (
    <tr key={`${prefix}-${player.name}-${i}`} className={next ? styles.nextRow : undefined}>
      <td className={styles.pos}>{prefix} {i + 1}</td>
      <td className={styles.playerCell}>
        {player.name}
        {player.note ? <span className={styles.note}>{player.note}</span> : null}
      </td>
      <td className={styles.rank}>{player.rank ?? '—'}</td>
      <td className={styles.country}>{player.country}</td>
    </tr>
  ));
}

function ListTable({
  players,
  prefix,
  next = false,
}: {
  players: EntryListPlayer[];
  prefix: string;
  next?: boolean;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Pos</th>
            <th>Player</th>
            <th className={styles.rank}>Rank</th>
            <th>Ctry</th>
          </tr>
        </thead>
        <tbody>
          <PlayerRows players={players} prefix={prefix} next={next} />
        </tbody>
      </table>
    </div>
  );
}

function selectedCrossEntries(event: Aug17EntryList) {
  const people = new Map<string, { name: string; elsewhere: Appearance[] }>();
  const selectedPlayers = [
    ...event.main,
    ...event.mainNext,
    ...event.qualifying,
  ];

  selectedPlayers.forEach((player) => {
    const key = keyName(player.name);
    const elsewhere = (APPEARANCES.get(key) ?? []).filter((a) => a.eventSlug !== event.slug);
    if (elsewhere.length > 0) people.set(key, { name: player.name, elsewhere });
  });

  return [...people.values()].sort((a, b) => {
    if (b.elsewhere.length !== a.elsewhere.length) return b.elsewhere.length - a.elsewhere.length;
    return a.name.localeCompare(b.name);
  });
}

function labelAppearance(a: Appearance): string {
  if (a.kind === 'MD ALT') return `${a.event} MD ALT ${a.position}`;
  if (a.kind === 'Q ALT') return `${a.event} Q ALT ${a.position}`;
  return `${a.event} ${a.kind}`;
}

export default async function ListsPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const { event: eventParam } = await searchParams;
  const event = getAug17EntryList(eventParam);
  const crossEntries = selectedCrossEntries(event);

  return (
    <main className="page">
      <div className={styles.hero}>
        <p className="eyebrow">Entry lists · planning pilot</p>
        <h1 className="page-title">Week of Aug 17, 2026</h1>
        <p className="page-lede">
          Main-draw position, qualifying position, and the deepest public next-in queues we can
          currently reconcile across the six Challengers this week.
        </p>
        <div className={styles.sourceNote}>
          This is a planning view, not an official ATP acceptance report. Main-draw status is
          reconciled to the newer Aug. 11 public update; qualifying uses the Aug. 10 snapshot.
          Players promoted into the main draw since the qualifying snapshot have been removed from
          the stale Q section. ATP/PlayerZone remains authoritative.
        </div>
      </div>

      <WhereDoIStand events={AUG17_ENTRY_LISTS} />

      <div className={styles.eventGrid} aria-label="Aug 17 tournaments">
        {AUG17_ENTRY_LISTS.map((item) => {
          const on = item.slug === event.slug;
          return (
            <Link
              key={item.slug}
              href={`/lists?event=${item.slug}`}
              prefetch={false}
              className={`${styles.eventCard}${on ? ` ${styles.eventCardOn}` : ''}`}
            >
              <div className={styles.eventName}>{item.name}</div>
              <div className={styles.eventMeta}>
                {item.level} · {item.surface} · ATP {item.atpCode}
              </div>
              <div className={styles.eventCounts}>
                <span className={styles.badge}>MD {item.main.length}</span>
                <span className={styles.badge}>MD ALT {item.mainNext.length}</span>
                <span className={styles.badge}>Q {item.qualifying.length}</span>
              </div>
            </Link>
          );
        })}
      </div>

      <section>
        <div className={styles.eventHeader}>
          <div>
            <h2 className={styles.eventTitle}>{event.name}</h2>
            <div className={styles.eventSub}>
              {event.level} · {event.surface} · ATP tournament code {event.atpCode}
            </div>
          </div>
          <div className={styles.sourceLinks}>
            <a href={AUG17_MAIN_SOURCE.url} target="_blank" rel="noreferrer">
              MD source ↗
            </a>
            <a href={AUG17_QUAL_SOURCE.url} target="_blank" rel="noreferrer">
              Q source ↗
            </a>
          </div>
        </div>

        {event.recentMovement.length > 0 ? (
          <div className={styles.movement}>
            <strong>Latest movement:</strong> {event.recentMovement.join(' · ')}
          </div>
        ) : null}

        <div className={styles.columns}>
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h3 className={styles.panelTitle}>Main draw</h3>
              <div className={styles.panelMeta}>
                {AUG17_MAIN_SOURCE.checkedAt} · latest public MD snapshot
              </div>
            </div>
            <div className={styles.sectionTitle}>Accepted</div>
            <ListTable players={event.main} prefix="MD" />
            <div className={styles.sectionTitle}>Main-draw next-in · visible depth</div>
            <ListTable players={event.mainNext} prefix="ALT" next />
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h3 className={styles.panelTitle}>Qualifying</h3>
              <div className={styles.panelMeta}>
                {AUG17_QUAL_SOURCE.checkedAt} · promoted MD players reconciled out
              </div>
            </div>
            <div className={styles.sectionTitle}>Qualifying acceptance</div>
            <ListTable players={event.qualifying} prefix="Q" />
            <div className={styles.sectionTitle}>Qualifying alternates · awaiting verified list</div>
          </div>
        </div>

        {crossEntries.length > 0 ? (
          <div className={styles.cross}>
            <h3 className={styles.crossTitle}>Cross-entry signals</h3>
            <p className={styles.crossIntro}>
              Players on {event.name}&apos;s visible lists who also appear somewhere in the other five
              Aug. 17 Challenger lists. These overlaps are the useful part for projecting movement.
            </p>
            <ul className={styles.crossList}>
              {crossEntries.map((person) => (
                <li key={person.name} className={styles.crossItem}>
                  <strong>{person.name}</strong>
                  <span className={styles.crossWhere}>
                    {person.elsewhere.map(labelAppearance).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className={styles.foot}>
          MD next-in is only as deep as the Aug. 11 public update exposes; qualifying is deeper in
          the Aug. 10 snapshot. We intentionally do not invent Original Cut Off, ranking date, or
          unseen alternate positions. The next version can replace these snapshots with ATP&apos;s
          official PlayerList feed if access is granted.
        </p>
      </section>
    </main>
  );
}
