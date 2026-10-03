import { findEmployeeIdByUserEmail } from "../auth/attendanceScope.js";
import { getAssignedEmployeeIds } from "../auth/managerAssignments.js";
import { userCanEdit, userIsAdmin, userIsManager } from "../auth/middleware.js";
import type { AuthUser } from "../auth/users.js";
import { query, queryOne, withTransaction } from "../db/index.js";
import {
  assertLeaveBalanceForApproval,
  loadLeaveBalancePayload,
  syncApprovedLeaveRequestDays,
} from "./balance.js";
import { applyPortalLeaveRange } from "../persist/portalAttendanceOverlay.js";
import { actorFrom } from "../persist/helpers.js";
import { todayIsoInIndia } from "../portalPunch/windows.js";
import { buildLeaveApplyWarnings } from "./applyChecks.js";
import { LeaveApplyConfirmRequiredError } from "./applyConfirm.js";
import { isExecutiveLeaveApprover } from "../leaveRequests/approvers.js";
import {
  canViewAllRequests,
  isManagementRequestOversight,
  parseDecisionStatus,
  parseIsoDate,
  pendingWithLabel,
  requestCapabilities,
  requireSubmitEmployeeId,
  resolveApprovalRoute,
  resolveManagerUserIdForEmployee,
  userCanDecideRequest,
  type ApprovalTier,
  type RequestStatus,
} from "../employeeRequests/workflow.js";
import { buildLeaveHistorySummary } from "./historySummary.js";
import { notifyManagementOfLeaveRequest } from "./leaveRequestNotify.js";
import {
  loadOversightDirectoryEmployees,
  loadScopeEmployeesByIds,
  type RequestScopeEmployee,
} from "../employeeRequests/scopeEmployees.js";

export type LeaveType = "pl" | "sl" | "cl";
export type LeaveRequestStatus = RequestStatus;

export type LeaveRequestRow = {
  id: number;
  employee_id: number;
  requester_user_id: number;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  status: LeaveRequestStatus;
  approval_tier: ApprovalTier;
  assigned_approver_user_id: number | null;
  decided_by_user_id: number | null;
  decided_at: string | null;
  decision_note: string | null;
  apply_warnings: unknown;
  created_at: string;
  updated_at: string;
  employee_code: string;
  employee_name: string;
  requester_name: string;
  requester_email: string;
  assigned_approver_name: string | null;
  assigned_approver_email: string | null;
  decided_by_name: string | null;
  decided_by_email: string | null;
};

const LEAVE_TYPES = new Set<LeaveType>(["pl", "sl", "cl"]);

function mapRow(row: LeaveRequestRow) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    requesterUserId: row.requester_user_id,
    leaveType: row.leave_type,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    status: row.status,
    approvalTier: row.approval_tier,
    assignedApproverUserId: row.assigned_approver_user_id,
    assignedApproverName: row.assigned_approver_name,
    assignedApproverEmail: row.assigned_approver_email,
    pendingWithLabel: pendingWithLabel(row.status, row.approval_tier, row.assigned_approver_name),
    decidedByUserId: row.decided_by_user_id,
    decidedByName: row.decided_by_name,
    decidedByEmail: row.decided_by_email,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    applyWarnings: parseWarningsJson(row.apply_warnings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    employeeCode: row.employee_code,
    employeeName: row.employee_name,
    requesterName: row.requester_name,
    requesterEmail: row.requester_email,
  };
}

const SELECT_BODY = `
  SELECT r.id, r.employee_id, r.requester_user_id, r.leave_type, r.start_date, r.end_date,
         r.reason, r.status, r.approval_tier, r.assigned_approver_user_id,
         r.decided_by_user_id, r.decided_at, r.decision_note, r.apply_warnings, r.created_at, r.updated_at,
         e.employee_code, e.name AS employee_name,
         ru.name AS requester_name, ru.email AS requester_email,
         au.name AS assigned_approver_name, au.email AS assigned_approver_email,
         du.name AS decided_by_name, du.email AS decided_by_email
  FROM leave_requests r
  JOIN employees e ON e.id = r.employee_id
  JOIN users ru ON ru.id = r.requester_user_id
  LEFT JOIN users au ON au.id = r.assigned_approver_user_id
  LEFT JOIN users du ON du.id = r.decided_by_user_id
`;

export function canViewAllLeaveRequests(user: AuthUser): boolean {
  return canViewAllRequests(user);
}

function parseLeaveType(raw: unknown): LeaveType {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase() as LeaveType;
  if (!LEAVE_TYPES.has(t)) {
    throw Object.assign(new Error("leaveType must be pl, sl, or cl"), { status: 400 });
  }
  return t;
}

