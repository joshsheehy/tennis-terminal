# Hong Kong historical edition import

This patch imports real, source-backed historical tournament editions for Bank of China Hong Kong Tennis Open:

- 2023: Not held. ATP announced the event returned in 2024 after a 21-year absence.
- 2024: ATP 250, Hong Kong, outdoor hard, Week 1, 1-7 Jan 2024.
- 2025: ATP 250, Hong Kong, outdoor hard, Week 1, 30 Dec 2024-5 Jan 2025.

It does not invent cut data. Cut rows remain empty until official draw PDFs are parsed.

## Run after uploading

Open:

```text
https://YOUR-RAILWAY-APP-URL/api/import-hong-kong-history
```

Expected result:

```json
{"ok":true,"imported":true,"rowsImported":3}
```
