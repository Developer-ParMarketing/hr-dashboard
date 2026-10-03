#!/usr/bin/env python3
"""
Bridge: ESSL PDF via backend/python_tools/attendance_tool, or tabular ESSL grid files.

PDF flow: native parser → monthly DataFrame → employee JSON (and a temp Excel for download).

Usage: pdf_to_json.py <PATH> [COMPANY] [REPORT_TYPE]
  REPORT_TYPE is passed through for the dashboard; PDF always uses the full monthly grid.
"""
from __future__ import annotations

import contextlib
import json
import math
import os
import re
import sys
import tempfile

_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from merge_cross_reports import (  # noqa: E402
    _compute_worked_minutes,
    _parse_clock_to_minutes,
    cell_str as merge_cell_str,
    find_col,
    parse_to_date,
    read_merge_table,
)


def parse_hours_field(val) -> float | None:
    """Numeric Excel cell, decimal hours, time/timedelta, Excel day-fraction, or H:MM string."""
    from datetime import datetime, time, timedelta

    if val is None:
        return None
    if isinstance(val, timedelta):
        sec = val.total_seconds()
        if not math.isfinite(sec) or sec < 0:
            return None
        return round(sec / 3600.0, 4)
    if isinstance(val, time):
        return val.hour + val.minute / 60.0 + (val.second or 0) / 3600.0
    if isinstance(val, datetime):
        with contextlib.suppress(Exception):
            import pandas as pd

            if pd.isna(val):
                return None
        return val.hour + val.minute / 60.0 + (val.second or 0) / 3600.0
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        n = float(val)
        if math.isnan(n) or not math.isfinite(n):
            return None
        return n
    s = str(val).strip()
    if not s or s.lower() == "nan":
        return None
    h = hhmm_to_decimal(s)
    if h is not None:
        return h
    try:
        n = float(s.replace(",", ""))
        return n if math.isfinite(n) else None
    except ValueError:
        return None


def _find_column(df, keys):
    """Find Excel column by exact or normalized label."""
    normalized = {str(c).strip().lower().replace(" ", "_"): c for c in df.columns}
    for key in keys:
        if key in df.columns:
            return key
        k = str(key).strip().lower().replace(" ", "_")
        if k in normalized:
            return normalized[k]
    return None


def _column_norm_key(label: str) -> str:
    """Stable key: EMPCODE, Emp Code, emp_code → empcode."""
    return re.sub(r"[^a-z0-9]", "", str(label).lower())


def _norm_column_index(df):
    """First column per normalized header (handles EMPCODE vs EmpCode, HOURS D1, etc.)."""
    idx: dict[str, object] = {}
    for c in df.columns:
        nk = _column_norm_key(c)
        if nk not in idx:
            idx[nk] = c
    return idx


def _row_val_by_norm(row, idx: dict[str, object], *norm_keys: str):
    for nk in norm_keys:
        if nk in idx:
            return row.get(idx[nk])
    return None


def hhmm_to_decimal(s) -> float | None:
    if s is None or (isinstance(s, float) and str(s) == "nan"):
        return None
    t = str(s).strip()
    if not t or t.lower() == "nan":
        return None
    if ":" not in t:
        try:
            return float(t)
        except ValueError:
            return None
    parts = t.split(":")
    try:
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        return round(h + m / 60.0, 4)
    except (ValueError, IndexError):
        return None


_MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


def _try_parse_date_parts(day: int | None, month: int, year: int):
    from datetime import date

    if year < 2000 or year > 2100 or month < 1 or month > 12:
        return None
    d = 1 if day is None else day
    if d < 1 or d > 31:
        return None
    try:
        return date(year, month, d)
    except ValueError:
        return None


