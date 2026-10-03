#!/usr/bin/env python3
"""
Cross-check ESSL JSON against Computex-style leave and WFH Excel exports.
Replaces AB (and empty cells on daily/weekly scoped uploads) when the same employee
(code + name) has DA / SL / PL / CL / WFH on that calendar day.

Usage:
  merge_cross_reports.py <employees.json> <year> <month> <leave.xlsx|-> <wfh.xlsx|->
    [report_type] [report_day]

  report_type: daily | weekly | monthly (default monthly)
  report_day: day-of-month for daily/weekly scope (optional)

Reads employees JSON (list or { "employees": [...] }), prints { "employees": [...], "crossCheck": {...} }.
Use "-" to skip leave or WFH file.
"""
from __future__ import annotations

import calendar
import json
import math
import re
import sys
from datetime import date, datetime, timedelta
from typing import Any

try:
    import pandas as pd
except ImportError:
    print(json.dumps({"error": "pandas required", "employees": []}))
    sys.exit(1)


def _frame_with_header_row(raw: pd.DataFrame, header_row: int) -> pd.DataFrame:
    if raw is None or raw.empty or header_row < 0 or header_row >= len(raw):
        return pd.DataFrame()
    head = raw.iloc[header_row].tolist()
    cols: list[str] = []
    seen: dict[str, int] = {}
    for i, v in enumerate(head):
        c = cell_str(v) or f"col_{i+1}"
        n = seen.get(c, 0)
        seen[c] = n + 1
        cols.append(c if n == 0 else f"{c}__{n+1}")
    data = raw.iloc[header_row + 1 :].copy()
    data.columns = cols
    data = data.dropna(how="all")
    return data.reset_index(drop=True)


def _score_merge_df(df: pd.DataFrame) -> int:
    if df is None or df.empty:
        return -10_000
    cols = [str(c).strip().lower() for c in df.columns]
    cols_alnum = [re.sub(r"[^a-z0-9]", "", c) for c in cols]
    score = 0
    if any(c in ("name", "empname", "employeename") for c in cols_alnum):
        score += 120
    if any(c in ("date", "from", "to", "submitdate", "submittedon") for c in cols_alnum):
        score += 80
    if any(c in ("leave", "leavetype", "status", "abbreviation", "type") for c in cols_alnum):
        score += 60
    if any(c in ("situation", "direction", "inout", "io") for c in cols_alnum):
        score += 40
    # Wide calendar grids often have many day/date columns.
    day_like = 0
    for c in df.columns:
        s = cell_str(c)
        if re.fullmatch(r"\d{1,2}", s):
            day_like += 1
            continue
        if parse_to_date(c) is not None:
            day_like += 1
    score += min(day_like, 31) * 3
    score += min(len(df), 500)
    return score


def _best_df_from_raw(raw: pd.DataFrame) -> pd.DataFrame:
    if raw is None or raw.empty:
        return pd.DataFrame()
    best_df = pd.DataFrame()
    best_score = -10_000
    max_header_scan = min(12, len(raw) - 1)
    for hr in range(0, max_header_scan + 1):
        cand = _frame_with_header_row(raw, hr)
        sc = _score_merge_df(cand)
        if sc > best_score:
            best_score = sc
            best_df = cand
    return best_df


def read_merge_table(path: str) -> pd.DataFrame:
    low = path.lower()
    if low.endswith(".csv"):
        raw = pd.read_csv(path, header=None, dtype=object)
        return _best_df_from_raw(raw)
    if low.endswith(".tsv"):
        raw = pd.read_csv(path, sep="\t", header=None, dtype=object)
        return _best_df_from_raw(raw)
    if low.endswith(".ods"):
        xls = pd.ExcelFile(path, engine="odf")
    elif low.endswith(".xls"):
        xls = pd.ExcelFile(path, engine="xlrd")
    else:
        xls = pd.ExcelFile(path)

    best_df = pd.DataFrame()
    best_score = -10_000
    for sheet in xls.sheet_names:
        try:
            raw = xls.parse(sheet, header=None)
        except Exception:
            continue
        cand = _best_df_from_raw(raw)
        sc = _score_merge_df(cand)
        if sc > best_score:
            best_score = sc
            best_df = cand
    return best_df


