from __future__ import annotations

import os
import re
import sys
from datetime import datetime

import pandas as pd
import pdfplumber

STANDARD_SHIFT_MINUTES = 540


def parse_time_to_minutes(val) -> int | None:
    if not val:
        return None
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            dt = datetime.strptime(str(val).strip(), fmt)
            return dt.hour * 60 + dt.minute
        except ValueError:
            continue
    return None


def minutes_to_hhmm(m) -> str:
    return f"{m // 60:02d}:{m % 60:02d}" if m else ""


def wall_clock_from_minutes(total_min: int) -> str:
    m = int(total_min) % (24 * 60)
    if m < 0:
        m += 24 * 60
    return f"{m // 60:02d}:{m % 60:02d}"


def duration_hhmm(mins) -> str:
    try:
        n = int(mins)
    except (TypeError, ValueError):
        return ""
    if n < 0:
        return ""
    return f"{n // 60}:{n % 60:02d}"


def derive_out_time(in_time, out_time, work_minutes) -> str:
    ot = str(out_time).strip() if out_time else ""
    if ot:
        return ot
    if in_time and work_minutes:
        im = parse_time_to_minutes(in_time)
        try:
            wm = int(work_minutes)
        except (TypeError, ValueError):
            wm = 0
        if im is not None and wm > 0:
            return wall_clock_from_minutes(im + wm)
    return ""


def compute_minutes(i, o) -> int:
    i = parse_time_to_minutes(i)
    o = parse_time_to_minutes(o)
    if i is None or o is None:
        return 0
    if o < i:
        o += 1440
    return max(o - i, 0)


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", str(name).strip().lower())


def extract_report_date(text: str):
    match = re.search(r"\b(\d{2}-[A-Za-z]{3}-\d{4})\b", text)
    if match:
        return datetime.strptime(match.group(1), "%d-%b-%Y")
    return None


def _time_tokens(s: str) -> list[str]:
    """All clock tokens (HH:MM or HH:MM:SS) in order."""
    return re.findall(r"\b(\d{1,2}:\d{2}(?::\d{2})?)\b", s)


def _is_midnight_placeholder(s: str) -> bool:
    m = parse_time_to_minutes(s)
    return m is not None and m == 0


def _drop_leading_midnight(times: list[str]) -> list[str]:
    """
    Strip a bogus *extra* leading 00:00 when there are still ≥4 times after it
    (e.g. 00:00 t1 t2 t3 t4). Do not strip when there are exactly four tokens:
    00:00 may be an invalid S.In placeholder paired with S.Out before act in/out.
    """
    if len(times) <= 2:
        return times
    out = list(times)
    while len(out) > 4 and _is_midnight_placeholder(out[0]):
        out.pop(0)
    return out


def _policy_start_likelihood(t: str) -> int:
    """
    How likely the *first* time in a (S.In, S.Out) pair is a policy shift *start*.
    Do not treat :15/:30/:45 as strongly as "scheduled" here - end-of-day times like 18:30
    are usually S.Out and would wrongly beat a real punch (e.g. 09:37) when we only compare
    two single tokens. Pair span + this score disambiguates.
    """
    m = parse_time_to_minutes(t)
    if m is None:
        return -999
    if m == 0:
        return -100
    minute = m % 60
    if minute == 0:
        return 10
    if minute in (15, 45):
        return 2
    if minute == 30:
        return 1
    return -8


def _office_day_pair_score(t_first: str, t_second: str) -> int:
    """
    Score how much (t_first, t_second) looks like same-day S.In → S.Out (policy row),
    vs (Act In, Act Out) which often has a non-round first time (:37, :06).
    Night shifts may list out as early morning (e.g. 19:00 → 04:00) - treat as next day.
    """
    m0 = parse_time_to_minutes(t_first)
    m1 = parse_time_to_minutes(t_second)
    if m0 is None or m1 is None:
        return -10000
    if m0 == 0:
        return -500
    if m1 <= m0:
        if m1 < 720:
            m1_adj = m1 + 1440
            if m1_adj <= m0:
                return -8000
            span = m1_adj - m0
        else:
            return -8000
    else:
        span = m1 - m0
    if span < 180 or span > 840:
        return -4000
    return _policy_start_likelihood(t_first) + 40