function parseWarningsJson(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export async function createLeaveRequest(
  user: AuthUser,
  input: {
    leaveType: unknown;
    startDate: unknown;
    endDate: unknown;
    reason?: unknown;
    acknowledgeWarnings?: unknown;
  },
) {
  const employeeId = await requireSubmitEmployeeId(user, "leave");

  const leaveType = parseLeaveType(input.leaveType);
  const startDate = parseIsoDate(input.startDate, "startDate");
  const endDate = parseIsoDate(input.endDate, "endDate");
  if (endDate < startDate) {
    throw Object.assign(new Error("endDate must be on or after startDate"), { status: 400 });
  }
  const today = todayIsoInIndia();
  if (startDate < today) {
    throw Object.assign(new Error("Leave cannot start before today"), { status: 400 });
  }
  const reason = String(input.reason ?? "").trim();

  await assertLeaveBalanceForApproval({
    employeeId,
    leaveType,
    startDate,
    endDate,
  });

  const applyWarnings = await buildLeaveApplyWarnings({
    employeeId,
    startDate,
    endDate,
  });
  const acknowledge =
    input.acknowledgeWarnings === true ||
    String(input.acknowledgeWarnings ?? "").trim().toLowerCase() === "true";
  if (applyWarnings.length > 0 && !acknowledge) {
    throw new LeaveApplyConfirmRequiredError(applyWarnings);
  }

  const { approvalTier, assignedApproverUserId } = await resolveApprovalRoute(user, employeeId);

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO leave_requests (
       employee_id, requester_user_id, leave_type, start_date, end_date, reason,
       status, approval_tier, assigned_approver_user_id, apply_warnings, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9::jsonb, NOW())
     RETURNING id`,
    [
      employeeId,
      user.id,
      leaveType,
      startDate,
      endDate,
      reason,
      approvalTier,
      assignedApproverUserId,
      JSON.stringify(applyWarnings),
    ],
  );
  if (!inserted) {
    throw Object.assign(new Error("Failed to create leave request"), { status: 500 });
  }

  const row = await queryOne<LeaveRequestRow>(`${SELECT_BODY} WHERE r.id = $1`, [inserted.id]);
  if (!row) {
    throw Object.assign(new Error("Leave request not found after create"), { status: 500 });
  }
  const mapped = mapRow(row);
  void notifyManagementOfLeaveRequest({
    id: mapped.id,
    employeeName: mapped.employeeName,
    employeeCode: mapped.employeeCode,
    requesterName: mapped.requesterName,
    leaveType: mapped.leaveType,
    startDate: mapped.startDate,
    endDate: mapped.endDate,
    reason: mapped.reason,
  }).catch((err) => {
    console.error("[leave-notify] management email failed", err);
  });
  return mapped;
}

export async function listMyLeaveRequests(user: AuthUser) {
  const rows = await query<LeaveRequestRow>(
    `${SELECT_BODY} WHERE r.requester_user_id = $1 ORDER BY r.created_at DESC, r.id DESC`,
    [user.id],
  );
  return rows.map(mapRow);
}

export async function listPendingApprovalForUser(user: AuthUser) {
  const rows: LeaveRequestRow[] = [];

  const managerRows = await query<LeaveRequestRow>(
    `${SELECT_BODY}
     WHERE r.status = 'pending'
       AND r.approval_tier = 'manager'
       AND r.assigned_approver_user_id = $1
     ORDER BY r.start_date ASC, r.id ASC`,
    [user.id],
  );
  rows.push(...managerRows);

  if (isExecutiveLeaveApprover(user)) {
    const execRows = await query<LeaveRequestRow>(
      `${SELECT_BODY}
       WHERE r.status = 'pending' AND r.approval_tier = 'leadership_hr'
       ORDER BY r.start_date ASC, r.id ASC`,
    );
    rows.push(...execRows);
  }

  const seen = new Set<number>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))).map(mapRow);
}

/** Pending queue plus requests this user already approved or rejected (for approver inbox). */
export async function listApprovalInboxForUser(user: AuthUser) {
  const pendingRows = await query<LeaveRequestRow>(
    `${SELECT_BODY}
     WHERE r.status = 'pending'
       AND (
         (r.approval_tier = 'manager' AND r.assigned_approver_user_id = $1)
         OR ($2::boolean AND r.approval_tier = 'leadership_hr')
       )
     ORDER BY r.start_date ASC, r.id ASC`,
    [user.id, isExecutiveLeaveApprover(user)],
  );

  const decidedRows = await query<LeaveRequestRow>(
    `${SELECT_BODY}
     WHERE r.decided_by_user_id = $1 AND r.status IN ('approved', 'rejected')
     ORDER BY r.decided_at DESC NULLS LAST, r.id DESC
     LIMIT 200`,
    [user.id],
  );

  const byId = new Map<number, LeaveRequestRow>();
  for (const row of pendingRows) byId.set(row.id, row);
  for (const row of decidedRows) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }

  const merged = [...byId.values()];
  merged.sort((a, b) => {
    const aPending = a.status === "pending";
    const bPending = b.status === "pending";
    if (aPending !== bPending) return aPending ? -1 : 1;
    if (aPending) {
      return String(a.start_date).localeCompare(String(b.start_date)) || a.id - b.id;
    }
    const aDec = a.decided_at ? new Date(a.decided_at).getTime() : 0;
    const bDec = b.decided_at ? new Date(b.decided_at).getTime() : 0;
    return bDec - aDec || b.id - a.id;
  });

  return merged.map(mapRow);
}

export async function listAllLeaveRequests(user: AuthUser) {
  if (!canViewAllLeaveRequests(user)) {
    throw Object.assign(new Error("You do not have access to all leave requests"), { status: 403 });
  }
  const { requests } = await listScopedLeaveRequestsForViewer(user);
  return requests;
}

export type LeaveScopeEmployee = RequestScopeEmployee;

/** Full leave list for approvers: all employees (oversight) or assigned team (managers). */
export async function listScopedLeaveRequestsForViewer(user: AuthUser, searchRaw?: unknown) {
  const oversight = isManagementRequestOversight(user);
  const isManager = userIsManager(user);
  if (!oversight && !isManager) {
    throw Object.assign(new Error("You do not have access to this leave list"), { status: 403 });
  }

  const search = String(searchRaw ?? "").trim();
  const params: unknown[] = [];
  const conditions: string[] = ["1=1"];

  let teamEmployees: LeaveScopeEmployee[] | undefined;

  if (oversight) {
    teamEmployees = await loadOversightDirectoryEmployees();
  } else {
    const employeeIds = await getAssignedEmployeeIds(user.id);
    teamEmployees = await loadScopeEmployeesByIds(employeeIds);
    if (employeeIds.length === 0) {
      return { scope: "team" as const, requests: [], teamEmployees };
    }
    params.push(employeeIds);
    conditions.push(`r.employee_id = ANY($${params.length}::int[])`);
  }

  if (search.length > 0) {
    params.push(`%${search}%`);
    const i = params.length;
    conditions.push(`(
      e.name ILIKE $${i}
      OR e.employee_code ILIKE $${i}
      OR ru.name ILIKE $${i}
      OR ru.email ILIKE $${i}
      OR COALESCE(r.reason, '') ILIKE $${i}
      OR r.leave_type::text ILIKE $${i}
      OR r.status::text ILIKE $${i}
    )`);
  }

  params.push(5000);
  const limitIdx = params.length;

  const rows = await query<LeaveRequestRow>(
    `${SELECT_BODY}
     WHERE ${conditions.join(" AND ")}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT $${limitIdx}`,
    params,
  );

  return {
    scope: oversight ? ("all" as const) : ("team" as const),
    requests: rows.map(mapRow),
    teamEmployees,
  };
}

async function getLeaveRequestById(id: number): Promise<LeaveRequestRow | null> {
  const row = await queryOne<LeaveRequestRow>(`${SELECT_BODY} WHERE r.id = $1`, [id]);
  return row ?? null;
}

function userCanDecideLeaveRequest(user: AuthUser, row: LeaveRequestRow): boolean {
  return userCanDecideRequest(user, row);
}

export async function decideLeaveRequest(
  user: AuthUser,
  id: number,
  input: { status: unknown; note?: unknown },
) {
  const statusRaw = parseDecisionStatus(input.status);
  const decisionNote = String(input.note ?? "").trim();

  const row = await getLeaveRequestById(id);
  if (!row) {
    throw Object.assign(new Error("Leave request not found"), { status: 404 });
  }
  if (row.requester_user_id === user.id) {
    throw Object.assign(new Error("You cannot approve or reject your own leave request"), {
      status: 403,
    });
  }
  if (!userCanDecideLeaveRequest(user, row)) {
    throw Object.assign(new Error("You are not allowed to decide on this leave request"), {
      status: 403,
    });
  }

  await withTransaction(async (client) => {
    const locked = await client.query<LeaveRequestRow>(
      `${SELECT_BODY} WHERE r.id = $1 AND r.status = 'pending' FOR UPDATE OF r`,
      [id],
    );
    const pendingRow = locked.rows[0];
    if (!pendingRow) {
      throw Object.assign(new Error("Leave request is not pending"), { status: 400 });
    }

    if (statusRaw === "approved") {
      await assertLeaveBalanceForApproval({
        employeeId: pendingRow.employee_id,
        leaveType: pendingRow.leave_type,
        startDate: pendingRow.start_date,
        endDate: pendingRow.end_date,
      });
    }

    const updatedRows = await client.query(
      `UPDATE leave_requests
       SET status = $2, decided_by_user_id = $3, decided_at = NOW(), decision_note = $4, updated_at = NOW()
       WHERE id = $1 AND status = 'pending'`,
      [id, statusRaw, user.id, decisionNote || null],
    );
    if (updatedRows.rowCount !== 1) {
      throw Object.assign(new Error("Leave request is not pending"), { status: 400 });
    }

    if (statusRaw === "approved") {
      await syncApprovedLeaveRequestDays(client, {
        employeeId: pendingRow.employee_id,
        leaveType: pendingRow.leave_type,
        startDate: pendingRow.start_date,
        endDate: pendingRow.end_date,
      });
      await applyPortalLeaveRange(client, {
        employeeId: pendingRow.employee_id,
        leaveType: pendingRow.leave_type,
        startDate: pendingRow.start_date,
        endDate: pendingRow.end_date,
        actor: actorFrom(user.email),
      });
    }
  });

  const updated = await getLeaveRequestById(id);
  if (!updated) {
    throw Object.assign(new Error("Leave request not found"), { status: 404 });
  }
  return mapRow(updated);
}

export async function cancelLeaveRequest(user: AuthUser, id: number) {
  const row = await getLeaveRequestById(id);
  if (!row) {
    throw Object.assign(new Error("Leave request not found"), { status: 404 });
  }
  if (row.requester_user_id !== user.id && !userIsAdmin(user) && !userCanEdit(user)) {
    throw Object.assign(new Error("You can only cancel your own leave requests"), { status: 403 });
  }
  if (row.status !== "pending") {
    throw Object.assign(new Error("Only pending requests can be cancelled"), { status: 400 });
  }

  await query(
    `UPDATE leave_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
    [id],
  );

  const updated = await getLeaveRequestById(id);
  if (!updated) {
    throw Object.assign(new Error("Leave request not found"), { status: 404 });
  }
  return mapRow(updated);
}

