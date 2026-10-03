#!/usr/bin/env python3
"""Build experience-relieving-letter-template.docx from DRAFT-source.docx (yellow = placeholders)."""
from __future__ import annotations

import re
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets" / "relieving-letter"
SRC = ASSET_DIR / "DRAFT-source.docx"
OUT = ASSET_DIR / "experience-relieving-letter-template.docx"

TEXT_REPLACEMENTS = {
    "Date": "[[letterDate]]",
    "Employee Name": "[[employeeName]]",
    "Employee Code:": "Employee Code: [[employeeCode]]",
    "Ms./ Mrs./": "",
    "NAME": "[[employeeName]]",
    "Designation": "[[designation]]",
    "DOJ": "[[dateOfJoining]]",
    "DOL": "[[dateOfLeaving]]",
}


def patch_xml(xml: str) -> str:
    xml = re.sub(r'<w:highlight w:val="[^"]+"/>', "", xml)

    def repl_t(m: re.Match[str]) -> str:
        full = m.group(0)
        inner = m.group(1)
        if inner.strip() == "Mr.":
            return '<w:t xml:space="preserve"> [[salutation]] </w:t>'
        if inner in TEXT_REPLACEMENTS:
            if inner == "Ms./ Mrs./":
                return "<w:t></w:t>"
            return f"<w:t>{TEXT_REPLACEMENTS[inner]}</w:t>"
        return full

    return re.sub(r'<w:t(?: xml:space="preserve")?>([^<]*)</w:t>', repl_t, xml)


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Missing source file: {SRC}")
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(SRC, "r") as zin, zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename == "word/document.xml":
                data = patch_xml(data.decode("utf-8")).encode("utf-8")
            zout.writestr(info, data)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
