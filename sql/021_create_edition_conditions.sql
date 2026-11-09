-- Playing conditions per tournament edition, shown on the Builder's info card.
-- Weather/elevation come from Open-Meteo (/api/conditions/climate); ball and
-- the sheet's surface (for indoor) from the ProTennisLive detail sheet
-- (/api/conditions/sheet). Created lazily by src/lib/edition-conditions.ts.
create table if not exists edition_conditions (
  edition_id uuid primary key references tournament_editions(id) on delete cascade,
  elevation_m integer,
  temp_high_c smallint,
  temp_low_c smallint,
  humidity_pct smallint,
  climate_updated_at timestamptz,
  ball text,
  sheet_surface text,
  sheet_url text,
  sheet_checked_at timestamptz,
  updated_at timestamptz not null default now()
);
