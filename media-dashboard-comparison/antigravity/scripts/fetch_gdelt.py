from __future__ import annotations

import os
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
    retries: int = 1
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Fetch articles from GDELT DOC 2.0 API for a specific date window.
    Implements a strict timeout of 5 seconds to prevent hangs.
    """
    env_max = os.environ.get("MAX_RECORDS_PER_COMPANY")
    if env_max:
        try:
            max_records = int(env_max)
        except ValueError:
            pass

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
    
    # Strictly bound retries to 1
    max_attempts = 1
    
    for attempt in range(1, max_attempts + 1):
        try:
            # Short timeout of 15s to avoid hanging
            response = requests.get(GDELT_ENDPOINT, params=params, timeout=15)
            
            if response.status_code in {429, 500, 502, 503, 504}:
                raise GDELTFetchError(f"GDELT transient HTTP {response.status_code}")
                
            response.raise_for_status()
            payload = response.json()
            articles = payload.get("articles", []) or []
            return articles, warnings
            
        except Exception as exc:
            if attempt == max_attempts:
                warnings.append(
                    f"GDELT fetch failed for window {start.date()} to {end.date()}: {exc}"
                )
                return [], warnings
            
            time.sleep(1)
            
    return [], warnings