export function leaveRequestCapabilities(user: AuthUser) {
  return requestCapabilities(user);
}

function parseCalendarYear(yearInput: unknown): number {
  const now = new Date();
  let year = now.getFullYear();
  if (yearInput != null && String(yearInput).trim() !== "") {
    const parsed = Number.parseInt(String(yearInput), 10);
    if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) {
      throw Object.assign(new Error("Invalid year"), { status: 400 });
    }
    year = parsed;
  }
  return year;
}

export async function getLeaveBalanceForUser(user: AuthUser, yearInput?: unknown) {
  const employeeId = await requireSubmitEmployeeId(user, "leave");
  const year = parseCalendarYear(yearInput);
  const balance = await loadLeaveBalancePayload(employeeId, year);
  return balance;
}

async function assertCanViewEmployeeLeaveHistory(user: AuthUser, employeeId: number): Promise<void> {
  if (isManagementRequestOversight(user)) return;
  if (userIsManager(user)) {
    const assigned = await getAssignedEmployeeIds(user.id);
    if (assigned.includes(employeeId)) return;
  }
  const managerUserId = await resolveManagerUserIdForEmployee(employeeId);
  if (managerUserId === user.id) return;
  const ownEmployeeId = await findEmployeeIdByUserEmail(user.email);
  if (ownEmployeeId === employeeId) return;
  throw Object.assign(new Error("You do not have access to this employee's leave history"), {
    status: 403,
  });
}

