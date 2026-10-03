import { listAppUsers } from "../auth/adminUsers.js";
import { listManagers } from "../auth/managerAssignments.js";
import type { AuthUser } from "../auth/users.js";
import { resolveAttendanceScope } from "../auth/attendanceScope.js";
import { userCanEdit, userIsAdmin } from "../auth/middleware.js";
import { query } from "../db/index.js";
import { pendingWithLabel } from "../employeeRequests/workflow.js";
import { countDaysInRange } from "../leaveRequests/balance.js";
import { isoDate, daysInMonth } from "../persist/helpers.js";
import { getSalaryCalculationStatus } from "../salary/attendanceFingerprint.js";
import { listSalaryResults } from "../salary/salaryService.js";
import {
  formatDisplayDate,
  formatDisplayDateRange,
  formatDisplayDateTime,
} from "../displayDate.js";

export type ReportType = "admin" | "self" | "team" | "leave" | "in-out" | "payroll" | "contact" | "email";

export type ReportColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
};

export type ReportStat = {
  label: string;
  value: string | number;
};

export type ReportTableSection = {
  title: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  emptyMessage?: string;
};

export type ReportResponse = {
  type: ReportType;
  title: string;
  period: {
    year: number;
    month: number;
    company: string;
    label: string;
  };
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  stats?: ReportStat[];
  sections?: ReportTableSection[];
  emptyMessage?: string;
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

const REPORT_TITLES: Record<ReportType, string> = {
  admin: "Admin Report",
  self: "My attendance",
  team: "Team attendance",
  leave: "Leave Report",
  "in-out": "In/Out Report",
  payroll: "Payroll Report",
  contact: "Contact Report",
  email: "Email Report",
};

function dashboardRole(user: AuthUser): string {
  return user.role.trim().toLowerCase();
}

function isEmployeeViewer(user: AuthUser): boolean {
  return dashboardRole(user) === "viewer";
}

export function canAccessReportType(user: AuthUser, type: ReportType): boolean {
  const role = dashboardRole(user);
  if (type === "admin") return role === "admin";
  if (type === "self") return role === "viewer";
  if (type === "team") return role === "admin" || role === "hr" || role === "manager";
  if (type === "leave" || type === "in-out") {
    return role === "admin" || role === "hr" || role === "manager" || role === "viewer";
  }
  return role === "admin" || role === "hr";
}

export function listAccessibleReportTypes(user: AuthUser): ReportType[] {
  const all: ReportType[] = ["admin", "self", "team", "leave", "in-out", "payroll", "contact", "email"];
  return all.filter((type) => canAccessReportType(user, type));
}

function periodLabel(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? "Month"} ${year}`;
}

async function resolveEmployeeScope(
  user: AuthUser,
  company: string,
): Promise<{ clause: string; params: unknown[] }> {
  const scope = await resolveAttendanceScope(user);
  if (scope.restrictToEmployeeIds === null) {
    return {
      clause: `(e.company = $1 OR e.company IS NULL OR e.company = '')`,
      params: [company],
    };
  }
  if (scope.restrictToEmployeeIds.length === 0) {
    return { clause: "FALSE", params: [] };
  }
  return {
    clause: `(e.company = $1 OR e.company IS NULL OR e.company = '') AND e.id = ANY($2::int[])`,
    params: [company, scope.restrictToEmployeeIds],
  };
}

async function loadAdminReport(
  year: number,
  month: number,
  company: string,
): Promise<ReportResponse> {
  const users = await listAppUsers();

  const [{ count: employeeCount }] = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM employees e
     WHERE (e.company = $1 OR e.company IS NULL OR e.company = '')`,
    [company],
  );

  const [{ count: activeCount }] = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM employees e
     WHERE (e.company = $1 OR e.company IS NULL OR e.company = '')
       AND lower(trim(coalesce(e.status, 'active'))) = 'active'`,
    [company],
  );

  const [{ count: uploadCount }] = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM upload_history u
     WHERE u.report_year = $1 AND u.report_month = $2
       AND ($3 = '' OR upper(trim(coalesce(u.company, ''))) = upper($3))`,
    [year, month, company],
  );

  const salaryStatus = await getSalaryCalculationStatus(year, month, company);

  const roleCounts = users.reduce<Record<string, number>>((acc, row) => {
    const role = row.role.trim().toLowerCase();
    acc[role] = (acc[role] ?? 0) + 1;
    return acc;
  }, {});

  const managers = await listManagers();

  return {
    type: "admin",
    title: REPORT_TITLES.admin,
    period: { year, month, company, label: periodLabel(year, month) },
    stats: [
      { label: "Dashboard users", value: users.length },
      { label: "Admins", value: roleCounts.admin ?? 0 },
      { label: "HR users", value: roleCounts.hr ?? 0 },
      { label: "Managers", value: roleCounts.manager ?? 0 },
      { label: "Employees", value: Number(employeeCount) },
      { label: "Active employees", value: Number(activeCount) },
      { label: "Manager assignments", value: managers.reduce((sum, m) => sum + m.assignedCount, 0) },
      { label: "Uploads this month", value: Number(uploadCount) },
      { label: "Payroll saved (this month)", value: salaryStatus.savedPayrollCount },
    ],
    columns: [
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "role", label: "Role" },
      { key: "updatedAt", label: "Updated" },
    ],
    rows: users.map((row) => ({
      name: row.name,
      email: row.email,
      role: row.role,
      updatedAt: formatDisplayDateTime(row.updatedAt) ?? "",
    })),
  };
}

