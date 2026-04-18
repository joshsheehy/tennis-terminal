export type Tournament = {
  id: string;
  slug: string;
  name: string;
  city: string;
  country: string | null;
};

export type TournamentEdition = {
  id: string;
  tournament_id: string;
  year: number;
  week: number | null;
  start_date: string;
  end_date: string | null;
  level: string;
  surface: string;
  indoor: boolean | null;
  source: string;
  source_url: string | null;
  status: 'held' | 'not_held';
};

export type ScheduleRow = {
  edition_id: string;
  tournament_id: string;
  slug: string;
  name: string;
  city: string;
  country: string | null;
  year: number;
  week: number | null;
  start_date: string;
  end_date: string | null;
  level: string;
  surface: string;
  indoor: boolean | null;
  source: string;
};

export type CutoffSnapshot = {
  id: string;
  tournament_edition_id: string;
  event_type: 'singles' | 'doubles';
  draw_type: 'main' | 'qualifying';
  last_direct_acceptance_rank: number | null;
  last_alternate_rank: number | null;
  challenger_doubles_advanced_cut_rank: number | null;
  challenger_doubles_onsite_cut_rank: number | null;
};

export type CheckerStatus = 'Direct Acceptance' | 'Via Alternate Spot' | 'Out' | 'No cutoff data';

export type CheckerResult = {
  label: string;
  status: CheckerStatus;
};
