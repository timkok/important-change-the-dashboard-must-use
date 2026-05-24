from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

NOVO_QUERY = '("Novo Nordisk" OR Ozempic OR Wegovy OR Rybelsus OR semaglutide OR "oral semaglutide")'
LILLY_QUERY = '("Eli Lilly" OR Mounjaro OR Zepbound OR tirzepatide OR orforglipron OR retatrutide)'

QUERY_DEFINITIONS = {
    "Novo Nordisk": {
        "query": NOVO_QUERY,
        "falsePositiveControls": "Standalone 'Novo' keyword triggers context validator requiringOzempic, Wegovy, Rybelsus, semaglutide, GLP-1, obesity, diabetes, pharmaceutical, or pharma.",
    },
    "Eli Lilly": {
        "query": LILLY_QUERY,
        "falsePositiveControls": "Standalone 'Lilly' keyword triggers context validator requiring Mounjaro, Zepbound, tirzepatide, orforglipron, retatrutide, GLP-1, obesity, diabetes, pharmaceutical, or pharma.",
    },
}

COMPANY_KEYWORDS = {
    "Novo Nordisk": ["novo nordisk", "ozempic", "wegovy", "rybelsus", "semaglutide", "oral semaglutide", "novo"],
    "Eli Lilly": ["eli lilly", "mounjaro", "zepbound", "tirzepatide", "orforglipron", "retatrutide", "lilly"],
}

FALSE_POSITIVE_CONTEXT = {
    "Novo Nordisk": ["ozempic", "wegovy", "rybelsus", "semaglutide", "glp-1", "obesity", "diabetes", "pharmaceutical", "pharma"],
    "Eli Lilly": ["mounjaro", "zepbound", "tirzepatide", "orforglipron", "retatrutide", "glp-1", "obesity", "diabetes", "pharmaceutical", "pharma"],
}

TOPIC_RULES = [
    ("Weight loss efficacy", ["weight loss", "lost weight", "body weight", "obesity drug", "obesity treatment", "efficacy", "slim", "shed weight"]),
    ("Diabetes treatment", ["diabetes", "a1c", "blood sugar", "glycemic", "type 2", "t2d"]),
    ("GLP-1 market competition", ["glp-1", "market competition", "rival", "compete", "competition", "obesity market", "competitor"]),
    ("Drug pricing / insurance / access", ["price", "pricing", "insurance", "coverage", "covered", "access", "medicare", "medicaid", "copay", "cost", "list price", "out of pocket"]),
    ("Supply shortage", ["shortage", "supply", "out of stock", "availability", "demand", "capacity", "shortages", "supply chain"]),
    ("Side effects / safety", ["side effect", "adverse", "safety", "risk", "warning", "death", "gastroparesis", "nausea", "vomiting", "suicidal", "pancreatitis", "complication"]),
    ("Cardiovascular outcomes", ["cardiovascular", "heart", "stroke", "reduced risk", "outcomes", "cvd", "mace", "cardiac"]),
    ("Oral GLP-1", ["oral", "pill", "tablet", "oral semaglutide", "orforglipron", "daily pill"]),
    ("Pipeline / next-generation drugs", ["pipeline", "next-generation", "retatrutide", "orforglipron", "cagrisema", "amycretin", "trial", "phase 3", "phase 2", "investigational"]),
    ("Earnings / revenue / market share", ["earnings", "revenue", "sales", "market share", "forecast", "profit", "stock", "shares", "valuation", "market cap"]),
    ("Celebrity / lifestyle culture", ["celebrity", "hollywood", "lifestyle", "tiktok", "influencer", "fashion", "oscars", "red carpet", "vanity"]),
    ("Public health / obesity policy", ["public health", "obesity policy", "policy", "who", "health system", "population", "medicaid coverage", "government"]),
    ("Compounded GLP-1s", ["compound", "compounded", "compounding", "copycat", "telehealth", "pharmacy", "formulation"]),
    ("Legal / regulatory", ["lawsuit", "legal", "regulatory", "fda", "ema", "regulator", "approval", "approved", "patent", "patents", "litigation"]),
    ("Food industry impact", ["food industry", "snack", "restaurant", "grocery", "consumer staples", "food sales", "calorie", "eating habits"]),
]

POSITIVE_KEYWORDS = [
    "approval", "approved", "benefit", "effective", "breakthrough", "growth",
    "strong sales", "positive trial", "reduced risk", "successful", "improves", "gains",
]
NEGATIVE_KEYWORDS = [
    "lawsuit", "shortage", "adverse event", "side effect", "risk", "warning",
    "death", "denied coverage", "backlash", "safety concern", "drop", "failure", "shortages",
]

