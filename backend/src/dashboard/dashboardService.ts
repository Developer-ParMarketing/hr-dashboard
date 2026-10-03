import { findEmployeeIdByUserEmail, resolveAttendanceScope } from "../auth/attendanceScope.js";
import type { AuthUser } from "../auth/users.js";
import { userCanEdit, userIsAdmin, userIsManager } from "../auth/middleware.js";
import { query, queryOne, withTransaction } from "../db/index.js";
import { isoDate, daysInMonth } from "../persist/helpers.js";
import { requestCapabilities } from "../employeeRequests/workflow.js";
import { listPendingApprovalForUser } from "../leaveRequests/service.js";
import { isExecutiveLeaveApprover } from "../leaveRequests/approvers.js";
import { listPendingReimbursementForUser } from "../reimbursementRequests/service.js";
import { listPendingPortalPunches } from "../portalPunch/service.js";
import {
  loadPmAttendanceSnapshotForSalary,
  getSalaryCalculationStatus,
  hasAttendanceDataForPeriod,
  type SalaryCalculationStatus,
} from "../salary/attendanceFingerprint.js";
import { loadSalarySheet, type SalarySheetResponse } from "../salary/salarySheet.js";
import { formatDisplayDate, formatDisplayDateRange } from "../displayDate.js";
import {
  buildEmployeePayDaysBaselineInsight,
  buildManagerTeamLateBaselineInsight,
  teamLateMarkTotalBetween,
  type DashboardBaselineInsight,
} from "./baselines.js";
import {
  canViewDashboardAttendanceRoster,
  loadDashboardAttendanceEmployeeRoster,
  resolveDashboardRosterRestrictIds,
  type DashboardAttendanceEmployeeRow,
} from "./attendanceRosterInsights.js";
import {
  dashboardPatternCompareLabel,
  resolveDashboardPeriod,
  type DashboardRangePreset,
} from "./dateRange.js";
import { isManagementRequestOversight } from "../employeeRequests/workflow.js";
import {
  buildDashboardNotificationsPayload,
  type DashboardNotification,
  type DashboardNotificationsMeta,
} from "./dashboardNotifications.js";
import {
  resolveDashboardEmployeeScope,
  resolveDashboardView,
  type DashboardView,
} from "./dashboardScope.js";

export type { DashboardView };

export type DashboardPendingApprovals = {
  leave: number;
  reimbursement: number;
  portalPunch: number;
};

export type DashboardMyRequests = {
  leavePending: number;
  reimbursementPending: number;
  totalPending: number;
};

export type DashboardEmployeeSnapshot = {
  linked: boolean;
  /** Present when linked is false - sign-in address HR must match on the employee record. */
  loginEmail?: string;
  hasAttendance: boolean;
  payDays: number | null;
  wfhDays: number | null;
  lateMarks: number | null;
  hasPayslip: boolean;
  baselineInsight?: DashboardBaselineInsight | null;
};

export type DashboardRecentRequestKind = "leave" | "reimbursement" | "portalPunch";

export type DashboardRecentRequest = {
  kind: DashboardRecentRequestKind;
  id: number;
  status: string;
  summary: string;
  submittedAt: string;
  href: string;
};

export type DashboardAction = {
  id: string;
  severity: "warning" | "info";
  message: string;
  href: string;
  actionLabel: string;
};

/** Ordered monthly payroll steps for HR operations home. */
export type DashboardChecklistItem = {
  id: string;
  step: number;
  title: string;
  detail: string;
  status: "todo" | "done" | "blocked";
  href: string;
  actionLabel: string;
};

export type DashboardWeeklyWeekSummary = {
  weekStart: string;
  weekEnd: string;
  peopleTotal: number;
  peopleApproved: number;
  complete: boolean;
};