async function loadAttendanceSummaryReport(
  user: AuthUser,
  year: number,
  month: number,
  company: string,
  reportType: "self" | "team",
): Promise<ReportResponse> {
  if (reportType === "self" && !isEmployeeViewer(user)) {
    throw Object.assign(new Error("You do not have access to this report"), { status: 403 });
  }
  if (reportType === "team" && isEmployeeViewer(user)) {
    throw Object.assign(new Error("You do not have access to this report"), { status: 403 });
  }

  const attendanceScope = await resolveAttendanceScope(user);
  const isSelfView = reportType === "self" || attendanceScope.mode === "self";
  const isOrgWide = attendanceScope.mode === "full";

  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, daysInMonth(year, month));
  const scope = await resolveEmployeeScope(user, company);
  const fromIdx = scope.params.length + 1;
  const toIdx = scope.params.length + 2;

  const rows = await query<{
    employee_code: string;
    name: string;
    team_name: string | null;
    days_on_register: string;
    present_days: string;
    late_days: string;
    absent_days: string;
    leave_days: string;
    total_hours: string;
  }>(
    `SELECT
       e.employee_code,
       e.name,
       COALESCE(t.name, 'Unassigned') AS team_name,
       COALESCE(d_agg.days_on_register, 0)::text AS days_on_register,
       COALESCE(d_agg.present_days, 0)::text AS present_days,
       COALESCE(d_agg.late_days, 0)::text AS late_days,
       COALESCE(d_agg.absent_days, 0)::text AS absent_days,
       COALESCE(l_agg.leave_days, 0)::text AS leave_days,
       COALESCE(d_agg.total_hours, 0)::text AS total_hours
     FROM employees e
     LEFT JOIN teams t ON t.id = e.team_id
     LEFT JOIN (
       SELECT
         employee_id,
         COUNT(*)::int AS days_on_register,
         COUNT(*) FILTER (
           WHERE coalesce(working_hours, 0) > 0
              OR (in_time IS NOT NULL AND btrim(in_time) <> '')
              OR lower(btrim(coalesce(status_token, ''))) IN (
                'p', 'present', 'od', 'wfh', 'pl', 'cl', 'sl', 'hl', 'wo', 'weekly off', 'weeklyoff'
              )
         )::int AS present_days,
         COUNT(*) FILTER (WHERE late = 1)::int AS late_days,
         COUNT(*) FILTER (
           WHERE lower(btrim(coalesce(daily_status, ''))) = 'absent'
              OR lower(btrim(coalesce(status_token, ''))) IN ('a', 'abs', 'absent')
         )::int AS absent_days,
         COALESCE(SUM(working_hours), 0) AS total_hours
       FROM daily_attendance
       WHERE attendance_date BETWEEN $${fromIdx}::date AND $${toIdx}::date
       GROUP BY employee_id
     ) d_agg ON d_agg.employee_id = e.id
     LEFT JOIN (
       SELECT employee_id, COUNT(*)::int AS leave_days
       FROM leave_records
       WHERE date BETWEEN $${fromIdx}::date AND $${toIdx}::date
       GROUP BY employee_id
     ) l_agg ON l_agg.employee_id = e.id
     WHERE ${scope.clause}
     ORDER BY COALESCE(t.sort_order, 9999), t.name NULLS LAST, e.employee_code`,
    [...scope.params, from, to],
  );

  const totalLate = rows.reduce((sum, row) => sum + Number(row.late_days), 0);
  const totalAbsent = rows.reduce((sum, row) => sum + Number(row.absent_days), 0);
  const totalHours = rows.reduce((sum, row) => sum + Number(row.total_hours), 0);
  const onRegister = rows.filter((row) => Number(row.days_on_register) > 0).length;

  const teamStatSuffix = isSelfView ? "" : isOrgWide ? "" : " (team)";

  const stats: ReportStat[] = isSelfView
    ? [
        {
          label: "Days on register",
          value: rows.reduce((sum, row) => sum + Number(row.days_on_register), 0),
        },
        {
          label: "Present days",
          value: rows.reduce((sum, row) => sum + Number(row.present_days), 0),
        },
        { label: "Late days", value: totalLate },
        { label: "Absent days", value: totalAbsent },
        { label: "Worked hours", value: Number(totalHours.toFixed(1)) },
      ]
    : [
        { label: "People", value: rows.length },
        { label: "On monthly register", value: onRegister },
        { label: `Late days${teamStatSuffix}`, value: totalLate },
        { label: `Absent days${teamStatSuffix}`, value: totalAbsent },
        { label: `Worked hours${teamStatSuffix}`, value: Number(totalHours.toFixed(1)) },
      ];

  const columns: ReportColumn[] = isSelfView
    ? [
        { key: "employeeCode", label: "Code" },
        { key: "name", label: "Name" },
        { key: "daysOnRegister", label: "Days on register", align: "right" },
        { key: "presentDays", label: "Present days", align: "right" },
        { key: "lateDays", label: "Late days", align: "right" },
        { key: "absentDays", label: "Absent days", align: "right" },
        { key: "leaveDays", label: "Leave days", align: "right" },
        { key: "totalHours", label: "Total worked hours", align: "right" },
      ]
    : [
        { key: "teamName", label: "Team" },
        { key: "employeeCode", label: "Code" },
        { key: "name", label: "Name" },
        { key: "daysOnRegister", label: "Days on register", align: "right" },
        { key: "presentDays", label: "Present days", align: "right" },
        { key: "lateDays", label: "Late days", align: "right" },
        { key: "absentDays", label: "Absent days", align: "right" },
        { key: "leaveDays", label: "Leave days", align: "right" },
        { key: "totalHours", label: "Total worked hours", align: "right" },
      ];

  const mappedRows = isSelfView
    ? rows.map((row) => ({
        employeeCode: row.employee_code,
        name: row.name,
        daysOnRegister: Number(row.days_on_register),
        presentDays: Number(row.present_days),
        lateDays: Number(row.late_days),
        absentDays: Number(row.absent_days),
        leaveDays: Number(row.leave_days),
        totalHours: Number(Number(row.total_hours).toFixed(1)),
      }))
    : rows.map((row) => ({
        teamName: row.team_name ?? "Unassigned",
        employeeCode: row.employee_code,
        name: row.name,
        daysOnRegister: Number(row.days_on_register),
        presentDays: Number(row.present_days),
        lateDays: Number(row.late_days),
        absentDays: Number(row.absent_days),
        leaveDays: Number(row.leave_days),
        totalHours: Number(Number(row.total_hours).toFixed(1)),
      }));

  const title = isSelfView
    ? REPORT_TITLES.self
    : isOrgWide
      ? "Attendance report"
      : REPORT_TITLES.team;

  return {
    type: reportType,
    title,
    period: { year, month, company, label: periodLabel(year, month) },
    stats,
    columns,
    rows: mappedRows,
    emptyMessage: isSelfView
      ? rows.length === 0
        ? "No attendance on the saved register for this month yet."
        : undefined
      : rows.length === 0
        ? "No people in scope for this period."
        : undefined,
  };
}

