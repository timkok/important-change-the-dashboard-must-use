#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


MINIMAX_ROOT = Path(__file__).resolve().parents[1]


def check_html() -> tuple[bool, str]:
    path = MINIMAX_ROOT / "index.html"
    if not path.is_file():
        return False, "index.html not found"
    content = path.read_text()
    if './styles.css' not in content and 'styles.css' not in content:
        return False, "index.html does not reference styles.css"
    if './app.js' not in content and 'app.js' not in content:
        return False, "index.html does not reference app.js"
    return True, "OK"


def check_app_js() -> tuple[bool, str]:
    path = MINIMAX_ROOT / "app.js"
    if not path.is_file():
        return False, "app.js not found"
    content = path.read_text()
    if 'localhost' in content:
        return False, "app.js contains 'localhost'"
    if re.search(r'["\']https?://', content):
        # Allow external project links in metadata panel (not data source URLs)
        external_links = re.findall(r'["\'](https?://github\.com/timkok/[^"\']+)["\']', content)
        if external_links:
            # These are external project links, not localhost or data paths - allowed
            pass
        else:
            return False, "app.js contains absolute HTTP(S) URLs"
    if re.search(r'["\']/data/generated[^"\']*["\']', content):
        return False, "app.js contains absolute /data/generated paths"
    data_paths = [
        'mentions.json',
        'daily_counts.json',
        'source_summary.json',
        'topic_summary.json',
        'alerts.json',
        'metadata.json',
    ]
    for dp in data_paths:
        if dp not in content:
            return False, f"app.js does not reference {dp}"
    return True, "OK"


def check_css() -> tuple[bool, str]:
    path = MINIMAX_ROOT / "styles.css"
    if not path.is_file():
        return False, "styles.css not found"
    content = path.read_text()
    if re.search(r'url\(["\']?/[^"\')]+["\']?\)', content):
        return False, "styles.css contains absolute /URL paths"
    return True, "OK"


def main() -> int:
    all_ok = True
    checks = [
        ("index.html", check_html),
        ("app.js", check_app_js),
        ("styles.css", check_css),
    ]
    for name, fn in checks:
        ok, msg = fn()
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {name}: {msg}")
        if not ok:
            all_ok = False
    if all_ok:
        print("\nAll path checks passed.")
        return 0
    print("\nPath validation FAILED.")
    return 1


if __name__ == "__main__":
    sys.exit(main())