export type DashboardSummary = {
  view: DashboardView;
  period: {
    year: number;
    month: number;
    company: string;
    label: string;
    preset: DashboardRangePreset;
    quarter: number | null;
    dateFrom: string;
    dateTo: string;
    isSingleCalendarMonth: boolean;
  };
  attendance: {
    hasData: boolean;
    employeeCount: number;
    /** Employee × week rows overlapping the period (with daily attendance in range). */
    weeklyTotal: number;
    weeklyApproved: number;
    weeklyPending: number;
  /** Distinct week_start values in scope; complete = all employee rows for that week approved/locked. */
  weeklyCalendarWeeksTotal: number;
  weeklyCalendarWeeksComplete: number;
  /** One entry per calendar week in the filter period (week-wise approval progress). */
  weeklyWeeks: DashboardWeeklyWeekSummary[];
  teamLateMarks?: number | null;
    teamBaselineInsight?: DashboardBaselineInsight | null;
  };
  salary: {
    hasAttendanceData: boolean;
    hasResults: boolean;
    attendanceStale: boolean;
    staleMessage: string | null;
    matchedRows: number;
    totalRows: number;
    errorRows: number;
    blockedByApproval: number;
    savedPayrollCount: number;
  } | null;
  people: {
    total: number;
    missingBaseSalary: number;
    /** No work email, or email with no matching dashboard login. */
    unlinkedEmail: number;
    missingDoj: number;
    /** Active employees with no daily attendance rows for the dashboard month (when register uploaded). */
    absentFromRegister: number;
    payrollReadyCount: number;
  } | null;
  teams: {
    withoutManager: number;
    withoutMembers: number;
  } | null;
  pendingApprovals: DashboardPendingApprovals | null;
  myRequests: DashboardMyRequests | null;
  employeeSnapshot: DashboardEmployeeSnapshot | null;
  recentRequests: DashboardRecentRequest[] | null;
  /** Per-employee attendance summary + policy warnings (managers, HR, management, executive approvers). */
  attendanceEmployeeRoster: DashboardAttendanceEmployeeRow[] | null;
  /** Label for the period immediately before the dashboard filter (pattern comparison). */
  attendanceRosterPatternCompareLabel: string | null;
  actions: DashboardAction[];
  /** Present for operations view - month payroll checklist. */
  checklist: DashboardChecklistItem[] | null;
  /** Ranked reminders and shortcuts for this user (feature-weighted priority). */
  notifications: DashboardNotification[];
  notificationsMeta: DashboardNotificationsMeta;
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function employeeScopeSql(
  company: string,
  restrictIds: number[] | null,
  alias: string,
): { clause: string; params: unknown[] } {
  const params: unknown[] = [company];
  let clause = `(${alias}.company = $1 OR ${alias}.company IS NULL OR ${alias}.company = '')`;
  if (restrictIds != null) {
    if (restrictIds.length === 0) {
      return { clause: "FALSE", params: [] };
    }
    params.push(restrictIds);
    clause += ` AND ${alias}.id = ANY($${params.length}::int[])`;
  }
  return { clause, params };
}

const FROZEN_WEEKLY_STATUS_SQL = `LOWER(TRIM(status)) IN ('approved', 'locked')`;

async function loadAttendanceStats(
  dateFrom: string,
  dateTo: string,
  company: string,
  restrictIds: number[] | null,
): Promise<DashboardSummary["attendance"]> {
  const scope = employeeScopeSql(company, restrictIds, "e");
  if (scope.clause === "FALSE") {
    return {
      hasData: false,
      employeeCount: 0,
      weeklyTotal: 0,
      weeklyApproved: 0,
      weeklyPending: 0,
      weeklyCalendarWeeksTotal: 0,
      weeklyCalendarWeeksComplete: 0,
      weeklyWeeks: [],
    };
  }

  const fromIdx = scope.params.length + 1;
  const toIdx = scope.params.length + 2;
  const params = [...scope.params, dateFrom, dateTo];

  const daily = await query<{ employee_count: number; row_count: number }>(
    `SELECT
       COUNT(DISTINCT d.employee_id)::int AS employee_count,
       COUNT(*)::int AS row_count
     FROM daily_attendance d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.attendance_date BETWEEN $${fromIdx}::date AND $${toIdx}::date
       AND ${scope.clause}`,
    params,
  );

  const weekly = await query<{
    employee_weeks_total: number;
    employee_weeks_approved: number;
    calendar_weeks_total: number;
    calendar_weeks_complete: number;
  }>(
    `WITH in_period_daily AS (
       SELECT DISTINCT d.employee_id
       FROM daily_attendance d
       JOIN employees e ON e.id = d.employee_id
       WHERE d.attendance_date BETWEEN $${fromIdx}::date AND $${toIdx}::date
         AND ${scope.clause}
     ),
     scoped_weeks AS (
       SELECT w.employee_id, w.week_start, w.week_end, w.status
       FROM weekly_attendance w
       JOIN employees e ON e.id = w.employee_id
       INNER JOIN in_period_daily ipd ON ipd.employee_id = w.employee_id
       WHERE w.week_start <= $${toIdx}::date
         AND w.week_end >= $${fromIdx}::date
         AND ${scope.clause}
         AND EXISTS (
           SELECT 1 FROM daily_attendance d
           WHERE d.employee_id = w.employee_id
             AND d.attendance_date >= GREATEST(w.week_start, $${fromIdx}::date)
             AND d.attendance_date <= LEAST(w.week_end, $${toIdx}::date)
         )
     ),
     week_groups AS (
       SELECT
         week_start,
         MAX(week_end)::text AS week_end,
         COUNT(*)::int AS rows_total,
         COUNT(*) FILTER (WHERE ${FROZEN_WEEKLY_STATUS_SQL})::int AS rows_approved
       FROM scoped_weeks
       GROUP BY week_start
     )
     SELECT
       COALESCE((SELECT COUNT(*)::int FROM scoped_weeks), 0) AS employee_weeks_total,
       COALESCE((SELECT COUNT(*)::int FROM scoped_weeks WHERE ${FROZEN_WEEKLY_STATUS_SQL}), 0) AS employee_weeks_approved,
       COALESCE((SELECT COUNT(*)::int FROM week_groups), 0) AS calendar_weeks_total,
       COALESCE((SELECT COUNT(*)::int FROM week_groups WHERE rows_total = rows_approved), 0) AS calendar_weeks_complete`,
    params,
  );

  const weekRows = await query<{
    week_start: string;
    week_end: string;
    people_total: number;
    people_approved: number;
  }>(
    `WITH in_period_daily AS (
       SELECT DISTINCT d.employee_id
       FROM daily_attendance d
       JOIN employees e ON e.id = d.employee_id
       WHERE d.attendance_date BETWEEN $${fromIdx}::date AND $${toIdx}::date
         AND ${scope.clause}
     ),
     scoped_weeks AS (
       SELECT w.employee_id, w.week_start, w.week_end, w.status
       FROM weekly_attendance w
       JOIN employees e ON e.id = w.employee_id
       INNER JOIN in_period_daily ipd ON ipd.employee_id = w.employee_id
       WHERE w.week_start <= $${toIdx}::date
         AND w.week_end >= $${fromIdx}::date
         AND ${scope.clause}
         AND EXISTS (
           SELECT 1 FROM daily_attendance d
           WHERE d.employee_id = w.employee_id
             AND d.attendance_date >= GREATEST(w.week_start, $${fromIdx}::date)
             AND d.attendance_date <= LEAST(w.week_end, $${toIdx}::date)
         )
     )
     SELECT
       week_start::text AS week_start,
       MAX(week_end)::text AS week_end,
       COUNT(*)::int AS people_total,
       COUNT(*) FILTER (WHERE ${FROZEN_WEEKLY_STATUS_SQL})::int AS people_approved
     FROM scoped_weeks
     GROUP BY week_start
     ORDER BY week_start`,
    params,
  );

  const employeeCount = daily[0]?.employee_count ?? 0;
  const weeklyTotal = weekly[0]?.employee_weeks_total ?? 0;
  const weeklyApproved = weekly[0]?.employee_weeks_approved ?? 0;
  const weeklyCalendarWeeksTotal = weekly[0]?.calendar_weeks_total ?? 0;
  const weeklyCalendarWeeksComplete = weekly[0]?.calendar_weeks_complete ?? 0;
  const weeklyWeeks: DashboardWeeklyWeekSummary[] = weekRows.map((row) => ({
    weekStart: row.week_start.slice(0, 10),
    weekEnd: row.week_end.slice(0, 10),
    peopleTotal: row.people_total,
    peopleApproved: row.people_approved,
    complete: row.people_total > 0 && row.people_approved === row.people_total,
  }));

  return {
    hasData: (daily[0]?.row_count ?? 0) > 0,
    employeeCount,
    weeklyTotal,
    weeklyApproved,
    weeklyPending: Math.max(0, weeklyTotal - weeklyApproved),
    weeklyCalendarWeeksTotal,
    weeklyCalendarWeeksComplete,
    weeklyWeeks,
  };
}

async function loadPeopleStats(
  company: string,
  restrictIds: number[] | null,
  period?: { dateFrom: string; dateTo: string; attendanceLoaded: boolean },
): Promise<DashboardSummary["people"]> {
  const from = period?.attendanceLoaded && period ? period.dateFrom : null;
  const to = period?.attendanceLoaded && period ? period.dateTo : null;

  const params: unknown[] = [company, from, to];
  let idClause = "";
  if (restrictIds != null) {
    if (restrictIds.length === 0) {
      return {
        total: 0,
        missingBaseSalary: 0,
        unlinkedEmail: 0,
        missingDoj: 0,
        absentFromRegister: 0,
        payrollReadyCount: 0,
      };
    }
    params.push(restrictIds);
    idClause = ` AND e.id = ANY($4::int[])`;
  }

  const rows = await query<{
    total: number;
    missing_base: number;
    unlinked_email: number;
    missing_doj: number;
    absent_from_register: number;
    payroll_ready_count: number;
  }>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE b.employee_id IS NULL)::int AS missing_base,
       COUNT(*) FILTER (
         WHERE e.email IS NULL
            OR TRIM(e.email) = ''
            OR NOT EXISTS (
                 SELECT 1 FROM users u
                 WHERE lower(u.email) = lower(TRIM(e.email))
               )
       )::int AS unlinked_email,
       COUNT(*) FILTER (
         WHERE e.date_of_joining IS NULL AND lower(COALESCE(e.status, 'active')) = 'active'
       )::int AS missing_doj,
       COUNT(*) FILTER (
         WHERE $2::date IS NOT NULL
           AND lower(COALESCE(e.status, 'active')) = 'active'
           AND NOT EXISTS (
                 SELECT 1 FROM daily_attendance d
                 WHERE d.employee_id = e.id
                   AND d.attendance_date BETWEEN $2::date AND $3::date
               )
       )::int AS absent_from_register,
       COUNT(*) FILTER (
         WHERE b.employee_id IS NOT NULL
           AND e.email IS NOT NULL
           AND TRIM(e.email) <> ''
           AND EXISTS (
                 SELECT 1 FROM users u
                 WHERE lower(u.email) = lower(TRIM(e.email))
               )
           AND NOT (
             e.date_of_joining IS NULL AND lower(COALESCE(e.status, 'active')) = 'active'
           )
           AND NOT (
             $2::date IS NOT NULL
             AND lower(COALESCE(e.status, 'active')) = 'active'
             AND NOT EXISTS (
                   SELECT 1 FROM daily_attendance d
                   WHERE d.employee_id = e.id
                     AND d.attendance_date BETWEEN $2::date AND $3::date
                 )
           )
       )::int AS payroll_ready_count
     FROM employees e
     LEFT JOIN salary_base_profiles b
       ON b.employee_id = e.id AND b.company = $1
     WHERE (e.company = $1 OR e.company IS NULL OR e.company = '')
       ${idClause}`,
    params,
  );

  return {
    total: rows[0]?.total ?? 0,
    missingBaseSalary: rows[0]?.missing_base ?? 0,
    unlinkedEmail: rows[0]?.unlinked_email ?? 0,
    missingDoj: rows[0]?.missing_doj ?? 0,
    absentFromRegister: rows[0]?.absent_from_register ?? 0,
    payrollReadyCount: rows[0]?.payroll_ready_count ?? 0,
  };
}

async function loadTeamHealthStats(): Promise<DashboardSummary["teams"]> {
  const rows = await query<{ without_manager: number; without_members: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE t.manager_user_id IS NULL)::int AS without_manager,
       COUNT(*) FILTER (WHERE COALESCE(m.member_count, 0) = 0)::int AS without_members
     FROM teams t
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS member_count
       FROM employees e
       WHERE e.team_id = t.id AND lower(COALESCE(e.status, 'active')) = 'active'
     ) m ON TRUE`,
  );
  return {
    withoutManager: rows[0]?.without_manager ?? 0,
    withoutMembers: rows[0]?.without_members ?? 0,
  };
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}


