from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import requests


GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc"

QUERY_DEFINITIONS = {
    "Novo Nordisk": '("Novo Nordisk" OR Ozempic OR Wegovy OR Rybelsus OR semaglutide OR "oral semaglutide")',
    "Eli Lilly": '("Eli Lilly" OR Mounjaro OR Zepbound OR tirzepatide OR orforglipron OR retatrutide)',
}


def _timestamp(value: datetime) -> str:
    return value.strftime("%Y%m%d%H%M%S")


def _windows(days: int, window_days: int) -> list[tuple[datetime, datetime]]:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    windows: list[tuple[datetime, datetime]] = []
    cursor = start
    while cursor < end:
        next_cursor = min(cursor + timedelta(days=window_days), end)
        windows.append((cursor, next_cursor))
        cursor = next_cursor
    return windows


def fetch_company_articles(company: str, days: int = 7) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    articles: list[dict[str, Any]] = []
    errors: list[str] = []
    timeout = 15
    max_retries = 1
    window_days = 14
    hit_429 = False

    for start, end in _windows(days, window_days):
        if hit_429:
            errors.append(f"{start.date()} to {end.date()}: Skipped after 429 from previous window")
            continue

        params = {
            "query": QUERY_DEFINITIONS[company],
            "mode": "artlist",
            "format": "json",
            "maxrecords": 250,
            "sort": "datedesc",
            "startdatetime": _timestamp(start),
            "enddatetime": _timestamp(end),
        }
        for attempt in range(max_retries + 1):
            try:
                response = requests.get(GDELT_DOC_URL, params=params, timeout=timeout)
                if response.status_code == 429:
                    if attempt == max_retries:
                        errors.append(f"{start.date()} to {end.date()}: HTTP 429 after retries, stopping GDELT for {company}")
                        hit_429 = True
                        break
                    time.sleep(2)
                    continue
                response.raise_for_status()
                articles.extend(response.json().get("articles", []))
                break
            except Exception as exc:
                if attempt == max_retries:
                    errors.append(f"{start.date()} to {end.date()}: {exc.__class__.__name__}")
                else:
                    time.sleep(2)
        time.sleep(1)

    return articles, {
        "name": f"GDELT DOC 2.0 - {company}",
        "rawSource": "GDELT",
        "available": len(articles) > 0,
        "recordsFetched": len(articles),
        "errors": errors,
        "credentialRequired": False,
    }


def fetch_all_gdelt(days: int = 7) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    by_company: dict[str, list[dict[str, Any]]] = {}
    statuses: list[dict[str, Any]] = []
    for company in QUERY_DEFINITIONS:
        articles, status = fetch_company_articles(company, days)
        by_company[company] = articles
        statuses.append(status)
    return by_company, statuses