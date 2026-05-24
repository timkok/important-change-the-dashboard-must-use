# CSV Import Support

Place one or more `.csv` files in this folder before running `codex-version/scripts/build_dataset.py`.

Required columns:

`date, company, source, title, url`

Expected full schema:

`date, company, channel, source, title, snippet, url, topic, sentiment, reach, engagement, sourceAuthority, matchedKeywords`

Notes:

- `company` must be `Novo Nordisk` or `Eli Lilly`.
- `matchedKeywords` can use `|` between multiple keywords.
- `rawSource` is read from a column when present; otherwise it is set from the CSV filename.
- If `reach` or `engagement` is supplied, the dashboard treats those values as imported metrics instead of GDELT proxy metrics.
- Import validation errors are written into `data/generated/metadata.json`.
