from __future__ import annotations

import csv
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fetch_gdelt import fetch_all_gdelt
from normalize import normalize_csv_row, normalize_gdelt_article, stable_id


ROOT = Path(__file__).resolve().parents[1]
GENERATED_DIR = ROOT / "data" / "generated"
IMPORTS_DIR = ROOT / "data" / "imports"

OPTIONAL_API_SOURCES = [
    ("Mediastack", "MEDIASTACK_API_KEY"),
    ("NewsAPI", "NEWSAPI_KEY"),
    ("Brandwatch API", "BRANDWATCH_TOKEN"),
    ("Meltwater API", "MELTWATER_TOKEN"),
    ("Talkwalker API", "TALKWALKER_TOKEN"),
]


def write_json(name: str, value: Any) -> None:
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    path = GENERATED_DIR / name
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def dedupe_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    output: list[dict[str, Any]] = []
    for record in records:
        key = (record.get("url") or "").strip().lower()
        if not key:
            key = stable_id(record.get("title", ""), record.get("date", ""), record.get("company", ""))
        if key in seen:
            continue
        seen.add(key)
        output.append(record)
    return sorted(output, key=lambda item: item.get("date", ""), reverse=True)


def load_csv_imports() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    IMPORTS_DIR.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    files = sorted(IMPORTS_DIR.glob("*.csv"))
    errors: list[str] = []
    for file_path in files:
        try:
            with file_path.open(newline="", encoding="utf-8-sig") as handle:
                reader = csv.DictReader(handle)
                for row in reader:
                    normalized = normalize_csv_row(row)
                    if normalized:
                        records.append(normalized)
        except Exception as exc:  # noqa: BLE001 - surfaced in dashboard metadata.
            errors.append(f"{file_path.name}: {exc}")
    return records, {
        "name": "Brandwatch / Meltwater / Talkwalker CSV exports",
        "rawSource": "CSV",
        "available": bool(files),
        "recordsFetched": len(records),
        "files": [path.name for path in files],
        "errors": errors,
        "credentialRequired": False,
        "notes": "CSV export support is optional. Place CSV files in data/imports with the documented columns.",
    }


def optional_source_statuses() -> list[dict[str, Any]]:
    statuses: list[dict[str, Any]] = []
    for name, env_key in OPTIONAL_API_SOURCES:
        has_key = bool(os.getenv(env_key))
        statuses.append({
            "name": name,
            "rawSource": name.replace(" API", ""),
            "available": False,
            "recordsFetched": 0,
            "credentialRequired": True,
            "configured": has_key,
            "errors": [] if not has_key else ["Connector not implemented in this static pipeline scaffold; add a server-side fetcher before enabling records."],
            "notes": "Skipped unless a server-side fetcher and GitHub Secret are configured. Keys are never exposed to frontend JavaScript.",
        })
    statuses.append({
        "name": "Google Trends via pytrends",
        "rawSource": "Google Trends",
        "available": False,
        "recordsFetched": 0,
        "credentialRequired": False,
        "configured": False,
        "errors": ["Optional source not enabled in requirements."],
        "notes": "Unofficial optional source. If enabled later, write data/generated/search_trends.json and keep failures non-blocking.",
    })
    return statuses


def build_daily_counts(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counter: dict[tuple[str, str], int] = defaultdict(int)
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=89)
    companies = ["Novo Nordisk", "Eli Lilly"]
    for i in range(90):
        date = (start + timedelta(days=i)).isoformat()
        for company in companies:
            counter[(date, company)] = 0
    for record in records:
        counter[(record["date"], record["company"])] += 1
    return [
        {"date": date, "company": company, "count": count}
        for (date, company), count in sorted(counter.items())
    ]