def _infer_report_date_tabular(df, path: str):
    """Best-effort register date from sheet headers or filename (tabular ESSL exports)."""
    text_blobs: list[str] = [os.path.basename(path).replace("_", " ").replace("-", " ")]
    head = df.head(8)
    for val in head.astype(str).values.flatten():
        s = str(val).strip()
        if s and s.lower() != "nan":
            text_blobs.append(s)
    joined = " | ".join(text_blobs)

    iso = re.search(r"\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b", joined)
    if iso:
        return _try_parse_date_parts(int(iso.group(3)), int(iso.group(2)), int(iso.group(1)))

    dmy = re.search(r"\b(0?[1-9]|[12]\d|3[01])[/\-](0?[1-9]|1[0-2])[/\-](20\d{2})\b", joined)
    if dmy:
        return _try_parse_date_parts(int(dmy.group(1)), int(dmy.group(2)), int(dmy.group(3)))

    named = re.search(
        r"\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[,\s\-]+(20\d{2})\b",
        joined,
        re.I,
    )
    if named:
        mon = named.group(1).lower()
        month = _MONTHS.get(mon) or _MONTHS.get(mon[:3])
        if month:
            return _try_parse_date_parts(None, month, int(named.group(2)))

    y_m = re.search(r"\b(20\d{2})[_\-](0?[1-9]|1[0-2])\b", joined)
    if y_m:
        return _try_parse_date_parts(None, int(y_m.group(2)), int(y_m.group(1)))

    m_y = re.search(r"\b(0?[1-9]|1[0-2])[_\-](20\d{2})\b", joined)
    if m_y:
        return _try_parse_date_parts(None, int(m_y.group(1)), int(m_y.group(2)))

    return None


def _read_attendance_table(path: str):
    """Load ESSL-style grid from Excel or delimited text. Returns (df, parse_meta)."""
    import pandas as pd

    low = path.lower()
    if low.endswith(".csv"):
        df = pd.read_csv(path)
        return df, {"inputKind": "csv", "excelSheet": None}
    if low.endswith(".tsv"):
        df = pd.read_csv(path, sep="\t")
        return df, {"inputKind": "tsv", "excelSheet": None}
    if low.endswith(".ods"):
        df = pd.read_excel(path, engine="odf")
        return df, {"inputKind": "ods", "excelSheet": None}
    df, sheet = _read_best_excel_sheet(path)
    return df, {"inputKind": "excel", "excelSheet": sheet}


def _read_best_excel_sheet(path: str):
    """
    Read the most likely attendance sheet instead of defaulting to first sheet.
    Score prefers:
    - presence of EmpCode/EmpName-like columns
    - day1..day31/dayX_in_time style columns
    - higher non-empty row count
    """
    import pandas as pd

    workbook = pd.ExcelFile(path)
    best_df = None
    best_score = None
    best_sheet: str | None = None

    for sheet in workbook.sheet_names:
        try:
            df = workbook.parse(sheet)
        except Exception:
            continue
        if df is None or len(df.columns) == 0:
            continue

        norm_cols = [re.sub(r"[^a-z0-9]", "", str(c).lower()) for c in df.columns]

        has_emp_code = any(c in ("empcode", "employeecode", "code") for c in norm_cols)
        has_emp_name = any(c in ("empname", "employeename", "name") for c in norm_cols)

        day_col_count = 0
        in_time_col_count = 0
        row_in_time_col_count = 0
        for c in norm_cols:
            if re.fullmatch(r"day([1-9]|[12][0-9]|3[01])", c):
                day_col_count += 1
            if re.fullmatch(r"day([1-9]|[12][0-9]|3[01])(intime|intime1|in|int)", c):
                in_time_col_count += 1
            if c in ("intime", "aintime", "punchin", "actualin", "firstin", "firstpunch"):
                row_in_time_col_count += 1

        non_empty_rows = int(df.dropna(how="all").shape[0])
        score = (
            (60 if has_emp_code else 0)
            + (60 if has_emp_name else 0)
            + (day_col_count * 4)
            + (in_time_col_count * 3)
            + (row_in_time_col_count * 20)
            + min(non_empty_rows, 500)
        )

        if best_score is None or score > best_score:
            best_score = score
            best_df = df
            best_sheet = sheet

    if best_df is not None:
        return best_df, best_sheet
    # Fallback safety: first sheet
    first = workbook.sheet_names[0]
    return workbook.parse(first), first