def _is_invalid_punch_in(t: str | None) -> bool:
    if not t or not str(t).strip():
        return True
    return _is_midnight_placeholder(str(t).strip())


def _labeled_times_from_chunk(chunk: str) -> dict[str, str] | None:
    """
    If extract_text() kept labels (InTime, S.InTime, …), prefer them over positional tokens.
    """
    out: dict[str, str] = {}
    for pat, key in (
        (
            r"(?:S\.?[ \t]*InTime|S\.?[ \t]*In[ \t]*Time)[ \t]*[:.]?[ \t]*(\d{1,2}:\d{2}(?::\d{2})?)",
            "s_in",
        ),
        (
            r"(?:^|[^\w])(?:InTime|In[ \t]*Time|Punch[ \t]*In)[ \t]*[:.]?[ \t]*(\d{1,2}:\d{2}(?::\d{2})?)",
            "a_in",
        ),
        (
            r"(?:OutTime|Out[ \t]*Time|Punch[ \t]*Out)[ \t]*[:.]?[ \t]*(\d{1,2}:\d{2}(?::\d{2})?)",
            "a_out",
        ),
    ):
        m = re.search(pat, chunk, re.I | re.M)
        if m:
            out[key] = m.group(1).strip()
    return out or None


def _normalize_policy_pair_to_in_out(t_first: str, t_second: str) -> tuple[str, str]:
    """
    Policy columns may list (S.In, S.Out) or (S.Out, S.In) for the same calendar day.
    Shift must always use S.In (start). If the pair is reversed same-day, swap.
    Night shifts (evening start -> next-morning end) keep order when that pattern applies.
    """
    ma = parse_time_to_minutes(t_first)
    mb = parse_time_to_minutes(t_second)
    if ma is None or mb is None:
        return t_first, t_second
    if ma == 0 or mb == 0:
        return t_first, t_second
    if mb >= ma:
        return t_first, t_second
    gap = ma - mb
    if mb < 720 and ma >= 1020 and gap > 720:
        return t_first, t_second
    return t_second, t_first


def _normalize_act_in_out(a: str, b: str) -> tuple[str, str]:
    """
    Return (in, out) from two punch times on the same attendance day.
    ESSL rows list actual In before Out; older code assumed the reverse for 2-token rows.
    """
    m0 = parse_time_to_minutes(a)
    m1 = parse_time_to_minutes(b)
    if m0 is None or m1 is None:
        return a, b
    if m0 == 0 or m1 == 0:
        return a, b
    # Typical same-day shift: earlier punch is in, later is out.
    if m0 <= m1 and 30 <= (m1 - m0) <= 900:
        return a, b
    if m1 <= m0 and 30 <= (m0 - m1) <= 900:
        return b, a
    # Night shift: evening in, next-morning out.
    w_ab = compute_minutes(a, b)
    w_ba = compute_minutes(b, a)
    if m0 >= 960 and m1 < 720 and 60 <= w_ab <= 960:
        return a, b
    if m1 >= 960 and m0 < 720 and 60 <= w_ba <= 960:
        return b, a
    if 60 <= w_ab <= 900 and (w_ba < 60 or w_ba > 900 or w_ab <= w_ba):
        return a, b
    if 60 <= w_ba <= 900:
        return b, a
    return (a, b) if m0 <= m1 else (b, a)


def _resolve_act_in_out(times: list[str]) -> tuple[str | None, str | None]:
    """Pick actual in/out from 2-4 positional punch tokens on an ESSL row."""
    tokens = [t for t in _drop_leading_midnight(list(times)) if t and not _is_midnight_placeholder(t)]
    if not tokens:
        return None, None
    if len(tokens) == 1:
        return tokens[0], None
    if len(tokens) >= 4:
        _, _, act_in, act_out = _split_four_times(tokens[:4])
        return _normalize_act_in_out(act_in, act_out)

    candidate_pairs: list[tuple[str, str]]
    if len(tokens) == 2:
        candidate_pairs = [(tokens[0], tokens[1])]
    else:
        candidate_pairs = [
            (tokens[0], tokens[1]),
            (tokens[1], tokens[2]),
            (tokens[0], tokens[2]),
        ]

    best: tuple[str, str, int] | None = None
    for a, b in candidate_pairs:
        i, o = _normalize_act_in_out(a, b)
        if _is_invalid_punch_in(i) or not o:
            continue
        worked = compute_minutes(i, o)
        if worked <= 0:
            continue
        plausible = 60 <= worked <= 900
        if best is None:
            best = (i, o, worked)
            continue
        best_plausible = 60 <= best[2] <= 900
        if plausible and not best_plausible:
            best = (i, o, worked)
        elif plausible == best_plausible and worked > best[2]:
            best = (i, o, worked)

    if best:
        return best[0], best[1]
    i, o = _normalize_act_in_out(tokens[0], tokens[1])
    if _is_invalid_punch_in(i):
        return None, None
    return i, o


