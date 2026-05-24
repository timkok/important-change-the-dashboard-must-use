from __future__ import annotations

import os
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fetch_gdelt import fetch_gdelt_window
from import_csv import load_optional_csv_imports
from normalize import (
    QUERY_DEFINITIONS,
    dedupe_mentions,
    normalize_gdelt_article
)

ROOT = Path(__file__).resolve().parents[1]
GENERATED_DIR = ROOT / "data" / "generated"
IMPORT_DIR = ROOT / "data" / "imports"

def date_windows(days: int = 90, window_days: int = 10) -> list[tuple[datetime, datetime]]:
    """Split date range into smaller manageable chunks to prevent query exhaustion."""
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    windows = []
    cursor = start
    while cursor < end:
        window_end = min(cursor + timedelta(days=window_days), end)
        windows.append((cursor, window_end))
        cursor = window_end
    return windows

def write_json(name: str, payload: Any) -> None:
    """Safely write data structure to a JSON file."""
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    target = GENERATED_DIR / name
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

def build_daily_counts(mentions: list[dict[str, Any]], start_str: str, end_str: str) -> list[dict[str, Any]]:
    """Compute daily counts and share of voice percentage over the coverage window."""
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    for item in mentions:
        date_val = item.get("date")
        if date_val:
            counts[date_val][item["company"]] += 1
            
    rows = []
    day = datetime.fromisoformat(start_str).date()
    last = datetime.fromisoformat(end_str).date()
    
    while day <= last:
        key = day.isoformat()
        novo = counts[key]["Novo Nordisk"]
        lilly = counts[key]["Eli Lilly"]
        total = novo + lilly
        rows.append({
            "date": key,
            "Novo Nordisk": novo,
            "Eli Lilly": lilly,
            "total": total,
            "novoShare": round(novo / total, 4) if total else 0.0,
            "lillyShare": round(lilly / total, 4) if total else 0.0,
        })
        day += timedelta(days=1)
    return rows

def grouped_summary(mentions: list[dict[str, Any]], field: str) -> list[dict[str, Any]]:
    """Aggregate mentions by a grouping field (e.g. sourceDomain, topic)."""
    groups: dict[str, Counter[str]] = defaultdict(Counter)
    for item in mentions:
        val = item.get(field) or "Unknown"
        groups[val][item["company"]] += 1
        
    rows = []
    for name, counter in sorted(groups.items(), key=lambda pair: sum(pair[1].values()), reverse=True):
        total = counter["Novo Nordisk"] + counter["Eli Lilly"]
        rows.append({
            field: name,
            "Novo Nordisk": counter["Novo Nordisk"],
            "Eli Lilly": counter["Eli Lilly"],
            "total": total,
            "novoShare": round(counter["Novo Nordisk"] / total, 4) if total else 0.0,
            "lillyShare": round(counter["Eli Lilly"] / total, 4) if total else 0.0,
        })
    return rows