def _build_employees_from_df(df) -> list:
    import pandas as pd

    idx = _norm_column_index(df)

    def col_by_norm(*norm_keys: str):
        for nk in norm_keys:
            if nk in idx:
                return idx[nk]
        return None

    weekly_deficit_cols = [
        _find_column(df, (f"week{w}_deficit", f"week{w}_deficit_hours"))
        or col_by_norm(f"week{w}deficit", f"week{w}deficithours")
        for w in range(1, 6)
    ]
    monthly_deficit_col = _find_column(
        df,
        (
            "monthly_deficit_hours",
            "monthly_deficit",
            "deficit_hours",
            "deficit",
            "shortfall_hours",
            "shortfall",
        ),
    ) or col_by_norm("deficithours", "monthlydeficithours", "monthlydeficit")
    total_late_col = _find_column(
        df,
        ("total_late_days", "totalLateDays", "Total Late Days", "late_days_total"),
    ) or col_by_norm("totallatedays")
    shift_in_col = _find_column(
        df,
        (
            "S.InTime",
            "S. InTime",
            "S.In Time",
            "S InTime",
            "S_InTime",
            "Shift In Time",
            "ShiftInTime",
            "shift_start",
            "shift_start_time",
            "Shift",
            "Shift Time",
            "Expected In",
            "Duty From",
            "Sch In",
            "Scheduled In",
            "Start Time",
            "From Time",
            "Duty In",
            "Shift Start",
        ),
    )
    if not shift_in_col:
        shift_in_col = col_by_norm(
            "sintime",
            "shiftintime",
            "shiftstarttime",
            "shiftstart",
            "shift",
            "shifttime",
            "expectedin",
            "dutyfrom",
            "schin",
            "scheduledin",
            "starttime",
            "dutyin",
        )
    if not shift_in_col:
        # Fallback: match noisy headers like "S. IN TIME", "S-IN TIME", etc.
        for c in df.columns:
            n = re.sub(r"[^a-z0-9]", "", str(c).lower())
            if n in (
                "sintime",
                "shiftintime",
                "shiftstarttime",
                "shiftstart",
                "shift",
                "shifttime",
                "expectedin",
                "dutyfrom",
                "schin",
                "scheduledin",
                "starttime",
                "dutyin",
            ):
                shift_in_col = c
                break

    # Single punch column for daily-style rows (only used when one day has status). Avoid short names
    # like "Punch" / bare "intime" - they can match the wrong column vs per-day LOGIN D10.
    single_in_col = _find_column(
        df,
        (
            "InTime",
            "In Time",
            "IN TIME",
            "Login",
            "A.InTime",
            "A. InTime",
            "A.In Time",
            "Punch In",
            "Actual In",
            "First In",
            "First Punch",
            "Actual In Time",
        ),
    )
    if not single_in_col:
        single_in_col = col_by_norm(
            "intime", "login", "aintime", "punchin", "actualin", "firstin", "firstpunch"
        )
    if not single_in_col:
        for c in df.columns:
            n = re.sub(r"[^a-z0-9]", "", str(c).lower())
            if n in ("intime", "login", "aintime", "punchin", "actualin", "firstin", "firstpunch"):
                single_in_col = c
                break

    total_hours_col = _find_column(
        df,
        ("total_hours", "Total Hours", "totalHours", "monthly_hours"),
    ) or col_by_norm("totalhours")

    week_hours_cols = [
        _find_column(df, (f"week{w}_hours", f"Week{w}_Hours"))
        or col_by_norm(f"week{w}hours", f"week{w}totalhours")
        for w in range(1, 6)
    ]

    def cell_str(val) -> str:
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

    def truthy_late(val) -> bool:
        if val is None:
            return False
        try:
            if isinstance(val, (int, float)) and not isinstance(val, bool):
                if math.isnan(float(val)):
                    return False
                return float(val) != 0.0
        except (TypeError, ValueError):
            pass
        s = str(val).strip().lower()
        if not s or s == "nan":
            return False
        if s in ("1", "1.0", "true", "yes", "y", "late", "l"):
            return True
        return False

    def row_pick(row, col):
        if col is None:
            return None
        return row.get(col)

    employees: list = []
    for _, row in df.iterrows():
        code_raw = _row_val_by_norm(row, idx, "empcode", "employeecode", "employeeid", "empid")
        name_raw = _row_val_by_norm(row, idx, "empname", "employeename", "name")
        dept_raw = _row_val_by_norm(row, idx, "department", "dept")
        emp: dict = {
            "employeeCode": cell_str(code_raw if code_raw is not None else row.get("EmpCode")),
            "employeeName": cell_str(name_raw if name_raw is not None else row.get("EmpName")),
            "department": cell_str(dept_raw if dept_raw is not None else row.get("Department")),
            "shiftStart": cell_str(row_pick(row, shift_in_col)) if shift_in_col else "",
            "inTime": cell_str(row_pick(row, single_in_col)) if single_in_col else "",
        }
        for d in range(1, 32):
            nk_d = f"d{d}"
            nk_day = f"day{d}"
            status = cell_str(
                _row_val_by_norm(row, idx, nk_d, nk_day)
                or row.get(f"day{d}")
            )
            emp[f"day{d}"] = status
            in_raw = _row_val_by_norm(
                row,
                idx,
                f"logind{d}",
                f"day{d}intime",
                f"day{d}_intime",
            )
            if in_raw is None:
                in_raw = (
                    row.get(f"day{d}_in_time")
                    if f"day{d}_in_time" in row.index
                    else row.get(f"day{d}InTime")
                )
            if in_raw is None:
                in_raw = _row_val_by_norm(
                    row,
                    idx,
                    f"day{d}_in",
                    f"d{d}_in",
                    f"ind{d}",
                    f"in{d}",
                )
            emp[f"day{d}InTime"] = cell_str(in_raw)
            out_raw = _row_val_by_norm(
                row,
                idx,
                f"logoutd{d}",
                f"day{d}outtime",
                f"day{d}_outtime",
                f"outd{d}",
                f"out{d}",
            )
            if out_raw is None:
                out_raw = (
                    row.get(f"day{d}_out_time")
                    if f"day{d}_out_time" in row.index
                    else row.get(f"day{d}OutTime")
                )
            emp[f"day{d}OutTime"] = cell_str(out_raw)
            late_raw = _row_val_by_norm(
                row,
                idx,
                f"lated{d}",
                f"day{d}islate",
                f"day{d}late",
                f"day{d}latemark",
            )
            if late_raw is None:
                for col in (
                    f"day{d}_is_late",
                    f"day{d}IsLate",
                    f"day{d}_late",
                    f"day{d}_late_mark",
                ):
                    if col in row.index and row.get(col) is not None and str(row.get(col)).strip() != "":
                        late_raw = row.get(col)
                        break
            if late_raw is None:
                late_raw = row.get(f"day{d}IsLate")
            emp[f"day{d}IsLate"] = 1 if truthy_late(late_raw) else 0
            hours_raw = _row_val_by_norm(
                row,
                idx,
                f"hoursd{d}",
                f"day{d}hours",
                f"workdurd{d}",
                f"workdur{d}",
                f"workdurationd{d}",
            )
            if hours_raw is None:
                hours_raw = row.get(f"day{d}Hours") or row.get(f"day{d}_hours")
            h_dec = parse_hours_field(hours_raw) if hours_raw is not None else None
            # Excel time-formatted duration is often a day fraction (e.g. 9:30 → ~0.3958). Only rescale
            # raw floats in (0,1) when ×24 looks like a plausible shift length (avoid 0.5h → 12h bug).
            if (
                h_dec is not None
                and isinstance(hours_raw, (int, float))
                and not isinstance(hours_raw, bool)
            ):
                n = float(hours_raw)
                if 0 < n < 1 and math.isfinite(n):
                    scaled = n * 24.0
                    if 3.0 <= scaled <= 16.0:
                        h_dec = round(scaled, 4)
            if h_dec is not None:
                emp[f"day{d}Hours"] = h_dec

        # Header variants ESSL exports use that don't always land in idx (spacing, typos).
        for d in range(1, 32):
            if cell_str(emp.get(f"day{d}InTime") or ""):
                continue
            for col in df.columns:
                nk = re.sub(r"[^a-z0-9]", "", str(col).lower())
                if nk in (
                    f"logind{d}",
                    f"day{d}intime",
                    f"d{d}intime",
                    f"ind{d}",
                    f"in{d}",
                    f"day{d}in",
                    f"d{d}in",
                    f"login{d}",
                ):
                    v = row.get(col)
                    if v is not None and cell_str(v):
                        emp[f"day{d}InTime"] = cell_str(v)
                        break

        for d in range(1, 32):
            if cell_str(emp.get(f"day{d}OutTime") or ""):
                continue
            for col in df.columns:
                nk = re.sub(r"[^a-z0-9]", "", str(col).lower())
                if nk in (
                    f"logoutd{d}",
                    f"day{d}outtime",
                    f"d{d}outtime",
                    f"outd{d}",
                    f"out{d}",
                    f"day{d}out",
                    f"d{d}out",
                    f"logout{d}",
                ):
                    v = row.get(col)
                    if v is not None and cell_str(v):
                        emp[f"day{d}OutTime"] = cell_str(v)
                        break

        # One punch-in column for the whole row (common on daily ESSL exports).
        if single_in_col:
            v = cell_str(row_pick(row, single_in_col))
            if v:
                emp["inTime"] = v
                nonempty_days = [
                    d
                    for d in range(1, 32)
                    if cell_str(emp.get(f"day{d}") or "")
                ]
                if len(nonempty_days) == 1:
                    d0 = nonempty_days[0]
                    if not cell_str(emp.get(f"day{d0}InTime") or ""):
                        emp[f"day{d0}InTime"] = v
        if not cell_str(emp.get("inTime") or ""):
            for col in ("inTime", "InTime", "IN_TIME", "A.InTime", "A. InTime"):
                if col in row.index:
                    v = cell_str(row_pick(row, col))
                    if v:
                        emp["inTime"] = v
                        break

        for w in range(1, 6):
            whc = week_hours_cols[w - 1]
            wh = row_pick(row, whc)
            emp[f"week{w}"] = parse_hours_field(wh) if wh is not None else hhmm_to_decimal(wh)
        for w in range(1, 6):
            col = weekly_deficit_cols[w - 1]
            emp[f"week{w}Deficit"] = parse_hours_field(row_pick(row, col)) if col else None
        th = row_pick(row, total_hours_col) if total_hours_col else row.get("total_hours")
        emp["totalHours"] = parse_hours_field(th) if th is not None else hhmm_to_decimal(th)
        emp["deficitHours"] = (
            parse_hours_field(row_pick(row, monthly_deficit_col))
            if monthly_deficit_col
            else None
        )
        if total_late_col:
            try:
                v = row.get(total_late_col)
                if v is not None and str(v).strip() != "" and str(v).lower() != "nan":
                    emp["totalLateDays"] = int(float(v))
                else:
                    emp["totalLateDays"] = None
            except (TypeError, ValueError):
                emp["totalLateDays"] = None
        else:
            emp["totalLateDays"] = None
        employees.append(emp)
    return employees


