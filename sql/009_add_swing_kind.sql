-- Swings: distinguish a travel chain ('swing') from a single-city residency
-- ('series'). Additive: new column with a default, no rewrite of existing
-- rows (they were all swings under the prior definition).
alter table swings add column if not exists kind text not null default 'swing';