export async function getEmployeeLeaveHistory(
  user: AuthUser,
  employeeIdInput: unknown,
  yearInput?: unknown,
) {
  const employeeId = Number.parseInt(String(employeeIdInput ?? ""), 10);
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    throw Object.assign(new Error("Invalid employee id"), { status: 400 });
  }
  await assertCanViewEmployeeLeaveHistory(user, employeeId);

  const year = parseCalendarYear(yearInput);
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const employee = await queryOne<{ employee_code: string; name: string }>(
    `SELECT employee_code, name FROM employees WHERE id = $1`,
    [employeeId],
  );
  if (!employee) {
    throw Object.assign(new Error("Employee not found"), { status: 404 });
  }

  const rows = await query<LeaveRequestRow>(
    `${SELECT_BODY}
     WHERE r.employee_id = $1
       AND r.start_date <= $3::date
       AND r.end_date >= $2::date
     ORDER BY r.created_at DESC, r.id DESC`,
    [employeeId, yearStart, yearEnd],
  );
  const requests = rows.map(mapRow);
  const summary = buildLeaveHistorySummary(requests, year);
  const balance = await loadLeaveBalancePayload(employeeId, year);

  return {
    year,
    employeeId,
    employeeCode: employee.employee_code,
    employeeName: employee.name,
    summary,
    requests,
    balance,
  };
}