def norm_code(s: str) -> str:
    return re.sub(r"\s+", "", str(s).strip().upper())


def norm_name(s: str) -> str:
    return re.sub(r"\s+", " ", str(s).strip().lower())


def norm_name_key(s: str) -> str:
    """Loose name key: lowercase alnum only (ignore spaces/punctuation)."""
    return re.sub(r"[^a-z0-9]", "", norm_name(s))


def scope_days_for_report(
    report_type: str, year: int, month: int, report_day: int | None
) -> set[int] | None:
    """
    Which calendar days in the month to cross-check.
    None = whole month (monthly upload). Daily = one day. Weekly = Mon-Sun bucket in month.
    """
    dim = calendar.monthrange(year, month)[1]
    rt = (report_type or "monthly").strip().lower()
    if rt == "monthly" or report_day is None:
        return None
    if not (1 <= report_day <= dim):
        return set()
    if rt == "daily":
        return {report_day}
    if rt == "weekly":
        js_first = (calendar.weekday(year, month, 1) + 1) % 7
        first_dow_monday_first = (js_first + 6) % 7
        week_idx = (first_dow_monday_first + (report_day - 1)) // 7
        return {
            d
            for d in range(1, dim + 1)
            if (first_dow_monday_first + (d - 1)) // 7 == week_idx
        }
    return None


def _is_merge_candidate(raw: str, scoped: bool) -> bool:
    """Cells that still need leave/WFH lookup when overlay did not apply."""
    if raw.strip().upper() == "AB":
        return True
    if not raw.strip():
        return True
    return scoped and not raw.strip()


def _employee_code_from_row(emp: dict[str, Any]) -> str:
    return norm_code(
        cell_str(
            emp.get("employeeCode")
            or emp.get("empCode")
            or emp.get("code")
            or emp.get("EmpCode")
            or ""
        )
    )


def _wfh_token(entry: Any) -> str | None:
    if entry is None:
        return None
    if isinstance(entry, dict):
        tok = cell_str(entry.get("token"))
        return tok or None
    tok = cell_str(entry)
    return tok or None


def _wfh_entry(token: str, **extra: Any) -> dict[str, Any]:
    row: dict[str, Any] = {"token": token}
    for k, v in extra.items():
        if v is not None and v != "":
            row[k] = v
    return row


def _lookup_leave_token(
    leave_map: dict[tuple[str, str, int, int, int], str],
    code: str,
    name: str,
    y: int,
    mo: int,
    day: int,
) -> str | None:
    nc = norm_code(code)
    nk = norm_name(name)
    for key in ((nc, nk, y, mo, day), ("", nk, y, mo, day)):
        hit = leave_map.get(key)
        if hit:
            return hit
    return _single_token_for_name_day(leave_map, name, y, mo, day)


def _lookup_wfh_entry(
    wfh_map: dict[tuple[str, str, int, int, int], Any],
    code: str,
    name: str,
    y: int,
    mo: int,
    day: int,
) -> Any | None:
    nc = norm_code(code)
    nk = norm_name(name)
    for key in ((nc, nk, y, mo, day), ("", nk, y, mo, day)):
        hit = wfh_map.get(key)
        if hit is not None:
            return hit
    nk_key = norm_name_key(name)
    if not nk_key:
        return None
    hits: list[Any] = []
    for (c, n, yy, mm, dd), payload in wfh_map.items():
        if yy != y or mm != mo or dd != day:
            continue
        if c and nc and c != nc:
            continue
        nk2 = norm_name_key(n)
        if not nk2:
            continue
        if nk_key == nk2 or nk_key in nk2 or nk2 in nk_key:
            hits.append(payload)
    if not hits:
        return None
    uniq: list[Any] = []
    for h in hits:
        if h not in uniq:
            uniq.append(h)
    return uniq[0] if len(uniq) == 1 else None


def _apply_wfh_punch_fields(emp: dict[str, Any], day: int, wfh_entry: Any) -> None:
    if not isinstance(wfh_entry, dict):
        return
    in_t = cell_str(wfh_entry.get("in_time"))
    out_t = cell_str(wfh_entry.get("out_time"))
    hours = wfh_entry.get("hours")
    if in_t:
        emp[f"day{day}InTime"] = in_t
    if out_t:
        emp[f"day{day}OutTime"] = out_t
    if hours is not None:
        try:
            emp[f"day{day}Hours"] = round(float(hours), 4)
        except (TypeError, ValueError):
            pass


