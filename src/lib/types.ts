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
  source_type: string;
  last_direct_acceptance_rank: number | null;
  last_direct_acceptance_player_name: string | null;
  last_alternate_rank: number | null;
  last_alternate_player_name: string | null;
  challenger_doubles_advanced_cut_rank: number | null;
  challenger_doubles_advanced_team_name: string | null;
  challenger_doubles_onsite_cut_rank: number | null;
  challenger_doubles_onsite_team_name: string | null;
  parsed_at: string | null;
  parser_version: string | null;
  source_notes: string | null;
  created_at?: string;
  updated_at?: string;
};
