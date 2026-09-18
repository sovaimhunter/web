#!/usr/bin/env python3
"""Build the pinned AHECC JSON dataset from the official ABS archive.

Requires Python 3 and openpyxl. The input archive is available from:
https://www.abs.gov.au/statistics/classifications/australian-harmonized-export-commodity-classification-ahecc/2022/CompleteAHECC.zip
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import zipfile
from pathlib import Path

import openpyxl


EXPECTED_ARCHIVE_SHA256 = (
    "ffaee05fe374cd06d902f6bf473fb704ca050e5d4c20259e4f6fb3574aae7225"
)
SOURCE_URL = (
    "https://www.abs.gov.au/statistics/classifications/"
    "australian-harmonized-export-commodity-classification-ahecc/latest-release"
)


def digits(value: object) -> str:
    return re.sub(r"\D", "", str(value))


def clean_description(value: object) -> str:
    return re.sub(r"\s+", " ", str(value)).strip().lstrip("- ").strip()


def parse_workbook(content: bytes) -> list[dict[str, str | None]]:
    workbook = openpyxl.load_workbook(
        io.BytesIO(content), read_only=True, data_only=True
    )
    entries: list[dict[str, str | None]] = []

    for sheet_name in workbook.sheetnames:
        if not re.fullmatch(r"Chapter \d+", sheet_name):
            continue

        sheet = workbook[sheet_name]
        current_heading: str | None = None
        hs_descriptions: dict[int, str] = {}

        for row in sheet.iter_rows(values_only=True):
            chapter, heading, hs_code, export_item, unit, description = row[:6]
            description_text = (
                clean_description(description) if description is not None else ""
            )

            if chapter is not None and heading is None and description_text:
                current_heading = None
                hs_descriptions.clear()

            if heading is not None:
                current_heading = description_text or None
                hs_descriptions.clear()

            if hs_code is not None and description_text:
                hs_digits = digits(hs_code)
                if 2 <= len(hs_digits) <= 6:
                    hs_descriptions[len(hs_digits)] = description_text
                    for length in list(hs_descriptions):
                        if length > len(hs_digits):
                            del hs_descriptions[length]

            if export_item is None:
                continue

            code = digits(export_item).zfill(8)
            if not re.fullmatch(r"\d{8}", code):
                raise ValueError(
                    f"Invalid export item {export_item!r} in {sheet_name}"
                )

            parts = [
                current_heading,
                *(hs_descriptions[length] for length in sorted(hs_descriptions)),
                description_text,
            ]
            official_parts: list[str] = []
            for part in parts:
                if part and part not in official_parts:
                    official_parts.append(part)

            entries.append(
                {
                    "code": code,
                    "description": " — ".join(official_parts),
                    "unitOfQuantity": str(unit).strip() if unit is not None else None,
                }
            )

    return entries


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    archive_bytes = args.archive.read_bytes()
    checksum = hashlib.sha256(archive_bytes).hexdigest()
    if checksum != EXPECTED_ARCHIVE_SHA256:
        raise ValueError(
            f"Unexpected archive checksum: {checksum}; expected "
            f"{EXPECTED_ARCHIVE_SHA256}"
        )

    entries_by_code: dict[str, dict[str, str | None]] = {}
    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        for table in range(1, 22):
            name = f"1233{table:02d}.xlsx"
            for entry in parse_workbook(archive.read(name)):
                code = str(entry["code"])
                existing = entries_by_code.get(code)
                if existing is not None and existing != entry:
                    raise ValueError(f"Conflicting duplicate AHECC item: {code}")
                entries_by_code[code] = entry

    payload = {
        "id": "ahecc-2022-2023-04-18",
        "title": (
            "Australian Harmonized Export Commodity Classification (AHECC), 2022"
        ),
        "hsEdition": "2022",
        "effectiveFrom": "2022-01-01",
        "updatedAt": "2023-04-18",
        "sourceUrl": SOURCE_URL,
        "sourceChecksum": checksum,
        "entries": [entries_by_code[code] for code in sorted(entries_by_code)],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(entries_by_code)} AHECC items to {args.output}")


if __name__ == "__main__":
    main()
