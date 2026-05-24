# Comparison Notes: Codex vs Antigravity Versions

This document details the comparison parameters between the **Codex** and **Antigravity** implementations of the GLP-1 Media Exposure Dashboard.

## Key Comparison Dimensions

### 1. Data Quality & Hygiene Controls

- **Codex Version**: Performs basic filtering. May retain broad, context-free occurrences of the terms `"Novo"` or `"Lilly"` which can contain non-pharma noise (such as unrelated individuals, sports teams, or local news).
- **Antigravity Version**: Integrates a strict context-hygiene validator in `normalize.py`. If an article only matches `"Novo"`, it is discarded unless it also matches high-affinity GLP-1 keywords (Ozempic, Wegovy, Rybelsus, semaglutide, GLP-1, obesity, diabetes, pharmaceutical, pharma). This dramatically increases the relevance of the dataset.

### 2. Deduplication Power

- **Codex Version**: Performs standard deduplication by URL. If URL is missing, matches title.
- **Antigravity Version**: Performs dual-layer deduplication. It strips query trailing tags, subdomains, tracking variables (`utm_*`, `gclid`), and normalizes URLs. If a URL is missing, it strips and collapses the titles to pure alphanumeric characters for exact matches alongside dates and domains. Detailed logs of duplicates removed by URL vs Fallback methods are stored inside the generated `metadata.json` for auditable counts.

### 3. Frontend Architecture & Chart Performance

- **Codex Version**: Relies on standard JS chart rendering libraries (or simple fallbacks).
- **Antigravity Version**: Implements pure, lightweight SVG visualization renderers directly in vanilla JS. This keeps the application extremely performant, completely responsive, and free from heavy client-side network dependencies.

### 4. Transparency

- **Codex Version**: Displays metrics directly.
- **Antigravity Version**: Dedicates a specific "Data Quality" tab to transparency. It prints data source statistics, deduplication summaries, active pipeline warnings, GDELT API queries, and highlights clearly in the Explorer that reach and authority are proxies.

---

## Comparison Summary Table

| Metric / Feature | Codex version | Antigravity version |
| :--- | :--- | :--- |
| **Topic Classification** | Basic keyword check | 16 refined GLP-1 specific topic buckets |
| **URL Sanitization** | Strict string comparison | Strips subdomains, tracking query parameters |
| **Secondary Deduplication** | Match title string | Strips all punctuation and spaces for comparison |
| **UI Aesthetics** | Default light/simple theme | Premium dark mode, glassmorphism, right-drawer panel |
| **Chart Libraries** | External/Mock | Pure, native, lightweight responsive SVG |
| **Pipeline Diagnostics** | Minimal logs | Active warnings & duplicate metrics in `metadata.json` |
