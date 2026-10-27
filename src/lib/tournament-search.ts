import { pool } from './db';
import { EARLIEST_SEASON } from './seasons';
import { searchPattern } from './search-pattern';

// Search for the Saved page's "Add tournament" picker: any held edition, past
// or future, whose name or city matches. Results come back nearest-to-today
// first, so "Lille" offers this year's and next year's edition before 2023's.

export type TournamentSearchResult = {
  editionId: string;
  slug: string;
  year: number;
  name: string;
  city: string;
  country: string | null;
  level: string;
  start: string; // YYYY-MM-DD
};

export const SEARCH_LIMIT = 25;

export async function searchTournamentEditions(raw: unknown): Promise<TournamentSearchResult[]> {
  const pattern = searchPattern(raw);
  if (!pattern) return [];
  const result = await pool.query<TournamentSearchResult>(
    `select te.id as "editionId", t.slug, te.year, t.name, t.city, t.country, te.level,
            to_char(te.start_date, 'YYYY-MM-DD') as start
       from tournament_editions te
       join tournaments t on t.id = te.tournament_id
      where te.status = 'held'
        and te.year >= $2
        and (t.name ilike $1 or t.city ilike $1)
      order by abs(te.start_date - current_date), te.start_date desc
      limit $3`,
    [pattern, EARLIEST_SEASON, SEARCH_LIMIT]
  );
  return result.rows;
}
