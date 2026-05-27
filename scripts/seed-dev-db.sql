-- Sample data for local development / tests. Safe to re-run: it clears the
-- three app tables first, then inserts a small spread of tournaments across
-- several weeks, surfaces and levels so the schedule + filter UI is exercised.
begin;

truncate table cutoff_snapshots, tournament_editions, tournaments restart identity cascade;

with t as (
  insert into tournaments (slug, name, city, country) values
    ('buenos-aires-challenger', 'Buenos Aires Challenger', 'Buenos Aires', 'Argentina'),
    ('cordoba-open',            'Cordoba Open',            'Cordoba',      'Argentina'),
    ('itajai',                  'Itajai',                  'Itajai',       'Brazil'),
    ('australian-open',         'Australian Open',         'Melbourne',    'Australia'),
    ('canberra',                'Canberra',                'Canberra',     'Australia'),
    ('rotterdam',               'ABN AMRO Open',           'Rotterdam',    'Netherlands'),
    ('marseille',               'Open 13',                 'Marseille',    'France'),
    ('bengaluru',               'Bengaluru',               'Bengaluru',    'India'),
    ('indian-wells',            'BNP Paribas Open',        'Indian Wells', 'United States'),
    ('brasilia',                'Brasilia',                'Brasilia',     'Brazil'),
    ('thionville',              'Thionville',              'Thionville',   'France'),
    ('miami',                   'Miami Open',              'Miami',        'United States')
  returning id, slug
)
insert into tournament_editions
  (tournament_id, year, week, start_date, end_date, level, surface, indoor, source, status)
select t.id, e.year, e.week, e.start_date, e.end_date, e.level, e.surface, e.indoor, 'seed', 'held'
from t
join (values
  ('buenos-aires-challenger', 2026,  2, date '2026-01-11', date '2026-01-17', 'Challenger 50', 'Clay',        false),
  ('australian-open',         2026,  3, date '2026-01-18', date '2026-01-31', 'Grand Slam',    'Hard',        true),
  ('cordoba-open',            2026,  3, date '2026-01-18', date '2026-01-24', 'ATP 250',       'Clay',        false),
  ('itajai',                  2026,  3, date '2026-01-18', date '2026-01-24', 'Challenger 75', 'Clay',        false),
  ('canberra',                2026,  3, date '2026-01-18', date '2026-01-24', 'Challenger 125','Hard',        false),
  ('rotterdam',               2026,  7, date '2026-02-09', date '2026-02-15', 'ATP 500',       'Indoor Hard', true),
  ('marseille',               2026,  7, date '2026-02-16', date '2026-02-22', 'ATP 250',       'Indoor Hard', true),
  ('bengaluru',               2026,  7, date '2026-02-09', date '2026-02-15', 'Challenger 100','Hard',        false),
  ('indian-wells',            2026,  9, date '2026-03-04', date '2026-03-17', 'ATP 1000',      'Hard',        false),
  ('brasilia',                2026,  9, date '2026-03-02', date '2026-03-08', 'Challenger',    'Clay',        false),
  ('thionville',              2026,  9, date '2026-03-02', date '2026-03-08', 'Challenger',    'Hard',        true),
  ('miami',                   2026, 11, date '2026-03-23', date '2026-04-05', 'ATP 1000',      'Hard',        false)
) as e(slug, year, week, start_date, end_date, level, surface, indoor)
on t.slug = e.slug;

commit;
