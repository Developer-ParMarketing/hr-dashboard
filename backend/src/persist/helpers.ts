export const STANDARD_DAY_HOURS = 9;
export const LATE_GRACE_MINUTES = 15;
/** Full week target (Mon-Sat × 9h). Weekly short-hours mail fires below this. */
export const WEEKLY_HOURS_THRESHOLD = 54;
/** Assumed paid working days per month for hourly rate (deduction = rate × deficit hours). */
export const MONTHLY_PAID_DAYS = 26;

/** PM attendance rules (deficit, deductions, late grace, WFH cap) apply only for PM. */
export function isPmPolicyCompany(company: string | null | undefined): boolean {
  const c = cellStr(company).toUpperCase();
  if (!c) return true;
  return c === "PM";
}

export function weeklyDeductionRupees(
  monthlySalary: number | null | undefined,
  deficitHours: number | null | undefined,
  company?: string | null,
): number | null {
  if (!isPmPolicyCompany(company)) return 0;
  if (deficitHours == null || !Number.isFinite(deficitHours)) return null;
  if (deficitHours <= 0) return 0;
  if (monthlySalary == null || !Number.isFinite(monthlySalary) || monthlySalary <= 0) return 0;
  const hourly = monthlySalary / (MONTHLY_PAID_DAYS * STANDARD_DAY_HOURS);
  return Math.round(hourly * deficitHours * 100) / 100;
}

export type RawIngestEmployee = {
  employeeCode?: unknown;
  empCode?: unknown;
  code?: unknown;
  employeeName?: unknown;
  empName?: unknown;
  name?: unknown;
  department?: unknown;
  dept?: unknown;
  shiftStart?: unknown;
  inTime?: unknown;
  [key: string]: unknown;
};