function portalPunchStatusLabel(status: string): string {
  if (status === "open") return "Checked in";
  if (status === "pending") return "Pending approval";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  return status;
}

function leaveRequestStatusLabel(status: string): string {
  if (status === "pending") return "Pending";
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "cancelled") return "Cancelled";
  return status;
}

function leaveTypeLabel(type: string): string {
  const t = type.trim().toLowerCase();
  if (t === "pl") return "PL";
  if (t === "sl") return "SL";
  if (t === "cl") return "CL";
  return type.toUpperCase();
}

async function loadLeaveReport(
  user: AuthUser,
  year: number,
  month: number,
  company: string,
): Promise<ReportResponse> {
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, daysInMonth(year, month));
  const scope = await resolveEmployeeScope(user, company);
  const attendanceScope = await resolveAttendanceScope(user);
  const isSelfView = attendanceScope.mode === "self";

  const requestRows = await query<{
    employee_code: string;
    name: string;
    leave_type: string;
    start_date: string;
    end_date: string;
    reason: string;
    status: string;
    approval_tier: string;
    assigned_approver_name: string | null;
    created_at: string;
    decided_by_name: string | null;
    decided_at: string | null;
  }>(
    `SELECT e.employee_code, e.name, r.leave_type, r.start_date::text AS start_date,
            r.end_date::text AS end_date, r.reason, r.status, r.approval_tier,
            au.name AS assigned_approver_name, r.created_at,
            du.name AS decided_by_name, r.decided_at
     FROM leave_requests r
     JOIN employees e ON e.id = r.employee_id
     LEFT JOIN users au ON au.id = r.assigned_approver_user_id
     LEFT JOIN users du ON du.id = r.decided_by_user_id
     WHERE r.start_date <= $${scope.params.length + 2}::date
       AND r.end_date >= $${scope.params.length + 1}::date
       AND ${scope.clause}
     ORDER BY r.start_date DESC, e.employee_code, r.id DESC`,
    [...scope.params, from, to],
  );

  const pending = requestRows.filter((row) => row.status === "pending").length;
  const approved = requestRows.filter((row) => row.status === "approved").length;
  const rejected = requestRows.filter((row) => row.status === "rejected").length;

  const detailColumns: ReportColumn[] = [
    ...(isSelfView ? [] : [{ key: "employee", label: "Employee" } as ReportColumn]),
    { key: "dates", label: "Dates" },
    { key: "leaveType", label: "Type" },
    { key: "days", label: "Days", align: "right" },
    { key: "status", label: "Status" },
    { key: "pendingWith", label: "Pending with" },
    { key: "submitted", label: "Submitted" },
    { key: "decidedBy", label: "Decided by" },
    { key: "reason", label: "Reason" },
  ];

  const detailRows = requestRows.map((row) => {
    const base = {
      dates: formatDisplayDateRange(row.start_date, row.end_date),
      leaveType: leaveTypeLabel(row.leave_type),
      days: countDaysInRange(row.start_date, row.end_date),
      status: leaveRequestStatusLabel(row.status),
      pendingWith: pendingWithLabel(
        row.status as "pending" | "approved" | "rejected" | "cancelled",
        row.approval_tier as "manager" | "leadership_hr",
        row.assigned_approver_name,
      ),
      submitted: formatDisplayDateTime(row.created_at),
      decidedBy:
        row.decided_by_name ??
        (row.decided_at ? formatDisplayDateTime(row.decided_at) : null),
      reason: row.reason?.trim() ? row.reason.trim() : null,
    };
    if (isSelfView) return base;
    return {
      employee: `${row.name}\n${row.employee_code}`,
      ...base,
    };
  });

  return {
    type: "leave",
    title: isSelfView ? "My leave" : REPORT_TITLES.leave,
    period: { year, month, company, label: periodLabel(year, month) },
    stats: [
      { label: "Requests", value: requestRows.length },
      { label: "Pending", value: pending },
      { label: "Approved", value: approved },
      { label: "Rejected", value: rejected },
    ],
    columns: detailColumns,
    rows: detailRows,
    emptyMessage: isSelfView
      ? "You have no leave requests in this month."
      : requestRows.length === 0
        ? "No leave requests overlap this month."
        : undefined,
  };
}

