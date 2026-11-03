/**
 * Apply a Computex leave and/or WFH file to attendance that is ALREADY saved (e.g. from the
 * biometric machine sync) — no ESSL register upload needed.
 *
 * 1. Build the month grid from daily_attendance_raw (what the machine / last upload saved).
 * 2. Run the same merge as the PDF upload (scripts/merge_cross_reports.py): AB / empty days for the
 *    same employee + date become WFH / SL / PL / CL / DA. Days with an office punch (P) are kept.
 * 3. Save just the days that changed through persistProcessedAttendance().
 */

import { query } from "../db/index.js";
import { calendarTodayIso } from "../employees/employmentStatus.js";
import { cellStr, daysInMonth, isoDate, type RawIngestEmployee } from "./helpers.js";
import { persistProcessedAttendance, type PersistSummary } from "./ingest.js";
import { validateParsedEmployees } from "./validate.js";

type EmployeeRow = {
    id: number;
    employee_code: string;
    name: string;
    company: string | null;
    shift_start: string | null;
    status: string;
    date_of_joining: string | null;
    date_of_leaving: string | null;
};

type RawRow = {
    employee_id: number;
    attendance_date: string;
    in_time: string | null;
    out_time: string | null;
    working_hours: number | null;
    status_token: string | null;
};

export type MonthGrid = {
    employees: RawIngestEmployee[];
    /** employee_code → company, for saving each batch under the right company */
    companyByCode: Map<string, string>;
    lastDay: number;
};

const LEAVE_TOKENS = new Set(["SL", "PL", "CL", "DA"]);

/** Saved month as an ingest-shaped grid (day1…dayN tokens + in/out/hours). */
export async function buildSavedMonthGrid(year: number, month: number, company: string): Promise<MonthGrid> {
    const dim = daysInMonth(year, month);
    const monthStart = isoDate(year, month, 1);
    const monthEnd = isoDate(year, month, dim);
    const today = calendarTodayIso();
    const lastDay = monthEnd <= today ? dim : monthStart > today ? 0 : Number.parseInt(today.slice(8, 10), 10);

    const employees = await query<EmployeeRow>(
        `SELECT id, employee_code, name, company, shift_start, status,
            date_of_joining::text AS date_of_joining, date_of_leaving::text AS date_of_leaving
     FROM employees
     WHERE UPPER(COALESCE(NULLIF(TRIM(company), ''), 'PM')) = UPPER($1)
        OR id IN (SELECT DISTINCT employee_id FROM daily_attendance_raw
                  WHERE attendance_date BETWEEN $2::date AND $3::date)`,
        [company, monthStart, monthEnd],
    );
    const raws = await query<RawRow>(
        `SELECT employee_id, attendance_date::text AS attendance_date, in_time, out_time,
            working_hours, status_token
     FROM daily_attendance_raw
     WHERE attendance_date BETWEEN $1::date AND $2::date`,
        [monthStart, monthEnd],
    );
    const rawByKey = new Map(raws.map((r) => [`${r.employee_id}|${r.attendance_date.slice(0, 10)}`, r]));

    const grid: RawIngestEmployee[] = [];
    const companyByCode = new Map<string, string>();
    for (const e of employees) {
        if (e.date_of_leaving && e.date_of_leaving.slice(0, 10) < monthStart) continue;
        if (e.date_of_joining && e.date_of_joining.slice(0, 10) > monthEnd) continue;
        const row: RawIngestEmployee = {
            employeeCode: e.employee_code,
            employeeName: e.name || e.employee_code,
            department: "",
            shiftStart: cellStr(e.shift_start),
        };
        for (let d = 1; d <= lastDay; d++) {
            const r = rawByKey.get(`${e.id}|${isoDate(year, month, d)}`);
            row[`day${d}`] = cellStr(r?.status_token);
            row[`day${d}InTime`] = cellStr(r?.in_time);
            row[`day${d}OutTime`] = cellStr(r?.out_time);
            if (r?.working_hours != null) row[`day${d}Hours`] = Number(r.working_hours);
        }
        grid.push(row);
        companyByCode.set(e.employee_code.trim().toUpperCase(), e.company?.trim() || company);
    }
    return { employees: grid, companyByCode, lastDay };
}

export type ApplyLeaveWfhResult = {
    ok: boolean;
    year: number;
    month: number;
    wfhDays: number;
    leaveDays: number;
    daysChanged: number;
    employeesUpdated: number;
    changes: { code: string; name: string; date: string; from: string; to: string }[];
    /** File said WFH/leave but the machine shows an office punch that day — kept as present. */
    skippedPresent: { code: string; name: string; date: string; from: string; to: string }[];
    persisted: { company: string; summary?: PersistSummary; error?: string }[];
    crossCheck?: unknown;
};

