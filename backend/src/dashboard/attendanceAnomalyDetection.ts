import { query } from "../db/index.js";
import { daysInMonth } from "../persist/helpers.js";
import { asOfDayInPeriod } from "./baselines.js";
import { priorPeriodForPatternComparison } from "./dateRange.js";
import {
  metricsForDateRange,
  metricsFromDailyRows,
  type DailyAttendanceRow,
} from "./attendancePeriodMetrics.js";
import { detectHighOutlier, detectLowOutlier, shiftMonth } from "./robustStats.js";

export type AttendanceMonthlyMetrics = {
  payDays: number;
  wfhDays: number;
  lateMarks: number;
  absentDays: number;
};

type DailyRow = DailyAttendanceRow;

function rowsThroughDay(rows: DailyRow[], year: number, month: number, throughDay: number): DailyRow[] {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  return rows.filter((r) => {
    if (!r.attendance_date.startsWith(prefix)) return false;
    const day = Number.parseInt(r.attendance_date.slice(8, 10), 10);
    return Number.isFinite(day) && day <= throughDay;
  });
}

function metricsForMonth(
  allRows: DailyRow[],
  year: number,
  month: number,
  compareThroughDay: number | null,
): AttendanceMonthlyMetrics | null {
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  const inMonth = allRows.filter((r) => r.attendance_date.startsWith(prefix));
  if (inMonth.length === 0) return null;
  const slice =
    compareThroughDay != null && compareThroughDay > 0
      ? rowsThroughDay(inMonth, year, month, compareThroughDay)
      : inMonth;
  if (slice.length === 0) return null;
  return metricsFromDailyRows(slice);
}

/** One query: daily rows for all employees over the history window. */
async function loadDailyRowsBatch(
  employeeIds: number[],
  rangeStart: string,
  rangeEnd: string,
): Promise<Map<number, DailyRow[]>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await query<DailyRow & { employee_id: number }>(
    `SELECT employee_id, status_token, late, daily_status, attendance_date::text AS attendance_date
     FROM daily_attendance
     WHERE employee_id = ANY($1::int[])
       AND attendance_date BETWEEN $2::date AND $3::date
     ORDER BY employee_id, attendance_date`,
    [employeeIds, rangeStart, rangeEnd],
  );
  const byEmp = new Map<number, DailyRow[]>();
  for (const row of rows) {
    const list = byEmp.get(row.employee_id) ?? [];
    list.push({
      status_token: row.status_token,
      late: row.late,
      daily_status: row.daily_status,
      attendance_date: row.attendance_date,
    });
    byEmp.set(row.employee_id, list);
  }
  return byEmp;
}

export type StatisticalAttendanceInsight = {
  message: string;
  severity: number;
};

function buildInsightFlags(input: {
  current: AttendanceMonthlyMetrics;
  prior: AttendanceMonthlyMetrics;
  priorCompareLabel: string;
  periodLabel: string;
  isSingleCalendarMonth: boolean;
}): StatisticalAttendanceInsight[] {
  const flags: StatisticalAttendanceInsight[] = [];
  const { current, prior } = input;
  const priorName = input.priorCompareLabel.trim() || "the prior period";
  const nowLabel = input.periodLabel.trim() || (input.isSingleCalendarMonth ? "this month" : "this period");

  const payLow = detectLowOutlier(current.payDays, [prior.payDays], 1);
  if (payLow) {
    flags.push({
      message: `Pay days: ${current.payDays} in ${nowLabel} (${prior.payDays} in ${priorName}).`,
      severity: payLow.severity,
    });
  }

  const lateHigh = detectHighOutlier(current.lateMarks, [prior.lateMarks], "late marks", 1);
  if (lateHigh && !(current.lateMarks >= 4)) {
    flags.push({
      message: `Late marks: ${current.lateMarks} in ${nowLabel} (${prior.lateMarks} in ${priorName}).`,
      severity: lateHigh.severity,
    });
  }

  const wfhHigh = detectHighOutlier(current.wfhDays, [prior.wfhDays], "WFH days", 1);
  if (wfhHigh && !(current.wfhDays > 3)) {
    flags.push({
      message: `WFH days: ${current.wfhDays} in ${nowLabel} (${prior.wfhDays} in ${priorName}).`,
      severity: wfhHigh.severity,
    });
  }

  const absentHigh = detectHighOutlier(current.absentDays, [prior.absentDays], "absent days", 1);
  if (absentHigh && current.absentDays < 3) {
    flags.push({
      message: `Absences: ${current.absentDays} in ${nowLabel} (${prior.absentDays} in ${priorName}).`,
      severity: absentHigh.severity,
    });
  }

  return flags;
}