export function cellStr(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "nan") return "";
  return s;
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function parseClockToMinutes(value: string): number | null {
  const v = value.trim().replace(/\./g, ":");
  if (!v) return null;
  const mer = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (!mer) {
    const hourOnly = v.match(/^(\d{1,2})\s*([AP]M)$/i);
    if (!hourOnly) return null;
    let h = Number(hourOnly[1]);
    const ampm = hourOnly[2].toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return h * 60;
  }
  let h = Number(mer[1]);
  const m = Number(mer[2]);
  const ampm = (mer[4] ?? "").toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/** Wall-clock HH:MM (wraps at 24h). Seconds from the original punch are not reconstructed. */
export function minutesToClock(totalMin: number): string {
  const dayMin = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  const h = Math.floor(dayMin / 60);
  const m = dayMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function addMinutesToClock(clock: string, addMin: number): string | null {
  const base = parseClockToMinutes(clock);
  if (base == null || !Number.isFinite(addMin)) return null;
  return minutesToClock(base + Math.round(addMin));
}

export function deriveOutTime(
  inTime: string,
  outTime: string,
  workingHours: number | null,
): string {
  if (outTime) return outTime;
  if (inTime && workingHours != null && Number.isFinite(workingHours) && workingHours > 0) {
    return addMinutesToClock(inTime, workingHours * 60) ?? "";
  }
  return "";
}

export function extractWorkedHours(token: string): number | null {
  const t = token.trim();
  if (!t) return null;
  const pDur = t.match(/^(?:P|WFH)\((\d{1,2}):(\d{2})(?::\d{2})?\)$/i);
  if (pDur) {
    const h = Number.parseInt(pDur[1], 10);
    const mm = Number.parseInt(pDur[2], 10);
    if (Number.isFinite(h) && Number.isFinite(mm)) return h + mm / 60;
  }
  return null;
}

export function isPresentToken(token: string): boolean {
  const t = token.trim().toUpperCase();
  if (!t || t === "AB" || t === "WO" || t === "DA") return false;
  if (t === "SL" || t === "PL" || t === "CL") return false;
  if (t === "WFH" || t.startsWith("WFH(")) return false;
  return t === "P" || t.startsWith("P(");
}

export function isLeaveToken(token: string): boolean {
  const u = token.trim().toUpperCase();
  return u === "DA" || u === "SL" || u === "PL" || u === "CL";
}

export function isPaidLeaveToken(token: string): boolean {
  const u = token.trim().toUpperCase();
  return u === "SL" || u === "PL" || u === "CL";
}

function isGenericLeaveMark(token: string): boolean {
  return cellStr(token).toLowerCase() === "leave";
}

export function isAbsentToken(token: string): boolean {
  return token.trim().toUpperCase() === "AB";
}

export function isWeeklyOffToken(token: string): boolean {
  const u = token.trim().toUpperCase();
  return u === "WO" || u === "DA";
}

export function isWfhToken(token: string): boolean {
  const u = token.trim().toUpperCase();
  return u === "WFH" || u.startsWith("WFH(");
}

export function parseHoursValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value).replace(/,/g, "").trim();
  if (!s || s.toLowerCase() === "nan") return null;
  if (s.includes(":")) {
    const [h, m] = s.split(":");
    const hh = Number.parseInt(h, 10);
    const mm = Number.parseInt(m ?? "0", 10);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return hh + mm / 60;
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function durationHoursToHm(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = ((total % 60) + 60) % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function markFromToken(token: string): string {
  const u = token.trim().toUpperCase();
  if (!u) return "";
  if (u === "P" || u.startsWith("P(")) return "P";
  if (u === "WFH" || u.startsWith("WFH(")) return "WFH";
  if (u === "DA") return "WO";
  if (u === "SL" || u === "PL" || u === "CL" || u === "AB" || u === "WO") return u;
  return u;
}

export function tokenFromMark(mark: string, hours: number | null): string {
  const m = mark.trim().toUpperCase();
  if (!m) return "";
  if (m === "P" || m === "PRESENT") {
    return hours != null && hours > 0 ? `P(${durationHoursToHm(hours)})` : "P";
  }
  if (m === "WFH") {
    return hours != null && hours > 0 ? `WFH(${durationHoursToHm(hours)})` : "WFH";
  }
  if (m === "PRESENT") return "P";
  return m;
}

export class AttendanceLockedError extends Error {
  constructor(message = "Approved weekly attendance cannot be modified") {
    super(message);
    this.name = "AttendanceLockedError";
  }
}

/** True when a weekly row is frozen (approved or locked), case-insensitive. */
export function isWeeklyFrozen(status: string | null | undefined): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "approved" || s === "locked";
}

export function assertWeeklyNotFrozen(status: string | null | undefined): void {
  if (isWeeklyFrozen(status)) {
    throw new AttendanceLockedError();
  }
}

/** Map a Postgres trigger / constraint failure to AttendanceLockedError. */
export function throwIfWeeklyLockViolation(e: unknown): never {
  if (e instanceof AttendanceLockedError) throw e;
  const err = e as { code?: string; message?: string };
  const msg = err.message ?? String(e);
  if (
    err.code === "23001" ||
    /approved weekly attendance cannot be modified/i.test(msg)
  ) {
    throw new AttendanceLockedError();
  }
  throw e instanceof Error ? e : new Error(String(e));
}

export type DailyStatus = "present" | "late" | "absent" | "leave" | "wfh" | "weekly_off";

/** Normalize tokens for UI (Computex DA → weekly off label WO). */
export function normalizeStatusTokenForDisplay(token: string): string {
  const t = cellStr(token);
  if (!t) return "";
  if (t.toUpperCase() === "DA") return "WO";
  return t;
}

/** Calculated daily status stored on each saved attendance row. */
/** Map stored daily row fields to a grid token for monthly/weekly UI. */
export function displayTokenFromDailyRow(row: {
  status_token?: string | null;
  daily_status?: string | null;
  raw_status_token?: string | null;
}): string {
  const status = cellStr(row.daily_status).toLowerCase();
  let token = normalizeStatusTokenForDisplay(cellStr(row.status_token));

  if (isGenericLeaveMark(token) || (status === "leave" && !isPaidLeaveToken(token))) {
    const raw = normalizeStatusTokenForDisplay(cellStr(row.raw_status_token));
    if (isPaidLeaveToken(raw)) token = raw.toUpperCase();
    else if (isGenericLeaveMark(token)) token = "";
  }

  if (status === "wfh" && isPresentToken(token)) return "WFH";
  if (token && !isGenericLeaveMark(token)) return token;

  if (status === "weekly_off") return "WO";
  if (status === "leave") {
    const raw = normalizeStatusTokenForDisplay(cellStr(row.raw_status_token));
    if (isPaidLeaveToken(raw)) return raw.toUpperCase();
    return "";
  }
  if (status === "wfh") return "WFH";
  if (status === "absent") return "AB";
  if (status === "present" || status === "late") return "P";
  return "";
}

export function calculateDailyStatus(opts: {
  token: string;
  late: boolean;
  inTime: string;
  year: number;
  month: number;
  day: number;
}): DailyStatus {
  const token = opts.token.trim();
  const dow = new Date(opts.year, opts.month - 1, opts.day).getDay();
  if (isWeeklyOffToken(token) || (dow === 0 && !token && !opts.inTime)) return "weekly_off";
  if (isPaidLeaveToken(token)) return "leave";
  if (isWfhToken(token)) return "wfh";
  if (isPresentToken(token)) return opts.late ? "late" : "present";
  if (isAbsentToken(token)) return "absent";
  if (opts.inTime) return opts.late ? "late" : "present";
  if (dow === 0) return "weekly_off";
  return "absent";
}

export function isTruthyLate(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === "number") return v !== 0;
  const s = cellStr(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "late" || s === "l";
}

/** Coerce to a non-negative whole minute count for INTEGER columns. */
export function sanitizeLateMinutes(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.round(n));
}

/** Coerce to 0/1 for INTEGER late flag columns. */
export function sanitizeLateFlag(value: unknown): 0 | 1 {
  return isTruthyLate(value) ? 1 : 0;
}

export function isTimedAttendanceToken(token: string): boolean {
  return isPresentToken(token) || isWfhToken(token);
}

export function employeeCodeOf(raw: RawIngestEmployee): string {
  return cellStr(raw.employeeCode ?? raw.empCode ?? raw.code);
}

export function employeeNameOf(raw: RawIngestEmployee): string {
  return cellStr(raw.employeeName ?? raw.empName ?? raw.name);
}

/** Monday-first calendar weeks for a month (day-of-month numbers). */
export function calendarWeeksForMonth(year: number, month: number): number[][] {
  const dim = daysInMonth(year, month);
  const weeks: number[][] = [];
  const firstDow = new Date(year, month - 1, 1).getDay();
  const firstDowMondayFirst = (firstDow + 6) % 7;
  for (let d = 1; d <= dim; d++) {
    const idx = Math.floor((firstDowMondayFirst + (d - 1)) / 7);
    if (!weeks[idx]) weeks[idx] = [];
    weeks[idx].push(d);
  }
  return weeks;
}

export function requiredHoursForDays(
  year: number,
  month: number,
  days: number[],
  company?: string | null,
  holidayByDate?: ReadonlyMap<string, "full" | "half">,
): number {
  if (!isPmPolicyCompany(company)) return 0;
  let total = 0;
  for (const d of days) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow < 1 || dow > 6) continue;
    const iso = isoDate(year, month, d);
    const holidayType = holidayByDate?.get(iso);
    if (holidayType === "full") continue;
    if (holidayType === "half") total += STANDARD_DAY_HOURS / 2;
    else total += STANDARD_DAY_HOURS;
  }
  return total;
}