def _split_four_times(times: list[str]) -> tuple[str, str, str, str]:
    """
    Four clock values: two pairs (sched in/out vs act in/out). Pick which pair is *policy*
    by scoring full pairs - (S.In, S.Out) has a plausible same-day span and a policy-like
    first time; (Act In, Act Out) often starts with punch minutes (:37) and must not lose
    to a pair that is actually (Act In, S.Out) with 18:30 mistaken for S.In.
    Returns (sch_in, sch_out, act_in, act_out); sch_in is always normalized to true S.In.
    """
    t0, t1, t2, t3 = times[0], times[1], times[2], times[3]
    p1 = _office_day_pair_score(t0, t1)
    p2 = _office_day_pair_score(t2, t3)
    if p2 > p1:
        sch_in, sch_out = _normalize_policy_pair_to_in_out(t2, t3)
        return sch_in, sch_out, t0, t1
    if p1 > p2:
        sch_in, sch_out = _normalize_policy_pair_to_in_out(t0, t1)
        return sch_in, sch_out, t2, t3
    if _policy_start_likelihood(t2) > _policy_start_likelihood(t0):
        sch_in, sch_out = _normalize_policy_pair_to_in_out(t2, t3)
        return sch_in, sch_out, t0, t1
    sch_in, sch_out = _normalize_policy_pair_to_in_out(t0, t1)
    return sch_in, sch_out, t2, t3


def _apply_row_to_record(
    rec: dict,
    date_str: str,
    times: list[str],
    chunk: str = "",
    block: str = "",
) -> None:
    """
    Shift (S.InTime) = scheduled shift start; Login = actual InTime (first punch).
    Late in UI: login vs shift + 15 min (handled in dashboard isLateToken).
    """
    dt = datetime.strptime(date_str, "%d-%b-%Y")
    day = dt.day

    times = _drop_leading_midnight(times)
    if not times:
        return

    sch_in = sch_out = act_in = act_out = None
    if len(times) >= 4:
        sch_in, sch_out, act_in, act_out = _split_four_times(times)

    labeled = _labeled_times_from_chunk(chunk) if chunk else None
    if labeled and labeled.get("a_in"):
        i = labeled["a_in"]
        o = labeled.get("a_out") or act_out
    else:
        i, o = _resolve_act_in_out(times)
        if labeled and labeled.get("a_out") and not o:
            o = labeled["a_out"]

    if _is_invalid_punch_in(i):
        i = o = None
        worked = 0
    else:
        worked = compute_minutes(i, o) if i and o else 0

    if _is_invalid_punch_in(i):
        i = o = None
        worked = 0

    if worked <= 0 and not i:
        status = "AB"
    else:
        status = f"P({minutes_to_hhmm(worked)})"

    shift_in = rec.get("S.InTime")
    if shift_in and not _is_midnight_placeholder(shift_in):
        rec.setdefault("shift_by_day", {})[day] = shift_in

    old = rec["days"].get(day, "")
    if old.startswith("P(") and not status.startswith("P("):
        return

    rec.setdefault("out_times", {})
    rec["days"][day] = status
    rec["in_times"][day] = i
    rec["out_times"][day] = o
    rec["work_minutes"][day] = worked


