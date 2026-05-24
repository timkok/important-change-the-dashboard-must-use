from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import requests


GDELT_DOC_URL = "https://api.gdeltproject.org/api/v2/doc/doc"

COMPANY_QUERIES = {
    "Novo Nordisk": '("Novo Nordisk" OR Ozempic OR Wegovy OR Rybelsus OR semaglutide OR (Novo (Ozempic OR Wegovy OR Rybelsus OR semaglutide OR obesity OR diabetes OR "GLP-1" OR pharma OR pharmaceutical)))',
    "Eli Lilly": '("Eli Lilly" OR Mounjaro OR Zepbound OR tirzepatide OR orforglipron OR retatrutide OR (Lilly (Mounjaro OR Zepbound OR tirzepatide OR orforglipron OR retatrutide OR obesity OR diabetes OR "GLP-1" OR pharma OR pharmaceutical)))',
}


def iter_windows(days: int = 90, window_days: int = 14) -> list[tuple[datetime, datetime]]:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days)
    windows: list[tuple[datetime, datetime]] = []
    cursor = start
    while cursor < end:
        next_cursor = min(cursor + timedelta(days=window_days), end)
        windows.append((cursor, next_cursor))
        cursor = next_cursor
    return windows


def gdelt_timestamp(value: datetime) -> str:
    return value.strftime("%Y%m%d%H%M%S")


def fetch_company_articles(company: str, days: int = 90, max_records_per_window: int = 250) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    query = COMPANY_QUERIES[company]
    articles: list[dict[str, Any]] = []
    errors: list[str] = []
    timeout = float(os.getenv("GDELT_TIMEOUT_SECONDS", "8"))
    window_days = int(os.getenv("GDELT_WINDOW_DAYS", "14"))
    for start, end in iter_windows(days=days, window_days=window_days):
        params = {
            "query": query,
            "mode": "artlist",
            "format": "json",
            "maxrecords": max_records_per_window,
            "sort": "datedesc",
            "startdatetime": gdelt_timestamp(start),
            "enddatetime": gdelt_timestamp(end),
        }
        try:
            response = requests.get(GDELT_DOC_URL, params=params, timeout=timeout)
            response.raise_for_status()
            payload = response.json()
            articles.extend(payload.get("articles", []))
        except Exception as exc:  # noqa: BLE001 - status is written to metadata for UI visibility.
            errors.append(f"{start.date()} to {end.date()}: {exc.__class__.__name__}")
        time.sleep(1.0)
    status = {
        "name": f"GDELT DOC 2.0 - {company}",
        "rawSource": "GDELT",
        "available": len(articles) > 0,
        "recordsFetched": len(articles),
        "errors": errors,
        "credentialRequired": False,
        "notes": "Public GDELT DOC 2.0 article search. Reach and engagement are dashboard proxies, not measured impressions.",
    }
    return articles, status


def fetch_all_gdelt(days: int = 90) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    by_company: dict[str, list[dict[str, Any]]] = {}
    statuses: list[dict[str, Any]] = []
    for company in COMPANY_QUERIES:
        records, status = fetch_company_articles(company, days=days)
        by_company[company] = records
        statuses.append(status)
    return by_company, statuses
