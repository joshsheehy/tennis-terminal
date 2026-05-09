alter table cutoff_snapshots
  add column if not exists lucky_loser_count int not null default 0;
