from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

from normalize import normalize_csv_row

REQUIRED_COLUMNS = {"date", "company", "source", "title", "url"}


def load_csv_imports(imports_dir: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    imports_dir.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, Any]] = []
    files = sorted(imports_dir.glob("*.csv"))
    errors: list[str] = []
    for file_path in files:
        try:
            with file_path.open(newline="", encoding="utf-8-sig") as handle:
                reader = csv.DictReader(handle)
                missing = sorted(REQUIRED_COLUMNS - set(reader.fieldnames or []))
                if missing:
                    errors.append(f"{file_path.name}: missing required columns: {', '.join(missing)}")
                    continue
                for row in reader:
                    row.setdefault("rawSource", file_path.stem)
                    normalized = normalize_csv_row(row, raw_source=file_path.stem)
                    if normalized:
                        records.append(normalized)
        except Exception as exc:  # noqa: BLE001 - surfaced in metadata.
            errors.append(f"{file_path.name}: {exc.__class__.__name__}")
    return records, {
        "name": "Brandwatch / Meltwater / Talkwalker CSV exports",
        "rawSource": "CSV",
        "available": bool(files),
        "recordsFetched": len(records),
        "files": [path.name for path in files],
        "errors": errors,
        "credentialRequired": False,
    }