def generate_alerts(mentions: list[dict[str, Any]], daily_counts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Generate alerts based on rules from GDELT/CSV mentions in the last 7 days.
    """
    alerts = []
    now_date = datetime.now(timezone.utc).date()
    recent_cutoff = (now_date - timedelta(days=7)).isoformat()
    
    recent = [m for m in mentions if m.get("date", "") >= recent_cutoff]
    older = [m for m in mentions if m.get("date", "") < recent_cutoff]
    
    def add(kind: str, severity: str, title: str, detail: str, company: str = "Both") -> None:
        alerts.append({
            "id": f"{kind.replace(' ', '_').lower()}-{len(alerts) + 1}",
            "type": kind,
            "severity": severity,
            "company": company,
            "title": title,
            "detail": detail,
            "date": now_date.isoformat(),
        })

    # Rule 1: Negative Sentiment Spike
    if recent:
        recent_negative = sum(1 for m in recent if m["sentiment"] == "Negative")
        recent_neg_rate = recent_negative / len(recent)
        older_negative = sum(1 for m in older if m["sentiment"] == "Negative")
        older_neg_rate = (older_negative / len(older)) if older else 0.0
        
        if recent_neg_rate >= max(0.25, older_neg_rate * 1.5):
            add(
                "Negative sentiment spike",
                "High",
                "Negative Sentiment Spike Detected",
                f"{recent_neg_rate:.1%} of recent mentions are negative, compared to {older_neg_rate:.1%} in prior period."
            )

    # Rule 2: Safety, Pricing, Regulatory, Shortage topic spikes
    topic_alerts = [
        ("Side effects / safety", "Safety topic spike", "High"),
        ("Drug pricing / insurance / access", "Pricing/access topic spike", "Medium"),
        ("Legal / regulatory", "Legal/regulatory topic spike", "High"),
        ("Supply shortage", "Supply shortage spike", "High"),
    ]
    for topic, alert_type, severity in topic_alerts:
        count = sum(1 for m in recent if m.get("topic") == topic)
        if count >= 3:
            add(
                alert_type,
                severity,
                f"Topic Spike: {topic}",
                f"There are {count} mentions of {topic} in the last 7 days."
            )

    # Rule 3: Tier 1 Article Published
    for item in recent:
        if item.get("sourceTier") == "Tier 1":
            add(
                "Tier 1 article published",
                "Medium",
                f"Tier 1 Coverage: {item['source']}",
                f"Published '{item['title']}' covering {item['company']}.",
                item["company"]
            )
            # Log only the first one to avoid alert spam
            break

    # Rule 4: Share of Voice Leaderboard Changes (+10% difference)
    if recent:
        recent_total = len(recent)
        novo_count = sum(1 for m in recent if m["company"] == "Novo Nordisk")
        lilly_count = sum(1 for m in recent if m["company"] == "Eli Lilly")
        
        novo_sov = novo_count / recent_total
        lilly_sov = lilly_count / recent_total
        
        if (lilly_sov - novo_sov) > 0.10:
            add(
                "Lilly SOV exceeds Novo by more than 10 percentage points",
                "Medium",
                "Eli Lilly SOV Dominance",
                f"Eli Lilly has a {lilly_sov:.1%} share of voice vs Novo Nordisk's {novo_sov:.1%} in recent coverage.",
                "Eli Lilly"
            )
        elif (novo_sov - lilly_sov) > 0.10:
            add(
                "Novo SOV exceeds Lilly by more than 10 percentage points",
                "Medium",
                "Novo Nordisk SOV Dominance",
                f"Novo Nordisk has a {novo_sov:.1%} share of voice vs Eli Lilly's {lilly_sov:.1%} in recent coverage.",
                "Novo Nordisk"
            )

    # Rule 5: Pipeline Term Spike (orforglipron, retatrutide)
    pipeline_count = sum(
        1 for m in recent 
        if any(term in m.get("matchedKeywords", []) for term in {"orforglipron", "retatrutide"})
    )
    if pipeline_count >= 2:
        add(
            "Pipeline term spike: orforglipron or retatrutide",
            "Medium",
            "Next-Gen Pipeline Coverage Spike",
            f"Next-gen pipeline ingredients (orforglipron, retatrutide) were mentioned {pipeline_count} times in the last 7 days.",
            "Eli Lilly"
        )

    return alerts

def main() -> int:
    warnings: list[str] = []
    raw_mentions: list[dict[str, Any]] = []
    
    # Check GDELT days override via environment variable
    try:
        total_days = int(os.environ.get("GDELT_DAYS", "90"))
    except ValueError:
        total_days = 90
        
    coverage_end = datetime.now(timezone.utc).date()
    coverage_start = coverage_end - timedelta(days=total_days)
    
    # Fetch GDELT data
    windows = date_windows(days=total_days, window_days=10)
    for company, definition in QUERY_DEFINITIONS.items():
        for start, end in windows:
            articles, window_warnings = fetch_gdelt_window(definition["query"], start, end)
            warnings.extend(window_warnings)
            
            for article in articles:
                normalized = normalize_gdelt_article(article, company)
                if normalized:
                    raw_mentions.append(normalized)
                    
    # Load custom analyst CSVs
    csv_records, csv_warnings = load_optional_csv_imports(IMPORT_DIR)
    warnings.extend(csv_warnings)
    
    # Deduplicate GDELT & CSV
    deduped_mentions, dedupe_summary = dedupe_mentions(raw_mentions + csv_records)
    
    # Empty state validation
    if not deduped_mentions:
        warnings.append("GDELT returned zero records for the configured queries.")
        
    # Aggregate data structures
    daily_counts = build_daily_counts(
        deduped_mentions,
        coverage_start.isoformat(),
        coverage_end.isoformat()
    )
    source_summary = grouped_summary(deduped_mentions, "sourceDomain")
    topic_summary = grouped_summary(deduped_mentions, "topic")
    alerts = generate_alerts(deduped_mentions, daily_counts)
    
    metadata = {
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "coverageStart": coverage_start.isoformat(),
        "coverageEnd": coverage_end.isoformat(),
        "recordCount": len(deduped_mentions),
        "sourcesUsed": ["GDELT"] + (["CSV"] if csv_records else []),
        "sourcesUnavailable": ["Mediastack", "NewsAPI", "Brandwatch", "Meltwater", "Talkwalker"],
        "proxyMetricFields": ["reach", "sourceAuthority", "engagement"],
        "warnings": warnings,
        "queryDefinitions": QUERY_DEFINITIONS,
        "deduplicationSummary": dedupe_summary,
        "version": "antigravity"
    }
    
    # Write files to generated directory
    write_json("mentions.json", deduped_mentions)
    write_json("daily_counts.json", daily_counts)
    write_json("source_summary.json", source_summary)
    write_json("topic_summary.json", topic_summary)
    write_json("alerts.json", alerts)
    write_json("metadata.json", metadata)
    
    print(f"Data pipeline finished successfully. Total records: {len(deduped_mentions)}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