def cell_str(val: Any) -> str:
    if val is None:
        return ""
    try:
        if pd.isna(val):
            return ""
    except (TypeError, ValueError):
        pass
    s = str(val).strip()
    if not s or s.lower() == "nan":
        return ""
    return s


def _col_map(df: pd.DataFrame) -> dict[str, str]:
    return {str(c).strip().lower().replace(" ", "_"): c for c in df.columns}


def find_col(df: pd.DataFrame, keys: tuple[str, ...]) -> str | None:
    """Resolve headers like 'Emp Code', 'EMPLOYEE CODE', 'empcode' reliably."""
    cmap = _col_map(df)
    alnum: dict[str, str] = {}
    for c in df.columns:
        a = re.sub(r"[^a-z0-9]", "", str(c).lower())
        if a not in alnum:
            alnum[a] = c
    for k in keys:
        if k in df.columns:
            return k
        nk = k.strip().lower().replace(" ", "_")
        if nk in cmap:
            return cmap[nk]
        ka = re.sub(r"[^a-z0-9]", "", str(k).lower())
        if ka in alnum:
            return alnum[ka]
    return None


def parse_to_date(val: Any) -> date | None:
    if val is None:
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return val.date()
    if hasattr(val, "date") and callable(getattr(val, "date")):
        try:
            d = val.date()
            if isinstance(d, date):
                return d
        except (ValueError, OSError, TypeError):
            pass
    s = cell_str(val)
    if not s:
        return None
    fmts = (
        "%d-%b-%Y %I:%M %p",
        "%d-%b-%Y",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%Y-%m-%d",
        "%m/%d/%Y",
    )
    for fmt in fmts:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    try:
        ts = pd.to_datetime(s, dayfirst=True, errors="coerce")
        if pd.notna(ts):
            return ts.date()
    except (ValueError, TypeError):
        pass
    try:
        x = float(s)
        if math.isfinite(x) and 20000 < x < 80000:
            return date(1899, 12, 30) + timedelta(days=int(round(x)))
    except (ValueError, OSError, OverflowError, TypeError):
        pass
    return None


def parse_col_day_for_month(col: Any, target_m: int) -> int | None:
    """
    Parse day-of-month from a column header for the target month.
    Supports headers like:
    - 01-Apr-2026 / 01/04/2026 / 2026-04-01
    - 01-Apr / 01 Apr / Apr-01
    - 1, 2, 3 ... 31 (day-only grid headers)
    """
    s = cell_str(col)
    if not s:
        return None

    d0 = parse_to_date(s)
    if d0 and d0.month == target_m:
        return d0.day

    # Day-only header (1..31)
    if re.fullmatch(r"\d{1,2}", s):
        d = int(s)
        if 1 <= d <= 31:
            return d

    sm = s.strip().lower()
    mon_names = {
        "jan": 1,
        "feb": 2,
        "mar": 3,
        "apr": 4,
        "may": 5,
        "jun": 6,
        "jul": 7,
        "aug": 8,
        "sep": 9,
        "oct": 10,
        "nov": 11,
        "dec": 12,
    }

    # "01-Apr", "01 Apr", "Apr-01", "Apr 01"
    m1 = re.match(r"^\s*(\d{1,2})\s*[-/ ]\s*([A-Za-z]{3,})\s*$", sm)
    if m1:
        d = int(m1.group(1))
        mm = mon_names.get(m1.group(2)[:3], 0)
        if 1 <= d <= 31 and mm == target_m:
            return d
    m2 = re.match(r"^\s*([A-Za-z]{3,})\s*[-/ ]\s*(\d{1,2})\s*$", sm)
    if m2:
        mm = mon_names.get(m2.group(1)[:3], 0)
        d = int(m2.group(2))
        if 1 <= d <= 31 and mm == target_m:
            return d

    return None


# Leave / WFH token priority when the same day has multiple rows (higher wins)
_TOKEN_PRI = {"DA": 50, "SL": 40, "PL": 40, "CL": 40, "WFH": 30, "WFH(HD)": 25}