function recentRequestHref(kind: DashboardRecentRequestKind): string {
  if (kind === "leave") return "/leave-request?tab=mine";
  if (kind === "reimbursement") return "/reimbursement?tab=mine";
  return "/in-out-request?tab=mine";
}

async function loadRecentMyRequests(
  userId: number,
  dateFrom?: string,
  dateTo?: string,
): Promise<DashboardRecentRequest[]> {
  const dateClause =
    dateFrom && dateTo
      ? ` AND merged.submitted_at::date BETWEEN $2::date AND $3::date`
      : "";
  const params: unknown[] = [userId];
  if (dateFrom && dateTo) params.push(dateFrom, dateTo);

  const rows = await query<{
    kind: DashboardRecentRequestKind;
    id: number;
    status: string;
    submitted_at: string;
    leave_type: string | null;
    start_date: string | null;
    end_date: string | null;
    category: string | null;
    amount: string | null;
    expense_date: string | null;
    attendance_date: string | null;
  }>(
    `SELECT kind, id, status, submitted_at, leave_type, start_date, end_date, category, amount, expense_date, attendance_date FROM (
       SELECT 'leave'::text AS kind,
              id,
              status::text AS status,
              created_at AS submitted_at,
              leave_type::text AS leave_type,
              start_date::text AS start_date,
              end_date::text AS end_date,
              NULL::text AS category,
              NULL::text AS amount,
              NULL::text AS expense_date,
              NULL::text AS attendance_date
       FROM leave_requests
       WHERE requester_user_id = $1
       UNION ALL
       SELECT 'reimbursement'::text,
              id,
              status::text,
              created_at,
              NULL,
              NULL,
              NULL,
              category::text,
              TRIM(to_char(amount, '999999990.99')),
              expense_date::text,
              NULL
       FROM reimbursement_requests
       WHERE requester_user_id = $1
       UNION ALL
       SELECT 'portalPunch'::text,
              id,
              status::text,
              COALESCE(updated_at, created_at),
              NULL,
              NULL,
              NULL,
              NULL,
              NULL,
              NULL,
              attendance_date::text
       FROM portal_punch_days
       WHERE requester_user_id = $1
     ) merged
     WHERE 1=1${dateClause}
     ORDER BY submitted_at DESC, id DESC
     LIMIT 8`,
    params,
  );

  return rows.map((row) => {
    let summary = "";
    if (row.kind === "leave" && row.leave_type && row.start_date && row.end_date) {
      summary = `${row.leave_type.toUpperCase()} · ${formatDisplayDateRange(row.start_date, row.end_date)}`;
    } else if (row.kind === "reimbursement" && row.category && row.amount && row.expense_date) {
      summary = `${row.category} · ₹${row.amount} · ${formatDisplayDate(row.expense_date)}`;
    } else if (row.kind === "portalPunch" && row.attendance_date) {
      summary = `In/out · ${formatDisplayDate(row.attendance_date)}`;
    }
    return {
      kind: row.kind,
      id: row.id,
      status: row.status,
      summary: summary || "Request",
      submittedAt: row.submitted_at,
      href: recentRequestHref(row.kind),
    };
  });
}