SOURCE_TIERS = {
    "Tier 1": ["reuters.com", "bloomberg.com", "wsj.com", "nytimes.com", "ft.com", "cnbc.com", "apnews.com", "bbc.com", "theguardian.com", "statnews.com"],
    "Trade": ["biopharmadive.com", "fiercepharma.com", "pharmavoice.com", "endpoints.news", "pharmaceutical-technology.com", "evaluate.com", "fiercebiotech.com"],
    "Finance": ["marketwatch.com", "investors.com", "barrons.com", "finance.yahoo.com", "seekingalpha.com", "fool.com"],
}

def clean_text(value: Any) -> str:
    """Normalize whitespace and convert value to string."""
    return re.sub(r"\s+", " ", str(value or "")).strip()

def normalize_title_for_dedupe(title: str) -> str:
    """Normalize title to compare characters (strip spacing, punctuation, and lowercase)."""
    cleaned = re.sub(r"[^a-zA-Z0-9]", "", title.lower())
    return cleaned

def normalize_url(url: str) -> str:
    """
    Deduplicate and clean URL. Removes standard tracking parameters, lowercases domain,
    removes 'www.', and strips trailing slash.
    """
    if not url:
        return ""
    try:
        parsed = urlparse(url.strip())
        netloc = parsed.netloc.lower().removeprefix("www.")
        path = parsed.path.rstrip("/")
        
        # Strip tracking queries
        queries = parse_qsl(parsed.query)
        clean_queries = []
        for k, v in queries:
            lk = k.lower()
            if lk.startswith("utm_") or lk in {"ref", "fbclid", "gclid", "campaign", "source"}:
                continue
            clean_queries.append((k, v))
            
        new_query = urlencode(clean_queries) if clean_queries else ""
        return urlunparse((
            parsed.scheme.lower() or "https",
            netloc,
            path,
            "",
            new_query,
            ""
        ))
    except Exception:
        return url.strip().lower()

def source_domain(url: str, fallback: str = "") -> str:
    """Extract host domain name from URL or clean up fallback."""
    try:
        host = urlparse(url or "").netloc.lower().removeprefix("www.")
        if host:
            return host
    except Exception:
        pass
    return clean_text(fallback).lower()

def classify_source(domain: str) -> tuple[str, str, int, int]:
    """Classify domain by tier. Returns (sourceTier, channel, sourceAuthority, reach)."""
    domain = (domain or "").lower().removeprefix("www.")
    for tier, domains in SOURCE_TIERS.items():
        if any(domain == item or domain.endswith("." + item) for item in domains):
            if tier == "Tier 1":
                return "Tier 1", "News", 95, 100000
            if tier == "Trade":
                return "Trade", "Trade Media", 80, 35000
            return "Finance", "Finance Media", 75, 50000
    return "Other", "News", 45, 10000

def parse_date(value: str) -> str:
    """Parse dates of different formats into ISO date YYYY-MM-DD."""
    raw = clean_text(value)
    if not raw:
        return datetime.now(timezone.utc).date().isoformat()
    for fmt in ("%Y%m%dT%H%M%SZ", "%Y%m%d%H%M%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            return datetime.strptime(
                raw[: len(fmt.replace('%', ''))] if fmt.startswith("%Y%m%d") else raw,
                fmt
            ).date().isoformat()
        except ValueError:
            pass
    return raw[:10]

def matched_keywords(company: str, text: str) -> list[str]:
    """Find company keywords that match in text."""
    haystack = text.lower()
    found = [kw for kw in COMPANY_KEYWORDS[company] if kw in haystack]
    
    # Substring deduplication (e.g. if 'novo nordisk' matches, remove 'novo')
    if "novo" in found and "novo nordisk" in found:
        found.remove("novo")
    if "lilly" in found and "eli lilly" in found:
        found.remove("lilly")
    return sorted(set(found))

def passes_false_positive_controls(company: str, keywords: list[str], text: str) -> bool:
    """
    Ensure standalone 'novo' or 'lilly' are only matched when accompanied by relevant
    GLP-1, obesity, or diabetes contexts.
    """
    if not keywords:
        return False
    lowered = text.lower()
    if company == "Novo Nordisk" and keywords == ["novo"]:
        return any(term in lowered for term in FALSE_POSITIVE_CONTEXT[company])
    if company == "Eli Lilly" and keywords == ["lilly"]:
        return any(term in lowered for term in FALSE_POSITIVE_CONTEXT[company])
    return True

def classify_topic(text: str) -> str:
    """Classify text into topic buckets using keywords."""
    lowered = text.lower()
    for topic, words in TOPIC_RULES:
        if any(word in lowered for word in words):
            return topic
    return "Other"