def canon_leave_token(raw: str) -> str | None:
    t = cell_str(raw).upper().replace(".", "")
    if not t:
        return None
    if t in ("DA", "DAY OFF", "WEEK OFF", "WEEKLY OFF", "WO"):
        return "DA"
    if t == "SL" or "SICK" in t:
        return "SL"
    if t == "PL" or "PERSONAL" in t:
        return "PL"
    if t == "CL" or "CASUAL" in t:
        return "CL"
    if "WFH" in t or "WORK FROM HOME" in t or "REMOTE" in t or "HOME OFFICE" in t:
        if "HD" in t or "HALF" in t:
            return "WFH(HD)"
        return "WFH"
    if len(t) <= 4 and t.isalpha() and t in ("DA", "SL", "PL", "CL", "WFH"):
        return t
    return None


def pick_better(cur: str | None, nxt: str) -> str:
    if cur is None:
        return nxt
    def _pri(tok: str | None) -> int:
        t = (tok or "").strip().upper()
        if not t:
            return 0
        if t.startswith("P(") or t.startswith("WFH("):
            return 36
        return _TOKEN_PRI.get(t, 0)

    return cur if _pri(cur) >= _pri(nxt) else nxt


def _token_sort_pri(tok: str) -> int:
    """P(09:30) duration tokens (present + worked time)."""
    if tok.startswith("P(") or tok.startswith("WFH("):
        return 36
    return _TOKEN_PRI.get(tok, 0)


def _should_replace_cell(raw: str, tok: str) -> bool:
    """Apply leave/WFH from cross-check over empty, AB, or mistaken P cells."""
    ru = raw.strip().upper()
    tu = str(tok).strip().upper()
    if not tu:
        return False
    if ru == tu:
        return False
    if not ru or ru == "AB":
        return True
    if ru == "P" or ru.startswith("P("):
        return tu.startswith("WFH") or tu in ("SL", "PL", "CL", "DA", "WO", "WFH(HD)")
    return False


def pick_better_leave_wfh(cur: str | None, nxt: str) -> str:
    """When both leave and WFH match a day, respect priorities incl. P(HH:MM)."""
    if cur is None:
        return nxt
    if nxt is None:
        return cur
    return cur if _token_sort_pri(cur) >= _token_sort_pri(nxt) else nxt


def _overlay_leave_wfh_token(lt: str | None, wt: str | None) -> str | None:
    if lt and wt:
        return pick_better_leave_wfh(lt, wt)
    return lt or wt


def pick_better_wfh_entry(cur: Any | None, nxt: dict[str, Any]) -> dict[str, Any]:
    """Prefer richer WFH entries (with punch times) over plain tokens."""
    if cur is None:
        return nxt
    cur_tok = _wfh_token(cur) or ""
    nxt_tok = _wfh_token(nxt) or ""
    cur_rich = isinstance(cur, dict) and bool(cur.get("in_time") or cur.get("out_time"))
    nxt_rich = bool(nxt.get("in_time") or nxt.get("out_time"))
    if nxt_rich and not cur_rich:
        return nxt
    if cur_rich and not nxt_rich:
        return cur if isinstance(cur, dict) else nxt
    if _token_sort_pri(nxt_tok) > _token_sort_pri(cur_tok):
        return nxt
    if isinstance(cur, dict):
        return cur
    return nxt


def _parse_clock_to_minutes(val: Any) -> int | None:
    """Match attendance_tool.parse_time_to_minutes."""
    s = cell_str(val)
    if not s:
        return None
    for fmt in ("%H:%M:%S", "%H:%M", "%I:%M %p", "%I:%M:%S %p"):
        try:
            t = datetime.strptime(s, fmt)
            return t.hour * 60 + t.minute
        except ValueError:
            continue
    m = re.search(r"\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b", s, re.I)
    if m:
        t0 = m.group(1).strip().upper()
        for fmt in ("%I:%M %p", "%I:%M:%S %p", "%H:%M:%S", "%H:%M"):
            try:
                t = datetime.strptime(t0, fmt)
                return t.hour * 60 + t.minute
            except ValueError:
                continue
    return None


def _compute_worked_minutes(in_s: str, out_s: str) -> int:
    i = _parse_clock_to_minutes(in_s)
    o = _parse_clock_to_minutes(out_s)
    if i is None or o is None:
        return 0
    if o < i:
        o += 24 * 60
    return max(o - i, 0)


