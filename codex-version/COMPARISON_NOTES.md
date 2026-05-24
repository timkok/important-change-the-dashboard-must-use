# Comparison Notes

## Hosted URLs

- Codex hosted URL: `https://USERNAME.github.io/REPO_NAME/codex-version/`
- Antigravity hosted URL: `https://USERNAME.github.io/REPO_NAME/antigravity-version/`

## Data Freshness Comparison Checklist

- Confirm both dashboards show `lastUpdated`.
- Confirm both metadata files are reachable from the hosted site.
- Compare coverage start and coverage end dates.
- Check whether either workflow reports unavailable sources.

## Data Count Comparison Checklist

- Compare total mention counts.
- Compare counts by company.
- Compare counts by raw source.
- Confirm neither version uses mock or fake records.

## Topic Classification Comparison Checklist

- Compare top topic buckets for Novo Nordisk.
- Compare top topic buckets for Eli Lilly.
- Spot-check keyword matches behind high-volume topics.
- Check whether false-positive handling for broad company terms is documented.

## Alert Quality Comparison Checklist

- Compare alert count and severity.
- Check whether alerts are explainable from generated records.
- Confirm zero-record cases produce data-quality warnings instead of fake alerts.

## UX Comparison Checklist

- Confirm both dashboards open without local setup.
- Confirm tabs render on desktop and mobile widths.
- Confirm article titles and URLs are visible when real records exist.
- Confirm proxy metrics are clearly labeled.

## Deployment Reliability Comparison Checklist

- Confirm the latest GitHub Actions run succeeded.
- Confirm Pages serves CSS, JS, and JSON without broken paths.
- Confirm optional paid/API sources fail gracefully when secrets are absent.
- Confirm deploying one version does not overwrite the other intended hosted path.
