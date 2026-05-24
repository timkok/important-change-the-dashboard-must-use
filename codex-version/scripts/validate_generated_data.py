from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
GENERATED = ROOT / "data" / "generated"
REQUIRED_RECORD_FIELDS = {
    "date",
    "company",
    "source",
    "sourceDomain",
    "title",
    "url",
    "topic",
    "sentiment",
    "sentimentScore",
    "reach",
    "engagement",
    "sourceAuthority",
    "sourceTier",
    "rawSource",
    "matchedKeywords",
}
MOCK_MARKERS = ("lorem ipsum", "mock", "fake data", "placeholder", "example.com")


def load_json(path: Path) -> Any:
    if not path.is_file() or path.stat().st_size == 0:
        raise AssertionError(f"{path} missing or empty")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise AssertionError(f"{path} is not valid JSON: {exc}") from exc


def main() -> int:
    metadata = load_json(GENERATED / "metadata.json")
    mentions = load_json(GENERATED / "mentions.json")
    if not isinstance(metadata, dict):
        raise AssertionError("metadata.json must be an object")
    if not isinstance(mentions, list):
        raise AssertionError("mentions.json must be an array")
    record_count = int(metadata.get("recordCount", -1))
    if record_count != len(mentions):
        raise AssertionError(f"recordCount {record_count} does not match mentions length {len(mentions)}")
    if metadata.get("previousRecordCount", 0) > 0 and not mentions:
        raise AssertionError("generated data was overwritten with empty records despite previous good data")
    if record_count <= 0:
        raise AssertionError("generated dataset is empty")

    for index, record in enumerate(mentions):
        missing = sorted(REQUIRED_RECORD_FIELDS - set(record))
        if missing:
            raise AssertionError(f"record {index} missing required fields: {', '.join(missing)}")
        haystack = " ".join(str(record.get(key, "")) for key in ("title", "snippet", "source", "url")).lower()
        if any(marker in haystack for marker in MOCK_MARKERS):
            raise AssertionError(f"record {index} appears to contain mock/fake marker text")

    print(f"validate_generated_data.py passed: {record_count} records")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"validate_generated_data.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