def _wfh_token_from_worked_minutes(worked: int) -> str:
    """WFH duration token from IN/OUT span; IN-only remains WFH(HD)."""
    if worked <= 0:
        return "WFH(HD)"
    return f"WFH({worked // 60:02d}:{worked % 60:02d})"


def load_wfh_computex_submit_format(
    df: pd.DataFrame, target_y: int, target_m: int
) -> dict[tuple[str, str, int, int, int], dict[str, Any]]:
    """
    Computex WFH export: Code, Employee Name, Submit Date, Situation (IN/OUT), Time.
    When a separate Date column exists (PM Computex WFH 08.xls), group IN/OUT by that
    work day - OUT rows are often submitted on the next calendar day but belong to Date.
    Full day with IN+OUT → WFH(HH:MM) + punch times; IN only → WFH(HD).
    """
    out: dict[tuple[str, str, int, int, int], dict[str, Any]] = {}
    c_submit = find_col(
        df,
        ("Submit Date", "submit_date", "SubmitDate", "Submitted On", "submitted_on"),
    )
    c_work_date = find_col(
        df,
        (
            "Date",
            "date",
            "Work Date",
            "work_date",
            "Attendance Date",
            "attendance_date",
            "wfh_date",
        ),
    )
    c_sit = find_col(df, ("Situation", "situation", "Direction", "direction"))
    c_time = find_col(df, ("Time", "time", "Punch Time", "punch_time", "PunchTime"))
    c_code = find_col(
        df,
        (
            "Code",
            "EmpCode",
            "employee_code",
            "emp_code",
            "code",
            "employee_id",
            "emp_id",
            "empcode",
            "employee code",
        ),
    )
    c_name = find_col(
        df,
        (
            "EmpName",
            "employee_name",
            "emp_name",
            "name",
            "employee name",
            "employee",
        ),
    )
    if not (c_submit and c_sit and c_name):
        return out

    slots: dict[tuple[str, str, int, int, int], dict[str, str | None]] = {}

    for _, row in df.iterrows():
        name = norm_name(cell_str(row.get(c_name)))
        if not name:
            continue
        code = norm_code(cell_str(row.get(c_code))) if c_code else ""
        work_dt = parse_to_date(row.get(c_work_date)) if c_work_date else None
        if work_dt is None or work_dt.year != target_y or work_dt.month != target_m:
            work_dt = parse_to_date(row.get(c_submit))
        if not work_dt or work_dt.year != target_y or work_dt.month != target_m:
            continue
        key = (code, name, target_y, target_m, work_dt.day)
        situation = cell_str(row.get(c_sit)).strip().upper()
        time_val = cell_str(row.get(c_time)) if c_time else ""
        if not _parse_clock_to_minutes(time_val):
            # Fallback to time embedded in submit datetime text.
            submit_raw = cell_str(row.get(c_submit))
            m = re.search(r"\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b", submit_raw, re.I)
            if m:
                time_val = m.group(1).strip()
        if not time_val:
            continue
        slot = slots.setdefault(key, {"IN": None, "OUT": None})
        if situation == "IN":
            slot["IN"] = time_val
        elif situation == "OUT":
            slot["OUT"] = time_val

    for key, slot in slots.items():
        in_t = slot.get("IN")
        out_t = slot.get("OUT")
        if not in_t and not out_t:
            continue
        if in_t and out_t:
            worked = _compute_worked_minutes(in_t, out_t)
            token = _wfh_token_from_worked_minutes(worked)
            hours = round(worked / 60.0, 4) if worked > 0 else None
            out[key] = _wfh_entry(token, in_time=in_t, out_time=out_t, hours=hours)
        elif in_t:
            out[key] = _wfh_entry("WFH(HD)", in_time=in_t, hours=5.0)

    return out