async function loadMyRequestCounts(
  userId: number,
  period?: { dateFrom: string; dateTo: string },
): Promise<DashboardMyRequests> {
  const dateClause = period
    ? ` AND created_at::date BETWEEN $2::date AND $3::date`
    : "";
  const dateParams = period ? [period.dateFrom, period.dateTo] : [];
  const [leaveRow, reimbRow] = await Promise.all([
    queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM leave_requests WHERE requester_user_id = $1 AND status = 'pending'${dateClause}`,
      [userId, ...dateParams],
    ),
    queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM reimbursement_requests WHERE requester_user_id = $1 AND status = 'pending'${dateClause}`,
      [userId, ...dateParams],
    ),
  ]);
  const leavePending = leaveRow?.n ?? 0;
  const reimbursementPending = reimbRow?.n ?? 0;
  return {
    leavePending,
    reimbursementPending,
    totalPending: leavePending + reimbursementPending,
  };
}

function filterPendingByEmployees<T extends { employeeId?: number }>(
  items: T[],
  employeeIds: number[] | null,
): T[] {
  if (employeeIds == null) return items;
  if (employeeIds.length === 0) return [];
  return items.filter((item) => item.employeeId != null && employeeIds.includes(item.employeeId));
}

async function loadPendingApprovalCounts(
  user: AuthUser,
  employeeIds: number[] | null,
): Promise<DashboardPendingApprovals | null> {
  if (employeeIds != null && employeeIds.length === 0) {
    return { leave: 0, reimbursement: 0, portalPunch: 0 };
  }

  if (userCanEdit(user)) {
    const params: unknown[] = [];
    let leaveEmp = "";
    let reimbEmp = "";
    let punchEmp = "";
    if (employeeIds != null) {
      params.push(employeeIds);
      leaveEmp = ` AND employee_id = ANY($1::int[])`;
      reimbEmp = leaveEmp;
      punchEmp = leaveEmp;
    }
    const [leaveRow, reimbRow, punchRow] = await Promise.all([
      queryOne<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM leave_requests WHERE status = 'pending'${leaveEmp}`,
        params,
      ),
      queryOne<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM reimbursement_requests WHERE status = 'pending'${reimbEmp}`,
        params,
      ),
      queryOne<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM portal_punch_days
         WHERE (in_status = 'pending' OR out_status = 'pending')${punchEmp}`,
        params,
      ),
    ]);
    return {
      leave: leaveRow?.n ?? 0,
      reimbursement: reimbRow?.n ?? 0,
      portalPunch: punchRow?.n ?? 0,
    };
  }

  const caps = requestCapabilities(user);
  if (!caps.canViewPendingApproval && !isExecutiveLeaveApprover(user)) {
    return null;
  }

  const [leaveList, reimbList, punchList] = await Promise.all([
    listPendingApprovalForUser(user),
    listPendingReimbursementForUser(user),
    listPendingPortalPunches(user),
  ]);
  return {
    leave: filterPendingByEmployees(leaveList, employeeIds).length,
    reimbursement: filterPendingByEmployees(reimbList, employeeIds).length,
    portalPunch: filterPendingByEmployees(punchList, employeeIds).length,
  };
}

async function loadEmployeeSnapshot(
  employeeId: number | null,
  year: number,
  month: number,
): Promise<DashboardEmployeeSnapshot> {
  if (employeeId == null) {
    return {
      linked: false,
      hasAttendance: false,
      payDays: null,
      wfhDays: null,
      lateMarks: null,
      hasPayslip: false,
    };
  }

  const mk = monthKey(year, month);
  const payslipRow = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM salary_records WHERE employee_id = $1 AND month = $2`,
    [employeeId, mk],
  );

  const snapshot = await withTransaction(async (client) => {
    const attendance = await loadPmAttendanceSnapshotForSalary(client, employeeId, year, month);
    const dailyRow = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM daily_attendance d
       WHERE d.employee_id = $1
         AND d.attendance_date BETWEEN $2 AND $3`,
      [employeeId, isoDate(year, month, 1), isoDate(year, month, daysInMonth(year, month))],
    );
    return {
      hasAttendance: (dailyRow.rows[0]?.n ?? 0) > 0,
      payDays: attendance.payDays,
      wfhDays: attendance.wfhDays,
      lateMarks: attendance.lateMarkCount,
    };
  });

  return {
    linked: true,
    hasAttendance: snapshot.hasAttendance,
    payDays: snapshot.payDays,
    wfhDays: snapshot.wfhDays,
    lateMarks: snapshot.lateMarks,
    hasPayslip: (payslipRow?.n ?? 0) > 0,
    baselineInsight: await buildEmployeePayDaysBaselineInsight({
      employeeId,
      year,
      month,
      fullMonthPayDays: snapshot.payDays,
      hasAttendance: snapshot.hasAttendance,
    }),
  };
}

function appendWorkflowActions(
  actions: DashboardAction[],
  input: {
    view: DashboardView;
    userEmail: string;
    pendingApprovals: DashboardPendingApprovals | null;
    myRequests: DashboardMyRequests | null;
    employeeSnapshot: DashboardEmployeeSnapshot | null;
  },
): void {
  if (input.myRequests && input.myRequests.totalPending > 0) {
    actions.push({
      id: "my-requests-pending",
      severity: "info",
      message: `You have ${input.myRequests.totalPending} request${input.myRequests.totalPending === 1 ? "" : "s"} pending approval (leave, reimbursement, or in/out).`,
      href: "/leave-request?tab=mine",
      actionLabel: "View my requests",
    });
  }

  if (input.view === "employee" && input.employeeSnapshot && !input.employeeSnapshot.linked) {
    const email = input.employeeSnapshot.loginEmail ?? input.userEmail;
    actions.unshift({
      id: "profile-unlinked",
      severity: "warning",
      message: email
        ? `Your sign-in email (${email}) must match the work email on your employee record in HR. Until they match, attendance, leave, and payslips will not work.`
        : "Your login is not linked to an employee record. Ask HR to set your work email in People to the same address you use to sign in.",
      href: "/settings",
      actionLabel: "View profile in Settings",
    });
  }
}

function weeksFullyApprovedForPayroll(attendance: DashboardSummary["attendance"]): boolean {
  if (attendance.weeklyCalendarWeeksTotal > 0) {
    return (
      attendance.weeklyCalendarWeeksComplete === attendance.weeklyCalendarWeeksTotal &&
      attendance.weeklyPending === 0
    );
  }
  return attendance.weeklyTotal > 0 && attendance.weeklyPending === 0;
}

function payrollFullySaved(salary: NonNullable<DashboardSummary["salary"]>): boolean {
  if (salary.attendanceStale) return false;
  const total = salary.totalRows;
  if (total > 0) {
    return (
      salary.savedPayrollCount >= total &&
      salary.errorRows === 0 &&
      salary.blockedByApproval === 0
    );
  }
  return salary.hasResults && salary.savedPayrollCount > 0;
}

function peoplePayrollReadyDone(people: DashboardSummary["people"]): boolean {
  if (!people || people.total <= 0) return false;
  return people.payrollReadyCount >= people.total;
}

function buildPayrollChecklist(input: {
  attendance: DashboardSummary["attendance"];
  salary: NonNullable<DashboardSummary["salary"]>;
  people: DashboardSummary["people"];
  isAdmin: boolean;
}): DashboardChecklistItem[] {
  const { attendance, salary, people } = input;
  const missingBase = people?.missingBaseSalary ?? 0;
  const unlinkedEmail = people?.unlinkedEmail ?? 0;
  const missingDoj = people?.missingDoj ?? 0;
  const absentFromRegister = people?.absentFromRegister ?? 0;

  const uploadDone = attendance.hasData;
  const weeksExist =
    attendance.weeklyCalendarWeeksTotal > 0 || attendance.weeklyTotal > 0;
  const weeksApproved = weeksFullyApprovedForPayroll(attendance);
  const weeksBlocked = uploadDone && !weeksExist;
  const rosterTotal = people?.total ?? 0;
  const peopleReadyCount = people?.payrollReadyCount ?? 0;
  const peopleBaseDone = missingBase === 0;
  const peopleEmailDone = unlinkedEmail === 0;
  const peopleDojDone = missingDoj === 0;
  const peopleRegisterDone = !attendance.hasData || absentFromRegister === 0;
  const peopleProfileDone = peoplePayrollReadyDone(people);
  const sheetReady = salary.hasAttendanceData;
  const sheetErrors = salary.errorRows;
  const sheetErrorsDone = !sheetReady || sheetErrors === 0;
  const blockedByWeeks = salary.blockedByApproval > 0;
  const calcDone = payrollFullySaved(salary);
  const calcReady =
    sheetReady &&
    weeksApproved &&
    sheetErrorsDone &&
    peopleProfileDone &&
    !calcDone &&
    !salary.attendanceStale;
  const exportDone = calcDone;

  const items: DashboardChecklistItem[] = [
    {
      id: "upload-attendance",
      step: 1,
      title: "Upload attendance register",
      detail: uploadDone
        ? `${attendance.employeeCount} people have daily records for this month.`
        : "Upload the monthly/daily ESSL register first. Payroll pay days come from daily attendance.",
      status: uploadDone ? "done" : "todo",
      href: "/attendance?tab=upload",
      actionLabel: uploadDone ? "Open attendance" : "Upload register",
    },
    {
      id: "approve-weeks",
      step: 2,
      title: "Approve & lock weeks",
      detail: !uploadDone
        ? "Upload attendance before weekly approval."
        : weeksBlocked
          ? "Daily data is loaded, but there are no weekly rows yet. Open or upload the weekly register - salary calculation requires approved/locked weeks."
          : weeksApproved
            ? `All ${attendance.weeklyCalendarWeeksTotal} week${attendance.weeklyCalendarWeeksTotal === 1 ? "" : "s"} in this period are approved/locked for everyone on register.`
            : `${attendance.weeklyCalendarWeeksComplete} of ${attendance.weeklyCalendarWeeksTotal} week${attendance.weeklyCalendarWeeksTotal === 1 ? "" : "s"} fully approved - open Weekly register and approve each week for all people.`,
      status: !uploadDone ? "blocked" : weeksApproved ? "done" : "todo",
      href: "/attendance?tab=weekly",
      actionLabel: weeksApproved ? "Review weeks" : "Approve weeks",
    },
    {
      id: "people-payroll-ready",
      step: 3,
      title: "People ready for payroll",
      detail: peopleProfileDone
        ? `${peopleReadyCount} of ${rosterTotal} employee${rosterTotal === 1 ? "" : "s"} payroll-ready (base, email/login, DOJ, register).`
        : [
            `${peopleReadyCount}/${rosterTotal} payroll-ready`,
            !peopleBaseDone
              ? `${missingBase} missing base salary (In Hand / PF / PT)`
              : null,
            !peopleDojDone
              ? `${missingDoj} active employee${missingDoj === 1 ? "" : "s"} missing date of joining`
              : null,
            !peopleEmailDone
              ? `${unlinkedEmail} missing work email or dashboard login`
              : null,
            attendance.hasData && !peopleRegisterDone
              ? `${absentFromRegister} active in People but not in this month’s attendance register`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Review people data before calculating.",
      status: peopleProfileDone ? "done" : "todo",
      href: input.isAdmin ? "/admin?section=people" : "/salary?section=sheet",
      actionLabel: peopleProfileDone ? "Open People" : "Fix in People",
    },
    {
      id: "sheet-errors",
      step: 4,
      title: "Fix salary sheet errors",
      detail: !sheetReady
        ? "Load attendance first; the sheet builds from people + attendance."
        : sheetErrors > 0
          ? `${sheetErrors} row${sheetErrors === 1 ? "" : "s"} have errors${
              blockedByWeeks
                ? ` (${salary.blockedByApproval} blocked until weeks are approved)`
                : ""
            }. Fix before calculate.`
          : blockedByWeeks
            ? `${salary.blockedByApproval} row${salary.blockedByApproval === 1 ? "" : "s"} still wait on weekly approval.`
            : `${salary.matchedRows} of ${salary.totalRows} rows ready to calculate.`,
      status: !sheetReady
        ? "blocked"
        : sheetErrors > 0 || blockedByWeeks
          ? "todo"
          : "done",
      href: "/salary?section=sheet",
      actionLabel: sheetErrors > 0 ? "Fix sheet errors" : "Open sheet",
    },
    {
      id: "calculate-payroll",
      step: 5,
      title: "Calculate payroll",
      detail: salary.attendanceStale
        ? salary.staleMessage ??
          "Attendance changed after the last run - recalculate so results match the register."
        : calcDone
          ? salary.totalRows > 0
            ? `Payroll saved for ${salary.savedPayrollCount} of ${salary.totalRows} on the salary sheet.`
            : `Payroll saved for ${salary.savedPayrollCount} employee${salary.savedPayrollCount === 1 ? "" : "s"}.`
          : calcReady
            ? "Sheet is ready. Run calculate to save results for this month."
            : salary.savedPayrollCount > 0 && salary.totalRows > 0
              ? `${salary.savedPayrollCount} of ${salary.totalRows} payslips saved - finish the rest on Salary.`
              : "Complete upload, week approvals, people data, and sheet errors first.",
      status: calcDone ? "done" : calcReady || salary.attendanceStale ? "todo" : "blocked",
      href: "/salary?section=sheet",
      actionLabel: salary.attendanceStale ? "Recalculate" : calcDone ? "Open salary" : "Run payroll",
    },
    {
      id: "export-results",
      step: 6,
      title: "Review & export results",
      detail: exportDone
        ? "Results are available to review and export."
        : "Available after a successful calculate.",
      status: exportDone ? "done" : "blocked",
      href: "/salary?section=results",
      actionLabel: "Open results",
    },
  ];

  return items;
}

function buildActions(input: {
  view: DashboardView;
  userEmail: string;
  canEdit: boolean;
  isAdmin: boolean;
  attendance: DashboardSummary["attendance"];
  salary: NonNullable<DashboardSummary["salary"]>;
  people: DashboardSummary["people"];
  teams: DashboardSummary["teams"];
  pendingApprovals: DashboardPendingApprovals | null;
  myRequests: DashboardMyRequests | null;
  employeeSnapshot: DashboardEmployeeSnapshot | null;
}): DashboardAction[] {
  const actions: DashboardAction[] = [];

  if (input.view === "operations" && input.teams) {
    const { withoutManager, withoutMembers } = input.teams;
    if (withoutManager > 0 || withoutMembers > 0) {
      const parts: string[] = [];
      if (withoutManager > 0) {
        parts.push(
          `${withoutManager} team${withoutManager === 1 ? "" : "s"} without a manager`,
        );
      }
      if (withoutMembers > 0) {
        parts.push(
          `${withoutMembers} team${withoutMembers === 1 ? "" : "s"} with no active members`,
        );
      }
      actions.push({
        id: "teams-need-setup",
        severity: "warning",
        message: `${parts.join("; ")} - manager visibility and attendance filters may be wrong.`,
        href: "/admin?section=teams",
        actionLabel: "Assign teams",
      });
    }
  }

  if (input.view === "operations" && input.people && input.people.unlinkedEmail > 0) {
    actions.unshift({
      id: "people-email-login-mismatch",
      severity: "warning",
      message: `${input.people.unlinkedEmail} ${input.people.unlinkedEmail === 1 ? "person" : "people"}: work email doesn’t match dashboard login.`,
      href: "/admin?section=people&filter=unlinked-email",
      actionLabel: "Fix in People",
    });
  }

  if (input.view === "operations" && input.people) {
    const { missingDoj, absentFromRegister } = input.people;
    if (missingDoj > 0) {
      actions.push({
        id: "people-missing-doj",
        severity: "warning",
        message: `${missingDoj} active employee${missingDoj === 1 ? "" : "s"} missing date of joining - payroll pro-rata and tenure rules need DOJ.`,
        href: "/admin?section=people&filter=missing-doj",
        actionLabel: "Fix in People",
      });
    }
    if (input.attendance.hasData && absentFromRegister > 0) {
      actions.push({
        id: "people-not-in-register",
        severity: "warning",
        message: `${absentFromRegister} active employee${absentFromRegister === 1 ? "" : "s"} in People but not in this month’s uploaded register - check codes match ESSL.`,
        href: "/admin?section=people&filter=not-in-register",
        actionLabel: "Review in People",
      });
    }
  }

  // Operations uses the ordered checklist; keep only cross-cutting nudges here.
  if (input.view === "operations" && input.pendingApprovals) {
    const total =
      input.pendingApprovals.leave +
      input.pendingApprovals.reimbursement +
      input.pendingApprovals.portalPunch;
    if (total > 0) {
      actions.push({
        id: "approvals-pending",
        severity: "info",
        message: `${total} request${total === 1 ? "" : "s"} awaiting approval (leave, reimbursement, or in/out).`,
        href: "/leave-request?tab=pending",
        actionLabel: "Review requests",
      });
    }
  }

  if (input.view === "manager") {
    if (!input.attendance.hasData) {
      actions.push({
        id: "team-attendance-missing",
        severity: "warning",
        message: "No attendance uploaded for your team this month yet.",
        href: "/attendance",
        actionLabel: "Open attendance",
      });
    } else if (input.attendance.weeklyCalendarWeeksTotal > 0) {
      const pendingWeeks = Math.max(
        0,
        input.attendance.weeklyCalendarWeeksTotal - input.attendance.weeklyCalendarWeeksComplete,
      );
      if (pendingWeeks > 0) {
        actions.push({
          id: "weekly-pending",
          severity: "info",
          message: `${pendingWeeks} calendar week${pendingWeeks === 1 ? "" : "s"} not fully approved for your team.`,
          href: "/attendance?tab=weekly",
          actionLabel: "Approve weeks",
        });
      }
    } else if (input.attendance.weeklyPending > 0) {
      actions.push({
        id: "weekly-pending",
        severity: "info",
        message: "Weekly approvals still open for your team.",
        href: "/attendance?tab=weekly",
        actionLabel: "Approve weeks",
      });
    }
  }

  if (input.view === "employee") {
    if (input.employeeSnapshot?.linked && !input.employeeSnapshot.hasAttendance) {
      actions.push({
        id: "my-attendance-missing",
        severity: "info",
        message: "HR has not published your attendance for this month yet.",
        href: "/attendance",
        actionLabel: "Open attendance",
      });
    }
    const PAYSLIP_SELF_SERVICE_LIVE = false;
    if (PAYSLIP_SELF_SERVICE_LIVE && input.employeeSnapshot?.hasPayslip) {
      actions.push({
        id: "payslip-ready",
        severity: "info",
        message: "Your pay slip for this month is ready to view.",
        href: "/payslip",
        actionLabel: "View pay slip",
      });
    }
  }

  appendWorkflowActions(actions, {
    view: input.view,
    userEmail: input.userEmail,
    pendingApprovals: input.pendingApprovals,
    myRequests: input.myRequests,
    employeeSnapshot: input.employeeSnapshot,
  });

  return actions;
}

export function canUseDashboardDateFilters(user: AuthUser): boolean {
  if (userIsManager(user)) return true;
  return isManagementRequestOversight(user);
}

export async function getDashboardNotifications(input: Parameters<typeof getDashboardSummary>[0]): Promise<{
  notifications: DashboardNotification[];
  notificationsMeta: DashboardNotificationsMeta;
}> {
  const summary = await getDashboardSummary(input);
  return {
    notifications: summary.notifications,
    notificationsMeta: summary.notificationsMeta,
  };
}

export async function listDashboardEmployeeFilterOptions(
  user: AuthUser,
  company: string,
): Promise<Array<{ id: number; name: string; code: string | null }>> {
  if (!canUseDashboardDateFilters(user)) {
    throw Object.assign(new Error("Not allowed"), { status: 403 });
  }
  const scope = await resolveAttendanceScope(user);
  const restrictIds = scope.restrictToEmployeeIds;
  const co = company.trim() || "PM";

  if (restrictIds != null && restrictIds.length === 0) {
    return [];
  }

  if (restrictIds != null) {
    const rows = await query<{ id: number; name: string; code: string | null }>(
      `SELECT e.id, e.name, e.employee_code AS code
       FROM employees e
       WHERE e.id = ANY($1::int[])
         AND (e.company = $2 OR e.company IS NULL OR e.company = '')
         AND lower(COALESCE(e.status, 'active')) = 'active'
       ORDER BY e.name`,
      [restrictIds, co],
    );
    return rows;
  }

  const rows = await query<{ id: number; name: string; code: string | null }>(
    `SELECT e.id, e.name, e.employee_code AS code
     FROM employees e
     WHERE (e.company = $1 OR e.company IS NULL OR e.company = '')
       AND lower(COALESCE(e.status, 'active')) = 'active'
     ORDER BY e.name`,
    [co],
  );
  return rows;
}

async function countSavedPayrollForScope(
  year: number,
  month: number,
  company: string,
  restrictIds: number[] | null,
): Promise<number> {
  const mk = monthKey(year, month);
  const companyNorm = company.trim() || "PM";
  if (restrictIds != null && restrictIds.length === 0) return 0;
  if (restrictIds != null) {
    const row = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM salary_records s
       JOIN employees e ON e.id = s.employee_id
       WHERE s.month = $1
         AND s.employee_id = ANY($2::int[])
         AND (e.company = $3 OR e.company IS NULL OR e.company = '')`,
      [mk, restrictIds, companyNorm],
    );
    return row?.n ?? 0;
  }
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM salary_records s
     JOIN employees e ON e.id = s.employee_id
     WHERE s.month = $1
       AND (e.company = $2 OR e.company IS NULL OR e.company = '')`,
    [mk, companyNorm],
  );
  return row?.n ?? 0;
}

async function hasAttendanceInScopeForPayrollMonth(
  year: number,
  month: number,
  company: string,
  restrictIds: number[] | null,
): Promise<boolean> {
  if (restrictIds != null && restrictIds.length === 0) return false;
  if (restrictIds == null) {
    return hasAttendanceDataForPeriod(year, month, company);
  }
  const dim = daysInMonth(year, month);
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, dim);
  const companyNorm = company.trim() || "PM";
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM daily_attendance d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.attendance_date BETWEEN $1 AND $2
       AND d.employee_id = ANY($3::int[])
       AND (e.company = $4 OR e.company IS NULL OR e.company = '')`,
    [from, to, restrictIds, companyNorm],
  );
  return (row?.n ?? 0) > 0;
}

