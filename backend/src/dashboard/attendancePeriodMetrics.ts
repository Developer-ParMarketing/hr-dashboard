import { cellStr, daysInMonth, isoDate } from "../persist/helpers.js";
import { payDaysFromDailyTokens } from "../salary/pmSalaryCalculator.js";
import type { AttendanceMonthlyMetrics } from "./attendanceAnomalyDetection.js";

export type DailyAttendanceRow = {
  status_token: string | null;
  late: number | null;
  daily_status: string | null;
  attendance_date: string;
};

export function metricsFromDailyRows(rows: DailyAttendanceRow[]): AttendanceMonthlyMetrics {
  const stats = payDaysFromDailyTokens(rows);
  let absentDays = 0;
  for (const row of rows) {
    const token = cellStr(row.status_token).toLowerCase();
    const daily = cellStr(row.daily_status).toLowerCase();
    if (
      daily === "absent" ||
      token === "a" ||
      token === "abs" ||
      token === "absent" ||
      token === "ab"
    ) {
      absentDays += 1;
    }
  }
  return {
    payDays: stats.payDays,
    wfhDays: stats.wfhDays,
    lateMarks: stats.lateMarkCount,
    absentDays,
  };
}

export function rowsInDateRange(
  rows: DailyAttendanceRow[],
  dateFrom: string,
  dateTo: string,
): DailyAttendanceRow[] {
  return rows.filter((r) => r.attendance_date >= dateFrom && r.attendance_date <= dateTo);
}

export function metricsForDateRange(
  rows: DailyAttendanceRow[],
  dateFrom: string,
  dateTo: string,
): AttendanceMonthlyMetrics | null {
  const slice = rowsInDateRange(rows, dateFrom, dateTo);
  if (slice.length === 0) return null;
  return metricsFromDailyRows(slice);
}

/** Calendar months overlapping [dateFrom, dateTo] (clipped), in order. */
export function calendarMonthsOverlappingRange(
  dateFrom: string,
  dateTo: string,
): Array<{ year: number; month: number; from: string; to: string }> {
  const out: Array<{ year: number; month: number; from: string; to: string }> = [];
  let y = Number.parseInt(dateFrom.slice(0, 4), 10);
  let m = Number.parseInt(dateFrom.slice(5, 7), 10);
  const endY = Number.parseInt(dateTo.slice(0, 4), 10);
  const endM = Number.parseInt(dateTo.slice(5, 7), 10);

  while (y < endY || (y === endY && m <= endM)) {
    const monthStart = isoDate(y, m, 1);
    const monthEnd = isoDate(y, m, daysInMonth(y, m));
    const from = monthStart < dateFrom ? dateFrom : monthStart;
    const to = monthEnd > dateTo ? dateTo : monthEnd;
    out.push({ year: y, month: m, from, to });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
