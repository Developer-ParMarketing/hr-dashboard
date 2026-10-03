import type pg from "pg";
import { daysInMonth, isoDate } from "../persist/helpers.js";
import { payDaysFromDailyTokens } from "./pmSalaryCalculator.js";

export type ApprovedAttendanceIssue = {
  code: "unapproved_week" | "missing_approved_daily";
  weekStart?: string;
  weekEnd?: string;
  status?: string;
  attendanceDate?: string;
  message: string;
};

export type ApprovedAttendanceCheck = {
  ok: boolean;
  issues: ApprovedAttendanceIssue[];
};

const FROZEN_WEEK_SQL = `LOWER(TRIM(w.status)) IN ('approved', 'locked')`;

/**
 * Salary may only run after weekly attendance is approved/locked.
 * Flags daily rows in the month that are not covered by a frozen week.
 */
export async function checkApprovedAttendanceForSalary(
  client: pg.PoolClient,
  employeeId: number,
  year: number,
  month: number,
): Promise<ApprovedAttendanceCheck> {
  const dim = daysInMonth(year, month);
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, dim);
  const issues: ApprovedAttendanceIssue[] = [];

  const unapprovedWeeks = await client.query<{
    week_start: string;
    week_end: string;
    status: string;
  }>(
    `SELECT w.week_start::text AS week_start, w.week_end::text AS week_end, w.status
     FROM weekly_attendance w
     WHERE w.employee_id = $1
       AND w.week_start <= $3::date
       AND w.week_end >= $2::date
       AND NOT (${FROZEN_WEEK_SQL})
     ORDER BY w.week_start`,
    [employeeId, from, to],
  );

  for (const row of unapprovedWeeks.rows) {
    const ws = String(row.week_start).slice(0, 10);
    const we = String(row.week_end).slice(0, 10);
    issues.push({
      code: "unapproved_week",
      weekStart: ws,
      weekEnd: we,
      status: row.status,
      message: `Week ${ws} to ${we} is ${String(row.status || "draft").trim() || "draft"} - approve and lock weekly attendance before salary`,
    });
  }

  const uncoveredDays = await client.query<{ attendance_date: string }>(
    `SELECT d.attendance_date::text AS attendance_date
     FROM daily_attendance d
     WHERE d.employee_id = $1
       AND d.attendance_date BETWEEN $2 AND $3
       AND NOT EXISTS (
         SELECT 1 FROM weekly_attendance w
         WHERE w.employee_id = d.employee_id
           AND d.attendance_date BETWEEN w.week_start AND w.week_end
           AND (${FROZEN_WEEK_SQL})
       )
     ORDER BY d.attendance_date`,
    [employeeId, from, to],
  );

  for (const row of uncoveredDays.rows) {
    const date = String(row.attendance_date).slice(0, 10);
    if (issues.some((i) => i.code === "unapproved_week" && i.weekStart && i.weekEnd && date >= i.weekStart && date <= i.weekEnd)) {
      continue;
    }
    issues.push({
      code: "missing_approved_daily",
      attendanceDate: date,
      message: `${date} is not in an approved/locked weekly attendance record`,
    });
  }

  return { ok: issues.length === 0, issues };
}

/** Pay days / WFH / late marks from approved daily rows only (post-lock snapshot). */
export async function loadApprovedPmAttendanceSnapshot(
  client: pg.PoolClient,
  employeeId: number,
  year: number,
  month: number,
): Promise<{ payDays: number; wfhDays: number; lateMarkCount: number }> {
  const dim = daysInMonth(year, month);
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, dim);

  const daily = await client.query<{ status_token: string | null; late: number | null }>(
    `SELECT d.status_token, d.late
     FROM daily_attendance d
     INNER JOIN weekly_attendance w
       ON w.employee_id = d.employee_id
      AND d.attendance_date BETWEEN w.week_start AND w.week_end
      AND (${FROZEN_WEEK_SQL})
     WHERE d.employee_id = $1
       AND d.attendance_date BETWEEN $2 AND $3
       AND d.origin = 'approved'
     ORDER BY d.attendance_date`,
    [employeeId, from, to],
  );

  return payDaysFromDailyTokens(daily.rows);
}

/** Preview/calc fallback: approved daily rows first, then any daily rows in the month. */
export async function loadPmAttendanceSnapshotForPreview(
  client: pg.PoolClient,
  employeeId: number,
  year: number,
  month: number,
): Promise<{ payDays: number; wfhDays: number; lateMarkCount: number }> {
  const approved = await loadApprovedPmAttendanceSnapshot(client, employeeId, year, month);
  if (approved.payDays > 0 || approved.wfhDays > 0 || approved.lateMarkCount > 0) {
    return approved;
  }

  const dim = daysInMonth(year, month);
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, dim);

  const daily = await client.query<{ status_token: string | null; late: number | null }>(
    `SELECT d.status_token, d.late
     FROM daily_attendance d
     WHERE d.employee_id = $1
       AND d.attendance_date BETWEEN $2 AND $3
     ORDER BY d.attendance_date`,
    [employeeId, from, to],
  );

  return payDaysFromDailyTokens(daily.rows);
}

export async function checkApprovedAttendanceForEmployees(
  client: pg.PoolClient,
  employeeIds: number[],
  year: number,
  month: number,
): Promise<Map<number, ApprovedAttendanceCheck>> {
  const out = new Map<number, ApprovedAttendanceCheck>();
  for (const id of employeeIds) {
    out.set(id, await checkApprovedAttendanceForSalary(client, id, year, month));
  }
  return out;
}