def load_leave_overrides(
    path: str, target_y: int, target_m: int
) -> dict[tuple[str, str, int, int, int], str]:
    out: dict[tuple[str, str, int, int, int], str] = {}
    try:
        df = read_merge_table(path)
    except Exception:
        return out
    if df.empty:
        return out

    c_code = find_col(
        df,
        (
            "Code",
            "EmpCode",
            "employee_code",
            "emp_code",
            "code",
            "employee_id",
            "emp_id",
            "empcode",
            "employee code",
        ),
    )
    c_name = find_col(
        df,
        (
            "Employee Name",
            "EmpName",
            "employee_name",
            "emp_name",
            "name",
            "employee name",
            "employee",
        ),
    )
    c_from = find_col(
        df,
        (
            "From",
            "from_date",
            "from",
            "leave_date",
            "date",
            "start_date",
            "applied_date",
        ),
    )
    c_to = find_col(df, ("To", "to_date", "to", "end_date"))
    c_type = find_col(
        df,
        (
            "leave_type",
            "type",
            "abbreviation",
            "abbr",
            "leave_abbr",
            "category",
            "status",
            "leave",
        ),
    )

    for _, row in df.iterrows():
        name = norm_name(cell_str(row.get(c_name)) if c_name else "")
        if not name:
            continue
        code = norm_code(cell_str(row.get(c_code))) if c_code else ""

        d0 = parse_to_date(row.get(c_from)) if c_from else None
        d1 = parse_to_date(row.get(c_to)) if c_to else d0
        if d0 is None:
            for c in df.columns:
                d0 = parse_to_date(row.get(c))
                if d0:
                    break
        if d0 is None:
            continue
        if d1 is None:
            d1 = d0

        tok = canon_leave_token(cell_str(row.get(c_type)) if c_type else "")
        if not tok:
            for c in df.columns:
                if c == c_code or c == c_name:
                    continue
                tok = canon_leave_token(cell_str(row.get(c)))
                if tok:
                    break
        if not tok:
            continue

        d = d0
        while d <= d1:
            if d.year == target_y and d.month == target_m:
                key = (code, name, target_y, target_m, d.day)
                out[key] = pick_better(out.get(key), tok)
            d = d + timedelta(days=1)

    # Fallback for wide calendar-like exports:
    # one row per employee, date columns across the sheet with tokens in cells.
    if c_name:
        day_cols: dict[str, int] = {}
        for col in df.columns:
            if c_name is not None and col == c_name:
                continue
            day = parse_col_day_for_month(col, target_m)
            if day is not None:
                day_cols[str(col)] = day
        if day_cols:
            for _, row in df.iterrows():
                name = norm_name(cell_str(row.get(c_name)))
                if not name:
                    continue
                code = norm_code(cell_str(row.get(c_code))) if c_code else ""
                for col, day in day_cols.items():
                    tok = canon_leave_token(cell_str(row.get(col)))
                    if not tok:
                        continue
                    key = (code, name, target_y, target_m, day)
                    out[key] = pick_better(out.get(key), tok)

    return out


def detect_in_out_column(df: pd.DataFrame) -> str | None:
    for c in df.columns:
        ser = df[c].astype(str).str.strip().str.upper()
        if ser.isin(["IN", "OUT"]).any() and ser.isin(["IN", "OUT"]).sum() >= 1:
            return c
    cmap = _col_map(df)
    for hint in ("in_out", "in/out", "punch", "direction", "io", "type"):
        if hint in cmap:
            return cmap[hint]
    return None