async function loadPayrollReport(
  year: number,
  month: number,
  company: string,
): Promise<ReportResponse> {
  const results = await listSalaryResults({ year, month, company });

  return {
    type: "payroll",
    title: REPORT_TITLES.payroll,
    period: { year, month, company, label: periodLabel(year, month) },
    stats: [
      { label: "Rows", value: results.rows.length },
      { label: "Calculated", value: results.hasSalaryResults ? "Yes" : "No" },
      {
        label: "Attendance stale",
        value: results.attendanceStale ? "Yes" : "No",
      },
    ],
    columns: [
      { key: "employeeCode", label: "Code" },
      { key: "employeeName", label: "Name" },
      { key: "grossSalary", label: "Gross", align: "right" },
      { key: "workingDays", label: "Pay days", align: "right" },
      { key: "attendanceDeduction", label: "Deduction", align: "right" },
      { key: "finalSalary", label: "Net pay", align: "right" },
      { key: "status", label: "Status" },
    ],
    rows: results.rows.map((row) => ({
      employeeCode: row.employeeCode,
      employeeName: row.employeeName,
      grossSalary: row.grossSalary,
      workingDays: row.workingDays,
      attendanceDeduction: row.attendanceDeduction,
      finalSalary: row.finalSalary,
      status: row.status,
    })),
    emptyMessage: results.rows.length === 0 ? "Payroll has not been calculated for this month." : undefined,
  };
}