def _parse_attendance_rows_from_block(block: str):
    """
    Walk lines; each date starts a row. Merge following lines until we have enough
    times (punches often sit on the next line after date in extract_text() output).
    """
    line_list = [ln.strip() for ln in block.splitlines() if ln.strip()]
    idx = 0
    while idx < len(line_list):
        line = line_list[idx]
        dm = re.search(r"(\d{2}-[A-Za-z]{3}-\d{4})", line, re.I)
        if not dm:
            idx += 1
            continue
        date_str = dm.group(1)
        chunk = line[dm.end() :]
        j = idx + 1
        times = _time_tokens(chunk)
        merge_budget = 0
        while j < len(line_list) and merge_budget < 8:
            nxt = line_list[j]
            if re.search(r"\d{2}-[A-Za-z]{3}-\d{4}", nxt, re.I):
                break
            if len(times) >= 4:
                break
            chunk = f"{chunk} {nxt}"
            times = _time_tokens(chunk)
            j += 1
            merge_budget += 1
        yield date_str, times, chunk
        idx = j if j > idx else idx + 1


def _s_in_from_row_times(times: list[str]) -> str | None:
    """
    Direct S.InTime pick from row tokens without hardcoding employee values.
    Use rounded candidates (:00/:30) and pick the one closest to login token.
    """
    if not times:
        return None
    login_guess = times[0] if times else None
    login_m = parse_time_to_minutes(login_guess) if login_guess else None
    cands: list[tuple[str, int]] = []
    for t in times:
        m = parse_time_to_minutes(t)
        if m is None or m == 0:
            continue
        if m % 60 not in (0, 30):
            continue
        cands.append((t, m))
    if not cands:
        return None
    if login_m is None:
        return sorted(cands, key=lambda x: x[1])[0][0]
    ranked: list[tuple[int, int, str]] = []
    for t, m in cands:
        d = abs(m - login_m)
        d = min(d, 1440 - d)
        ranked.append((d, m, t))
    ranked.sort(key=lambda x: (x[0], x[1]))
    return ranked[0][2]


def _split_emp_blocks(full_text: str) -> list[str]:
    """
    One slice per Emp Code header. Index-based (not non-greedy findall) so we never
    merge or drop sections on awkward PDF text.
    """
    markers = list(re.finditer(r"(?i)Emp\s*Code\s*:\s*\S+", full_text))
    if not markers:
        return []
    blocks: list[str] = []
    for i, m in enumerate(markers):
        start = m.start()
        end = markers[i + 1].start() if i + 1 < len(markers) else len(full_text)
        blocks.append(full_text[start:end])
    return blocks


def _extract_employee_name(block: str) -> str:
    """
    ESSL layouts vary (same-line name, name on next line, Emp Name, etc.).
    Never skip a block solely because this fails - return "" and still import the row.
    """
    patterns = [
        r"Employee\s*Name\s*:\s*([^\n\r]+)",
        r"Employee\s*Name\s*:\s*\n\s*([^\n\r]+)",
        r"Emp\.?\s*Name\s*:\s*([^\n\r]+)",
        r"Name\s*of\s*(?:the\s*)?Employee\s*:\s*([^\n\r]+)",
    ]
    for p in patterns:
        m = re.search(p, block, re.I)
        if not m:
            continue
        raw = m.group(1).strip()
        if raw:
            return re.split(r"Att\.|Shift|Punch", raw)[0].strip()
    return ""


def _extract_s_in_time_from_block(block: str) -> str | None:
    """
    Scheduled shift start from explicit S.InTime only (as requested).
    Not from generic Shift labels or inferred positional tokens.
    """
    dm = re.search(r"\d{2}-[A-Za-z]{3}-\d{4}", block, re.I)
    head = block[: dm.start()] if dm else block

    for ln in head.splitlines():
        m = re.search(
            r"(?:S\.?[ \t]*InTime|S\.?[ \t]*In[ \t]*Time)[^\n\r]*?(\d{1,2}:\d{2}(?::\d{2})?)",
            ln,
            re.I,
        )
        if m:
            t = m.group(1).strip()
            if not _is_midnight_placeholder(t):
                return t

    m = re.search(
        r"(?:S\.?[ \t]*InTime|S\.?[ \t]*In[ \t]*Time)[^\n\r]*?(\d{1,2}:\d{2}(?::\d{2})?)",
        head,
        re.I | re.M,
    )
    if m:
        t = m.group(1).strip()
        if not _is_midnight_placeholder(t):
            return t

    for ln in block.splitlines():
        if not re.search(r"S\.?[ \t]*In(?:[ \t]*Time)?", ln, re.I):
            continue
        times = _time_tokens(ln)
        if not times:
            continue
        rounded = [t for t in times if parse_time_to_minutes(t) and parse_time_to_minutes(t) % 60 in (0, 30)]
        cand = rounded[0] if rounded else times[0]
        if not _is_midnight_placeholder(cand):
            return cand
    return None


