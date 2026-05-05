# Hong Kong cut import patch

Adds a temporary real-data importer route for Hong Kong 2024 and 2025 cut snapshots.

Route after deployment:

```text
/api/import-hong-kong-cuts
```

Data included:
- 2024 singles main cut
- 2024 singles qualifying cut
- 2024 doubles main cut
- 2025 singles main cut
- 2025 singles qualifying cut
- 2025 doubles main cut
- alternate entries count per imported draw

All rows are sourced from official ProTennisLive/ATP draw PDFs and include source_notes in the database.
