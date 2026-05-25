# MiniMax vs Codex / Kimi / Claude — Comparison Notes

This document explains how the MiniMax implementation compares to Codex, Kimi, and Claude versions of the GLP-1 Media Exposure Dashboard.

## What MiniMax Is

MiniMax was used as the AI system to implement this dashboard directly, with the same data schema, GDELT pipeline, and frontend structure as the other versions.

## Comparison Criteria

### Data Freshness

All versions use the same GDELT DOC 2.0 API with a 7-day lookback. Pipeline settings are identical:
- `LOOKBACK_DAYS = 7`
- `MAX_RECORDS_PER_COMPANY = 50`
- `PIPELINE_TIMEOUT_SECONDS = 180`
- HTTP timeout = 15 seconds
- max retries = 1

Differences come from GDELT's own rate limits and the timing of workflow runs, not from implementation choices.

### Record Count

Record count is determined by GDELT coverage on the day of the run. All versions write the same JSON schema, so record counts are comparable across versions.

### UI Clarity

All versions share the same HTML/CSS structure with tabbed navigation, freshness banner, KPI cards, charts (SVG), article explorer, and risk monitor. The MiniMax version includes the additional "MiniMax vs Codex/Kimi/Claude" section in the Methodology tab.

### Alert Usefulness

Alerts are generated from topic coverage patterns and data quality warnings. All versions use the same `build_alerts()` logic.

### Methodology

All versions use:
- Rule-based topic classification (keyword matching)
- Rule-based sentiment scoring (GDELT tone with fallback keywords)
- Rule-based source tier classification (domain lists)
- Standalone Novo/Lilly false-positive controls with context validators
- URL-first deduplication, then title+date+domain fallback

### Workflow Reliability

The MiniMax workflow:
- Runs on push to main when `minimax-version/**` changes
- Supports `workflow_dispatch` for manual runs
- Supports daily schedule at 11:00 UTC
- Uploads the repository root to preserve all version URLs
- Uses `deploy-pages@v4`

### Runtime Behavior

- Pure HTML/CSS/vanilla JavaScript (no React, no Next.js, no Vite)
- No browser-side API calls to GDELT
- No mock/fake data fallbacks
- Relative paths only (`./data/generated/*.json`)
- Pipeline respects GDELT rate limits (stops on HTTP 429)

## Known Limitations

All versions share these limitations (inherited from GDELT):
1. GDELT does not provide true impressions or social engagement — all `reach`, `engagement`, and `sourceAuthority` values are proxies.
2. Non-English coverage is underrepresented.
3. Social media posts are not captured.
4. Paid/paywalled articles may be undercounted.
5. A single fetch run may return 0 records if GDELT rate limits or time out.

The dashboard shows an honest empty state with metadata warnings when no data is available.

## Implementation Notes

- MiniMax version includes `version: "minimax"` in `metadata.json`.
- HTML title says "MiniMax Media Exposure Dashboard".
- Version label in the top-left says "MiniMax version".
- Methodology tab links to all other version URLs.

## Files Unique to MiniMax Version

```
minimax-version/
  index.html          # MiniMax version label
  styles.css          # Shared CSS
  app.js              # Shared JS with MiniMax DATA_PATHS
  README.md           # MiniMax-specific documentation
  COMPARISON_NOTES.md # This file
  data/
    generated/        # Pipeline outputs
    imports/          # CSV import directory
  scripts/
    fetch_gdelt.py    # GDELT fetch with rate-limit handling
    normalize.py      # Article normalization
    import_csv.py     # CSV import support
    build_dataset.py  # Main pipeline orchestrator
    validate_generated_data.py  # Data validation
    validate_dashboard_paths.py # Path validation
    requirements.txt  # Python dependencies
  .nojekyll          # GitHub Pages marker
```

## Design Decisions

1. **Timeout handling**: Pipeline uses `signal.SIGALRM` to enforce a hard timeout. This prevents hanging on slow GDELT responses.
2. **429 handling**: When HTTP 429 is received, the pipeline stops further GDELT calls for that company and logs a warning. It does not retry indefinitely.
3. **Empty state**: If no records are fetched, `mentions.json` is an empty array and `metadata.json.warnings` contains an explanation. The dashboard renders an honest "no data" state.
4. **Repository root upload**: The GitHub Actions workflow uploads `.` (repository root) so all version folders remain available at their respective URLs.