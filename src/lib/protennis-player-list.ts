export type ProTennisPlayerListRawPlayer = {
  Gender?: string | null;
  PlayerId?: string | null;
  LastName?: string | null;
  FirstName?: string | null;
  NatlCode?: string | null;
  RankRoll?: number | null;
  Seed?: string | null;
  EntryCode?: string | null;
  Alternate?: boolean | null;
  PartnerId?: string | null;
  [key: string]: unknown;
};

export type ProTennisPlayerListRawDraw = {
  MainQualyDrawType?: string | null;
  IsDoubles?: boolean | null;
  PlayerListType?: string | null;
  PlayerList?: ProTennisPlayerListRawPlayer[] | null;
  [key: string]: unknown;
};

export type ProTennisPlayerListResponse = {
  Tournaments?: ProTennisPlayerListRawDraw[] | null;
  Tour?: string | null;
  TournamentYear?: number | null;
  TournamentId?: number | null;
  [key: string]: unknown;
};

export type ProTennisAcceptanceEntry = {
  listPosition: number;
  alternatePosition: number | null;
  playerId: string | null;
  firstName: string | null;
  lastName: string | null;
  name: string;
  country: string | null;
  rank: number | null;
  seed: string | null;
  entryCode: string | null;
  alternate: boolean;
  partnerId: string | null;
};

export type ProTennisAcceptanceList = {
  eventType: 'singles' | 'doubles';
  drawType: 'main' | 'qualifying';
  playerListType: string | null;
  entries: ProTennisAcceptanceEntry[];
};

export type ParsedProTennisPlayerList = {
  tour: string | null;
  tournamentYear: number | null;
  tournamentId: number | null;
  lists: ProTennisAcceptanceList[];
};

function cleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanRank(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : null;
}

function playerName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(' ').trim();
}

/**
 * Normalize ATP's official ProTennisLive PlayerList payload without changing
 * published order. That order is critical: alternate queue position is derived
 * from the order of rows where Alternate=true, never from ranking.
 *
 * The documented PlayerList contract does NOT expose Original Cut Off, Ranking
 * Date or report/list date. Those values therefore remain separate metadata and
 * must never be inferred here from the lowest-ranked direct acceptance.
 */
export function parseProTennisPlayerList(
  raw: ProTennisPlayerListResponse
): ParsedProTennisPlayerList {
  const draws = Array.isArray(raw.Tournaments) ? raw.Tournaments : [];

  const lists = draws.flatMap((draw): ProTennisAcceptanceList[] => {
    const drawCode = cleanString(draw.MainQualyDrawType)?.toUpperCase();
    if (drawCode !== 'M' && drawCode !== 'Q') return [];

    const eventType: 'singles' | 'doubles' = draw.IsDoubles ? 'doubles' : 'singles';
    const drawType: 'main' | 'qualifying' = drawCode === 'Q' ? 'qualifying' : 'main';
    const players = Array.isArray(draw.PlayerList) ? draw.PlayerList : [];
    let alternatePosition = 0;

    const entries = players.flatMap((player, index): ProTennisAcceptanceEntry[] => {
      const firstName = cleanString(player.FirstName);
      const lastName = cleanString(player.LastName);
      const name = playerName(firstName, lastName);
      if (!name) return [];

      const alternate = player.Alternate === true;
      if (alternate) alternatePosition += 1;

      return [{
        listPosition: index + 1,
        alternatePosition: alternate ? alternatePosition : null,
        playerId: cleanString(player.PlayerId),
        firstName,
        lastName,
        name,
        country: cleanString(player.NatlCode),
        rank: cleanRank(player.RankRoll),
        seed: cleanString(player.Seed),
        entryCode: cleanString(player.EntryCode),
        alternate,
        partnerId: cleanString(player.PartnerId),
      }];
    });

    return [{
      eventType,
      drawType,
      playerListType: cleanString(draw.PlayerListType),
      entries,
    }];
  });

  return {
    tour: cleanString(raw.Tour),
    tournamentYear: typeof raw.TournamentYear === 'number' ? raw.TournamentYear : null,
    tournamentId: typeof raw.TournamentId === 'number' ? raw.TournamentId : null,
    lists,
  };
}

/**
 * Fetch one official ATP ProTennisLive PlayerList using a legitimately issued
 * bearer token. No PlayerZone credentials, browser session or bypass logic is
 * supported here. Callers must explicitly supply the token.
 */
export async function fetchProTennisPlayerList(
  tournamentYear: number,
  tournamentId: number,
  bearerToken: string,
  timeoutMs = 10_000
): Promise<ParsedProTennisPlayerList> {
  if (!Number.isInteger(tournamentYear) || tournamentYear < 2000 || tournamentYear > 2100) {
    throw new Error('Invalid tournament year');
  }
  if (!Number.isInteger(tournamentId) || tournamentId <= 0) {
    throw new Error('Invalid tournament id');
  }
  const token = bearerToken.trim();
  if (!token) throw new Error('A ProTennisLive bearer token is required');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      `https://api.protennislive.com/feeds/PlayerList/${tournamentYear}/${tournamentId}`,
      {
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          authorization: token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`,
          'user-agent': 'TennisCuts/1.0',
        },
      }
    );
    if (!response.ok) {
      throw new Error(`ProTennisLive PlayerList returned HTTP ${response.status}`);
    }
    const raw = await response.json() as ProTennisPlayerListResponse;
    return parseProTennisPlayerList(raw);
  } finally {
    clearTimeout(timer);
  }
}
