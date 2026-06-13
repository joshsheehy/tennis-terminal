-- Swings: distinguish the same year's swings computed for different level
-- filters (ATP-only, ATP+Challenger, ATP+Challenger+ITF, etc.). Additive:
-- a new nullable-with-default column, no rewrite of existing rows. Existing
-- rows adopt the default 'atp+challenger' scope they were computed under.
alter table swings add column if not exists level_scope text not null default 'atp+challenger';

create index if not exists swings_year_scope_idx on swings(year, level_scope);
