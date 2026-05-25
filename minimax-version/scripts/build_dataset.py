from __future__ import annotations

import json
import os
import sys
import signal
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fetch_gdelt import QUERY_DEFINITIONS, fetch_all_gdelt
from import_csv import load_csv_imports
from normalize import normalize_gdelt_article, stable_id


MINIMAX_ROOT = Path(__file__).resolve().parents[1]
GENERATED_DIR = MINIMAX_ROOT / "data" / "generated"
IMPORTS_DIR = MINIMAX_ROOT / "data" / "imports"

REQUIRED_FILES = [
    "mentions.json",
    "daily_counts.json",
    "source_summary.json",
    "topic_summary.json",
    "alerts.json",
    "metadata.json",
]

PIPELINE_TIMEOUT_SECONDS = int(os.getenv("PIPELINE_TIMEOUT_SECONDS", "180"))
LOOKBACK_DAYS = int(os.getenv("LOOKBACK_DAYS", "7"))
MAX_RECORDS_PER_COMPANY = int(os.getenv("MAX_RECORDS_PER_COMPANY", "50"))


class TimeoutException(Exception):
    pass


def timeout_handler(signum, frame):
    raise TimeoutException("Pipeline timed out")


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


def build_alerts(records: list[dict[str, Any]], warnings: list[str]) -> list[dict[str, Any]]:
    rows = [{"level": "warning", "company": "All", "title": "Data quality warning", "message": warning} for warning in warnings]
    topic_counts = Counter((row["company"], row["topic"]) for row in records)
    for (company, topic), count in topic_counts.most_common(8):
        if count >= 5:
            rows.append({"level": "info", "company": company, "title": f"High coverage: {topic}", "message": f"{count} mentions in the current window."})
    return rows


def main() -> None:
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(PIPELINE_TIMEOUT_SECONDS)

    print(f"[MiniMax] Pipeline starting. LOOKBACK_DAYS={LOOKBACK_DAYS}, MAX_RECORDS_PER_COMPANY={MAX_RECORDS_PER_COMPANY}")

    existing = read_existing_mentions()
    previous_count = len(existing)

    by_company, gdelt_statuses = fetch_all_gdelt(days=LOOKBACK_DAYS)

    normalized_records: list[dict[str, Any]] = []
    for company, articles in by_company.items():
        for article in articles[:MAX_RECORDS_PER_COMPANY]:
            record = normalize_gdelt_article(article, company)
            if record:
                normalized_records.append(record)

    csv_records, csv_status = load_csv_imports(IMPORTS_DIR)
    all_sources = gdelt_statuses + [csv_status]

    all_records = normalized_records + csv_records
    all_records = dedupe(all_records)

    coverage_start = ""
    coverage_end = ""
    if all_records:
        dates = sorted(set(r["date"] for r in all_records))
        coverage_start = dates[0] if dates else ""
        coverage_end = dates[-1] if dates else ""

    filtered = rolling_window(all_records, LOOKBACK_DAYS, datetime.now(timezone.utc).date())
    all_records = filtered

    newly_fetched = len(normalized_records)
    sources_used = [s["name"] for s in all_sources if s.get("available")]
    sources_unavailable = [s["name"] for s in all_sources if not s.get("available")]
    warnings: list[str] = []
    for s in all_sources:
        for err in s.get("errors", []):
            warnings.append(f"{s['name']}: {err}")
    if not normalized_records and not csv_records:
        warnings.append("No records fetched from any source. Dashboard will show empty state.")

    write_json("mentions.json", all_records)
    write_json("daily_counts.json", daily_counts(all_records, LOOKBACK_DAYS))
    write_json("source_summary.json", source_summary(all_records))
    write_json("topic_summary.json", topic_summary(all_records))
    write_json("alerts.json", build_alerts(all_records, warnings))
    write_json("metadata.json", {
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "coverageStart": coverage_start,
        "coverageEnd": coverage_end,
        "recordCount": len(all_records),
        "sourcesUsed": sources_used,
        "sourcesUnavailable": sources_unavailable,
        "proxyMetricFields": ["reach", "engagement", "sourceAuthority"],
        "warnings": warnings,
        "queryDefinitions": QUERY_DEFINITIONS,
        "fetchMode": "full",
        "previousRecordCount": previous_count,
        "newlyFetchedCount": newly_fetched,
        "deduplicatedCount": 0,
        "finalRecordCount": len(all_records),
        "preservedExistingData": False,
        "version": "minimax",
    })

    print(f"[MiniMax] Pipeline complete. {len(all_records)} records written. {len(warnings)} warnings.")
    signal.alarm(0)


if __name__ == "__main__":
    main()