async function loadContactReport(
  user: AuthUser,
  year: number,
  month: number,
  company: string,
): Promise<ReportResponse> {
  void year;
  void month;
  const scope = await resolveEmployeeScope(user, company);

  const rows = await query<{
    employee_code: string;
    name: string;
    email: string | null;
    department: string | null;
    company: string | null;
    status: string;
    shift_start: string | null;
  }>(
    `SELECT e.employee_code, e.name, e.email, e.department, e.company, e.status, e.shift_start
     FROM employees e
     WHERE ${scope.clause}
     ORDER BY e.employee_code`,
    scope.params,
  );

  const missingEmail = rows.filter((row) => !row.email?.trim()).length;

  return {
    type: "contact",
    title: REPORT_TITLES.contact,
    period: { year, month, company, label: periodLabel(year, month) },
    stats: [
      { label: "People", value: rows.length },
      { label: "Missing email", value: missingEmail },
    ],
    columns: [
      { key: "employeeCode", label: "Code" },
      { key: "name", label: "Name" },
      { key: "email", label: "Email" },
      { key: "department", label: "Department" },
      { key: "shiftStart", label: "Shift" },
      { key: "status", label: "Status" },
    ],
    rows: rows.map((row) => ({
      employeeCode: row.employee_code,
      name: row.name,
      email: row.email,
      department: row.department,
      shiftStart: row.shift_start,
      status: row.status,
    })),
    emptyMessage: rows.length === 0 ? "No employee contacts found." : undefined,
  };
}