def sentiment_from_text(text: str, tone: Any = None) -> tuple[str, float]:
    """
    Determine sentiment and sentimentScore.
    Clamps GDELT tone score divided by 10 to [-1, 1], otherwise falls back to keyword count.
    """
    try:
        if tone is None:
            raise ValueError
        score = max(-1.0, min(1.0, float(tone) / 10.0))
    except (TypeError, ValueError):
        lowered = text.lower()
        pos = sum(1 for word in POSITIVE_KEYWORDS if word in lowered)
        neg = sum(1 for word in NEGATIVE_KEYWORDS if word in lowered)
        score = 0.0 if pos == neg else max(-1.0, min(1.0, (pos - neg) * 0.2))
        
    if score >= 0.15:
        return "Positive", round(score, 3)
    if score <= -0.15:
        return "Negative", round(score, 3)
    return "Neutral", round(score, 3)

def stable_id(*parts: str) -> str:
    """Generate a stable 16-char hash ID from components."""
    return hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:16]

def normalize_gdelt_article(article: dict[str, Any], company: str) -> dict[str, Any] | None:
    """Normalize GDELT article response into uniform schema."""
    title = clean_text(article.get("title"))
    snippet = clean_text(
        article.get("snippet") or article.get("description") or article.get("summary") or ""
    )
    url = normalize_url(clean_text(article.get("url")))
    domain = source_domain(url, article.get("domain") or article.get("sourceCommonName"))
    
    text = f"{title} {snippet} {url} {domain}"
    keywords = matched_keywords(company, text)
    
    if not passes_false_positive_controls(company, keywords, text):
        return None
        
    topic = classify_topic(text)
    sentiment, sentiment_score = sentiment_from_text(text, article.get("tone"))
    tier, channel, authority, reach = classify_source(domain)
    date = parse_date(article.get("seendate") or article.get("date") or "")
    source = clean_text(
        article.get("sourceCommonName") or article.get("domain") or domain or "Unknown source"
    )
    
    # Stable ID generation bases
    dedupe_basis = url or f"{title.lower()}|{date}|{domain}"
    
    return {
        "id": stable_id(company, dedupe_basis),
        "date": date,
        "company": company,
        "matchedEntity": ", ".join(keywords[:3]) if keywords else company,
        "channel": channel,
        "source": source,
        "sourceDomain": domain,
        "sourceTier": tier,
        "title": title or "(Untitled article)",
        "snippet": snippet,
        "url": url,
        "topic": topic,
        "sentiment": sentiment,
        "sentimentScore": sentiment_score,
        "reach": reach,
        "engagement": 0,
        "sourceAuthority": authority,
        "matchedKeywords": keywords,
        "rawSource": "GDELT",
        "language": article.get("language"),
        "country": article.get("sourceCountry"),
        "isProxyMetrics": True,
        "dataQualityNotes": ["GDELT does not provide true impressions or engagement; reach and authority are rule-based proxies."],
    }

def dedupe_mentions(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Deduplicates records:
    1. Lowercase normalized URL (if present).
    2. Fallback: Lowercased title (alphanumeric only) + date + domain.
    Tracks exact counts of URL vs Fallback deduplication.
    """
    seen_urls: set[str] = set()
    seen_fallbacks: set[str] = set()
    
    deduped: list[dict[str, Any]] = []
    
    original_count = len(records)
    removed_url = 0
    removed_fallback = 0
    
    # Sort chronologically so later duplicates are rejected
    sorted_records = sorted(
        records,
        key=lambda item: (item.get("date", ""), item.get("title", "")),
        reverse=True
    )
    
    for record in sorted_records:
        company = record.get("company", "Both")
        url = record.get("url", "")
        title = record.get("title", "")
        date = record.get("date", "")
        domain = record.get("sourceDomain", "")
        
        # Check URL deduplication first
        if url:
            url_key = f"{company}|{url}"
            if url_key in seen_urls:
                removed_url += 1
                continue
            seen_urls.add(url_key)
            
            # Also register fallback key to prevent title dupes from non-url imports matching url imports
            norm_title = normalize_title_for_dedupe(title)
            fallback_key = f"{company}|{norm_title}|{date}|{domain}"
            seen_fallbacks.add(fallback_key)
            
        else:
            # Fallback deduplication
            norm_title = normalize_title_for_dedupe(title)
            fallback_key = f"{company}|{norm_title}|{date}|{domain}"
            if fallback_key in seen_fallbacks:
                removed_fallback += 1
                continue
            seen_fallbacks.add(fallback_key)
            
        deduped.append(record)
        
    summary = {
        "originalRecordCount": original_count,
        "duplicatesRemoved": removed_url + removed_fallback,
        "dedupedByURL": removed_url,
        "dedupedByTitleDateDomain": removed_fallback,
        "finalRecordCount": len(deduped)
    }
    
    return deduped, summary
