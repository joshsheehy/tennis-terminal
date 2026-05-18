# Tennis Terminal

Starter repo for the Tennis Terminal build.

What is included:
- corrected 3-table schema: `tournaments`, `tournament_editions`, `cutoff_snapshots`
- schedule page for first 10 ATP Tour + first 10 Challenger events
- checker page scaffold that uses singles rank + combined doubles ranking input only
- official-source-backed calendar import script
- official ATP Challenger Calendar PDF sync endpoint and workflows

Important note:
- the calendar importer is **not** a PDF parser yet
- it is an honest official-source-backed importer for the first 10 ATP Tour events and first 10 Challenger events
- next step after this repo is live: replace the seeded official-source rows with real PDF parsing

## No-terminal setup path

### Put this into GitHub without terminal
Option A: GitHub Desktop
1. Install GitHub Desktop.
2. Choose **Add an Existing Repository from your Hard Drive** after unzipping this folder.
3. Publish it to GitHub.

Option B: GitHub website
1. Create a new empty GitHub repo.
2. Unzip this folder.
3. Drag all files into the repo upload screen on GitHub.
4. Commit the upload.

## Deploy later
Recommended easiest production path with few moving parts:
- Railway for app + Postgres

## Environment variable
Add this in Railway later:
- `DATABASE_URL`

## Database
Run the SQL in `sql/schema.sql` in your Postgres database before importing calendars.