def _hr_python_tools_dir() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    backend_root = os.path.dirname(here)
    return os.path.join(backend_root, "python_tools")


def _enrich_df_from_pdf_records(df, records: dict):
    """Copy worked hours and late totals from the native PDF records onto the monthly grid."""
    by_code = {str(emp.get("EmpCode", "")).strip(): emp for emp in records.values()}
    for i, row in df.iterrows():
        rec = by_code.get(str(row.get("EmpCode", "")).strip())
        if not rec:
            continue
        for d in range(1, 32):
            mins = rec.get("work_minutes", {}).get(d)
            if mins:
                df.at[i, f"day{d}Hours"] = round(float(mins) / 60.0, 4)
        late_n = sum(1 for v in rec.get("is_late", {}).values() if v)
        df.at[i, "total_late_days"] = late_n
    return df


def _parse_pdf_native(pdf_path: str):
    """ESSL PDF → native attendance_tool → monthly DataFrame + report metadata."""
    tools = _hr_python_tools_dir()
    attendance_tool_py = os.path.join(tools, "attendance_tool.py")
    if not os.path.isfile(attendance_tool_py):
        raise FileNotFoundError(f"Native PDF parser not found at {attendance_tool_py}")
    if tools not in sys.path:
        sys.path.insert(0, tools)

    from attendance_tool import parse_pdf_to_records, records_to_monthly_dataframe

    parsed = parse_pdf_to_records(pdf_path, None)
    if parsed is None:
        raise ValueError("Failed to parse ESSL PDF (no employees or report date found)")

    records, report_date = parsed
    df = records_to_monthly_dataframe(records)
    df = _enrich_df_from_pdf_records(df, records)
    return (
        df,
        report_date.day,
        report_date.strftime("%a, %d %b %Y"),
        report_date.strftime("%Y-%m-%d"),
    )


