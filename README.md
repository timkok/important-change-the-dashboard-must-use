# GLP-1 Media Exposure Dashboard

Pure static HTML/CSS/JavaScript dashboard backed by generated JSON files. The browser reads only `data/generated/*.json`; all data fetching happens in Python before deployment.

## Local development

```bash
python -m pip install -r scripts/requirements.txt
python scripts/build_dataset.py
open index.html
```

If generated files are missing, the dashboard shows: `No generated data found. Run the GitHub Actions workflow or run scripts/build_dataset.py locally.`

For quick connectivity checks you can shorten a local run without changing the default 90-day GitHub Actions build:

```bash
GDELT_DAYS=7 GDELT_TIMEOUT_SECONDS=3 python scripts/build_dataset.py
```

## Real data source

GDELT DOC 2.0 is the default real public news/media source. The pipeline fetches the last 90 days of article results for:

- Novo Nordisk: `"Novo Nordisk"`, Ozempic, Wegovy, Rybelsus, semaglutide, and context-filtered Novo.
- Eli Lilly: `"Eli Lilly"`, Mounjaro, Zepbound, tirzepatide, orforglipron, retatrutide, and context-filtered Lilly.

The standalone terms `Novo` and `Lilly` are treated as valid only when paired with GLP-1, obesity, diabetes, pharma, or relevant brand/drug context.

## Generated files

`scripts/build_dataset.py` writes:

- `data/generated/mentions.json`
- `data/generated/daily_counts.json`
- `data/generated/source_summary.json`
- `data/generated/topic_summary.json`
- `data/generated/alerts.json`
- `data/generated/metadata.json`

All normalized records include `rawSource`.

## Metric caveats

GDELT does not provide true impressions, reach, or social engagement.

- `reach` is a proxy based on source tier and source authority.
- `engagement` is `0` for GDELT records unless imported from CSV or a future paid source.
- `sourceAuthority` is a rule-based domain proxy.

The dashboard labels these as proxies in the data-quality panel.

## Optional sources

Google Trends can be added later with `pytrends` in GitHub Actions only. It is unofficial and should write `data/generated/search_trends.json`; failures should not fail deployment.

Paid/API sources such as Mediastack, NewsAPI, Brandwatch, Meltwater, and Talkwalker must run server-side in GitHub Actions or another backend step. Never expose keys in frontend JavaScript.

Add GitHub repository secrets under `Settings > Secrets and variables > Actions`:

- `MEDIASTACK_API_KEY`
- `NEWSAPI_KEY`
- `BRANDWATCH_TOKEN`
- `MELTWATER_TOKEN`
- `TALKWALKER_TOKEN`

This scaffold reports those optional sources as unavailable until server-side fetchers are implemented.

## CSV imports

Put Brandwatch, Meltwater, or Talkwalker CSV exports in `data/imports/`.

Expected columns:

```text
date, company, channel, source, title, snippet, url, topic, sentiment, reach, engagement, sourceAuthority, matchedKeywords
```

`matchedKeywords` can be pipe-separated, such as `Wegovy|semaglutide`. CSV records are normalized into the same schema and deduplicated by URL, or by title/date/company when URL is missing.

## Change keyword groups

Edit `COMPANY_QUERIES` in `scripts/fetch_gdelt.py` for GDELT query logic and `COMPANY_KEYWORDS` / `STANDALONE_VALIDATORS` in `scripts/normalize.py` for post-fetch matching hygiene.

## Data freshness

Check `data/generated/metadata.json`:

- `lastUpdated`
- `coverageWindow`
- `recordCount`
- `recordsBySource`
- `dataSources`
- `missingSources`

The dashboard also flags freshness in the Data Status panel.

## GitHub Pages deployment

`.github/workflows/deploy.yml` runs on pushes to `main`, daily at `10:00 UTC`, and manual dispatch. It installs Python dependencies, runs `scripts/build_dataset.py`, uploads the static site, and deploys with GitHub Pages.

No mock data is generated. If real sources return no data or optional sources are unavailable, the dashboard remains functional and shows source/status warnings instead of fabricated records.
