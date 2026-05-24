# Codex Media Exposure Dashboard

This is the Codex version of the static GLP-1 media exposure dashboard. It is designed to run from GitHub Pages at:

```text
https://USERNAME.github.io/REPO_NAME/codex-version/
```

The browser loads only generated static JSON files from `./data/generated/*.json`. It does not call GDELT or paid media APIs from frontend JavaScript and does not expose API keys.

## Local data build

```bash
python -m pip install -r codex-version/scripts/requirements.txt
python codex-version/scripts/build_dataset.py
```

For quick local connectivity checks:

```bash
GDELT_DAYS=7 GDELT_TIMEOUT_SECONDS=3 python codex-version/scripts/build_dataset.py
```

## Data sources

GDELT DOC 2.0 is the default public/free real-data source. The Python pipeline fetches the last 90 days for:

- Novo Nordisk: `("Novo Nordisk" OR Ozempic OR Wegovy OR Rybelsus OR semaglutide OR "oral semaglutide")`
- Eli Lilly: `("Eli Lilly" OR Mounjaro OR Zepbound OR tirzepatide OR orforglipron OR retatrutide)`

CSV exports from Brandwatch, Meltwater, or Talkwalker can be placed in `codex-version/data/imports/` with:

```text
date, company, channel, source, title, snippet, url, topic, sentiment, reach, engagement, sourceAuthority, matchedKeywords
```

Optional paid/API sources must be fetched server-side in GitHub Actions or another backend step. Keys belong in GitHub Secrets and must never be exposed in frontend JavaScript.

## Metric caveat

GDELT does not provide true impressions or social engagement. For GDELT records:

- `reach` is a source-tier proxy.
- `engagement` is `0`.
- `sourceAuthority` is rule-based.
- `isProxyMetrics` is `true`.

The dashboard labels these fields as proxies.

## Generated files

The pipeline writes:

- `codex-version/data/generated/mentions.json`
- `codex-version/data/generated/daily_counts.json`
- `codex-version/data/generated/source_summary.json`
- `codex-version/data/generated/topic_summary.json`
- `codex-version/data/generated/alerts.json`
- `codex-version/data/generated/metadata.json`

If GDELT returns zero records, the files are still valid JSON and `metadata.json` includes:

```json
{
  "recordCount": 0,
  "warnings": ["GDELT returned zero records for the configured queries."]
}
```

No mock records are created.

## Hosted GitHub Pages deployment

1. Push `codex-version` and `.github/workflows/deploy-codex.yml` to `main`.
2. Go to GitHub repo Settings -> Pages.
3. Under Build and deployment, select GitHub Actions.
4. Run the `Deploy Codex media dashboard` workflow manually or push to `main`.
5. Open `https://USERNAME.github.io/REPO_NAME/codex-version/`.
6. Confirm the Data Quality tab shows the generated data timestamp.
7. Confirm generated data files are accessible from `https://USERNAME.github.io/REPO_NAME/codex-version/data/generated/metadata.json`.

GitHub Pages serves one deployed artifact per repository. This Codex workflow prepares a Pages artifact with a top-level `codex-version/` folder so the dashboard opens at `/codex-version/`.
