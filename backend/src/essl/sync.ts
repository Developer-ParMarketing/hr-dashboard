/**
 * Pull punches from the eSSL biometric server and save them as the attendance register.
 *
 * Data lands in exactly the same place as an uploaded ESSL PDF: `persistProcessedAttendance()`
 * writes daily_attendance_raw → daily_attendance, weekly rollups, salary drafts. HR edits
 * (daily_attendance_edits), approved/locked weeks and approved salary are left alone, as with uploads.
 *
 * Only days whose punches changed since the last sync are written, so a 15-minute schedule
 * does not flood change_history.
 */

import { query } from "../db/index.js";
import { calendarTodayIso } from "../employees/employmentStatus.js";
import { loadHolidayTypeMapForMonth } from "../holidays/holidayAttendance.js";
import { cellStr, daysInMonth, isoDate, type RawIngestEmployee } from "../persist/helpers.js";
import { persistProcessedAttendance, type PersistSummary } from "../persist/ingest.js";
import { validateParsedEmployees } from "../persist/validate.js";
import { recordUploadHistory } from "../persist/queries.js";
import { fetchEsslPunches, type EsslPunch } from "./client.js";

/** Same ceiling as ingestAnomalies (MAX_DAY_HOURS). */
const MAX_DAY_HOURS = 18;

export type EsslSyncResult = {
    ok: boolean;
    trigger: "manual" | "schedule";
    year: number;
    month: number;
    from: string;
    to: string;
    punches: number;
    matchedEmployees: number;
    unmatchedCodes: string[];
    employeesUpdated: number;
    daysChanged: number;
    companies: { company: string; employees: number; persisted?: PersistSummary; error?: string }[];
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    error?: string;
};

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
    source: string | null;
};

type DesiredDay = {
    token: string;
    inTime: string;
    outTime: string;
    hours: number | null;
};

let running: Promise<EsslSyncResult> | null = null;
let lastResult: EsslSyncResult | null = null;

export function lastEsslSyncResult(): EsslSyncResult | null {
    return lastResult;
}

export function esslSyncRunning(): boolean {
    return running != null;
}

function defaultCompany(): string {
    return process.env.ESSL_DEFAULT_COMPANY?.trim() || "PM";
}

/** Companies whose active staff are marked AB on working days with no punch. "ALL" = every company. */
function absentFillCompanies(): Set<string> | "all" {
    const raw = (process.env.ESSL_COMPANIES ?? "PM").trim();
    if (!raw || raw.toUpperCase() === "ALL") return "all";
    return new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean));
}

/** Weekdays (0=Sun … 6=Sat) where a missing punch is NOT marked AB. Default: Sunday only. */
function noPunchOffDays(): Set<number> {
    const raw = (process.env.ESSL_NO_PUNCH_OFF_DAYS ?? "0").trim();
    const days = raw
        .split(",")
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    return new Set(days.length ? days : [0]);
}

function hhmm(time: string): string {
    return time.slice(0, 5);
}

function secondsOf(time: string): number {
    const [h, m, s] = time.split(":").map((v) => Number.parseInt(v, 10));
    return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
}

