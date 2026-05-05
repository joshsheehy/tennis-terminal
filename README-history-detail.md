# Tournament detail history patch

Adds the tournament detail view fields Josh requested:

- current tournament edition at top
- last 3 previous calendar years of cuts, when imported
- same level as previous year
- same week as previous year
- alternate entries count per draw/year

Files included:

- `src/app/tournaments/[slug]/page.tsx`
- `src/lib/db.ts`
- `src/lib/types.ts`
- `sql/schema.sql`
- `sql/002_add_alternate_entries_count.sql`

After applying:

1. Run the SQL migration in Railway Postgres:
   `sql/002_add_alternate_entries_count.sql`

2. Deploy.

3. The page will show cut rows when `cutoff_snapshots` has imported data.
