from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse


TOPIC_RULES: list[tuple[str, list[str]]] = [
    ("Drug pricing / insurance / access", ["price", "pricing", "insurance", "medicare", "medicaid", "coverage", "reimbursement", "affordability", "access"]),
    ("Supply shortage", ["shortage", "supply", "availability", "backorder"]),
    ("Side effects / safety", ["side effect", "side-effect", "adverse event", "nausea", "pancreatitis", "gastroparesis", "safety", "risk"]),
    ("Oral GLP-1", ["oral", "pill", "tablet", "orforglipron", "oral semaglutide"]),
    ("Pipeline / next-generation drugs", ["pipeline", "trial", "phase 3", "retatrutide", "amycretin", "cagrisema", "next-generation", "next generation"]),
    ("Earnings / revenue / market share", ["earnings", "revenue", "sales", "market share", "forecast", "guidance", "valuation", "stock"]),
    ("Legal / regulatory", ["fda", "ema", "approval", "lawsuit", "legal", "regulator", "warning letter"]),
    ("Compounded GLP-1s", ["compounded", "compounding", "copycat"]),
    ("Food industry impact", ["food", "snacks", "restaurants", "grocery", "packaged food", "alcohol"]),
    ("Weight loss efficacy", ["weight loss", "obesity", "body weight", "reduced weight", "weight-loss"]),
    ("Diabetes treatment", ["diabetes", "a1c", "blood sugar", "glycemic", "type 2"]),
    ("GLP-1 market competition", ["glp-1", "glp 1", "market competition", "compete", "rival", "mounjaro", "zepbound", "ozempic", "wegovy"]),
    ("Cardiovascular outcomes", ["cardiovascular", "heart", "stroke", "cardiometabolic", "reduced risk"]),
    ("Celebrity / lifestyle culture", ["celebrity", "hollywood", "lifestyle", "fashion", "influencer"]),
    ("Public health / obesity policy", ["public health", "obesity policy", "policy", "who", "government"]),
]

POSITIVE_TERMS = [
    "approval", "approved", "effective", "benefit", "growth", "strong sales",
    "breakthrough", "positive trial", "reduced risk", "outperformed", "beat estimates",
]

NEGATIVE_TERMS = [
    "lawsuit", "shortage", "side effect", "death", "risk", "warning",
    "pricing backlash", "denied coverage", "adverse event", "probe", "investigation",
]

TIER_1_DOMAINS = {
    "reuters.com", "bloomberg.com", "wsj.com", "nytimes.com", "ft.com",
    "cnbc.com", "apnews.com", "bbc.com", "theguardian.com", "statnews.com",
}

TRADE_DOMAINS = {
    "biopharmadive.com", "fiercepharma.com", "pharmavoice.com",
    "endpoints.news", "pharmaceutical-technology.com", "evaluate.com",
}

FINANCE_DOMAINS = {
    "marketwatch.com", "investors.com", "fool.com", "seekingalpha.com",
    "barrons.com", "finance.yahoo.com",
}

COMPANY_KEYWORDS = {
    "Novo Nordisk": ["Novo Nordisk", "Ozempic", "Wegovy", "Rybelsus", "semaglutide", "Novo"],
    "Eli Lilly": ["Eli Lilly", "Mounjaro", "Zepbound", "tirzepatide", "orforglipron", "retatrutide", "Lilly"],
}

STANDALONE_VALIDATORS = {
    "Novo": ["ozempic", "wegovy", "rybelsus", "semaglutide", "obesity", "diabetes", "glp-1", "glp 1", "pharma", "pharmaceutical"],
    "Lilly": ["mounjaro", "zepbound", "tirzepatide", "orforglipron", "retatrutide", "obesity", "diabetes", "glp-1", "glp 1", "pharma", "pharmaceutical"],
}


def parse_gdelt_datetime(value: str | None) -> str:
    if not value:
        return datetime.now(timezone.utc).date().isoformat()
    value = value.strip()
    for fmt in ("%Y%m%dT%H%M%SZ", "%Y%m%d%H%M%S", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc).date().isoformat()
        except ValueError:
            continue
    return value[:10]


def stable_id(*parts: str) -> str:
    joined = "|".join(part.strip().lower() for part in parts if part)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:24]


def clean_domain(value: str | None, url: str = "") -> str:
    domain = (value or "").lower().strip()
    if not domain and url:
        domain = urlparse(url).netloc.lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def text_blob(*parts: str | None) -> str:
    return " ".join(part or "" for part in parts).strip()


def matched_keywords_for_company(company: str, text: str) -> list[str]:
    matches: list[str] = []
    lower = text.lower()
    for keyword in COMPANY_KEYWORDS[company]:
        pattern = r"\b" + re.escape(keyword.lower()) + r"\b"
        if re.search(pattern, lower):
            if keyword in STANDALONE_VALIDATORS:
                validators = STANDALONE_VALIDATORS[keyword]
                if not any(term in lower for term in validators):
                    continue
            matches.append(keyword)
    return matches


