# MiniMax GLP-1 Media Exposure Dashboard

A static GitHub Pages dashboard comparing Novo Nordisk vs Eli Lilly media exposure, powered by real GDELT data.

## Purpose

Monitor real-time media coverage of Novo Nordisk and Eli Lilly across GLP-1, obesity, diabetes, products, pipeline, pricing/access, safety, supply, and market-competition topics.

## Data Pipeline

The pipeline runs in GitHub Actions before each deploy:

1. **Fetch** — Queries GDELT DOC 2.0 API for both companies (7-day lookback)
2. **Normalize** — Classifies articles by topic, sentiment, source tier, and entity
3. **Dedup** — Removes duplicate articles by URL or title+date+domain
4. **Write** — Outputs static JSON files to `data/generated/`

## Generated Data Files

| File | Description |
|------|-------------|
| `mentions.json` | All normalized article records |
| `daily_counts.json` | Daily mention counts by company |
| `source_summary.json` | Source domain aggregations |
| `topic_summary.json` | Topic x company matrix |
| `alerts.json` | Data quality and coverage alerts |
| `metadata.json` | Pipeline run metadata |

## GDELT Limitations

- **Rate limits**: GDELT may return HTTP 429 or timeout. The pipeline stops on 429 and continues with available data.
- **No engagement data**: GDELT provides article metadata but not true impressions, shares, or engagement. These are source-tier proxies.
- **No social coverage**: Social posts and Reddit are not captured by GDELT's news index.
- **Language bias**: GDELT favors English-language sources.

## Proxy Metric Caveat

For GDELT records:
- `reach` is a source-tier proxy (Tier 1 = 1M, Trade = 250K, etc.)
- `engagement` is always 0 for GDELT records
- `sourceAuthority` is a rule-based score (45–90)
- `isProxyMetrics: true` flags these as approximations

## Run Locally

```bash
# Install dependencies
pip install -r minimax-version/scripts/requirements.txt

# Run the data pipeline
python -u minimax-version/scripts/build_dataset.py

# Validate outputs
python minimax-version/scripts/validate_generated_data.py
python minimax-version/scripts/validate_dashboard_paths.py

# Serve locally (for preview)
python -m http.server 8000
# Then open http://localhost:8000/minimax-version/
```

## Deploy

Push to `main` with changes in `minimax-version/**` or run the `deploy-minimax` workflow manually via `workflow_dispatch`.

The workflow uploads the repository root so all versions (codex, kimi, claude, minimax) are available on GitHub Pages.

## Compare Versions

| Version | URL |
|---------|-----|
| Codex | https://timkok.github.io/important-change-the-dashboard-must-use/codex-version/ |
| Kimi | https://timkok.github.io/important-change-the-dashboard-must-use/kimi-version/ |
| Claude | https://timkok.github.io/important-change-the-dashboard-must-use/claude-version/ |
| MiniMax | https://timkok.github.io/important-change-the-dashboard-must-use/minimax-version/ |

See [COMPARISON_NOTES.md](./COMPARISON_NOTES.md) for detailed implementation differences.