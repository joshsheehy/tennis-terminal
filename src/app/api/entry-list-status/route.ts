import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Player = {
  rank: number | null;
  name: string;
  country?: string | null;
  flags?: string[];
};

type Tournament = {
  editionId: string | null;
  tournament: string;
  city: string;
  startDate: string;
  level: string | null;
  sourceName: string;
  surface: string | null;
  main: Player[];
  wildCards: Player[];
  qualifying: Player[];
  qualifyingNextIn: Player[];
  released: boolean;
};

type WeekSnapshot = {
  created_at: string | Date;
  source_updated_text: string | null;
  tournaments: Tournament[];
};

type PlayerSpot = {
  section: 'wild_card' | 'main' | 'qualifying' | 'qualifying_next_in';
  position: number;
  rank: number | null;
  country: string | null;
  flags: string[];
};

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findPlayer(tournament: Tournament, playerName: string): PlayerSpot | null {
  const target = normalizeName(playerName);
  const sections: Array<[PlayerSpot['section'], Player[]]> = [
    ['wild_card', tournament.wildCards ?? []],
    ['main', tournament.main ?? []],
    ['qualifying', tournament.qualifying ?? []],
    ['qualifying_next_in', tournament.qualifyingNextIn ?? []],
  ];

  for (const [section, players] of sections) {
    const index = players.findIndex((player) => normalizeName(player.name) === target);
    if (index >= 0) {
      const player = players[index];
      return {
        section,
        position: index + 1,
        rank: player.rank ?? null,
        country: player.country ?? null,
        flags: player.flags ?? [],
      };
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const week = request.nextUrl.searchParams.get('week');
  const player = request.nextUrl.searchParams.get('player')?.trim() || null;
  if (week && !/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return NextResponse.json({ ok: false, error: 'week must be YYYY-MM-DD' }, { status: 400 });
  }

  const snapshots = await pool.query<WeekSnapshot>(
    `
    select created_at, source_updated_text, tournaments
    from central_entry_list_week_snapshots
    where tour = 'atp'
      and week_start = coalesce($1::date, (
        select week_start
        from central_entry_list_week_snapshots
        where tour = 'atp'
        order by week_start asc
        limit 1
      ))
    order by created_at desc
    limit 2
    `,
    [week]
  );

  const latest = snapshots.rows[0];
  const previous = snapshots.rows[1] ?? null;
  if (!latest) {
    return NextResponse.json({ ok: true, week: week ?? null, snapshot: null, tournaments: [] });
  }

  const summaries = latest.tournaments.map((tournament) => {
    const spot = player ? findPlayer(tournament, player) : null;
    const previousTournament = previous?.tournaments.find(
      (candidate) => normalizeName(candidate.sourceName) === normalizeName(tournament.sourceName)
    );
    const previousSpot = player && previousTournament ? findPlayer(previousTournament, player) : null;

    return {
      tournament: tournament.tournament,
      city: tournament.city,
      startDate: tournament.startDate,
      level: tournament.level,
      surface: tournament.surface,
      released: tournament.released,
      counts: {
        main: tournament.main?.length ?? 0,
        wildCards: tournament.wildCards?.length ?? 0,
        qualifying: tournament.qualifying?.length ?? 0,
        qualifyingNextIn: tournament.qualifyingNextIn?.length ?? 0,
      },
      ...(player ? {
        player: spot,
        movement: previousSpot && spot
          ? {
              previousSection: previousSpot.section,
              previousPosition: previousSpot.position,
              sectionChanged: previousSpot.section !== spot.section,
              positionsMovedWithinSection:
                previousSpot.section === spot.section ? previousSpot.position - spot.position : null,
            }
          : null,
      } : {}),
    };
  });

  return NextResponse.json({
    ok: true,
    player,
    snapshot: {
      createdAt: latest.created_at,
      sourceUpdatedText: latest.source_updated_text,
      previousCreatedAt: previous?.created_at ?? null,
    },
    tournaments: summaries,
  });
}
