alter table cutoff_snapshots
add column if not exists alternate_entries_count int not null default 0;