export function buildStatisticalInsightsForPeriod(input: {
  periodFrom: string;
  periodTo: string;
  isSingleCalendarMonth: boolean;
  priorCompareLabel: string;
  periodLabel: string;
  allRows: DailyRow[];
}): { insights: string[]; anomalyScore: number; patternHistoryMonths: number } {
  let current: AttendanceMonthlyMetrics | null = null;
  let prior: AttendanceMonthlyMetrics | null = null;

  if (input.isSingleCalendarMonth) {
    const year = Number.parseInt(input.periodFrom.slice(0, 4), 10);
    const month = Number.parseInt(input.periodFrom.slice(5, 7), 10);
    const asOfDay = asOfDayInPeriod(year, month);
    const dim = daysInMonth(year, month);
    const monthComplete = asOfDay >= dim;
    const throughDay = monthComplete ? null : asOfDay;

    current = metricsForMonth(input.allRows, year, month, throughDay);
    if (!current) return { insights: [], anomalyScore: 0, patternHistoryMonths: 0 };

    const prev = shiftMonth(year, month, -1);
    const priorCompareDay =
      throughDay != null ? Math.min(throughDay, daysInMonth(prev.year, prev.month)) : null;
    prior = metricsForMonth(input.allRows, prev.year, prev.month, priorCompareDay);
  } else {
    current = metricsForDateRange(input.allRows, input.periodFrom, input.periodTo);
    if (!current) return { insights: [], anomalyScore: 0, patternHistoryMonths: 0 };

    const priorRange = priorPeriodForPatternComparison(
      input.periodFrom,
      input.periodTo,
      input.isSingleCalendarMonth,
    );
    prior = metricsForDateRange(input.allRows, priorRange.dateFrom, priorRange.dateTo);
  }

  if (!prior) {
    return { insights: [], anomalyScore: 0, patternHistoryMonths: 0 };
  }

  const flags = buildInsightFlags({
    current,
    prior,
    priorCompareLabel: input.priorCompareLabel,
    periodLabel: input.periodLabel,
    isSingleCalendarMonth: input.isSingleCalendarMonth,
  });

  if (flags.length === 0) {
    return { insights: [], anomalyScore: 0, patternHistoryMonths: 1 };
  }

  const anomalyScore = Math.min(
    100,
    Math.round(flags.reduce((sum, f) => sum + f.severity, 0) / flags.length),
  );

  return {
    insights: flags.map((f) => f.message),
    anomalyScore,
    patternHistoryMonths: 1,
  };
}

export async function enrichRosterWithStatisticalInsights(
  employeeIds: number[],
  input: {
    periodFrom: string;
    periodTo: string;
    isSingleCalendarMonth: boolean;
    priorCompareLabel: string;
    periodLabel: string;
  },
  rows: Array<{
    employeeId: number;
    insights: string[];
    anomalyScore: number;
    patternHistoryMonths: number;
  }>,
): Promise<void> {
  if (employeeIds.length === 0) return;

  const priorRange = priorPeriodForPatternComparison(
    input.periodFrom,
    input.periodTo,
    input.isSingleCalendarMonth,
  );
  const byEmp = await loadDailyRowsBatch(employeeIds, priorRange.dateFrom, input.periodTo);

  for (const row of rows) {
    const daily = byEmp.get(row.employeeId) ?? [];
    const { insights, anomalyScore, patternHistoryMonths } = buildStatisticalInsightsForPeriod({
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      isSingleCalendarMonth: input.isSingleCalendarMonth,
      priorCompareLabel: input.priorCompareLabel,
      periodLabel: input.periodLabel,
      allRows: daily,
    });
    row.insights = insights;
    row.anomalyScore = anomalyScore;
    row.patternHistoryMonths = patternHistoryMonths;
  }
}
