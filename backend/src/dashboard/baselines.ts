import { query } from "../db/index.js";
import { daysInMonth, isoDate } from "../persist/helpers.js";
import { payDaysFromDailyTokens } from "../salary/pmSalaryCalculator.js";
import { todayIsoInIndia } from "../portalPunch/windows.js";

export type DashboardBaselineInsight = {
  tone: "info" | "warning";
  message: string;
};

const MIN_SAMPLES = 3;
const MAX_HISTORY_MONTHS = 6;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mad(values: number[], med: number): number {
  if (values.length === 0) return 0;
  const devs = values.map((v) => Math.abs(v - med));
  return median(devs);
}

/** Day of month to include when comparing “so far this month” (IST). */
export function asOfDayInPeriod(year: number, month: number, now = new Date()): number {
  const dim = daysInMonth(year, month);
  const todayIso = todayIsoInIndia(now);
  const start = isoDate(year, month, 1);
  const end = isoDate(year, month, dim);
  if (todayIso < start) return 0;
  if (todayIso > end) return dim;
  const day = Number.parseInt(todayIso.slice(8, 10), 10);
  return Number.isFinite(day) && day >= 1 ? Math.min(day, dim) : dim;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

async function payDaysThroughDay(
  employeeId: number,
  year: number,
  month: number,
  throughDay: number,
): Promise<number | null> {
  if (throughDay <= 0) return null;
  const dim = daysInMonth(year, month);
  const toDay = Math.min(throughDay, dim);
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, toDay);

  const rows = await query<{ status_token: string | null; late: number | null }>(
    `SELECT d.status_token, d.late
     FROM daily_attendance d
     WHERE d.employee_id = $1
       AND d.attendance_date BETWEEN $2 AND $3
     ORDER BY d.attendance_date`,
    [employeeId, from, to],
  );
  if (rows.length === 0) return null;
  return payDaysFromDailyTokens(rows).payDays;
}

async function monthHasDailyRows(employeeId: number, year: number, month: number): Promise<boolean> {
  const dim = daysInMonth(year, month);
  const row = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM daily_attendance
     WHERE employee_id = $1
       AND attendance_date BETWEEN $2 AND $3`,
    [employeeId, isoDate(year, month, 1), isoDate(year, month, dim)],
  );
  return (row[0]?.n ?? 0) > 0;
}

export async function buildEmployeePayDaysBaselineInsight(input: {
  employeeId: number;
  year: number;
  month: number;
  fullMonthPayDays: number | null;
  hasAttendance: boolean;
}): Promise<DashboardBaselineInsight | null> {
  if (!input.hasAttendance || input.fullMonthPayDays == null) return null;

  const asOfDay = asOfDayInPeriod(input.year, input.month);
  if (asOfDay <= 0) return null;

  const currentThrough =
    asOfDay >= daysInMonth(input.year, input.month)
      ? input.fullMonthPayDays
      : await payDaysThroughDay(input.employeeId, input.year, input.month, asOfDay);
  if (currentThrough == null) return null;

  const historical: number[] = [];
  let cursor = shiftMonth(input.year, input.month, -1);
  for (let i = 0; i < MAX_HISTORY_MONTHS && historical.length < MAX_HISTORY_MONTHS; i++) {
    const { year, month } = cursor;
    const has = await monthHasDailyRows(input.employeeId, year, month);
    if (has) {
      const histDay = Math.min(asOfDay, daysInMonth(year, month));
      const pay = await payDaysThroughDay(input.employeeId, year, month, histDay);
      if (pay != null) historical.push(pay);
    }
    cursor = shiftMonth(year, month, -1);
  }

  if (historical.length < MIN_SAMPLES) return null;

  const med = median(historical);
  const spread = mad(historical, med);
  const threshold = Math.max(1, med - Math.max(spread * 2, 1));

  if (currentThrough >= threshold) return null;

  const monthLabel = new Date(input.year, input.month - 1, 1).toLocaleString("en-IN", {
    month: "long",
  });
  const throughLabel =
    asOfDay >= daysInMonth(input.year, input.month)
      ? `full ${monthLabel}`
      : `day ${asOfDay} of ${monthLabel}`;

  return {
    tone: "warning",
    message: `Through ${throughLabel}, you have ${currentThrough} pay day${currentThrough === 1 ? "" : "s"} - your recent months were usually about ${Math.round(med)} by the same point.`,
  };
}

function teamScopeClause(
  company: string,
  restrictIds: number[] | null,
): { clause: string; params: unknown[] } {
  const params: unknown[] = [company];
  let clause = `(e.company = $1 OR e.company IS NULL OR e.company = '')`;
  if (restrictIds != null) {
    if (restrictIds.length === 0) return { clause: "FALSE", params: [] };
    params.push(restrictIds);
    clause += ` AND e.id = ANY($${params.length}::int[])`;
  }
  return { clause, params };
}

async function teamLateMarkTotal(
  year: number,
  month: number,
  company: string,
  restrictIds: number[] | null,
): Promise<number | null> {
  const dim = daysInMonth(year, month);
  return teamLateMarkTotalBetween(
    isoDate(year, month, 1),
    isoDate(year, month, dim),
    company,
    restrictIds,
  );
}

export async function teamLateMarkTotalBetween(
  dateFrom: string,
  dateTo: string,
  company: string,
  restrictIds: number[] | null,
): Promise<number | null> {
  const scope = teamScopeClause(company, restrictIds);
  if (scope.clause === "FALSE") return null;
  const row = await query<{ late_total: number; row_count: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN COALESCE(d.late, 0) > 0 THEN 1 ELSE 0 END), 0)::int AS late_total,
       COUNT(*)::int AS row_count
     FROM daily_attendance d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.attendance_date BETWEEN $${scope.params.length + 1} AND $${scope.params.length + 2}
       AND ${scope.clause}`,
    [...scope.params, dateFrom, dateTo],
  );
  if ((row[0]?.row_count ?? 0) === 0) return null;
  return row[0]?.late_total ?? 0;
}

