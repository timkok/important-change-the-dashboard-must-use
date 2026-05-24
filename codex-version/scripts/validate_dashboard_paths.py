from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_DATA_PATHS = [
    "./data/generated/metadata.json",
    "./data/generated/mentions.json",
    "./data/generated/daily_counts.json",
    "./data/generated/source_summary.json",
    "./data/generated/topic_summary.json",
    "./data/generated/alerts.json",
]


def main() -> int:
    index = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    if 'href="./styles.css"' not in index:
        raise AssertionError("index.html must reference ./styles.css")
    if 'src="./app.js"' not in index:
        raise AssertionError("index.html must reference ./app.js")
    for path in REQUIRED_DATA_PATHS:
        if path not in app:
            raise AssertionError(f"app.js missing relative data path {path}")
    forbidden = ("http://", "https://", "../data/generated/")
    data_block = app.split("const DATA_PATHS", 1)[-1].split("};", 1)[0]
    for marker in forbidden:
        if marker in data_block:
            raise AssertionError(f"DATA_PATHS must stay relative; found {marker}")
    print("validate_dashboard_paths.py passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as exc:
        print(f"validate_dashboard_paths.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