def _duration_hm(total_min: int) -> str:
    m = max(int(total_min), 0)
    return f"{m // 60:02d}:{m % 60:02d}"


def _looks_like_computex_punch_df(df) -> bool:
    """Computex attendance/WFH punch export: Submit Date + Situation (IN/OUT) + employee name."""
    if df is None or df.empty:
        return False
    c_submit = find_col(
        df,
        (
            "Submit Date",
            "submit_date",
            "SubmitDate",
            "Submitted On",
            "submitted_on",
            "Punch Date",
            "punch_date",
        ),
    )
    c_sit = find_col(
        df,
        ("Situation", "situation", "Direction", "direction", "In/Out", "in_out", "IN/OUT"),
    )
    c_name = find_col(
        df,
        (
            "Employee Name",
            "EmpName",
            "employee_name",
            "emp_name",
            "name",
            "Employee",
            "employee name",
        ),
    )
    if not (c_submit and c_sit and c_name):
        return False
    for _, row in df.head(500).iterrows():
        if not merge_cell_str(row.get(c_name)):
            continue
        sit = merge_cell_str(row.get(c_sit)).strip().upper()
        if sit in ("IN", "OUT"):
            return True
    return False


def _employees_from_computex_punches(df):
    """
    Computex punch rows → one employee row with day1..day31 tokens (P / P(HH:MM)).
    Returns (employees, primary_register_date).
    """
    from collections import Counter
    from datetime import date

    c_submit = find_col(
        df,
        (
            "Submit Date",
            "submit_date",
            "SubmitDate",
            "Submitted On",
            "submitted_on",
            "Punch Date",
            "punch_date",
        ),
    )
    c_sit = find_col(
        df,
        ("Situation", "situation", "Direction", "direction", "In/Out", "in_out", "IN/OUT"),
    )
    c_time = find_col(
        df,
        ("Time", "time", "Punch Time", "punch_time", "PunchTime", "Punch In Time"),
    )
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
            "Employee",
            "employee name",
        ),
    )
    if not (c_submit and c_sit and c_name):
        return [], None

    day_slots: dict[tuple[str, str, int, int, int], dict[str, str | None]] = {}
    report_dates: list[date] = []

    for _, row in df.iterrows():
        name = merge_cell_str(row.get(c_name))
        if not name:
            continue
        code = merge_cell_str(row.get(c_code)) if c_code else ""
        sd = parse_to_date(row.get(c_submit))
        if not sd:
            continue
        report_dates.append(sd)

        situation = merge_cell_str(row.get(c_sit)).strip().upper()
        time_val = merge_cell_str(row.get(c_time)) if c_time else ""
        if not _parse_clock_to_minutes(time_val):
            submit_raw = merge_cell_str(row.get(c_submit))
            m = re.search(r"\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b", submit_raw, re.I)
            if m:
                time_val = m.group(1).strip()

        pk = (code, name, sd.year, sd.month, sd.day)
        slot = day_slots.setdefault(pk, {"IN": None, "OUT": None})
        if situation == "IN":
            slot["IN"] = time_val or None
        elif situation == "OUT":
            slot["OUT"] = time_val or None

    primary_date = Counter(report_dates).most_common(1)[0][0] if report_dates else None

    employees_map: dict[tuple[str, str], dict] = {}
    for (code, name, y, mo, d), slot in day_slots.items():
        in_t = slot.get("IN") or ""
        out_t = slot.get("OUT") or ""
        if not in_t and not out_t:
            continue

        worked = _compute_worked_minutes(in_t, out_t) if in_t and out_t else 0
        token = ""
        hours = None
        if in_t and out_t and worked > 0:
            token = f"P({_duration_hm(worked)})"
            hours = round(worked / 60.0, 4)
        elif in_t:
            token = "P"
        else:
            continue

        key = (code, name)
        emp = employees_map.get(key)
        if not emp:
            emp = {
                "employeeCode": code,
                "employeeName": name,
                "department": "",
                "shiftStart": "",
                "inTime": "",
            }
            for di in range(1, 32):
                emp[f"day{di}"] = ""
                emp[f"day{di}InTime"] = ""
            employees_map[key] = emp

        emp[f"day{d}"] = token
        if in_t:
            emp[f"day{d}InTime"] = in_t
        if hours is not None:
            emp[f"day{d}Hours"] = hours
        if primary_date and d == primary_date.day and y == primary_date.year and mo == primary_date.month and in_t:
            emp["inTime"] = in_t

    employees = [e for e in employees_map.values() if any(str(e.get(f"day{i}", "")).strip() for i in range(1, 32))]
    return employees, primary_date


