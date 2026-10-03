import { createHash } from "crypto";
import type pg from "pg";
import { query, withTransaction } from "../db/index.js";
import { daysInMonth, isoDate } from "../persist/helpers.js";
import { payDaysFromDailyTokens } from "./pmSalaryCalculator.js";

export type SalaryCalculationStatus = {
  hasAttendanceData: boolean;
  hasSalaryResults: boolean;
  /** Payslips saved in salary_records for this month (company scope). */
  savedPayrollCount: number;
  lastCalculatedAt: string | null;
  lastCalculatedBy: string | null;
  attendanceStale: boolean;
  staleMessage: string | null;
  attendanceFingerprint: string | null;
  savedFingerprint: string | null;
};

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** All daily attendance in the month (uploaded monthly / daily register - approval not required). */
export async function loadPmAttendanceSnapshotForSalary(
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
     WHERE d.employee_id = $1
       AND d.attendance_date BETWEEN $2 AND $3
     ORDER BY d.attendance_date`,
    [employeeId, from, to],
  );

  return payDaysFromDailyTokens(daily.rows);
}

/** Warning when preview pay days are zero (missing register vs all AB/WO). */
export async function payDaysZeroWarning(
  client: pg.PoolClient,
  employeeId: number,
  year: number,
  month: number,
  payDays: number,
): Promise<string | null> {
  if (payDays > 0) return null;
  const dim = daysInMonth(year, month);
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, dim);
  const row = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM daily_attendance
     WHERE employee_id = $1 AND attendance_date BETWEEN $2 AND $3`,
    [employeeId, from, to],
  );
  const n = row.rows[0]?.n ?? 0;
  if (n === 0) {
    return "No attendance for this month - upload the monthly register in Attendance History.";
  }
  return "Pay days are 0 (only absent or weekly-off days on file). Use a month with present days or re-upload attendance.";
}

export async function computePeriodAttendanceFingerprint(
  client: pg.PoolClient,
  year: number,
  month: number,
  company: string,
): Promise<string> {
  const dim = daysInMonth(year, month);
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, dim);
  const companyNorm = company.trim() || "PM";

  const daily = await client.query<{ chunk: string }>(
    `SELECT
       d.employee_id::text || '|' || d.attendance_date::text || '|' ||
       COALESCE(d.status_token, '') || '|' || COALESCE(d.late::text, '0') || '|' ||
       COALESCE(d.origin, '') || '|' || COALESCE(d.updated_at::text, '') AS chunk
     FROM daily_attendance d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.attendance_date BETWEEN $1 AND $2
       AND (e.company = $3 OR e.company IS NULL OR e.company = '')
     ORDER BY d.employee_id, d.attendance_date`,
    [from, to, companyNorm],
  );

  const weekly = await client.query<{ chunk: string }>(
    `SELECT
       w.employee_id::text || '|' || w.week_start::text || '|' || w.week_end::text || '|' ||
       COALESCE(w.status, '') || '|' || COALESCE(w.updated_at::text, '') AS chunk
     FROM weekly_attendance w
     JOIN employees e ON e.id = w.employee_id
     WHERE w.week_start <= $2::date
       AND w.week_end >= $1::date
       AND (e.company = $3 OR e.company IS NULL OR e.company = '')
     ORDER BY w.employee_id, w.week_start`,
    [from, to, companyNorm],
  );

  const payload = [
    `period:${year}-${month}:${companyNorm}`,
    `days:${dim}`,
    ...daily.rows.map((r) => `d:${r.chunk}`),
    ...weekly.rows.map((r) => `w:${r.chunk}`),
  ].join("\n");

  return createHash("sha256").update(payload).digest("hex");
}

export async function hasAttendanceDataForPeriod(
  year: number,
  month: number,
  company: string,
): Promise<boolean> {
  const dim = daysInMonth(year, month);
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, dim);
  const companyNorm = company.trim() || "PM";
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM daily_attendance d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.attendance_date BETWEEN $1 AND $2
       AND (e.company = $3 OR e.company IS NULL OR e.company = '')`,
    [from, to, companyNorm],
  );
  return (rows[0]?.n ?? 0) > 0;
}

export async function getSalaryCalculationStatus(
  year: number,
  month: number,
  company: string,
): Promise<SalaryCalculationStatus> {
  const companyNorm = company.trim() || "PM";
  const mk = monthKey(year, month);

  return withTransaction(async (client) => {
    const hasAttendanceData = await hasAttendanceDataForPeriod(year, month, companyNorm);
    const currentFingerprint = hasAttendanceData
      ? await computePeriodAttendanceFingerprint(client, year, month, companyNorm)
      : null;

    const run = await client.query<{
      attendance_fingerprint: string;
      calculated_at: Date;
      calculated_by: string | null;
    }>(
      `SELECT attendance_fingerprint, calculated_at, calculated_by
       FROM salary_calc_runs
       WHERE year = $1 AND month = $2 AND company = $3`,
      [year, month, companyNorm],
    );

    const resultCount = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM salary_records s
       JOIN employees e ON e.id = s.employee_id
       WHERE s.month = $1
         AND (e.company = $2 OR e.company IS NULL OR e.company = '')`,
      [mk, companyNorm],
    );
    const hasSalaryResults = (resultCount.rows[0]?.n ?? 0) > 0;
    const savedPayrollCount = resultCount.rows[0]?.n ?? 0;

    const saved = run.rows[0];
    const lastCalculatedAt = saved?.calculated_at
      ? new Date(saved.calculated_at).toISOString()
      : null;
    const savedFingerprint = saved?.attendance_fingerprint ?? null;

    const attendanceStale =
      hasSalaryResults &&
      hasAttendanceData &&
      savedFingerprint != null &&
      currentFingerprint != null &&
      savedFingerprint !== currentFingerprint;

    let staleMessage: string | null = null;
    if (attendanceStale) {
      staleMessage =
        "Attendance was updated after the last salary run (approved, rejected, or edited). Recalculate to refresh pay days and deductions.";
    } else if (!hasSalaryResults && hasAttendanceData) {
      staleMessage = null;
    }

    return {
      hasAttendanceData,
      hasSalaryResults,
      savedPayrollCount,
      lastCalculatedAt,
      lastCalculatedBy: saved?.calculated_by ?? null,
      attendanceStale,
      staleMessage,
      attendanceFingerprint: currentFingerprint,
      savedFingerprint,
    };
  });
}

export async function recordSalaryCalculationRun(
  client: pg.PoolClient,
  input: {
    year: number;
    month: number;
    company: string;
    actor: string;
    employeeCount: number;
  },
): Promise<void> {
  const companyNorm = input.company.trim() || "PM";
  const fingerprint = await computePeriodAttendanceFingerprint(
    client,
    input.year,
    input.month,
    companyNorm,
  );
  await client.query(
    `INSERT INTO salary_calc_runs (
       year, month, company, attendance_fingerprint, calculated_at, calculated_by, employee_count
     ) VALUES ($1, $2, $3, $4, NOW(), $5, $6)
     ON CONFLICT (year, month, company) DO UPDATE SET
       attendance_fingerprint = EXCLUDED.attendance_fingerprint,
       calculated_at = EXCLUDED.calculated_at,
       calculated_by = EXCLUDED.calculated_by,
       employee_count = EXCLUDED.employee_count`,
    [input.year, input.month, companyNorm, fingerprint, input.actor, input.employeeCount],
  );
}
