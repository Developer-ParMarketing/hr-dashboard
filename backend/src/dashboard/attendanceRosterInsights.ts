import type { AuthUser } from "../auth/users.js";
import { userCanEdit, userIsManager } from "../auth/middleware.js";
import { query } from "../db/index.js";
import { isExecutiveLeaveApprover } from "../leaveRequests/approvers.js";
import { isLeadershipReviewer } from "../performance/leadership.js";
import { cellStr, isoDate } from "../persist/helpers.js";
import {
  lateMarkToDeductionDays,
} from "../salary/pmSalaryCalculator.js";
import { enrichRosterWithStatisticalInsights } from "./attendanceAnomalyDetection.js";
import {
  calendarMonthsOverlappingRange,
  metricsForDateRange,
  metricsFromDailyRows,
  rowsInDateRange,
} from "./attendancePeriodMetrics.js";
import { sqlEmployeeOperationalOnDate, calendarTodayIso } from "../employees/employmentStatus.js";
import type { AttendanceScope } from "../auth/attendanceScope.js";
import { resolveDashboardEmployeeScope } from "./dashboardScope.js";

export type DashboardAttendanceEmployeeRow = {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  teamName: string | null;
  hasAttendance: boolean;
  payDays: number | null;
  wfhDays: number | null;
  lateMarks: number | null;
  absentDays: number | null;
  warnings: string[];
  /** Statistical outliers vs personal history (median + MAD). */
  insights: string[];
  /** 0-100 risk score from pattern detection; higher = more unusual. */
  anomalyScore: number;
  /** 1 when last month's register exists for comparison; else 0. */
  patternHistoryMonths: number;
};

const PM_WFH_MONTHLY_CAP = 3;
/** Excluded from dashboard attendance summary charts and roster (Jay/Mansi still view everyone else). */
const ATTENDANCE_ROSTER_EXCLUDED_TEAM_SLUG = "management";

export function canViewDashboardAttendanceRoster(user: AuthUser): boolean {
  if (userIsManager(user)) return true;
  if (userCanEdit(user)) return true;
  if (isExecutiveLeaveApprover(user)) return true;
  if (isLeadershipReviewer(user.email)) return true;
  return false;
}

function employeeScopeClause(
  company: string,
  restrictIds: number[] | null,
): { clause: string; params: unknown[] } {
  const params: unknown[] = [company, calendarTodayIso()];
  let clause = `(e.company = $1 OR e.company IS NULL OR e.company = '')
    AND lower(COALESCE(e.status, 'active')) = 'active'
    AND ${sqlEmployeeOperationalOnDate("e", 2)}
    AND NOT EXISTS (
      SELECT 1 FROM teams t_ex
      WHERE t_ex.id = e.team_id AND lower(t_ex.slug) = $${params.length + 1}
    )`;
  params.push(ATTENDANCE_ROSTER_EXCLUDED_TEAM_SLUG);
  if (restrictIds != null) {
    if (restrictIds.length === 0) return { clause: "FALSE", params: [] };
    params.push(restrictIds);
    clause += ` AND e.id = ANY($${params.length}::int[])`;
  }
  return { clause, params };
}

function buildEmployeeAttendanceWarnings(input: {
  hasRegisterData: boolean;
  hasAttendance: boolean;
  lateMarks: number;
  wfhDays: number;
  absentDays: number;
  periodLabel: string;
  monthLabel?: string;
}): string[] {
  const warnings: string[] = [];
  const prefix = input.monthLabel ? `${input.monthLabel}: ` : "";
  if (input.hasRegisterData && !input.hasAttendance) {
    warnings.push(`${prefix}Not on the ${input.periodLabel} attendance register`);
  }
  if (input.lateMarks >= 4) {
    const dedDays = lateMarkToDeductionDays(input.lateMarks);
    warnings.push(
      `${prefix}${input.lateMarks} late marks in ${input.periodLabel} (${dedDays} day${dedDays === 1 ? "" : "s"} may be deducted from pay)`,
    );
  } else if (input.lateMarks === 3) {
    warnings.push(`${prefix}3 late marks in ${input.periodLabel} - one more may affect pay`);
  }
  if (input.wfhDays > PM_WFH_MONTHLY_CAP) {
    warnings.push(
      `${prefix}WFH ${input.wfhDays} days in ${input.periodLabel} (policy allows ${PM_WFH_MONTHLY_CAP} per month)`,
    );
  }
  if (input.absentDays >= 3) {
    warnings.push(
      `${prefix}Absent on ${input.absentDays} day${input.absentDays === 1 ? "" : "s"} in ${input.periodLabel}`,
    );
  }
  return warnings;
}

function warningsForEmployeeInPeriod(input: {
  allRows: {
    status_token: string | null;
    late: number | null;
    daily_status: string | null;
    attendance_date: string;
  }[];
  dateFrom: string;
  dateTo: string;
  isSingleCalendarMonth: boolean;
  hasRegisterData: boolean;
  periodLabel: string;
}): string[] {
  const inPeriod = rowsInDateRange(input.allRows, input.dateFrom, input.dateTo);
  const hasAttendance = inPeriod.length > 0;

  if (input.isSingleCalendarMonth) {
    let absentDays = 0;
    let lateMarks = 0;
    let wfhDays = 0;
    if (hasAttendance) {
      const stats = metricsFromDailyRows(inPeriod);
      lateMarks = stats.lateMarks;
      wfhDays = stats.wfhDays;
      absentDays = stats.absentDays;
    }
    return buildEmployeeAttendanceWarnings({
      hasRegisterData: input.hasRegisterData,
      hasAttendance,
      lateMarks,
      wfhDays,
      absentDays,
      periodLabel: input.periodLabel,
    });
  }

  const warnings: string[] = [];
  if (input.hasRegisterData && !hasAttendance) {
    warnings.push(`Not on the ${input.periodLabel} attendance register`);
  }

  for (const { year, month, from, to } of calendarMonthsOverlappingRange(
    input.dateFrom,
    input.dateTo,
  )) {
    const monthRows = rowsInDateRange(input.allRows, from, to);
    if (monthRows.length === 0) continue;
    const stats = metricsFromDailyRows(monthRows);
    const monthName = new Date(year, month - 1, 1).toLocaleString("en-IN", {
      month: "short",
      year: "numeric",
    });
    warnings.push(
      ...buildEmployeeAttendanceWarnings({
        hasRegisterData: false,
        hasAttendance: true,
        lateMarks: stats.lateMarks,
        wfhDays: stats.wfhDays,
        absentDays: stats.absentDays,
        periodLabel: input.periodLabel,
        monthLabel: monthName,
      }),
    );
  }

  return warnings;
}