function durationHm(totalMinutes: number): string {
    const m = Math.max(0, Math.round(totalMinutes));
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** First punch = in, last punch = out. One punch = present, no out yet. */
export function desiredFromPunches(times: string[]): DesiredDay {
    const sorted = [...times].sort();
    const first = sorted[0];
    if (sorted.length === 1) {
        return { token: "P", inTime: hhmm(first), outTime: "", hours: null };
    }
    const last = sorted[sorted.length - 1];
    const minutes = Math.floor((secondsOf(last) - secondsOf(first)) / 60);
    if (minutes <= 0) {
        return { token: "P", inTime: hhmm(first), outTime: "", hours: null };
    }
    const hours = Math.round((minutes / 60) * 10000) / 10000;
    if (hours > MAX_DAY_HOURS) {
        return { token: "P", inTime: hhmm(first), outTime: hhmm(last), hours: null };
    }
    return { token: `P(${durationHm(minutes)})`, inTime: hhmm(first), outTime: hhmm(last), hours };
}

function sameDay(existing: RawRow | undefined, want: DesiredDay): boolean {
    if (!existing) return false;
    if ((existing.source ?? "") !== "essl") return false;
    if (cellStr(existing.status_token).toUpperCase() !== want.token.toUpperCase()) return false;
    if (cellStr(existing.in_time).slice(0, 5) !== want.inTime) return false;
    if (cellStr(existing.out_time).slice(0, 5) !== want.outTime) return false;
    const a = existing.working_hours;
    const b = want.hours;
    if (a == null || b == null) return a == null && b == null;
    return Math.abs(Number(a) - b) < 0.01;
}

/** Days HR or the leave/WFH merge already explained: a missing punch must not overwrite them with AB. */
function protectedWithoutPunch(existing: RawRow | undefined): boolean {
    if (!existing) return false;
    const source = (existing.source ?? "").toLowerCase();
    if (source === "leave" || source === "wfh") return true;
    const token = cellStr(existing.status_token).toUpperCase();
    return (
        token === "SL" ||
        token === "PL" ||
        token === "CL" ||
        token === "WO" ||
        token === "DA" ||
        token === "WFH" ||
        token.startsWith("WFH(")
    );
}

async function runSync(opts: {
    year: number;
    month: number;
    actor: string;
    trigger: "manual" | "schedule";
}): Promise<EsslSyncResult> {
    const { year, month, actor, trigger } = opts;
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const dim = daysInMonth(year, month);
    const monthStart = isoDate(year, month, 1);
    const monthEnd = isoDate(year, month, dim);
    const today = calendarTodayIso();
    const to = monthEnd < today ? monthEnd : today;

    const result: EsslSyncResult = {
        ok: true,
        trigger,
        year,
        month,
        from: monthStart,
        to,
        punches: 0,
        matchedEmployees: 0,
        unmatchedCodes: [],
        employeesUpdated: 0,
        daysChanged: 0,
        companies: [],
        startedAt,
        finishedAt: startedAt,
        durationMs: 0,
    };

    if (monthStart > today) {
        result.ok = false;
        result.error = "That month has not started yet.";
        return result;
    }

    const punches = await fetchEsslPunches(monthStart, to);
    result.punches = punches.length;
    if (punches.length === 0) {
        // Never turn a silent/empty machine reply into a month of AB.
        result.finishedAt = new Date().toISOString();
        result.durationMs = Date.now() - started;
        return result;
    }

    const byCode = new Map<string, Map<string, string[]>>();
    for (const p of punches as EsslPunch[]) {
        let days = byCode.get(p.code);
        if (!days) byCode.set(p.code, (days = new Map()));
        const list = days.get(p.date) ?? [];
        list.push(p.time);
        days.set(p.date, list);
    }

    const employees = await query<EmployeeRow>(
        `SELECT id, employee_code, name, company, shift_start, status,
            date_of_joining::text AS date_of_joining, date_of_leaving::text AS date_of_leaving
     FROM employees`,
    );
    const byEmpCode = new Map(employees.map((e) => [e.employee_code.trim().toUpperCase(), e]));

    result.unmatchedCodes = [...byCode.keys()].filter((code) => !byEmpCode.has(code)).sort();

    const fill = absentFillCompanies();
    const candidates = employees.filter((e) => {
        const code = e.employee_code.trim().toUpperCase();
        if (byCode.has(code)) return true;
        if (e.date_of_joining && e.date_of_joining.slice(0, 10) > to) return false;
        if (e.date_of_leaving && e.date_of_leaving.slice(0, 10) < monthStart) return false;
        if (e.status.trim().toLowerCase() === "inactive" && !e.date_of_leaving) return false;
        const company = (e.company?.trim() || defaultCompany()).toUpperCase();
        return fill === "all" || fill.has(company);
    });
    result.matchedEmployees = candidates.filter((e) => byCode.has(e.employee_code.trim().toUpperCase())).length;

    if (candidates.length === 0) {
        result.finishedAt = new Date().toISOString();
        result.durationMs = Date.now() - started;
        return result;
    }

    const rawRows = await query<RawRow>(
        `SELECT employee_id, attendance_date::text AS attendance_date, in_time, out_time,
            working_hours, status_token, source
     FROM daily_attendance_raw
     WHERE attendance_date BETWEEN $1::date AND $2::date
       AND employee_id = ANY($3::int[])`,
        [monthStart, monthEnd, candidates.map((e) => e.id)],
    );
    const rawByKey = new Map(rawRows.map((r) => [`${r.employee_id}|${r.attendance_date.slice(0, 10)}`, r]));
    const holidays = await loadHolidayTypeMapForMonth(year, month);
    const lastDay = Number.parseInt(to.slice(8, 10), 10);
    const offDays = noPunchOffDays();

    const batches = new Map<string, RawIngestEmployee[]>();
    for (const emp of candidates) {
        const code = emp.employee_code.trim().toUpperCase();
        const punchDays = byCode.get(code) ?? new Map<string, string[]>();
        const joined = emp.date_of_joining?.slice(0, 10) ?? null;
        const left = emp.date_of_leaving?.slice(0, 10) ?? null;

        const row: RawIngestEmployee = {
            employeeCode: emp.employee_code,
            employeeName: emp.name || emp.employee_code,
            department: "",
            shiftStart: cellStr(emp.shift_start),
        };
        let changed = 0;
        const sundaysWithPunches: number[] = [];

        for (let d = 1; d <= lastDay; d++) {
            const date = isoDate(year, month, d);
            if (joined && date < joined) continue;
            if (left && date > left) continue;
            const dow = new Date(year, month - 1, d).getDay();
            const times = punchDays.get(date) ?? [];
            const existing = rawByKey.get(`${emp.id}|${date}`);

            let want: DesiredDay;
            if (times.length > 0) {
                want = desiredFromPunches(times);
                if (dow === 0) sundaysWithPunches.push(d);
            } else {
                // No punch: weekly off / holiday / today (day not over) / leave or WFH already recorded → leave as is.
                if (dow === 0 || offDays.has(dow) || holidays.has(date) || date === today || protectedWithoutPunch(existing)) {
                    continue;
                }
                want = { token: "AB", inTime: "", outTime: "", hours: null };
            }

            if (sameDay(existing, want) && dow !== 0) continue;
            if (sameDay(existing, want) && dow === 0) {
                // Sunday rows are rewritten by ingest when omitted, so resend them unchanged.
            } else {
                changed += 1;
            }
            row[`day${d}`] = want.token;
            row[`day${d}InTime`] = want.inTime;
            row[`day${d}OutTime`] = want.outTime;
            if (want.hours != null) row[`day${d}Hours`] = want.hours;
        }

        if (changed === 0) continue;
        // Ingest rewrites every omitted Sunday as weekly off; keep Sunday punches by always sending them.
        for (const d of sundaysWithPunches) {
            if (row[`day${d}`] != null) continue;
            const want = desiredFromPunches(punchDays.get(isoDate(year, month, d)) ?? []);
            row[`day${d}`] = want.token;
            row[`day${d}InTime`] = want.inTime;
            row[`day${d}OutTime`] = want.outTime;
            if (want.hours != null) row[`day${d}Hours`] = want.hours;
        }

        result.daysChanged += changed;
        result.employeesUpdated += 1;
        const company = emp.company?.trim() || defaultCompany();
        const list = batches.get(company) ?? [];
        list.push(row);
        batches.set(company, list);
    }

    for (const [company, rows] of batches) {
        const entry: EsslSyncResult["companies"][number] = { company, employees: rows.length };
        try {
            const validated = validateParsedEmployees(rows, year, month);
            entry.persisted = await persistProcessedAttendance({
                employees: validated.employees,
                year,
                month,
                company,
                source: "essl",
                actor,
                reportType: "monthly",
            });
            if (trigger === "manual") {
                await recordUploadHistory({
                    fileName: "Biometric machine sync (eSSL)",
                    reportType: "monthly",
                    reportYear: year,
                    reportMonth: month,
                    company,
                    actor,
                    employeeCount: rows.length,
                    dailyUpserted: entry.persisted.dailyUpserted,
                });
            }
        } catch (e) {
            entry.error = e instanceof Error ? e.message : String(e);
            result.ok = false;
        }
        result.companies.push(entry);
    }

    result.finishedAt = new Date().toISOString();
    result.durationMs = Date.now() - started;
    return result;
}

/** Sync one month. Concurrent calls share the run already in progress. */
export async function syncEsslMonth(opts: {
    year: number;
    month: number;
    actor: string;
    trigger: "manual" | "schedule";
}): Promise<EsslSyncResult> {
    if (running) return running;
    running = (async () => {
        try {
            const r = await runSync(opts);
            if (r.companies.some((c) => c.error)) {
                r.error = r.companies
                    .filter((c) => c.error)
                    .map((c) => `${c.company}: ${c.error}`)
                    .join("\n");
            }
            lastResult = r;
            return r;
        } catch (e) {
            const now = new Date().toISOString();
            const failed: EsslSyncResult = {
                ok: false,
                trigger: opts.trigger,
                year: opts.year,
                month: opts.month,
                from: isoDate(opts.year, opts.month, 1),
                to: isoDate(opts.year, opts.month, daysInMonth(opts.year, opts.month)),
                punches: 0,
                matchedEmployees: 0,
                unmatchedCodes: [],
                employeesUpdated: 0,
                daysChanged: 0,
                companies: [],
                startedAt: now,
                finishedAt: now,
                durationMs: 0,
                error: e instanceof Error ? e.message : String(e),
            };
            lastResult = failed;
            return failed;
        } finally {
            running = null;
        }
    })();
    return running;
}