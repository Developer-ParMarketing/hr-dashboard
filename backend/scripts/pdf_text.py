#!/usr/bin/env python3
"""
Read the text of a policy PDF for the Policies -> Import from document feature.

Usage: python3 pdf_text.py <file.pdf>
Prints JSON: {"paragraphs": [{"text": "...", "heading": bool, "bullet": bool}, ...]}
         or {"error": "..."}

Headings are lines in a bigger or bold font; lines close together are joined into one paragraph;
page headers / footers / page numbers that repeat on most pages are dropped.
Uses pdfplumber (already installed for the attendance PDF upload).
"""
from __future__ import annotations

import json
import re
import statistics
import sys
from collections import Counter

BULLET_RE = re.compile(r"^([-*\u2022\u25cf\u25aa\u25e6\u2023\u2043\uf0b7\uf0a7o]|\(?[a-z0-9]{1,2}[.)])\s+", re.I)
ROMAN_RE = re.compile(r"^\(?(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)[.)]\s", re.I)
PAGE_NO_RE = re.compile(r"^(page\s*)?\d+(\s*(of|/)\s*\d+)?$", re.I)


# Ligatures that Word/Calibri PDFs store as unnamed glyphs ("shi(cid:332)" = "shift").
CID_LIGATURES = {"332": "ft", "414": "tf", "415": "ti", "425": "tt", "427": "tti", "322": "fi", "323": "fl", "333": "ffi", "334": "ffl"}


def norm(text: str) -> str:
    text = re.sub(r"\(cid:(\d+)\)", lambda m: CID_LIGATURES.get(m.group(1), ""), text)
    return re.sub(r"\s+", " ", text).strip()


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file given"}))
        return
    try:
        import pdfplumber  # type: ignore
    except Exception:
        print(json.dumps({"error": "pdfplumber is not installed on the server (pip3 install pdfplumber)."}))
        return

    try:
        pdf = pdfplumber.open(sys.argv[1])
    except Exception:
        print(json.dumps({"error": "This file is not a valid PDF."}))
        return

    pages: list[list[dict]] = []
    sizes: list[float] = []
    fonts: Counter = Counter()
    with pdf:
        for page in pdf.pages[:60]:
            lines = []
            for ln in page.extract_text_lines(keep_blank_chars=False) or []:
                text = norm(ln.get("text", ""))
                chars = [c for c in ln.get("chars", []) if c.get("text", "").strip()]
                if not text or not chars:
                    continue
                size = statistics.mean(float(c.get("size", 0) or 0) for c in chars)
                font = Counter(str(c.get("fontname", "")) for c in chars).most_common(1)[0][0]
                bold = sum(1 for c in chars if "bold" in str(c.get("fontname", "")).lower()) >= 0.8 * len(chars)
                lines.append({"text": text, "size": size, "bold": bold, "font": font, "top": float(ln.get("top", 0)), "bottom": float(ln.get("bottom", 0))})
                sizes.extend([size] * len(text))
                fonts.update({font: len(text)})
            pages.append(lines)

    if not sizes:
        print(json.dumps({"error": "No text found in this PDF - it is probably a scanned image. Please upload the Word file or paste the text."}))
        return

    body = statistics.median(sizes)
    # The font used for most text is the body font; a short line in another font (often the bold
    # one in PDFs whose font names hide "Bold", e.g. "CIDFont+F2") with space above it is a heading.
    body_font = fonts.most_common(1)[0][0] if fonts else ""

    # Lines repeated on at least half the pages (company header, footer) are not content.
    repeats: set[str] = set()
    if len(pages) >= 3:
        counts = Counter(l["text"].lower() for page in pages for l in {x["text"]: x for x in page}.values())
        repeats = {t for t, n in counts.items() if n >= max(2, len(pages) // 2)}

    paragraphs: list[dict] = []
    for page in pages:
        prev = None
        for l in page:
            text = l["text"]
            if text.lower() in repeats or PAGE_NO_RE.match(text):
                continue
            line_h = max(1.0, l["bottom"] - l["top"])
            gap_above = (l["top"] - prev["bottom"]) if prev is not None else line_h * 2
            heading_like = (
                len(text) <= 90
                and not text.endswith((",", ";"))
                and re.match(r"^[A-Za-z]", text) is not None
                and not BULLET_RE.match(text)
                and not ROMAN_RE.match(text)
                # table rows ("Manager Rs.300-500 Rs.200-300") are not headings
                and "rs." not in text.lower()
                and sum(ch.isdigit() for ch in text) <= len(text) * 0.15
            )
            other_font = l["font"] != body_font and l["size"] >= body * 0.95
            heading = heading_like and (
                l["size"] >= body * 1.15
                or (l["bold"] and l["size"] >= body * 0.95 and gap_above >= line_h * 0.9)
                or (other_font and gap_above >= line_h * 0.9 and not text.endswith("."))
            )
            # Bold lines in the middle of text ("8:30am - 5:30pm") are list items, not headings.
            starts_lower = re.match(r"^[a-z]", text) is not None and not BULLET_RE.match(text)
            bullet = (bool(BULLET_RE.match(text)) or (other_font and not heading and not starts_lower)) and not heading
            # Roman-numbered points ("II. Employees must ...") start a new rule.
            numbered = ROMAN_RE.match(text) is not None
            if numbered and not heading:
                bullet = True
            joins = (
                prev is not None
                and bool(paragraphs)
                and not heading
                and not bullet
                and not numbered
                and not paragraphs[-1]["heading"]
                and (l["top"] - prev["bottom"]) <= line_h * 0.9
            )
            # a wrapped line of a numbered point / bullet continues that point
            continues_point = (
                prev is not None
                and bool(paragraphs)
                and paragraphs[-1]["bullet"]
                and not heading
                and not numbered
                and not BULLET_RE.match(text)
                and (l["font"] in (body_font, prev["font"]) or starts_lower)
                and (l["top"] - prev["bottom"]) <= line_h * 0.9
            )
            if joins or continues_point:
                paragraphs[-1]["text"] = norm(paragraphs[-1]["text"] + " " + text)
            else:
                paragraphs.append({"text": text, "heading": heading, "bullet": bullet, "gap": gap_above, "lh": line_h})
            prev = l

    # Merge a heading that wrapped onto two lines.
    merged: list[dict] = []
    for p in paragraphs:
        if (
            merged
            and p["heading"]
            and merged[-1]["heading"]
            and p.get("gap", 99) <= p.get("lh", 1) * 0.9
            and len(merged[-1]["text"]) + len(p["text"]) <= 90
        ):
            merged[-1]["text"] = norm(merged[-1]["text"] + " " + p["text"])
        else:
            merged.append(p)

    out = [{"text": p["text"], "heading": p["heading"], "bullet": p["bullet"]} for p in merged]
    print(json.dumps({"paragraphs": out}, ensure_ascii=False))


if __name__ == "__main__":
    main()