def summarize_by_source(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[record["sourceDomain"] or record["source"]].append(record)
    summary = []
    for source, items in grouped.items():
        summary.append({
            "source": source,
            "sourceTier": most_common(item["sourceTier"] for item in items),
            "channel": most_common(item["channel"] for item in items),
            "mentions": len(items),
            "averageSentimentScore": round(sum(item["sentimentScore"] for item in items) / len(items), 3),
            "reachProxy": sum(item["reach"] for item in items),
            "engagement": sum(item["engagement"] for item in items),
            "rawSources": sorted({item["rawSource"] for item in items}),
        })
    return sorted(summary, key=lambda item: item["mentions"], reverse=True)


def summarize_by_topic(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[(record["company"], record["topic"])].append(record)
    return sorted([
        {
            "company": company,
            "topic": topic,
            "mentions": len(items),
            "averageSentimentScore": round(sum(item["sentimentScore"] for item in items) / len(items), 3),
            "reachProxy": sum(item["reach"] for item in items),
        }
        for (company, topic), items in grouped.items()
    ], key=lambda item: (item["company"], -item["mentions"]))


def build_alerts(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    topic_counts = Counter((record["company"], record["topic"]) for record in records)
    negative_counts = Counter(record["company"] for record in records if record["sentiment"] == "Negative")
    for (company, topic), count in topic_counts.most_common(8):
        if count >= 5:
            alerts.append({
                "level": "info",
                "company": company,
                "title": f"High coverage: {topic}",
                "message": f"{count} real media mentions matched this topic in the current 90-day window.",
            })
    for company, count in negative_counts.items():
        if count >= 5:
            alerts.append({
                "level": "watch",
                "company": company,
                "title": "Negative sentiment watch",
                "message": f"{count} mentions classified as negative by GDELT tone or keyword rules.",
            })
    return alerts


def most_common(values: Any) -> str:
    return Counter(values).most_common(1)[0][0]


def build_metadata(records: list[dict[str, Any]], statuses: list[dict[str, Any]], days: int = 90) -> dict[str, Any]:
    by_source = Counter(record["rawSource"] for record in records)
    dates = [record["date"] for record in records if record.get("date")]
    missing = sorted({status["name"] for status in statuses if not status.get("available")})
    return {
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "coverageWindow": {
            "days": days,
            "start": min(dates) if dates else None,
            "end": max(dates) if dates else None,
        },
        "recordCount": len(records),
        "recordsBySource": dict(sorted(by_source.items())),
        "dataSources": statuses,
        "missingSources": missing,
        "metricDisclosure": {
            "reach": "Proxy for GDELT records based on source tier and authority. CSV imports may contain actuals if supplied by the export owner.",
            "engagement": "Zero for GDELT records because GDELT does not provide true engagement. CSV/API imports may provide actuals.",
            "sourceAuthority": "Rule-based proxy using source domain category.",
        },
        "knownLimitations": [
            "GDELT article search is broad online news coverage, not paid media monitoring.",
            "GDELT does not provide true impressions, reach, or social engagement.",
            "Topic and fallback sentiment classification use deterministic keyword rules.",
            "Standalone Novo and Lilly matches are filtered with GLP-1, diabetes, pharma, or brand context to reduce false positives.",
            "Optional paid/API-key sources are skipped unless server-side fetchers and GitHub Secrets are configured.",
        ],
    }


def main() -> None:
    all_records: list[dict[str, Any]] = []
    statuses: list[dict[str, Any]] = []

    gdelt_days = int(os.getenv("GDELT_DAYS", "90"))
    gdelt_by_company, gdelt_statuses = fetch_all_gdelt(days=gdelt_days)
    statuses.extend(gdelt_statuses)
    for company, articles in gdelt_by_company.items():
        for article in articles:
            normalized = normalize_gdelt_article(article, company)
            if normalized:
                all_records.append(normalized)

    csv_records, csv_status = load_csv_imports()
    all_records.extend(csv_records)
    statuses.append(csv_status)
    statuses.extend(optional_source_statuses())

    records = dedupe_records(all_records)
    write_json("mentions.json", records)
    write_json("daily_counts.json", build_daily_counts(records))
    write_json("source_summary.json", summarize_by_source(records))
    write_json("topic_summary.json", summarize_by_topic(records))
    write_json("alerts.json", build_alerts(records))
    write_json("metadata.json", build_metadata(records, statuses, days=gdelt_days))
    print(f"Wrote {len(records)} normalized real records to {GENERATED_DIR}")


if __name__ == "__main__":
    main()
