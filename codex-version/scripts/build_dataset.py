from __future__ import annotations

import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fetch_gdelt import QUERY_DEFINITIONS, fetch_all_gdelt
from import_csv import load_csv_imports
from normalize import normalize_gdelt_article, stable_id


CODEX_ROOT = Path(__file__).resolve().parents[1]
GENERATED_DIR = CODEX_ROOT / "data" / "generated"
IMPORTS_DIR = CODEX_ROOT / "data" / "imports"
REQUIRED_FILES = ["mentions.json", "daily_counts.json", "source_summary.json", "topic_summary.json", "alerts.json", "metadata.json"]

OPTIONAL_SOURCES = [
    ("Mediastack", "MEDIASTACK_API_KEY"),
    ("NewsAPI", "NEWSAPI_KEY"),
    ("Brandwatch", "BRANDWATCH_TOKEN"),
    ("Meltwater", "MELTWATER_TOKEN"),
    ("Talkwalker", "TALKWALKER_TOKEN"),
]


def write_json(name: str, value: Any) -> None:
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    (GENERATED_DIR / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_existing_mentions() -> list[dict[str, Any]]:
    path = GENERATED_DIR / "mentions.json"
    if not path.is_file() or path.stat().st_size == 0:
        return []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except json.JSONDecodeError:
        return []


def dedupe_key(record: dict[str, Any]) -> str:
    url = (record.get("url") or "").strip().lower()
    if url:
        return f"url:{url}"
    title = (record.get("title") or "").strip().lower()
    date = (record.get("date") or "").strip()
    domain = (record.get("sourceDomain") or record.get("source") or "").strip().lower()
    return f"title:{title}|date:{date}|domain:{domain}"


def dedupe(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    output: list[dict[str, Any]] = []
    for record in records:
        key = dedupe_key(record)
        if key in seen:
            continue
        seen.add(key)
        output.append(record)
    return sorted(output, key=lambda row: row.get("date", ""), reverse=True)


def rolling_window(records: list[dict[str, Any]], days: int, end_date: datetime.date) -> list[dict[str, Any]]:
    start_date = end_date - timedelta(days=days - 1)
    return [
        record for record in records
        if start_date.isoformat() <= str(record.get("date", ""))[:10] <= end_date.isoformat()
    ]


def daily_counts(records: list[dict[str, Any]], days: int) -> list[dict[str, Any]]:
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days - 1)
    counts: dict[tuple[str, str], int] = defaultdict(int)
    for i in range(days):
        date = (start + timedelta(days=i)).isoformat()
        for company in QUERY_DEFINITIONS:
            counts[(date, company)] = 0
    for record in records:
        counts[(record["date"], record["company"])] += 1
    return [{"date": date, "company": company, "count": count} for (date, company), count in sorted(counts.items())]


def source_summary(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[record["sourceDomain"] or record["source"]].append(record)
    rows = []
    for source, items in grouped.items():
        rows.append({
            "source": source,
            "mentions": len(items),
            "sourceTier": Counter(item["sourceTier"] for item in items).most_common(1)[0][0],
            "channel": Counter(item["channel"] for item in items).most_common(1)[0][0],
            "reach": sum(item["reach"] for item in items),
            "engagement": sum(item["engagement"] for item in items),
            "isProxyMetrics": all(item.get("isProxyMetrics") for item in items),
        })
    return sorted(rows, key=lambda item: item["mentions"], reverse=True)


def topic_summary(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[(record["company"], record["topic"])].append(record)
    return sorted([
        {
            "company": company,
            "topic": topic,
            "mentions": len(items),
            "averageSentimentScore": round(sum(item["sentimentScore"] for item in items) / len(items), 3),
            "reach": sum(item["reach"] for item in items),
        }
        for (company, topic), items in grouped.items()
    ], key=lambda item: (item["company"], -item["mentions"]))


def alerts(records: list[dict[str, Any]], warnings: list[str]) -> list[dict[str, Any]]:
    rows = [{"level": "warning", "company": "All", "title": "Data quality warning", "message": warning} for warning in warnings]
    topic_counts = Counter((row["company"], row["topic"]) for row in records)
    for (company, topic), count in topic_counts.most_common(8):
        if count >= 5:
            rows.append({"level": "info", "company": company, "title": f"High coverage: {topic}", "message": f"{count} mentions in the current window."})
    return rows


def optional_statuses() -> list[dict[str, Any]]:
    rows = []
    for name, env_key in OPTIONAL_SOURCES:
        rows.append({
            "name": name,
            "rawSource": name,
            "available": False,
            "configured": bool(os.getenv(env_key)),
            "recordsFetched": 0,
            "credentialRequired": True,
            "errors": [] if not os.getenv(env_key) else ["No server-side connector implemented in this Codex version yet."],
        })
    rows.append({
        "name": "Google Trends",
        "rawSource": "Google Trends",
        "available": False,
        "configured": False,
        "recordsFetched": 0,
        "credentialRequired": False,
        "errors": ["Optional unofficial pytrends source is not enabled."],
    })
    return rows


def metadata(
    records: list[dict[str, Any]],
    statuses: list[dict[str, Any]],
    warnings: list[str],
    coverage_start: str,
    coverage_end: str,
    pipeline_stats: dict[str, Any],
) -> dict[str, Any]:
    return {
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "coverageStart": coverage_start,
        "coverageEnd": coverage_end,
        "recordCount": len(records),
        "sourcesUsed": sorted({row["rawSource"] for row in records}),
        "sourcesUnavailable": sorted({status["name"] for status in statuses if not status.get("available")}),
        "proxyMetricFields": ["reach", "engagement", "sourceAuthority"],
        "warnings": warnings,
        "queryDefinitions": QUERY_DEFINITIONS,
        "deduplicationMethod": "Deduplicated by normalized URL first, then title + date + sourceDomain when URL is missing.",
        "falsePositiveHandling": "Standalone Novo/Lilly matches require GLP-1, obesity, diabetes, or pharma context before inclusion.",
        "version": "codex",
        **pipeline_stats,
    }


def main() -> int:
    days = int(os.getenv("GDELT_DAYS", "90"))
    lookback_days = int(os.getenv("GDELT_LOOKBACK_DAYS", "5"))
    full_refresh = os.getenv("FULL_REFRESH", "false").lower() == "true"
    fetch_days = days if full_refresh else max(3, min(lookback_days, 7))
    fetch_mode = "full" if full_refresh else "incremental"
    coverage_end = datetime.now(timezone.utc).date()
    coverage_start = coverage_end - timedelta(days=days - 1)
    existing_records = read_existing_mentions()
    fetched_records: list[dict[str, Any]] = []
    statuses: list[dict[str, Any]] = []
    warnings: list[str] = []

    gdelt_by_company, gdelt_statuses = fetch_all_gdelt(fetch_days)
    statuses.extend(gdelt_statuses)
    for company, articles in gdelt_by_company.items():
        for article in articles:
            normalized = normalize_gdelt_article(article, company)
            if normalized:
                fetched_records.append(normalized)

    csv_records, csv_status = load_csv_imports(IMPORTS_DIR)
    statuses.append(csv_status)
    statuses.extend(optional_statuses())

    previous_count = len(existing_records)
    newly_fetched_count = len(fetched_records) + len(csv_records)
    if full_refresh and fetched_records:
        candidate_records = [*fetched_records, *csv_records]
    else:
        candidate_records = [*existing_records, *fetched_records, *csv_records]
    deduped_records = dedupe(candidate_records)
    deduplicated_count = len(candidate_records) - len(deduped_records)
    records = rolling_window(deduped_records, days, coverage_end)
    preserved_existing = bool(existing_records) and not fetched_records
    if preserved_existing:
        warnings.append("GDELT returned zero new records; preserved existing healthy generated dataset.")
    if not records:
        warnings.append("GDELT returned zero records for the configured queries.")

    pipeline_stats = {
        "previousRecordCount": previous_count,
        "newlyFetchedCount": newly_fetched_count,
        "deduplicatedCount": deduplicated_count,
        "finalRecordCount": len(records),
        "fetchMode": fetch_mode,
        "preservedExistingData": preserved_existing,
        "csvImportErrors": csv_status.get("errors", []),
    }

    write_json("mentions.json", records)
    write_json("daily_counts.json", daily_counts(records, days))
    write_json("source_summary.json", source_summary(records))
    write_json("topic_summary.json", topic_summary(records))
    write_json("alerts.json", alerts(records, warnings))
    write_json("metadata.json", metadata(records, statuses, warnings, coverage_start.isoformat(), coverage_end.isoformat(), pipeline_stats))

    missing_or_empty = [name for name in REQUIRED_FILES if not (GENERATED_DIR / name).is_file() or (GENERATED_DIR / name).stat().st_size == 0]
    if missing_or_empty:
        print(f"Required generated files could not be written: {', '.join(missing_or_empty)}", file=sys.stderr)
        return 1
    print(f"Wrote {len(records)} Codex records to {GENERATED_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
