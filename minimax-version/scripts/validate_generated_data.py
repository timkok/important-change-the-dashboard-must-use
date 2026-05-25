#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path


MINIMAX_ROOT = Path(__file__).resolve().parents[1]
GENERATED_DIR = MINIMAX_ROOT / "data" / "generated"

REQUIRED_FILES = [
    "mentions.json",
    "daily_counts.json",
    "source_summary.json",
    "topic_summary.json",
    "alerts.json",
    "metadata.json",
]

REQUIRED_MENTION_FIELDS = [
    "id", "date", "company", "matchedEntity", "channel", "source", "sourceDomain",
    "sourceTier", "title", "snippet", "url", "topic", "sentiment", "sentimentScore",
    "reach", "engagement", "sourceAuthority", "matchedKeywords", "rawSource",
    "isProxyMetrics",
]

FAKE_DATA_MARKERS = ["example.com", "test-record", "mock-", "fake-", "placeholder"]


def check_metadata() -> tuple[bool, str]:
    path = GENERATED_DIR / "metadata.json"
    if not path.is_file():
        return False, "metadata.json is missing"
    try:
        meta = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        return False, f"metadata.json is invalid JSON: {e}"
    for field in ["lastUpdated", "coverageStart", "coverageEnd", "recordCount", "warnings"]:
        if field not in meta:
            return False, f"metadata.json missing required field: {field}"
    if meta.get("version") != "minimax":
        return False, f"metadata.json version is '{meta.get('version')}', expected 'minimax'"
    return True, "OK"


def check_mentions() -> tuple[bool, str]:
    path = GENERATED_DIR / "mentions.json"
    if not path.is_file():
        return False, "mentions.json is missing"
    try:
        records = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        return False, f"mentions.json is invalid JSON: {e}"
    if not isinstance(records, list):
        return False, "mentions.json must be an array"
    if len(records) == 0:
        meta_path = GENERATED_DIR / "metadata.json"
        if meta_path.is_file():
            meta = json.loads(meta_path.read_text())
            if not meta.get("warnings"):
                return False, "mentions.json is empty but metadata has no warnings"
        return True, "Empty mentions allowed with warnings"
    for i, record in enumerate(records):
        for field in REQUIRED_MENTION_FIELDS:
            if field not in record:
                return False, f"Record {i} missing field: {field}"
        company = record.get("company")
        if company not in ("Novo Nordisk", "Eli Lilly"):
            return False, f"Record {i} invalid company: {company}"
        sentiment = record.get("sentiment")
        if sentiment not in ("Positive", "Neutral", "Negative"):
            return False, f"Record {i} invalid sentiment: {sentiment}"
        for marker in FAKE_DATA_MARKERS:
            if marker in (record.get("url") or "").lower():
                return False, f"Record {i} contains fake data marker in URL: {marker}"
            if marker in (record.get("sourceDomain") or "").lower():
                return False, f"Record {i} contains fake data marker in sourceDomain: {marker}"
    return True, f"OK ({len(records)} records)"


def check_generated_files() -> tuple[bool, str]:
    missing = [f for f in REQUIRED_FILES if not (GENERATED_DIR / f).is_file()]
    if missing:
        return False, f"Missing files: {', '.join(missing)}"
    return True, "OK"


def main() -> int:
    all_ok = True
    checks = [
        ("generated files", check_generated_files),
        ("metadata.json", check_metadata),
        ("mentions.json", check_mentions),
    ]
    for name, fn in checks:
        ok, msg = fn()
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {name}: {msg}")
        if not ok:
            all_ok = False
    if all_ok:
        print("\nAll validation checks passed.")
        return 0
    print("\nValidation FAILED.")
    return 1


if __name__ == "__main__":
    sys.exit(main())