async function loadEmailReport(
  user: AuthUser,
  year: number,
  month: number,
  company: string,
): Promise<ReportResponse> {
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, daysInMonth(year, month));
  const scope = await resolveEmployeeScope(user, company);

  const rows = await query<{
    employee_code: string;
    name: string;
    kind: string;
    period_key: string;
    to_email: string | null;
    status: string;
    error: string | null;
    sent_at: string;
  }>(
    `SELECT e.employee_code, e.name, n.kind, n.period_key, n.to_email, n.status, n.error, n.sent_at::text
     FROM notification_log n
     JOIN employees e ON e.id = n.employee_id
     WHERE n.period_key BETWEEN $${scope.params.length + 1} AND $${scope.params.length + 2}
       AND ${scope.clause}
     ORDER BY n.sent_at DESC, e.employee_code`,
    [...scope.params, from, to],
  );

  const sent = rows.filter((row) => row.status === "sent").length;
  const failed = rows.filter((row) => row.status === "failed").length;

  return {
    type: "email",
    title: REPORT_TITLES.email,
    period: { year, month, company, label: periodLabel(year, month) },
    stats: [
      { label: "Notifications", value: rows.length },
      { label: "Sent", value: sent },
      { label: "Failed", value: failed },
    ],
    columns: [
      { key: "sentAt", label: "Sent" },
      { key: "employeeCode", label: "Code" },
      { key: "name", label: "Name" },
      { key: "kind", label: "Type" },
      { key: "periodKey", label: "Period" },
      { key: "toEmail", label: "To" },
      { key: "status", label: "Status" },
      { key: "error", label: "Error" },
    ],
    rows: rows.map((row) => ({
      sentAt: formatDisplayDateTime(row.sent_at),
      employeeCode: row.employee_code,
      name: row.name,
      kind: row.kind,
      periodKey: formatDisplayDate(row.period_key),
      toEmail: row.to_email,
      status: row.status,
      error: row.error,
    })),
    emptyMessage: rows.length === 0 ? "No email notifications logged for this month." : undefined,
  };
}