def parse_pdf_to_records(pdf_path: str, company=None):
    """
    company is ignored (kept for call compatibility). All employees in the PDF are imported.
    """
    del company
    if not os.path.isfile(pdf_path):
        return None

    records: dict[str, dict] = {}
    with pdfplumber.open(pdf_path) as pdf:
        full_text = ""
        for page in pdf.pages:
            txt = page.extract_text()
            if txt:
                full_text += txt + "\n"

    report_date = extract_report_date(full_text)
    if not report_date:
        return None

    for block in _split_emp_blocks(full_text):
        code_match = re.search(r"Emp\s*Code\s*:\s*(\S+)", block, re.I)
        if not code_match:
            continue
        emp_code = code_match.group(1).strip()
        emp_name = _extract_employee_name(block)

        if emp_code not in records:
            records[emp_code] = {
                "EmpCode": emp_code,
                "EmpName": emp_name,
                "S.InTime": None,
                "shift_by_day": {},
                "days": {},
                "in_times": {},
                "out_times": {},
                "work_minutes": {},
                "is_late": {},
            }
        elif emp_name and not records[emp_code].get("EmpName"):
            records[emp_code]["EmpName"] = emp_name

        rec = records[emp_code]
        s_in_header = _extract_s_in_time_from_block(block)
        if s_in_header and not _is_midnight_placeholder(s_in_header):
            rec["S.InTime"] = s_in_header

        for date_str, times, chunk in _parse_attendance_rows_from_block(block):
            if len(times) < 2:
                try:
                    dt = datetime.strptime(date_str, "%d-%b-%Y")
                    old = rec["days"].get(dt.day, "")
                    if not str(old).startswith("P("):
                        rec["days"][dt.day] = "AB"
                        rec.setdefault("in_times", {})[dt.day] = None
                        rec.setdefault("out_times", {})[dt.day] = None
                        rec.setdefault("work_minutes", {})[dt.day] = 0
                except ValueError:
                    pass
                continue
            s_in_col = _s_in_from_row_times(times)
            if s_in_col and not rec.get("S.InTime"):
                rec["S.InTime"] = s_in_col
            _apply_row_to_record(rec, date_str, times, chunk, block)

        need_fallback = (
            not rec["days"]
            or report_date.day not in rec["days"]
            or not str(rec["days"].get(report_date.day, "")).startswith("P(")
        )
        if need_fallback:
            loose = re.findall(
                r"(\d{2}-[A-Za-z]{3}-\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(\d{1,2}:\d{2}(?::\d{2})?)"
                r"(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?",
                block,
                re.S,
            )
            for tup in loose:
                date_str = tup[0]
                rest = [x for x in tup[1:] if x]
                if len(rest) < 2:
                    continue
                s_in_col = _s_in_from_row_times(rest)
                if s_in_col and not rec.get("S.InTime"):
                    rec["S.InTime"] = s_in_col
                _apply_row_to_record(rec, date_str, rest, " ".join(rest), block)

    for emp in records.values():
        shift_min = parse_time_to_minutes(emp.get("S.InTime"))
        for d in emp["days"].keys():
            in_min = parse_time_to_minutes(emp["in_times"].get(d))
            st = emp["days"].get(d, "")
            present = str(st).startswith("P")
            emp["is_late"][d] = int(
                present
                and in_min is not None
                and shift_min is not None
                and in_min > shift_min + 15
            )

    max_report_day = report_date.day
    for emp in records.values():
        for day_key in emp.get("days", {}):
            if isinstance(day_key, int):
                max_report_day = max(max_report_day, day_key)

    return records, report_date.replace(day=max_report_day)