function scopeSalarySheetSummary(
  sheet: SalarySheetResponse | null,
  calcStatus: SalaryCalculationStatus,
  restrictIds: number[] | null,
  scopedSavedCount: number,
  scopedHasAttendance: boolean,
): NonNullable<DashboardSummary["salary"]> {
  const rows =
    restrictIds != null
      ? (sheet?.rows ?? []).filter((r) => restrictIds.includes(r.employeeId))
      : sheet?.rows ?? [];
  const matchedRows = rows.filter((r) => r.matched && r.errors.length === 0).length;
  const errorRows = rows.filter((r) => r.errors.length > 0).length;
  const blockedByApproval = rows.filter((r) =>
    r.warnings.some((w) => w.includes("approve and lock weekly attendance")),
  ).length;
  const totalRows = rows.length;
  const hasResults =
    restrictIds != null ? scopedSavedCount > 0 : calcStatus.hasSalaryResults;

  return {
    hasAttendanceData: scopedHasAttendance,
    hasResults,
    attendanceStale: calcStatus.attendanceStale,
    staleMessage: calcStatus.staleMessage,
    matchedRows,
    totalRows,
    errorRows,
    blockedByApproval,
    savedPayrollCount: scopedSavedCount,
  };
}

async function registerHasDataInScope(
  dateFrom: string,
  dateTo: string,
  company: string,
  restrictIds: number[] | null,
): Promise<boolean> {
  if (restrictIds != null && restrictIds.length === 0) return false;
  const scope = employeeScopeSql(company, restrictIds, "e");
  if (scope.clause === "FALSE") return false;
  const fromIdx = scope.params.length + 1;
  const toIdx = scope.params.length + 2;
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM daily_attendance d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.attendance_date BETWEEN $${fromIdx}::date AND $${toIdx}::date
       AND ${scope.clause}`,
    [...scope.params, dateFrom, dateTo],
  );
  return (row?.n ?? 0) > 0;
}

export async function getDashboardSummary(input: {
  year: number;
  month: number;
  company: string;
  user: AuthUser;
  preset?: DashboardRangePreset;
  quarter?: number;
  dateFrom?: string;
  dateTo?: string;
  employeeIds?: number[] | null;
}): Promise<DashboardSummary> {
  const resolved = resolveDashboardPeriod({
    preset: input.preset ?? "monthly",
    year: input.year,
    month: input.month,
    quarter: input.quarter,
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
  });
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }
  const period = resolved;
  const company = input.company.trim() || "PM";
  const canEdit = userCanEdit(input.user);
  const isAdmin = userIsAdmin(input.user);
  const attendanceScope = await resolveAttendanceScope(input.user);
  const restrictIds = resolveDashboardEmployeeScope(
    input.user,
    attendanceScope,
    input.employeeIds ?? null,
  );
  const view = resolveDashboardView(input.user, attendanceScope.mode, canEdit);
  const rosterRestrictIds = resolveDashboardRosterRestrictIds(
    input.user,
    attendanceScope,
    input.employeeIds ?? null,
  );

  const payrollMonth = period.isSingleCalendarMonth
    ? {
        year: Number.parseInt(period.dateFrom.slice(0, 4), 10),
        month: Number.parseInt(period.dateFrom.slice(5, 7), 10),
      }
    : null;

  const employeeId =
    view === "employee"
      ? ((restrictIds?.length ?? 0) > 0
          ? restrictIds![0]!
          : await findEmployeeIdByUserEmail(input.user.email))
      : null;

  const loadSalaryBlock = view === "operations" && payrollMonth != null;
  const loadPersonalRequests = view !== "operations";
  const salaryYear = payrollMonth?.year ?? period.year;
  const salaryMonth = payrollMonth?.month ?? period.month;

  const [attendance, calcStatus, sheet, pendingApprovals, myRequests, employeeSnapshot, recentRequests] =
    await Promise.all([
      loadAttendanceStats(period.dateFrom, period.dateTo, company, restrictIds),
      loadSalaryBlock ? getSalaryCalculationStatus(salaryYear, salaryMonth, company) : Promise.resolve(null),
      loadSalaryBlock
        ? loadSalarySheet({ year: salaryYear, month: salaryMonth, company, withPreview: false }).catch(() => null)
        : Promise.resolve(null),
      loadPendingApprovalCounts(input.user, restrictIds),
      loadPersonalRequests
        ? loadMyRequestCounts(input.user.id, {
            dateFrom: period.dateFrom,
            dateTo: period.dateTo,
          })
        : Promise.resolve(null),
      view === "employee" && payrollMonth
        ? loadEmployeeSnapshot(employeeId, payrollMonth.year, payrollMonth.month)
        : Promise.resolve(null),
      loadPersonalRequests
        ? loadRecentMyRequests(input.user.id, period.dateFrom, period.dateTo)
        : Promise.resolve(null),
    ]);

  let salaryBlock: NonNullable<DashboardSummary["salary"]> | null = null;
  if (loadSalaryBlock && calcStatus) {
    const scopedSaved = await countSavedPayrollForScope(
      salaryYear,
      salaryMonth,
      company,
      restrictIds,
    );
    const scopedHasAttendance = await hasAttendanceInScopeForPayrollMonth(
      salaryYear,
      salaryMonth,
      company,
      restrictIds,
    );
    salaryBlock = scopeSalarySheetSummary(
      sheet,
      calcStatus,
      restrictIds,
      scopedSaved,
      scopedHasAttendance,
    );
  }

  const salary = loadSalaryBlock ? salaryBlock : null;

  const people =
    view === "operations" || view === "manager"
      ? await loadPeopleStats(company, restrictIds, {
          dateFrom: period.dateFrom,
          dateTo: period.dateTo,
          attendanceLoaded: attendance.hasData,
        })
      : null;

  const teams = view === "operations" ? await loadTeamHealthStats() : null;

  const salaryForActions = salary ?? {
    hasAttendanceData: false,
    hasResults: false,
    attendanceStale: false,
    staleMessage: null,
    matchedRows: 0,
    totalRows: 0,
    errorRows: 0,
    blockedByApproval: 0,
    savedPayrollCount: 0,
  };

  let employeeSnapshotOut = employeeSnapshot;
  if (view === "employee" && employeeSnapshotOut && !employeeSnapshotOut.linked) {
    employeeSnapshotOut = {
      ...employeeSnapshotOut,
      loginEmail: input.user.email.trim().toLowerCase(),
    };
  }

  let attendanceOut = attendance;
  if (view === "manager") {
    const teamLateMarks = await teamLateMarkTotalBetween(
      period.dateFrom,
      period.dateTo,
      company,
      restrictIds,
    );
    let teamBaselineInsight: DashboardBaselineInsight | null = null;
    if (period.preset === "monthly" && period.isSingleCalendarMonth) {
      const teamBaseline = await buildManagerTeamLateBaselineInsight({
        year: period.year,
        month: period.month,
        company,
        restrictIds,
        hasTeamAttendance: attendance.hasData,
      });
      teamBaselineInsight = teamBaseline.insight;
    }
    attendanceOut = {
      ...attendance,
      teamLateMarks,
      teamBaselineInsight,
    };
  }

  const actions = buildActions({
    view,
    userEmail: input.user.email,
    canEdit,
    isAdmin,
    attendance: attendanceOut,
    salary: salaryForActions,
    people,
    teams,
    pendingApprovals,
    myRequests,
    employeeSnapshot: employeeSnapshotOut,
  });

  const checklist =
    view === "operations" && payrollMonth != null
      ? buildPayrollChecklist({
          attendance: attendanceOut,
          salary: salaryForActions,
          people,
          isAdmin,
        })
      : null;

  let attendanceEmployeeRoster: DashboardAttendanceEmployeeRow[] | null = null;
  let attendanceRosterPatternCompareLabel: string | null = null;
  if (canViewDashboardAttendanceRoster(input.user)) {
    if (rosterRestrictIds != null && rosterRestrictIds.length === 0) {
      attendanceEmployeeRoster = [];
    } else {
      const hasRegisterData = await registerHasDataInScope(
        period.dateFrom,
        period.dateTo,
        company,
        rosterRestrictIds ?? restrictIds,
      );
      attendanceRosterPatternCompareLabel = dashboardPatternCompareLabel(period);
      attendanceEmployeeRoster = await loadDashboardAttendanceEmployeeRoster({
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
        isSingleCalendarMonth: period.isSingleCalendarMonth,
        priorCompareLabel: attendanceRosterPatternCompareLabel,
        company,
        restrictIds: rosterRestrictIds,
        hasRegisterData,
        periodLabel: period.label,
      });
    }
  }

  const { notifications, notificationsMeta } = buildDashboardNotificationsPayload({
    user: input.user,
    view,
    actions,
    checklist: view === "operations" ? checklist : null,
    pendingApprovals,
    salaryStale: salaryForActions.attendanceStale,
  });

  return {
    view,
    period: {
      year: period.year,
      month: period.month,
      company,
      label: period.label,
      preset: period.preset,
      quarter: period.quarter,
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      isSingleCalendarMonth: period.isSingleCalendarMonth,
    },
    attendance: attendanceOut,
    salary: view === "operations" ? salary : null,
    people: view === "operations" || view === "manager" ? people : null,
    pendingApprovals,
    myRequests,
    employeeSnapshot: employeeSnapshotOut,
    recentRequests,
    attendanceEmployeeRoster,
    attendanceRosterPatternCompareLabel,
    actions,
    checklist: view === "operations" ? checklist : null,
    teams: view === "operations" ? teams : null,
    notifications,
    notificationsMeta,
  };
}
