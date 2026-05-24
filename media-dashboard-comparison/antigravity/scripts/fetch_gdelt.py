from __future__ import annotations

import time
from datetime import datetime
from typing import Any
import requests

GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc"

class GDELTFetchError(RuntimeError):
    pass

def _format_dt(value: datetime) -> str:
    """Format datetime for GDELT API (YYYYMMDDHHMMSS)."""
    return value.strftime("%Y%m%d%H%M%S")

def fetch_gdelt_window(
    query: str,
    start: datetime,
    end: datetime,
    max_records: int = 250,
    retries: int = 4
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Fetch articles from GDELT DOC 2.0 API for a specific date window.
    Implements retry with exponential backoff for transient HTTP errors.
    """
    params = {
        "query": query,
        "mode": "artlist",
        "format": "json",
        "startdatetime": _format_dt(start),
        "enddatetime": _format_dt(end),
        "maxrecords": str(max_records),
        "sort": "datedesc",
    }
    warnings: list[str] = []
    
    for attempt in range(1, retries + 1):
        try:
            # GDELT can be sluggish, set timeout to 30s
            response = requests.get(GDELT_ENDPOINT, params=params, timeout=30)
            
            # 429 and 5xx are transient errors we should retry
            if response.status_code in {429, 500, 502, 503, 504}:
                raise GDELTFetchError(f"GDELT transient HTTP {response.status_code}")
                
            response.raise_for_status()
            payload = response.json()
            articles = payload.get("articles", []) or []
            return articles, warnings
            
        except Exception as exc:
            if attempt == retries:
                warnings.append(
                    f"GDELT fetch failed for window {start.date()} to {end.date()} after {retries} attempts: {exc}"
                )
                return [], warnings
            
            # Exponential backoff: 2s, 4s, 8s...
            sleep_time = 2 ** attempt
            time.sleep(sleep_time)
            
    return [], warnings