export function actorFrom(value: unknown): string {
  const s = cellStr(value);
  return s || "system";
}

/** Hours that count toward the weekly 54h target (leave / WO / absent do not). */
export function hoursCountTowardWeek(token: string, hours: number | null | undefined): number {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return 0;
  if (isLeaveToken(token) || isWeeklyOffToken(token) || token.trim().toUpperCase() === "AB") return 0;
  return hours;
}

export type AttendanceOrigin = "raw" | "calculated" | "hr_edit" | "approved";

export type DailyEditPatch = {
  in_time?: string | null;
  out_time?: string | null;
  working_hours?: number | null;
  late?: number | null;
  late_minutes?: number | null;
  status_token?: string | null;
  daily_status?: string | null;
  note?: string | null;
};

export function weekBoundsContaining(dateIso: string): { weekStart: string; weekEnd: string } {
  const year = Number.parseInt(dateIso.slice(0, 4), 10);
  const month = Number.parseInt(dateIso.slice(5, 7), 10);
  const day = Number.parseInt(dateIso.slice(8, 10), 10);
  const weeks = calendarWeeksForMonth(year, month);
  const week = weeks.find((w) => w.includes(day)) ?? [day];
  return {
    weekStart: isoDate(year, month, week[0]),
    weekEnd: isoDate(year, month, week[week.length - 1]),
  };
}

export function eachIsoDateInclusive(fromIso: string, toIso: string): string[] {
  const [ys, ms, ds] = fromIso.split("-").map((v) => Number.parseInt(v, 10));
  const [ye, me, de] = toIso.split("-").map((v) => Number.parseInt(v, 10));
  const out: string[] = [];
  const cursor = new Date(ys, ms - 1, ds);
  const end = new Date(ye, me - 1, de);
  while (cursor <= end) {
    out.push(isoDate(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