export async function loadDashboardAttendanceEmployeeRoster(input: {
  dateFrom: string;
  dateTo: string;
  isSingleCalendarMonth: boolean;
  priorCompareLabel: string;
  company: string;
  restrictIds: number[] | null;
  hasRegisterData: boolean;
  periodLabel: string;
}): Promise<DashboardAttendanceEmployeeRow[]> {
  const from = input.dateFrom;
  const to = input.dateTo;
  const scope = employeeScopeClause(input.company, input.restrictIds);
  if (scope.clause === "FALSE") return [];

  const employees = await query<{
    id: number;
    employee_code: string;
    name: string;
    team_name: string | null;
  }>(
    `SELECT e.id, e.employee_code, e.name, t.name AS team_name
     FROM employees e
     LEFT JOIN teams t ON t.id = e.team_id
     WHERE ${scope.clause}
     ORDER BY COALESCE(t.sort_order, 9999), t.name NULLS LAST, e.name`,
    scope.params,
  );
  if (employees.length === 0) return [];

  const fromIdx = scope.params.length + 1;
  const toIdx = scope.params.length + 2;
  const dailyRows = await query<{
    employee_id: number;
    status_token: string | null;
    late: number | null;
    daily_status: string | null;
    attendance_date: string;
  }>(
    `SELECT d.employee_id, d.status_token, d.late, d.daily_status, d.attendance_date::text AS attendance_date
     FROM daily_attendance d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.attendance_date BETWEEN $${fromIdx}::date AND $${toIdx}::date
       AND ${scope.clause}`,
    [...scope.params, from, to],
  );

  const byEmployee = new Map<
    number,
    {
      status_token: string | null;
      late: number | null;
      daily_status: string | null;
      attendance_date: string;
    }[]
  >();
  for (const row of dailyRows) {
    const list = byEmployee.get(row.employee_id) ?? [];
    list.push(row);
    byEmployee.set(row.employee_id, list);
  }

  const roster: DashboardAttendanceEmployeeRow[] = employees.map((emp) => {
    const rows = byEmployee.get(emp.id) ?? [];
    const inPeriod = rowsInDateRange(rows, from, to);
    const hasAttendance = inPeriod.length > 0;
    let payDays: number | null = null;
    let wfhDays: number | null = null;
    let lateMarks: number | null = null;
    let absentDays: number | null = null;

    if (hasAttendance) {
      const stats = metricsForDateRange(rows, from, to)!;
      payDays = stats.payDays;
      wfhDays = stats.wfhDays;
      lateMarks = stats.lateMarks;
      absentDays = stats.absentDays;
    }

    const warnings = warningsForEmployeeInPeriod({
      allRows: rows,
      dateFrom: from,
      dateTo: to,
      isSingleCalendarMonth: input.isSingleCalendarMonth,
      hasRegisterData: input.hasRegisterData,
      periodLabel: input.periodLabel,
    });

    return {
      employeeId: emp.id,
      employeeCode: emp.employee_code,
      employeeName: emp.name,
      teamName: emp.team_name,
      hasAttendance,
      payDays,
      wfhDays,
      lateMarks,
      absentDays,
      warnings,
      insights: [],
      anomalyScore: 0,
      patternHistoryMonths: 0,
    };
  });

  await enrichRosterWithStatisticalInsights(
    roster.map((r) => r.employeeId),
    {
      periodFrom: from,
      periodTo: to,
      isSingleCalendarMonth: input.isSingleCalendarMonth,
      priorCompareLabel: input.priorCompareLabel,
      periodLabel: input.periodLabel,
    },
    roster,
  );

  roster.sort((a, b) => {
    const scoreDiff = b.anomalyScore - a.anomalyScore;
    if (scoreDiff !== 0) return scoreDiff;
    const aw = a.warnings.length + a.insights.length > 0 ? 0 : 1;
    const bw = b.warnings.length + b.insights.length > 0 ? 0 : 1;
    if (aw !== bw) return aw - bw;
    return a.employeeName.localeCompare(b.employeeName, "en");
  });

  return roster;
}

/** Employee IDs included in the dashboard attendance roster (scope + optional filter). */
export function resolveDashboardRosterRestrictIds(
  user: AuthUser,
  attendanceScope: AttendanceScope,
  employeeIdsFilter: number[] | null,
): number[] | null {
  if (!canViewDashboardAttendanceRoster(user)) return null;
  return resolveDashboardEmployeeScope(user, attendanceScope, employeeIdsFilter);
}

/** True when the attendance roster includes the whole company (not only a manager team). */
export function hasCompanyWideAttendanceRosterScope(user: AuthUser): boolean {
  if (userCanEdit(user)) return true;
  if (isExecutiveLeaveApprover(user)) return true;
  if (isLeadershipReviewer(user.email)) return true;
  return false;
}