def load_wfh_overrides(path: str, target_y: int, target_m: int) -> dict[tuple[str, str, int, int, int], Any]:
    """
    WFH overrides for AB / scoped-empty cells:
    - Computex: Submit Date + Situation (IN/OUT) + Time → WFH(HH:MM) + punch times.
    - Legacy: punch rows with IN/OUT; calendar rows with WFH text (via leave parser).
    """
    out: dict[tuple[str, str, int, int, int], Any] = {}
    try:
        df = read_merge_table(path)
    except Exception:
        return out
    if df.empty:
        return out

    # Primary: same shape as python_tools/attendance_tool WFH punch rows
    for k, entry in load_wfh_computex_submit_format(df, target_y, target_m).items():
        out[k] = entry

    c_code = find_col(
        df,
        (
            "Code",
            "EmpCode",
            "employee_code",
            "emp_code",
            "code",
            "employee_id",
            "emp_id",
            "empcode",
        ),
    )
    c_name = find_col(
        df,
        (
            "Employee Name",
            "EmpName",
            "employee_name",
            "emp_name",
            "name",
            "employee name",
        ),
    )
    c_io = detect_in_out_column(df)

    flags: dict[tuple[str, str, int, int, int], dict[str, bool]] = {}

    for _, row in df.iterrows():
        name = norm_name(cell_str(row.get(c_name)) if c_name else "")
        if not name:
            continue
        code = norm_code(cell_str(row.get(c_code))) if c_code else ""

        in_month: list[date] = []
        for col in df.columns:
            dt = parse_to_date(row.get(col))
            if dt and dt.year == target_y and dt.month == target_m:
                in_month.append(dt)
        if not in_month:
            continue
        dt = min(in_month)

        direc = ""
        if c_io:
            direc = cell_str(row.get(c_io)).strip().upper()
        if not direc:
            for c in df.columns:
                v = cell_str(row.get(c)).strip().upper()
                if v in ("IN", "OUT"):
                    direc = v
                    break

        key = (code, name, target_y, target_m, dt.day)
        slot = flags.setdefault(key, {"in": False, "out": False})
        if direc == "IN":
            slot["in"] = True
        elif direc == "OUT":
            slot["out"] = True

    for key, slot in flags.items():
        if not slot["in"] and not slot["out"]:
            continue
        cur = out.get(key)
        cur_tok = _wfh_token(cur)
        if cur_tok and str(cur_tok).startswith("WFH("):
            continue
        if slot["in"] and slot["out"]:
            out[key] = _wfh_entry("WFH")
        elif slot["in"]:
            out[key] = pick_better_wfh_entry(cur, _wfh_entry("WFH(HD)", hours=5.0))

    # Computex / HR exports often look like a leave calendar (code, name, dates, remark=WFH)
    # with no IN/OUT column - reuse leave parser and keep WFH rows only.
    try:
        cal = load_leave_overrides(path, target_y, target_m)
        for k, tok in cal.items():
            if tok in ("WFH", "WFH(HD)") or (tok and tok.startswith("WFH")):
                cur = out.get(k)
                cur_tok = _wfh_token(cur)
                if cur_tok and str(cur_tok).startswith("WFH("):
                    continue
                entry = _wfh_entry(tok, hours=5.0 if tok == "WFH(HD)" else None)
                out[k] = pick_better_wfh_entry(cur, entry)
    except Exception:
        pass

    return out


def _single_token_for_name_day(
    m: dict[tuple[str, str, int, int, int], str],
    name: str,
    y: int,
    mo: int,
    di: int,
) -> str | None:
    """Use name+day; exact match first, then loose-name fallback if unique."""
    hits = [
        tok
        for (_c, n, yy, mm, dd), tok in m.items()
        if n == name and yy == y and mm == mo and dd == di
    ]
    if not hits:
        nk = norm_name_key(name)
        if nk:
            for (_c, n, yy, mm, dd), tok in m.items():
                if yy != y or mm != mo or dd != di:
                    continue
                nk2 = norm_name_key(n)
                if not nk2:
                    continue
                # Allow small formatting differences (spaces/punctuation/initials).
                if nk == nk2 or nk in nk2 or nk2 in nk:
                    hits.append(tok)
    if not hits:
        return None
    uniq: list[str] = []
    for t in hits:
        if t not in uniq:
            uniq.append(t)
    return uniq[0] if len(uniq) == 1 else None


