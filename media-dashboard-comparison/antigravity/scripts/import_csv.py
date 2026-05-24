from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

def load_optional_csv_imports(import_dir: Path) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Load optional analyst-provided CSV rows from the imports folder.
    Returns the parsed, normalized records and a list of warnings.
    """
    warnings: list[str] = []
    records: list[dict[str, Any]] = []
    
    if not import_dir.exists():
        return [], []
        
    for csv_path in sorted(import_dir.glob("*.csv")):
        try:
            with csv_path.open(newline="", encoding="utf-8") as handle:
                reader = csv.DictReader(handle)
                for line_num, row in enumerate(reader, start=2):
                    try:
                        # Extract company
                        company = row.get("company", "").strip()
                        if company not in {"Novo Nordisk", "Eli Lilly"}:
                            warnings.append(
                                f"CSV row {line_num} in {csv_path.name} skipped: company must be 'Novo Nordisk' or 'Eli Lilly'"
                            )
                            continue
                            
                        # Extract numeric parameters with safe defaults
                        def safe_int(field: str, default: int) -> int:
                            val = row.get(field)
                            if val is not None and val.strip():
                                try:
                                    return int(float(val.strip()))
                                except ValueError:
                                    pass
                            return default
                            
                        def safe_float(field: str, default: float) -> float:
                            val = row.get(field)
                            if val is not None and val.strip():
                                try:
                                    return float(val.strip())
                                except ValueError:
                                    pass
                            return default

                        reach = safe_int("reach", 10000)
                        engagement = safe_int("engagement", 0)
                        authority = safe_int("sourceAuthority", 45)
                        sentiment_score = safe_float("sentimentScore", 0.0)

                        # Keywords parsing (pipe-separated or list-like)
                        kw_raw = row.get("matchedKeywords", "") or row.get("keywords", "")
                        if "|" in kw_raw:
                            keywords = [k.strip() for k in kw_raw.split("|") if k.strip()]
                        elif "," in kw_raw:
                            keywords = [k.strip() for k in kw_raw.split(",") if k.strip()]
                        elif kw_raw.strip():
                            keywords = [kw_raw.strip()]
                        else:
                            keywords = []
                            
                        # Rebuild schema
                        normalized_row = {
                            "id": row.get("id") or f"csv-{csv_path.stem}-{line_num}",
                            "date": row.get("date", "").strip(),
                            "company": company,
                            "matchedEntity": row.get("matchedEntity") or company,
                            "channel": row.get("channel") or "CSV Import",
                            "source": row.get("source") or "CSV",
                            "sourceDomain": row.get("sourceDomain", "").strip().lower(),
                            "sourceTier": row.get("sourceTier") or "Other",
                            "title": row.get("title") or "(Untitled Import)",
                            "snippet": row.get("snippet") or "",
                            "url": row.get("url", "").strip(),
                            "topic": row.get("topic") or "Other",
                            "sentiment": row.get("sentiment") or "Neutral",
                            "sentimentScore": sentiment_score,
                            "reach": reach,
                            "engagement": engagement,
                            "sourceAuthority": authority,
                            "matchedKeywords": keywords,
                            "rawSource": row.get("rawSource") or "CSV",
                            "language": row.get("language") or "en",
                            "country": row.get("country") or "US",
                            "isProxyMetrics": row.get("isProxyMetrics", "false").lower() == "true",
                            "dataQualityNotes": ["Imported from CSV. Verification level depends on analyst source."]
                        }
                        records.append(normalized_row)
                    except Exception as row_exc:
                        warnings.append(
                            f"CSV row {line_num} in {csv_path.name} failed to parse: {row_exc}"
                        )
        except Exception as file_exc:
            warnings.append(f"CSV import file {csv_path.name} failed to load: {file_exc}")
            
    return records, warnings