export async function buildManagerTeamLateBaselineInsight(input: {
  year: number;
  month: number;
  company: string;
  restrictIds: number[] | null;
  hasTeamAttendance: boolean;
}): Promise<{ teamLateMarks: number | null; insight: DashboardBaselineInsight | null }> {
  if (!input.hasTeamAttendance || input.restrictIds == null || input.restrictIds.length === 0) {
    return { teamLateMarks: null, insight: null };
  }

  const current = await teamLateMarkTotal(input.year, input.month, input.company, input.restrictIds);
  if (current == null) return { teamLateMarks: null, insight: null };

  const monthName = new Date(input.year, input.month - 1, 1).toLocaleString("en-IN", {
    month: "long",
  });

  const seasonal: number[] = [];
  for (let y = input.year - 1; y >= input.year - MAX_HISTORY_MONTHS && seasonal.length < MAX_HISTORY_MONTHS; y--) {
    const total = await teamLateMarkTotal(y, input.month, input.company, input.restrictIds);
    if (total != null) seasonal.push(total);
  }

  let samples = seasonal;
  if (samples.length < MIN_SAMPLES) {
    const rolling: number[] = [];
    let cursor = shiftMonth(input.year, input.month, -1);
    for (let i = 0; i < MAX_HISTORY_MONTHS && rolling.length < MAX_HISTORY_MONTHS; i++) {
      const total = await teamLateMarkTotal(cursor.year, cursor.month, input.company, input.restrictIds);
      if (total != null) rolling.push(total);
      cursor = shiftMonth(cursor.year, cursor.month, -1);
    }
    if (rolling.length >= MIN_SAMPLES) samples = rolling;
  }

  if (samples.length < MIN_SAMPLES) {
    return { teamLateMarks: current, insight: null };
  }

  const med = median(samples);
  const spread = mad(samples, med);
  const highThreshold = med + Math.max(spread * 2, 1);

  if (current <= highThreshold) {
    return { teamLateMarks: current, insight: null };
  }

  const seasonalEnough = seasonal.length >= MIN_SAMPLES;
  return {
    teamLateMarks: current,
    insight: {
      tone: "warning",
      message: seasonalEnough
        ? `Team late marks (${current}) are higher than your team’s typical ${monthName} (median about ${Math.round(med)}).`
        : `Team late marks (${current}) are higher than your team’s recent months (median about ${Math.round(med)}).`,
    },
  };
}