function dayChanged(before: RawIngestEmployee, after: RawIngestEmployee, d: number): boolean {
    for (const suffix of ["", "InTime", "OutTime"]) {
        if (cellStr(before[`day${d}${suffix}`]) !== cellStr(after[`day${d}${suffix}`])) return true;
    }
    const a = before[`day${d}Hours`];
    const b = after[`day${d}Hours`];
    if (a == null || b == null) return (a == null) !== (b == null);
    return Math.abs(Number(a) - Number(b)) > 0.01;
}

/**
 * Compare the merged grid with the saved one and persist only changed days.
 * Sundays already saved are re-sent unchanged because ingest rewrites omitted Sundays as weekly off.
 */
export async function persistLeaveWfhChanges(opts: {
    year: number;
    month: number;
    before: MonthGrid;
    merged: unknown[];
    actor: string;
    crossCheck?: unknown;
}): Promise<ApplyLeaveWfhResult> {
    const { year, month, before, merged, actor } = opts;
    const result: ApplyLeaveWfhResult = {
        ok: true,
        year,
        month,
        wfhDays: 0,
        leaveDays: 0,
        daysChanged: 0,
        employeesUpdated: 0,
        changes: [],
        skippedPresent: [],
        persisted: [],
        crossCheck: opts.crossCheck,
    };

    const beforeByCode = new Map(
        before.employees.map((e) => [cellStr(e.employeeCode).toUpperCase(), e]),
    );
    const batches = new Map<string, RawIngestEmployee[]>();

    for (const item of merged) {
        if (!item || typeof item !== "object") continue;
        const after = item as RawIngestEmployee;
        const code = cellStr(after.employeeCode ?? after.empCode ?? after.code).toUpperCase();
        const prev = beforeByCode.get(code);
        if (!prev) continue;

        const out: RawIngestEmployee = {
            employeeCode: prev.employeeCode,
            employeeName: prev.employeeName,
            department: "",
            shiftStart: prev.shiftStart,
        };
        let changed = 0;
        for (let d = 1; d <= before.lastDay; d++) {
            const dow = new Date(year, month - 1, d).getDay();
            let isChange = dayChanged(prev, after, d);
            const prevTok = cellStr(prev[`day${d}`]).toUpperCase();
            if (isChange && (prevTok === "P" || prevTok.startsWith("P("))) {
                // Office punch on the machine wins over the WFH/leave file (the machine sync would put it back anyway).
                result.skippedPresent.push({
                    code: cellStr(prev.employeeCode),
                    name: cellStr(prev.employeeName),
                    date: isoDate(year, month, d),
                    from: cellStr(prev[`day${d}`]),
                    to: cellStr(after[`day${d}`]) || "-",
                });
                isChange = false;
            }
            if (!isChange && !(dow === 0 && cellStr(prev[`day${d}`]))) continue;
            const src = isChange ? after : prev;
            out[`day${d}`] = cellStr(src[`day${d}`]);
            out[`day${d}InTime`] = cellStr(src[`day${d}InTime`]);
            out[`day${d}OutTime`] = cellStr(src[`day${d}OutTime`]);
            if (src[`day${d}Hours`] != null && cellStr(src[`day${d}Hours`])) out[`day${d}Hours`] = src[`day${d}Hours`];
            if (src[`day${d}WfhUnverified`] != null) out[`day${d}WfhUnverified`] = src[`day${d}WfhUnverified`];
            if (!isChange) continue;
            changed += 1;
            const to = cellStr(after[`day${d}`]);
            const toUpper = to.toUpperCase();
            if (toUpper.startsWith("WFH")) result.wfhDays += 1;
            else if (LEAVE_TOKENS.has(toUpper)) result.leaveDays += 1;
            result.changes.push({
                code: cellStr(prev.employeeCode),
                name: cellStr(prev.employeeName),
                date: isoDate(year, month, d),
                from: cellStr(prev[`day${d}`]) || "-",
                to: to || "-",
            });
        }
        if (changed === 0) continue;
        result.daysChanged += changed;
        result.employeesUpdated += 1;
        const company = before.companyByCode.get(code) ?? "PM";
        const list = batches.get(company) ?? [];
        list.push(out);
        batches.set(company, list);
    }

    for (const [company, rows] of batches) {
        try {
            const validated = validateParsedEmployees(rows, year, month);
            const summary = await persistProcessedAttendance({
                employees: validated.employees,
                year,
                month,
                company,
                source: "essl",
                actor,
                reportType: "monthly",
            });
            result.persisted.push({ company, summary });
        } catch (e) {
            result.ok = false;
            result.persisted.push({ company, error: e instanceof Error ? e.message : String(e) });
        }
    }
    result.changes.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
    result.skippedPresent.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
    return result;
}