async function loadInOutReport(
  user: AuthUser,
  year: number,
  month: number,
  company: string,
): Promise<ReportResponse> {
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, daysInMonth(year, month));
  const scope = await resolveEmployeeScope(user, company);
  const attendanceScope = await resolveAttendanceScope(user);
  const isSelfView = attendanceScope.mode === "self";

  const rows = await query<{
    id: number;
    employee_code: string;
    name: string;
    attendance_date: string;
    shift_start: string | null;
    in_time: string | null;
    out_time: string | null;
    status: string;
    approval_tier: string;
    assigned_approver_name: string | null;
    created_at: string;
    decided_by_name: string | null;
    decided_at: string | null;
    decision_note: string | null;
  }>(
    `SELECT
       p.id,
       e.employee_code,
       e.name,
       p.attendance_date::text AS attendance_date,
       COALESCE(p.shift_start_snapshot, e.shift_start) AS shift_start,
       p.in_time,
       p.out_time,
       p.status,
       p.approval_tier,
       au.name AS assigned_approver_name,
       p.created_at,
       du.name AS decided_by_name,
       p.decided_at,
       p.decision_note
     FROM portal_punch_days p
     JOIN employees e ON e.id = p.employee_id
     LEFT JOIN users au ON au.id = p.assigned_approver_user_id
     LEFT JOIN users du ON du.id = p.decided_by_user_id
     WHERE p.attendance_date BETWEEN $${scope.params.length + 1} AND $${scope.params.length + 2}
       AND ${scope.clause}
     ORDER BY p.attendance_date DESC, e.employee_code, p.id DESC`,
    [...scope.params, from, to],
  );

  const approved = rows.filter((row) => row.status === "approved").length;
  const pending = rows.filter((row) => row.status === "pending").length;
  const rejected = rows.filter((row) => row.status === "rejected").length;
  const open = rows.filter((row) => row.status === "open").length;

  const columns: ReportColumn[] = [
    { key: "date", label: "Date" },
    ...(isSelfView ? [] : [{ key: "employee", label: "Employee" } as ReportColumn]),
    { key: "inTime", label: "In" },
    { key: "outTime", label: "Out" },
    { key: "shiftStart", label: "Shift" },
    { key: "status", label: "Status" },
    { key: "pendingWith", label: "Pending with" },
    { key: "submitted", label: "Submitted" },
    { key: "decidedBy", label: "Decided by" },
  ];

  const mappedRows = rows.map((row) => {
    const base = {
      date: formatDisplayDate(row.attendance_date),
      inTime: row.in_time ?? "-",
      outTime: row.out_time ?? "-",
      shiftStart: row.shift_start,
      status: portalPunchStatusLabel(row.status),
      pendingWith:
        row.status === "open"
          ? "Awaiting checkout"
          : pendingWithLabel(
              row.status as "pending" | "approved" | "rejected" | "cancelled",
              row.approval_tier as "manager" | "leadership_hr",
              row.assigned_approver_name,
            ),
      submitted: formatDisplayDateTime(row.created_at),
      decidedBy: row.decided_by_name
        ? row.decided_at
          ? `${row.decided_by_name} · ${formatDisplayDateTime(row.decided_at)}`
          : row.decided_by_name
        : row.decided_at
          ? formatDisplayDateTime(row.decided_at)
          : null,
    };
    if (isSelfView) return base;
    return {
      ...base,
      employee: `${row.name}\n${row.employee_code}`,
    };
  });

  return {
    type: "in-out",
    title: isSelfView ? "My in / out" : REPORT_TITLES["in-out"],
    period: { year, month, company, label: periodLabel(year, month) },
    stats: [
      { label: "Requests", value: rows.length },
      { label: "Open", value: open },
      { label: "Pending", value: pending },
      { label: "Approved", value: approved },
      { label: "Rejected", value: rejected },
    ],
    columns,
    rows: mappedRows,
    emptyMessage: isSelfView
      ? "You have no in/out requests for this month."
      : rows.length === 0
        ? "No in/out requests for this month. Data appears when employees use In / out request."
        : undefined,
  };
}

export async function loadReport(input: {
  type: ReportType;
  year: number;
  month: number;
  company: string;
  user: AuthUser;
}): Promise<ReportResponse> {
  const { type, year, month, company, user } = input;

  if (!canAccessReportType(user, type)) {
    throw Object.assign(new Error("You do not have access to this report"), { status: 403 });
  }

  switch (type) {
    case "admin":
      if (!userIsAdmin(user)) {
        throw Object.assign(new Error("Admin access required"), { status: 403 });
      }
      return loadAdminReport(year, month, company);
    case "team":
      return loadAttendanceSummaryReport(user, year, month, company, "team");
    case "self":
      return loadAttendanceSummaryReport(user, year, month, company, "self");
    case "leave":
      return loadLeaveReport(user, year, month, company);
    case "in-out":
      return loadInOutReport(user, year, month, company);
    case "payroll":
      if (!userCanEdit(user)) {
        throw Object.assign(new Error("HR access required"), { status: 403 });
      }
      return loadPayrollReport(year, month, company);
    case "contact":
      if (!userCanEdit(user)) {
        throw Object.assign(new Error("HR access required"), { status: 403 });
      }
      return loadContactReport(user, year, month, company);
    case "email":
      if (!userCanEdit(user)) {
        throw Object.assign(new Error("HR access required"), { status: 403 });
      }
      return loadEmailReport(user, year, month, company);
    default:
      throw Object.assign(new Error("Unknown report type"), { status: 400 });
  }
}
