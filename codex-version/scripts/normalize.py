from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse


COMPANIES = ("Novo Nordisk", "Eli Lilly")

COMPANY_KEYWORDS = {
    "Novo Nordisk": ["Novo Nordisk", "Ozempic", "Wegovy", "Rybelsus", "semaglutide", "oral semaglutide", "Novo"],
    "Eli Lilly": ["Eli Lilly", "Mounjaro", "Zepbound", "tirzepatide", "orforglipron", "retatrutide", "Lilly"],
}

STANDALONE_VALIDATORS = {
    "Novo": ["ozempic", "wegovy", "rybelsus", "semaglutide", "glp-1", "glp 1", "obesity", "diabetes", "pharmaceutical", "pharma"],
    "Lilly": ["mounjaro", "zepbound", "tirzepatide", "orforglipron", "retatrutide", "glp-1", "glp 1", "obesity", "diabetes", "pharmaceutical", "pharma"],
}

TOPIC_RULES: list[tuple[str, list[str]]] = [
    ("Drug pricing / insurance / access", ["price", "pricing", "insurance", "medicare", "medicaid", "coverage", "reimbursement", "affordability", "access"]),
    ("Supply shortage", ["shortage", "supply", "availability", "backorder"]),
    ("Side effects / safety", ["side effect", "adverse event", "nausea", "pancreatitis", "gastroparesis", "safety", "risk"]),
    ("Oral GLP-1", ["oral", "pill", "tablet", "orforglipron", "oral semaglutide"]),
    ("Pipeline / next-generation drugs", ["pipeline", "trial", "phase 3", "retatrutide", "amycretin", "cagrisema", "next-generation", "next generation"]),
    ("Earnings / revenue / market share", ["earnings", "revenue", "sales", "market share", "forecast", "guidance", "valuation", "stock"]),
    ("Legal / regulatory", ["fda", "ema", "approval", "lawsuit", "legal", "regulator", "warning letter"]),
    ("Compounded GLP-1s", ["compounded", "compounding", "copycat"]),
    ("Food industry impact", ["food", "snacks", "restaurants", "grocery", "packaged food", "alcohol"]),
    ("Weight loss efficacy", ["weight loss", "obesity", "reduced weight", "body weight"]),
    ("Diabetes treatment", ["diabetes", "a1c", "blood sugar", "glycemic", "type 2"]),
    ("GLP-1 market competition", ["glp-1", "glp 1", "competition", "compete", "rival", "mounjaro", "zepbound", "ozempic", "wegovy"]),
    ("Cardiovascular outcomes", ["cardiovascular", "heart", "stroke", "cardiometabolic", "reduced risk"]),
    ("Celebrity / lifestyle culture", ["celebrity", "hollywood", "lifestyle", "influencer"]),
    ("Public health / obesity policy", ["public health", "obesity policy", "policy", "government"]),
]

POSITIVE_TERMS = ["approval", "approved", "effective", "benefit", "growth", "strong sales", "breakthrough", "positive trial", "reduced risk"]
NEGATIVE_TERMS = ["lawsuit", "shortage", "side effect", "death", "risk", "warning", "pricing backlash", "denied coverage", "adverse event"]

TIER_1_DOMAINS = {"reuters.com", "bloomberg.com", "wsj.com", "nytimes.com", "ft.com", "cnbc.com", "apnews.com", "bbc.com", "theguardian.com", "statnews.com"}
TRADE_DOMAINS = {"biopharmadive.com", "fiercepharma.com", "pharmavoice.com", "endpoints.news", "pharmaceutical-technology.com", "evaluate.com"}
FINANCE_DOMAINS = {"marketwatch.com", "investors.com", "fool.com", "seekingalpha.com", "barrons.com", "finance.yahoo.com"}


def stable_id(*parts: str) -> str:
    return hashlib.sha256("|".join(str(part).lower().strip() for part in parts if part).encode("utf-8")).hexdigest()[:24]