def merge_employees(
    employees: list[dict[str, Any]],
    leave_map: dict[tuple[str, str, int, int, int], str],
    wfh_map: dict[tuple[str, str, int, int, int], Any],
    year: int,
    month: int,
    scope_days: set[int] | None = None,
) -> tuple[list[dict[str, Any]], int, int, list[dict[str, Any]]]:
    replaced = 0
    ab_candidates = 0
    unmatched_sample: list[dict[str, Any]] = []
    merged: list[dict[str, Any]] = []
    scoped = scope_days is not None

    for emp in employees:
        e = dict(emp)
        name = norm_name(str(e.get("employeeName", e.get("empName", e.get("name", "")))))
        code = _employee_code_from_row(e)

        for d in range(1, 32):
            if scope_days is not None and d not in scope_days:
                continue
            k = f"day{d}"
            if k not in e:
                continue
            raw = cell_str(e.get(k))

            lt = _lookup_leave_token(leave_map, code, name, year, month, d)
            wt_entry = _lookup_wfh_entry(wfh_map, code, name, year, month, d)
            wt = _wfh_token(wt_entry)
            overlay = _overlay_leave_wfh_token(lt, wt)
            if overlay and _should_replace_cell(raw, overlay):
                tok = overlay
                e[k] = tok
                tok_u = str(tok).strip().upper()
                if tok_u.startswith("WFH"):
                    from_wfh_file = wt is not None
                    e[f"day{d}WfhUnverified"] = 0 if from_wfh_file else 1
                    if wt_entry is not None:
                        _apply_wfh_punch_fields(e, d, wt_entry)
                if f"day{d}Hours" not in e or e.get(f"day{d}Hours") in (None, ""):
                    pm = re.match(r"^(?:P|WFH)\((\d{1,2}):(\d{2})\)$", str(tok).strip(), re.I)
                    if pm:
                        h, mi = int(pm.group(1)), int(pm.group(2))
                        e[f"day{d}Hours"] = round(h + mi / 60.0, 4)
                    elif str(tok).strip().upper() == "WFH(HD)":
                        e[f"day{d}Hours"] = 5.0
                replaced += 1
                continue

            if not _is_merge_candidate(raw, scoped):
                continue
            ab_candidates += 1

            if overlay is None:
                if len(unmatched_sample) < 25:
                    unmatched_sample.append(
                        {
                            "name": str(
                                e.get("employeeName", e.get("empName", e.get("name", "")))
                            ),
                            "code": code,
                            "day": d,
                            "month": month,
                        }
                    )

        merged.append(e)

    return merged, replaced, ab_candidates, unmatched_sample


def main() -> None:
    if len(sys.argv) < 6:
        print(
            json.dumps(
                {
                    "error": "usage: merge_cross_reports.py <employees.json> <year> <month> <leave.xlsx|-> <wfh.xlsx|->",
                    "employees": [],
                }
            )
        )
        sys.exit(1)

    json_path = sys.argv[1]
    try:
        year = int(sys.argv[2])
        month = int(sys.argv[3])
    except ValueError:
        print(json.dumps({"error": "year and month must be integers", "employees": []}))
        sys.exit(1)

    leave_p = sys.argv[4].strip()
    wfh_p = sys.argv[5].strip()
    report_type = sys.argv[6].strip().lower() if len(sys.argv) > 6 else "monthly"
    report_day: int | None = None
    if len(sys.argv) > 7 and sys.argv[7].strip().isdigit():
        report_day = int(sys.argv[7].strip())
    if not (1 <= month <= 12):
        print(json.dumps({"error": "month must be 1-12", "employees": []}))
        sys.exit(1)

    scope_days = scope_days_for_report(report_type, year, month, report_day)

    try:
        with open(json_path, encoding="utf-8") as f:
            payload = json.load(f)
    except (OSError, json.JSONDecodeError) as ex:
        print(json.dumps({"error": str(ex), "employees": []}))
        sys.exit(1)

    if isinstance(payload, dict) and "employees" in payload:
        employees = payload["employees"]
    elif isinstance(payload, list):
        employees = payload
    else:
        print(json.dumps({"error": "JSON must be a list or {employees: []}", "employees": []}))
        sys.exit(1)

    if not isinstance(employees, list):
        employees = []

    leave_map: dict[tuple[str, str, int, int, int], str] = {}
    wfh_map: dict[tuple[str, str, int, int, int], str] = {}

    if leave_p and leave_p != "-":
        leave_map = load_leave_overrides(leave_p, year, month)
    if wfh_p and wfh_p != "-":
        wfh_map = load_wfh_overrides(wfh_p, year, month)

    merged, replaced, ab_candidates, unmatched_sample = merge_employees(
        employees, leave_map, wfh_map, year, month, scope_days
    )

    print(
        json.dumps(
            {
                "employees": merged,
                "crossCheck": {
                    "replacedAb": replaced,
                    "abCandidates": ab_candidates,
                    "leaveKeys": len(leave_map),
                    "wfhKeys": len(wfh_map),
                    "unmatchedSample": unmatched_sample,
                    "reportType": report_type,
                    "reportDay": report_day,
                    "scopeDays": sorted(scope_days) if scope_days is not None else None,
                },
            }
        )
    )


if __name__ == "__main__":
    main()