def classify_topic(text: str) -> str:
    lower = text.lower()
    for topic, terms in TOPIC_RULES:
        if any(term in lower for term in terms):
            return topic
    return "Other"


def source_tier(domain: str) -> str:
    if domain in TIER_1_DOMAINS or any(domain.endswith("." + d) for d in TIER_1_DOMAINS):
        return "Tier 1"
    if domain in TRADE_DOMAINS or any(domain.endswith("." + d) for d in TRADE_DOMAINS):
        return "Trade"
    return "Other"


def channel_for_domain(domain: str, tier: str) -> str:
    if domain in FINANCE_DOMAINS or any(domain.endswith("." + d) for d in FINANCE_DOMAINS):
        return "Finance Media"
    if tier == "Trade":
        return "Trade Media"
    if tier == "Tier 1":
        return "News"
    return "News"


def source_authority_for(domain: str, tier: str, channel: str) -> int:
    if tier == "Tier 1":
        return 90
    if tier == "Trade":
        return 78
    if channel == "Finance Media":
        return 76
    return 55


def reach_proxy_for(tier: str, channel: str, authority: int) -> int:
    if tier == "Tier 1":
        return 850_000 + authority * 2_000
    if tier == "Trade":
        return 350_000 + authority * 1_500
    if channel == "Finance Media":
        return 300_000 + authority * 1_500
    return 120_000 + authority * 1_000


def sentiment_from_tone(tone: Any, text: str) -> tuple[str, float]:
    score: float | None = None
    if tone not in (None, ""):
        try:
            raw = float(tone)
            score = max(-1.0, min(1.0, raw / 10.0))
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
    body = text_blob(title, snippet, source, domain)
    matched = matched_keywords_for_company(company, body)
    if not matched:
        return None
    tier = source_tier(domain)
    channel = channel_for_domain(domain, tier)
    authority = source_authority_for(domain, tier, channel)
    sentiment, sentiment_score = sentiment_from_tone(article.get("tone"), body)
    date = parse_gdelt_datetime(article.get("seendate"))
    return {
        "id": stable_id(url, title, date, company),
        "date": date,
        "company": company,
        "matchedEntity": matched[0],
        "channel": channel,
        "source": source or domain,
        "sourceDomain": domain,
        "sourceTier": tier,
        "title": title,
        "snippet": snippet,
        "url": url,
        "topic": classify_topic(body),
        "sentiment": sentiment,
        "sentimentScore": sentiment_score,
        "reach": reach_proxy_for(tier, channel, authority),
        "engagement": 0,
        "sourceAuthority": authority,
        "matchedKeywords": matched,
        "rawSource": "GDELT",
        "language": article.get("language") or None,
        "country": article.get("sourceCountry") or None,
    }


def normalize_csv_row(row: dict[str, Any]) -> dict[str, Any] | None:
    company = row.get("company", "").strip()
    if company not in {"Novo Nordisk", "Eli Lilly"}:
        return None
    url = row.get("url", "").strip()
    title = row.get("title", "").strip()
    date = (row.get("date") or "").strip()[:10]
    source = row.get("source", "").strip()
    domain = clean_domain(None, url)
    topic = row.get("topic", "").strip() or classify_topic(text_blob(title, row.get("snippet")))
    sentiment = row.get("sentiment", "").strip().title()
    if sentiment not in {"Positive", "Neutral", "Negative"}:
        sentiment, score = sentiment_from_tone(None, text_blob(title, row.get("snippet")))
    else:
        score = {"Positive": 0.5, "Neutral": 0.0, "Negative": -0.5}[sentiment]
    matched_keywords = [item.strip() for item in (row.get("matchedKeywords") or "").split("|") if item.strip()]
    if not matched_keywords:
        matched_keywords = matched_keywords_for_company(company, text_blob(title, row.get("snippet")))
    tier = source_tier(domain)
    channel = row.get("channel", "").strip() or "CSV Import"
    return {
        "id": stable_id(url, title, date, company),
        "date": date,
        "company": company,
        "matchedEntity": matched_keywords[0] if matched_keywords else company,
        "channel": channel,
        "source": source or domain or "CSV import",
        "sourceDomain": domain,
        "sourceTier": tier if channel != "Social" else "Social",
        "title": title,
        "snippet": row.get("snippet", "").strip(),
        "url": url,
        "topic": topic,
        "sentiment": sentiment,
        "sentimentScore": score,
        "reach": _int_or_zero(row.get("reach")),
        "engagement": _int_or_zero(row.get("engagement")),
        "sourceAuthority": _int_or_zero(row.get("sourceAuthority")),
        "matchedKeywords": matched_keywords,
        "rawSource": "CSV",
        "language": None,
        "country": None,
    }


def _int_or_zero(value: Any) -> int:
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return 0
