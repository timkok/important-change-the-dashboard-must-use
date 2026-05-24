# GLP-1 Media Exposure Dashboard (Antigravity Version)

This is the independent **Antigravity** implementation of the Novo Nordisk vs Eli Lilly media exposure comparison dashboard.

## Key Features

1. **Real-time GDELT Data Fetching**: Automates fetching from GDELT DOC 2.0 API in date windows without browser-side keys.
2. **Context-Hygiene Filters**: Post-fetch validation that strips false positive standalone matches for `"Novo"` and `"Lilly"` unless relevant GLP-1, obesity, or diabetes contexts are present.
3. **Advanced URL and Title Deduplication**: Cleans tracking tags and parameters, checks matching URLs, and falls back to string-stripped titles, source domain, and date.
4. **Data Quality Transparency**: Injects warnings about GDELT proxy metrics (such as reach and authority scores) and explains them directly in the UI.
5. **No Local Dependencies**: Renders high-performance, dynamic charts using native SVG elements (no external JS library dependencies like Chart.js or D3).

## Directory Structure

```
media-dashboard-comparison/antigravity/
  index.html            <- Frontend interface
  styles.css            <- CSS styles
  app.js                <- Data bind logic & SVG renderers
  README.md             <- This file
  COMPARISON_NOTES.md   <- Side-by-side comparison notes
  data/
    generated/          <- Output folder for GDELT data
    imports/            <- Optional CSV imports folder
  scripts/
    requirements.txt    <- Python dependencies
    fetch_gdelt.py      <- API window client
    normalize.py        <- Cleans URLs, filters entity context
    import_csv.py       <- Custom CSV loader
    build_dataset.py    <- Orchestrates the data build
```

## Setup & Running Locally

### Backend Data Pipeline

1. Install Python 3.11+ dependencies:
   ```bash
   pip install -r scripts/requirements.txt
   ```

2. Run the data build pipeline:
   ```bash
   python scripts/build_dataset.py
   ```
   *For a quick test, you can run:*
   ```bash
   GDELT_DAYS=7 python scripts/build_dataset.py
   ```

### Frontend Dashboard

1. Launch a local web server from the project root directory:
   ```bash
   python3 -m http.server 8000
   ```
2. Navigate to `http://localhost:8000/antigravity/` in your web browser.

## Metric Proxy Caveats

GDELT does not provide native social engagement or impression metrics.
- `reach` is mapped as a proxy based on domain tiers (Tier 1 = 100k, Finance = 50k, Trade = 35k, Other = 10k).
- `engagement` defaults to `0` for GDELT records.
- `sourceAuthority` maps domain tiers from 45 to 95.

True reach and engagement are only populated when utilizing optional Brandwatch, Meltwater, or Talkwalker CSV imports.

## CSV Imports

To import analyst-provided CSV data, drop standard CSV files into the `data/imports/` folder before running `build_dataset.py`.
CSV columns:
`date, company, channel, source, title, snippet, url, topic, sentiment, reach, engagement, sourceAuthority, matchedKeywords`