def parse_date(value: Any) -> str:
    if not value:
        return datetime.now(timezone.utc).date().isoformat()
    text = str(value).strip()
    for fmt in ("%Y%m%dT%H%M%SZ", "%Y%m%d%H%M%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            return datetime.strptime(text[:10] if fmt == "%Y-%m-%d" else text, fmt).date().isoformat()
        except ValueError:
            continue
    return text[:10]


def clean_domain(value: Any = None, url: str = "") -> str:
    domain = str(value or "").lower().strip()
    if not domain and url:
        domain = urlparse(url).netloc.lower()
    return domain[4:] if domain.startswith("www.") else domain


def joined_text(*parts: Any) -> str:
    return " ".join(str(part or "") for part in parts).strip()


def matched_keywords_for_company(company: str, text: str) -> list[str]:
    lower = text.lower()
    matches: list[str] = []
    for keyword in COMPANY_KEYWORDS[company]:
        if re.search(r"\b" + re.escape(keyword.lower()) + r"\b", lower):
            if keyword in STANDALONE_VALIDATORS and not any(term in lower for term in STANDALONE_VALIDATORS[keyword]):
                continue
            matches.append(keyword)
    return matches


def classify_topic(text: str) -> str:
    lower = text.lower()
    for topic, terms in TOPIC_RULES:
        if any(term in lower for term in terms):
            return topic
    return "Other"


def classify_source(domain: str) -> tuple[str, str, int, int]:
    if domain in TIER_1_DOMAINS or any(domain.endswith("." + item) for item in TIER_1_DOMAINS):
        return "Tier 1", "News", 90, 1_000_000
    if domain in TRADE_DOMAINS or any(domain.endswith("." + item) for item in TRADE_DOMAINS):
        return "Trade", "Trade Media", 75, 250_000
    if domain in FINANCE_DOMAINS or any(domain.endswith("." + item) for item in FINANCE_DOMAINS):
        return "Finance", "Finance Media", 70, 300_000
    return "Other", "News", 45, 100_000


def sentiment_from(value: Any, text: str) -> tuple[str, float]:
    score: float | None = None
    if value not in (None, ""):
        try:
            score = max(-1.0, min(1.0, float(value) / 10.0))
        except (TypeError, ValueError):
            score = None
    if score is None:
        lower = text.lower()
        if any(term in lower for term in NEGATIVE_TERMS):
            score = -0.45
        elif any(term in lower for term in POSITIVE_TERMS):
            score = 0.45
        else:
            score = 0.0
    if score > 0.15:
        return "Positive", round(score, 3)
    if score < -0.15:
        return "Negative", round(score, 3)
    return "Neutral", round(score, 3)


def normalize_gdelt_article(article: dict[str, Any], company: str) -> dict[str, Any] | None:
    url = article.get("url") or article.get("url_mobile") or ""
    title = article.get("title") or ""
    snippet = article.get("snippet") or ""
    source = article.get("sourceCommonName") or article.get("domain") or ""
    domain = clean_domain(article.get("domain"), url)
    text = joined_text(title, snippet, source, domain)
    matched = matched_keywords_for_company(company, text)
    if not matched:
        return None
    tier, channel, authority, reach = classify_source(domain)
    sentiment, sentiment_score = sentiment_from(article.get("tone"), text)
    return {
        "id": stable_id(url, title, company),
        "date": parse_date(article.get("seendate")),
        "company": company,
        "matchedEntity": matched[0],
        "channel": channel,
        "source": source or domain,
        "sourceDomain": domain,
        "sourceTier": tier,
        "title": title,
        "snippet": snippet,
        "url": url,
        "topic": classify_topic(text),
        "sentiment": sentiment,
        "sentimentScore": sentiment_score,
        "reach": reach,
        "engagement": 0,
        "sourceAuthority": authority,
        "matchedKeywords": matched,
        "rawSource": "GDELT",
        "language": article.get("language") or None,
        "country": article.get("sourceCountry") or None,
        "isProxyMetrics": True,
        "dataQualityNotes": ["GDELT does not provide true impressions or engagement; reach and sourceAuthority are source-tier proxies."],
    }


def supplied_number(row: dict[str, Any], key: str) -> bool:
    value = row.get(key)
    if value in (None, ""):
        return False
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def normalize_csv_row(row: dict[str, Any], raw_source: str = "CSV") -> dict[str, Any] | None:
    company = (row.get("company") or "").strip()
    if company not in COMPANIES:
        return None
    url = (row.get("url") or "").strip()
    title = (row.get("title") or "").strip()
    domain = clean_domain(None, url)
    tier, default_channel, authority, reach = classify_source(domain)
    sentiment = (row.get("sentiment") or "").strip().title()
    if sentiment not in {"Positive", "Neutral", "Negative"}:
        sentiment, score = sentiment_from(None, joined_text(title, row.get("snippet")))
    else:
        score = {"Positive": 0.5, "Neutral": 0.0, "Negative": -0.5}[sentiment]
    matched = [item.strip() for item in (row.get("matchedKeywords") or "").split("|") if item.strip()]
    if not matched:
        matched = matched_keywords_for_company(company, joined_text(title, row.get("snippet")))
    channel = (row.get("channel") or default_channel or "CSV Import").strip()
    return {
        "id": stable_id(url, title, row.get("date") or "", company),
        "date": parse_date(row.get("date")),
        "company": company,
        "matchedEntity": matched[0] if matched else company,
        "channel": channel,
        "source": (row.get("source") or domain or "CSV import").strip(),
        "sourceDomain": domain,
        "sourceTier": "Social" if channel == "Social" else tier,
        "title": title,
        "snippet": (row.get("snippet") or "").strip(),
        "url": url,
        "topic": (row.get("topic") or "").strip() or classify_topic(joined_text(title, row.get("snippet"))),
        "sentiment": sentiment,
        "sentimentScore": score,
        "reach": int(float(row.get("reach") or reach)),
        "engagement": int(float(row.get("engagement") or 0)),
        "sourceAuthority": int(float(row.get("sourceAuthority") or authority)),
        "matchedKeywords": matched,
        "rawSource": (row.get("rawSource") or raw_source or "CSV").strip(),
        "language": None,
        "country": None,
        "isProxyMetrics": not (supplied_number(row, "reach") or supplied_number(row, "engagement")),
        "dataQualityNotes": ["CSV metrics are treated as imported values when supplied; missing metric fields use source-tier defaults."],
    }