def _status_for_bridge(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    if s.lower() in ("absent", "ab"):
        return "AB"
    return s


def records_to_monthly_dataframe(records: dict) -> pd.DataFrame:
    """Monthly grid for HR Automation pdf_to_json._build_employees_from_df."""
    rows: list[dict] = []
    for emp in records.values():
        row = {
            "EmpCode": emp["EmpCode"],
            "EmpName": emp["EmpName"],
            "S.InTime": emp["S.InTime"] or "",
        }
        for d in range(1, 32):
            row[f"day{d}"] = _status_for_bridge(emp["days"].get(d, ""))
            it = emp["in_times"].get(d)
            row[f"day{d}InTime"] = str(it).strip() if it else ""
            wm = emp.get("work_minutes", {}).get(d)
            row[f"day{d}OutTime"] = derive_out_time(
                it, emp.get("out_times", {}).get(d), wm
            )
            if wm:
                row[f"day{d}Hours"] = round(float(wm) / 60.0, 4)
            row[f"day{d}IsLate"] = 1 if emp["is_late"].get(d, 0) else 0
            if emp["is_late"].get(d, 0) and it:
                in_min = parse_time_to_minutes(it)
                shift_min = parse_time_to_minutes(emp.get("S.InTime"))
                if in_min is not None and shift_min is not None and in_min > shift_min:
                    row[f"day{d}LateMinutes"] = in_min - shift_min
        rows.append(row)
    return pd.DataFrame(rows)


def process_attendance(pdf_path: str, company=None, target_day=None):
    """
    company is ignored (kept for call compatibility). Full roster from the PDF is exported.
    """
    if not os.path.isfile(pdf_path):
        print("❌ File not found")
        return None

    parsed = parse_pdf_to_records(pdf_path, company)
    if parsed is None:
        print("❌ Failed to parse PDF")
        return None

    records, report_date = parsed
    report_day = report_date.day
    report_label = report_date.strftime("%a, %d %b %Y")

    os.makedirs("output", exist_ok=True)

    monthly_df = records_to_monthly_dataframe(records)
    monthly_path = os.path.abspath(os.path.join("output", "Attendance_Monthly.xlsx"))
    monthly_df.to_excel(monthly_path, index=False)
    print(f"✅ MONTHLY GRID ({len(records)} employees): {monthly_path}")

    day = target_day or report_day
    rows: list[dict] = []
    date_iso = report_date.replace(day=day).strftime("%Y-%m-%d")
    for emp in records.values():
        check_in = emp["in_times"].get(day) or ""
        worked = emp.get("work_minutes", {}).get(day) or 0
        late = bool(emp["is_late"].get(day, 0))
        late_minutes: int | str = ""
        if late and check_in:
            in_min = parse_time_to_minutes(check_in)
            shift_min = parse_time_to_minutes(emp.get("S.InTime"))
            if in_min is not None and shift_min is not None and in_min > shift_min:
                late_minutes = in_min - shift_min
        status = emp["days"].get(day, "AB")
        present = str(status).startswith("P")
        if late:
            late_mark = "Late"
        elif present:
            late_mark = "On time"
        else:
            late_mark = "-"
        rows.append(
            {
                "Employee": f"{emp['EmpName']} ({emp['EmpCode']})",
                "Date": date_iso,
                "In Time": emp["S.InTime"] or "",
                "Check-in": check_in,
                "Out Time": derive_out_time(
                    check_in, emp.get("out_times", {}).get(day), worked
                ),
                "Working Hours": duration_hhmm(worked) if present else "",
                "Late Mark": late_mark,
                "Late minutes": late_minutes,
            }
        )

    df = pd.DataFrame(rows)
    daily_path = f"output/Daily_{day}.xlsx"
    df.to_excel(daily_path, index=False)
    print(f"✅ DAILY ({report_label}): {daily_path}")

    return {
        "excelPath": monthly_path,
        "path": daily_path,
        "reportDay": report_day,
        "reportDate": report_label,
        "reportDateIso": report_date.strftime("%Y-%m-%d"),
    }


if __name__ == "__main__":
    pdf = sys.argv[1] if len(sys.argv) > 1 else ""
    day = int(sys.argv[2]) if len(sys.argv) > 2 else None
    process_attendance(pdf, target_day=day)