def _write_temp_excel(df) -> str | None:
    fd, excel_abs = tempfile.mkstemp(prefix="attendance_", suffix=".xlsx")
    os.close(fd)
    try:
        df.to_excel(excel_abs, index=False)
        return excel_abs
    except Exception:
        with contextlib.suppress(OSError):
            os.unlink(excel_abs)
        return None


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing pdf path", "employees": []}))
        sys.exit(1)

    input_path = os.path.abspath(sys.argv[1])
    # argv[2] is legacy "company" from the API; ignored - always import full PDF roster.
    report_type = (sys.argv[3] if len(sys.argv) > 3 else "monthly").strip().lower()
    if report_type not in {"daily", "weekly", "monthly"}:
        report_type = "monthly"

    # Tabular upload: ESSL day grid.
    if input_path.lower().endswith((".xlsx", ".xls", ".xlsm", ".csv", ".tsv", ".ods")):
        if not os.path.isfile(input_path):
            print(json.dumps({"error": "file not found", "employees": []}))
            sys.exit(1)
        try:
            df, parse_meta = _read_attendance_table(input_path)
        except Exception as e:
            print(json.dumps({"error": f"Could not read attendance file: {e}", "employees": []}))
            sys.exit(1)
        employees = _build_employees_from_df(df)
        inferred = _infer_report_date_tabular(df, input_path)
        report_day = inferred.day if inferred else None
        report_date = inferred.strftime("%a, %d %b %Y") if inferred else None
        report_date_iso = inferred.strftime("%Y-%m-%d") if inferred else None
        parse_meta = {
            **parse_meta,
            "source": "tabular_upload",
            "rowsInSheet": len(df),
            "employeeCount": len(employees),
        }
        if inferred:
            parse_meta["reportDay"] = report_day
            parse_meta["reportDate"] = report_date
            parse_meta["reportDateIso"] = report_date_iso
        payload: dict = {
            "employees": employees,
            "excelPath": input_path,
            "reportType": report_type,
            "parseMeta": parse_meta,
        }
        if inferred:
            payload["reportDay"] = report_day
            payload["reportDate"] = report_date
            payload["reportDateIso"] = report_date_iso
        print(json.dumps(payload))
        return

    pdf_path = input_path
    if not os.path.isfile(pdf_path):
        print(json.dumps({"error": "file not found", "employees": []}))
        sys.exit(1)

    try:
        df, report_day, report_date, report_date_iso = _parse_pdf_native(pdf_path)
    except Exception as e:
        print(json.dumps({"error": str(e), "employees": []}))
        sys.exit(1)

    employees = _build_employees_from_df(df)
    excel_abs = _write_temp_excel(df)
    parse_meta = {
        "source": "pdf_native",
        "pdfPath": pdf_path,
        "excelPath": excel_abs,
        "excelSheet": None,
        "rowsInSheet": int(len(df)),
        "employeeCount": len(employees),
        "reportDay": report_day,
        "reportDate": report_date,
        "reportDateIso": report_date_iso,
    }

    print(
        json.dumps(
            {
                "employees": employees,
                "excelPath": excel_abs,
                "reportDay": report_day,
                "reportDate": report_date,
                "reportDateIso": report_date_iso,
                "reportType": report_type,
                "parseMeta": parse_meta,
            },
        )
    )


if __name__ == "__main__":
    main()
