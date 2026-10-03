import { findEmployeeIdByUserEmail } from "../auth/attendanceScope.js";
import { userCanEdit, userIsAdmin, userIsManager } from "../auth/middleware.js";
import type { AuthUser } from "../auth/users.js";
import { queryOne, query } from "../db/index.js";
import { isLeadershipReviewer } from "../performance/leadership.js";
import { executiveApproverLabel, isExecutiveLeaveApprover } from "../leaveRequests/approvers.js";

export type ApprovalTier = "manager" | "leadership_hr";
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type RequestCapabilities = {
  canSubmit: boolean;
  canViewPendingApproval: boolean;
  canViewAll: boolean;
  isExecutiveApprover: boolean;
  /** Company-wide leave list for HR/leadership; direct reports for managers. */
  leaveListScope: "all" | "team" | null;
};

/** HR/admin, Jay/Mansi leadership, and executive approvers (Devanshi/Jiya) - company-wide request visibility. */
export function isManagementRequestOversight(user: AuthUser): boolean {
  if (userIsAdmin(user) || userCanEdit(user)) return true;
  if (isLeadershipReviewer(user.email)) return true;
  if (isExecutiveLeaveApprover(user)) return true;
  return false;
}

export function canViewAllRequests(user: AuthUser): boolean {
  return isManagementRequestOversight(user);
}

/** Employees and managers submit; HR/admin use approval and overview tabs only. */
export function canSubmitEmployeeRequests(user: AuthUser): boolean {
  return !userCanEdit(user);
}

export function requestCapabilities(user: AuthUser): RequestCapabilities {
  let leaveListScope: "all" | "team" | null = null;
  if (isManagementRequestOversight(user)) {
    leaveListScope = "all";
  } else if (userIsManager(user)) {
    leaveListScope = "team";
  }
  return {
    canSubmit: canSubmitEmployeeRequests(user),
    canViewPendingApproval: userIsManager(user) || isManagementRequestOversight(user),
    canViewAll: canViewAllRequests(user),
    isExecutiveApprover: isExecutiveLeaveApprover(user),
    leaveListScope,
  };
}

export async function resolveManagerUserIdForEmployee(employeeId: number): Promise<number | null> {
  const fromTeam = await queryOne<{ manager_user_id: number | null }>(
    `SELECT t.manager_user_id FROM employees e
     JOIN teams t ON t.id = e.team_id
     WHERE e.id = $1`,
    [employeeId],
  );
  if (fromTeam?.manager_user_id != null) return fromTeam.manager_user_id;

  const fromAssignment = await queryOne<{ manager_user_id: number }>(
    `SELECT manager_user_id FROM manager_employee_assignments WHERE employee_id = $1 LIMIT 1`,
    [employeeId],
  );
  return fromAssignment?.manager_user_id ?? null;
}

export function parseIsoDate(raw: unknown, field: string): string {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw Object.assign(new Error(`${field} must be YYYY-MM-DD`), { status: 400 });
  }
  return s;
}

export function assertStaffCannotSubmit(user: AuthUser, kind: "leave" | "reimbursement"): void {
  if (canSubmitEmployeeRequests(user)) return;
  const label = kind === "leave" ? "leave" : "reimbursement claims";
  throw Object.assign(
    new Error(`HR and admin do not submit ${label} through this portal.`),
    { status: 403 },
  );
}

export async function requireSubmitEmployeeId(user: AuthUser, kind: "leave" | "reimbursement"): Promise<number> {
  assertStaffCannotSubmit(user, kind);
  const employeeId = await findEmployeeIdByUserEmail(user.email);
  if (employeeId == null) {
    throw Object.assign(
      new Error(
        kind === "leave"
          ? "Your login is not linked to an employee record. Contact HR to submit leave."
          : "Your login is not linked to an employee record. Contact HR to submit reimbursement.",
      ),
      { status: 400 },
    );
  }
  return employeeId;
}

export async function resolveApprovalRoute(
  user: AuthUser,
  employeeId: number,
): Promise<{ approvalTier: ApprovalTier; assignedApproverUserId: number | null }> {
  const needsExecutive = userIsManager(user);
  let approvalTier: ApprovalTier = needsExecutive ? "leadership_hr" : "manager";
  let assignedApproverUserId: number | null = null;

  if (approvalTier === "manager") {
    assignedApproverUserId = await resolveManagerUserIdForEmployee(employeeId);
    if (assignedApproverUserId == null) {
      throw Object.assign(
        new Error("No manager is assigned for your team. Contact HR before submitting."),
        { status: 400 },
      );
    }
    if (assignedApproverUserId === user.id) {
      approvalTier = "leadership_hr";
      assignedApproverUserId = null;
    }
  }

  return { approvalTier, assignedApproverUserId };
}

export function pendingWithLabel(
  status: RequestStatus,
  approvalTier: ApprovalTier,
  assignedApproverName: string | null,
): string | null {
  if (status !== "pending") return null;
  if (approvalTier === "leadership_hr") return executiveApproverLabel();
  return assignedApproverName ?? "Manager";
}

type DecidableRow = {
  status: RequestStatus;
  approval_tier: ApprovalTier;
  assigned_approver_user_id: number | null;
  requester_user_id: number;
};

export function userCanDecideRequest(user: AuthUser, row: DecidableRow): boolean {
  if (row.status !== "pending") return false;
  if (row.approval_tier === "manager") {
    return row.assigned_approver_user_id === user.id;
  }
  return isExecutiveLeaveApprover(user);
}

/** Re-point open manager-tier requests at each employee's current team manager. */
export async function refreshPendingManagerTierAssignees(): Promise<void> {
  await query(
    `UPDATE leave_requests r
     SET assigned_approver_user_id = t.manager_user_id, updated_at = NOW()
     FROM employees e
     JOIN teams t ON t.id = e.team_id
     WHERE r.employee_id = e.id
       AND r.status = 'pending'
       AND r.approval_tier = 'manager'
       AND r.assigned_approver_user_id IS DISTINCT FROM t.manager_user_id`,
  );
  await query(
    `UPDATE reimbursement_requests r
     SET assigned_approver_user_id = t.manager_user_id, updated_at = NOW()
     FROM employees e
     JOIN teams t ON t.id = e.team_id
     WHERE r.employee_id = e.id
       AND r.status = 'pending'
       AND r.approval_tier = 'manager'
       AND r.assigned_approver_user_id IS DISTINCT FROM t.manager_user_id`,
  );
  await query(
    `UPDATE portal_punch_days p
     SET assigned_approver_user_id = t.manager_user_id, updated_at = NOW()
     FROM employees e
     JOIN teams t ON t.id = e.team_id
     WHERE p.employee_id = e.id
       AND p.approval_tier = 'manager'
       AND (p.in_status = 'pending' OR p.out_status = 'pending')
       AND p.assigned_approver_user_id IS DISTINCT FROM t.manager_user_id`,
  );
}

export function parseDecisionStatus(raw: unknown): "approved" | "rejected" {
  const statusRaw = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (statusRaw !== "approved" && statusRaw !== "rejected") {
    throw Object.assign(new Error("status must be approved or rejected"), { status: 400 });
  }
  return statusRaw;
}
