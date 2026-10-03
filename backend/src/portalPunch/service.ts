import type pg from "pg";
import { findEmployeeIdByUserEmail } from "../auth/attendanceScope.js";
import { getAssignedEmployeeIds } from "../auth/managerAssignments.js";
import type { AuthUser } from "../auth/users.js";
import { userIsManager } from "../auth/middleware.js";
import { query, queryOne, withTransaction } from "../db/index.js";
import {
  canSubmitEmployeeRequests,
  pendingWithLabel,
  parseDecisionStatus,
  resolveApprovalRoute,
  requireSubmitEmployeeId,
  resolveManagerUserIdForEmployee,
  userCanDecideRequest,
  type ApprovalTier,
} from "../employeeRequests/workflow.js";
import { buildPortalPunchHistorySummary } from "./historySummary.js";
import {
  loadOversightDirectoryEmployees,
  loadScopeEmployeesByIds,
  type RequestScopeEmployee,
} from "../employeeRequests/scopeEmployees.js";
import { isExecutiveLeaveApprover } from "../leaveRequests/approvers.js";
import { applyApprovedPortalPunchIfNeeded } from "../persist/portalAttendanceOverlay.js";
import { actorFrom } from "../persist/helpers.js";
import { canViewAllPortalPunches, portalPunchCapabilities } from "./access.js";
import { isManagementRequestOversight } from "../employeeRequests/workflow.js";
import {
  assertCheckInAllowed,
  assertCheckOutAllowed,
  clockHmInIndia,
  normalizeShiftStart,
  portalWindowsForShift,
  todayIsoInIndia,
  type PortalWindowInfo,
} from "./windows.js";

export type PortalPunchLegKind = "in" | "out";
export type PortalPunchLegStatus = "pending" | "approved" | "rejected";

/** @deprecated Day-level open status; legs use in_status / out_status. */
export type PortalPunchStatus = "open" | "pending" | "approved" | "rejected";

export type PortalPunchRow = {
  id: number;
  employee_id: number;
  requester_user_id: number;
  attendance_date: string;
  shift_start_snapshot: string | null;
  in_time: string | null;
  in_client_at: string | null;
  in_server_at: string | null;
  out_time: string | null;
  out_client_at: string | null;
  out_server_at: string | null;
  status: PortalPunchStatus;
  in_status: PortalPunchLegStatus | null;
  in_decided_by_user_id: number | null;
  in_decided_at: string | null;
  in_decision_note: string | null;
  out_status: PortalPunchLegStatus | null;
  out_decided_by_user_id: number | null;
  out_decided_at: string | null;
  out_decision_note: string | null;
  approval_tier: ApprovalTier;
  assigned_approver_user_id: number | null;
  decided_by_user_id: number | null;
  decided_at: string | null;
  decision_note: string | null;
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
  in_decided_by_name: string | null;
  out_decided_by_name: string | null;
  shift_start: string | null;
};

const SELECT_BODY = `
  SELECT p.id, p.employee_id, p.requester_user_id, p.attendance_date::text AS attendance_date,
         p.shift_start_snapshot, p.in_time, p.in_client_at, p.in_server_at,
         p.out_time, p.out_client_at, p.out_server_at, p.status, p.approval_tier,
         p.in_status, p.in_decided_by_user_id, p.in_decided_at, p.in_decision_note,
         p.out_status, p.out_decided_by_user_id, p.out_decided_at, p.out_decision_note,
         p.assigned_approver_user_id, p.decided_by_user_id, p.decided_at, p.decision_note,
         p.created_at, p.updated_at,
         e.employee_code, e.name AS employee_name, e.shift_start,
         ru.name AS requester_name, ru.email AS requester_email,
         au.name AS assigned_approver_name, au.email AS assigned_approver_email,
         du.name AS decided_by_name, du.email AS decided_by_email,
         idu.name AS in_decided_by_name,
         odu.name AS out_decided_by_name
  FROM portal_punch_days p
  JOIN employees e ON e.id = p.employee_id
  JOIN users ru ON ru.id = p.requester_user_id
  LEFT JOIN users au ON au.id = p.assigned_approver_user_id
  LEFT JOIN users du ON du.id = p.decided_by_user_id
  LEFT JOIN users idu ON idu.id = p.in_decided_by_user_id
  LEFT JOIN users odu ON odu.id = p.out_decided_by_user_id
`;

export type PortalPunchDayView = ReturnType<typeof mapDayRow>;
export type PortalPunchLegRecord = ReturnType<typeof mapLeg>;

function mapDayRow(row: PortalPunchRow) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    requesterUserId: row.requester_user_id,
    attendanceDate: row.attendance_date.slice(0, 10),
    shiftStartSnapshot: row.shift_start_snapshot,
    inTime: row.in_time,
    inClientAt: row.in_client_at,
    inServerAt: row.in_server_at,
    inStatus: row.in_status,
    outTime: row.out_time,
    outClientAt: row.out_client_at,
    outServerAt: row.out_server_at,
    outStatus: row.out_status,
    status: row.status,
    approvalTier: row.approval_tier,
    assignedApproverUserId: row.assigned_approver_user_id,
    assignedApproverName: row.assigned_approver_name,
    assignedApproverEmail: row.assigned_approver_email,
    pendingWithLabel:
      row.in_status === "pending" || row.out_status === "pending"
        ? pendingWithLabel("pending", row.approval_tier, row.assigned_approver_name)
        : null,
    decidedByUserId: row.decided_by_user_id,
    decidedByName: row.decided_by_name,
    decidedByEmail: row.decided_by_email,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    employeeCode: row.employee_code,
    employeeName: row.employee_name,
    requesterName: row.requester_name,
    requesterEmail: row.requester_email,
    shiftStart: row.shift_start_snapshot ?? row.shift_start,
  };
}

function mapLeg(row: PortalPunchRow, kind: PortalPunchLegKind) {
  const isIn = kind === "in";
  const legStatus = (isIn ? row.in_status : row.out_status) as PortalPunchLegStatus | null;
  const punchTime = isIn ? row.in_time : row.out_time;
  const decidedByName = isIn ? row.in_decided_by_name : row.out_decided_by_name;
  const decidedAt = isIn ? row.in_decided_at : row.out_decided_at;
  const decisionNote = isIn ? row.in_decision_note : row.out_decision_note;
  const decidedByUserId = isIn ? row.in_decided_by_user_id : row.out_decided_by_user_id;

  return {
    id: row.id,
    leg: kind,
    employeeId: row.employee_id,
    requesterUserId: row.requester_user_id,
    attendanceDate: row.attendance_date.slice(0, 10),
    punchTime,
    inTime: row.in_time,
    outTime: row.out_time,
    status: legStatus ?? "pending",
    approvalTier: row.approval_tier,
    assignedApproverUserId: row.assigned_approver_user_id,
    assignedApproverName: row.assigned_approver_name,
    assignedApproverEmail: row.assigned_approver_email,
    pendingWithLabel:
      legStatus === "pending"
        ? pendingWithLabel("pending", row.approval_tier, row.assigned_approver_name)
        : null,
    decidedByUserId,
    decidedByName: decidedByName,
    decidedAt,
    decisionNote,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    employeeCode: row.employee_code,
    employeeName: row.employee_name,
    requesterName: row.requester_name,
    requesterEmail: row.requester_email,
    shiftStart: row.shift_start_snapshot ?? row.shift_start,
    shiftStartSnapshot: row.shift_start_snapshot,
  };
}

function expandDayToLegs(row: PortalPunchRow): PortalPunchLegRecord[] {
  const legs: PortalPunchLegRecord[] = [];
  if (row.in_time && row.in_status) {
    legs.push(mapLeg(row, "in"));
  }
  if (row.out_time && row.out_status) {
    legs.push(mapLeg(row, "out"));
  }
  return legs;
}

function syncDayAggregateStatus(client: pg.PoolClient, dayId: number) {
  return client.query(
    `UPDATE portal_punch_days SET
       status = CASE
         WHEN in_status = 'rejected' OR out_status = 'rejected' THEN 'rejected'
         WHEN in_status = 'approved' AND out_status = 'approved' THEN 'approved'
         WHEN in_status = 'pending' OR out_status = 'pending' THEN 'pending'
         WHEN in_time IS NOT NULL AND out_time IS NULL THEN 'open'
         ELSE status
       END,
       updated_at = NOW()
     WHERE id = $1`,
    [dayId],
  );
}

function parseClientIso(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseLegKind(raw: unknown): PortalPunchLegKind {
  const k = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (k === "in" || k === "check_in" || k === "check-in") return "in";
  if (k === "out" || k === "check_out" || k === "check-out") return "out";
  throw Object.assign(new Error("leg must be in or out"), { status: 400 });
}

async function maybeApplyAttendanceAfterLegApproval(client: pg.PoolClient, row: PortalPunchRow, actor: string) {
  if (row.in_status !== "approved" || row.out_status !== "approved") return;
  if (!row.in_time || !row.out_time) return;
  const dateIso = row.attendance_date.slice(0, 10);
  const emp = await client.query<{ shift_start: string | null }>(
    `SELECT shift_start FROM employees WHERE id = $1`,
    [row.employee_id],
  );
  await applyApprovedPortalPunchIfNeeded(client, {
    employeeId: row.employee_id,
    dateIso,
    inTime: row.in_time,
    outTime: row.out_time,
    shiftStart: row.shift_start_snapshot ?? emp.rows[0]?.shift_start ?? null,
    actor,
  });
}

export function portalPunchMeta(user: AuthUser) {
  return {
    capabilities: portalPunchCapabilities(user),
    checkInGraceMinutes: 60,
    checkOutGraceMinutes: 60,
  };
}

export async function getPortalPunchToday(user: AuthUser) {
  if (!canSubmitEmployeeRequests(user)) {
    return { today: null as PortalWindowInfo | null, punch: null };
  }
  const employeeId = await findEmployeeIdByUserEmail(user.email);
  if (employeeId == null) {
    return { today: null, punch: null };
  }
  const emp = await queryOne<{ shift_start: string | null }>(
    `SELECT shift_start FROM employees WHERE id = $1`,
    [employeeId],
  );
  const todayIso = todayIsoInIndia(new Date());
  const row = await queryOne<PortalPunchRow>(
    `${SELECT_BODY} WHERE p.employee_id = $1 AND p.attendance_date = $2::date`,
    [employeeId, todayIso],
  );
  const windows = portalWindowsForShift(emp?.shift_start, new Date(), row?.in_time ?? null);
  return {
    today: windows,
    punch: row ? mapDayRow(row) : null,
  };
}

export async function punchCheckIn(user: AuthUser, clientTimeRaw?: unknown) {
  const employeeId = await requireSubmitEmployeeId(user, "leave");
  const emp = await queryOne<{ shift_start: string | null; company: string | null }>(
    `SELECT shift_start, company FROM employees WHERE id = $1`,
    [employeeId],
  );
  const serverNow = new Date();
  const clientDate = parseClientIso(clientTimeRaw) ?? serverNow;
  const windows = assertCheckInAllowed(emp?.shift_start, serverNow);
  if (windows.todayIso !== todayIsoInIndia(serverNow)) {
    throw Object.assign(new Error("Check-in is only allowed for today's date (IST)."), { status: 400 });
  }

  const existing = await queryOne<{
    id: number;
    in_time: string | null;
    in_status: PortalPunchLegStatus | null;
  }>(
    `SELECT id, in_time, in_status FROM portal_punch_days WHERE employee_id = $1 AND attendance_date = $2::date`,
    [employeeId, windows.todayIso],
  );
  if (existing?.in_time && existing.in_status === "pending") {
    throw Object.assign(new Error("Your check-in is already pending approval."), { status: 409 });
  }
  if (existing?.in_time && existing.in_status === "approved") {
    throw Object.assign(new Error("You have already checked in today."), { status: 409 });
  }

  const inTime = clockHmInIndia(clientDate);
  const shiftSnap = normalizeShiftStart(emp?.shift_start);
  const { approvalTier, assignedApproverUserId } = await resolveApprovalRoute(user, employeeId);

  if (existing) {
    await query(
      `UPDATE portal_punch_days SET
         in_time = $1, in_client_at = $2, in_server_at = NOW(),
         in_status = 'pending',
         in_decided_by_user_id = NULL, in_decided_at = NULL, in_decision_note = NULL,
         out_time = NULL, out_client_at = NULL, out_server_at = NULL,
         out_status = NULL,
         out_decided_by_user_id = NULL, out_decided_at = NULL, out_decision_note = NULL,
         shift_start_snapshot = $3, status = 'pending', approval_tier = $4,
         assigned_approver_user_id = $5,
         decided_by_user_id = NULL, decided_at = NULL, decision_note = NULL,
         updated_at = NOW()
       WHERE id = $6`,
      [
        inTime,
        clientDate.toISOString(),
        shiftSnap,
        approvalTier,
        assignedApproverUserId,
        existing.id,
      ],
    );
  } else {
    await query(
      `INSERT INTO portal_punch_days (
         employee_id, requester_user_id, attendance_date, shift_start_snapshot,
         in_time, in_client_at, in_server_at, in_status, status, approval_tier,
         assigned_approver_user_id, updated_at
       ) VALUES ($1, $2, $3::date, $4, $5, $6, NOW(), 'pending', 'pending', $7, $8, NOW())`,
      [
        employeeId,
        user.id,
        windows.todayIso,
        shiftSnap,
        inTime,
        clientDate.toISOString(),
        approvalTier,
        assignedApproverUserId,
      ],
    );
  }

  const row = await queryOne<PortalPunchRow>(
    `${SELECT_BODY} WHERE p.employee_id = $1 AND p.attendance_date = $2::date`,
    [employeeId, windows.todayIso],
  );
  if (!row) throw Object.assign(new Error("Failed to save check-in"), { status: 500 });
  const todayWindows = portalWindowsForShift(emp?.shift_start, new Date(), row.in_time);
  return { punch: mapDayRow(row), today: todayWindows };
}

export async function punchCheckOut(user: AuthUser, clientTimeRaw?: unknown) {
  const employeeId = await requireSubmitEmployeeId(user, "leave");
  const emp = await queryOne<{ shift_start: string | null; company: string | null }>(
    `SELECT shift_start, company FROM employees WHERE id = $1`,
    [employeeId],
  );
  const serverNow = new Date();
  const clientDate = parseClientIso(clientTimeRaw) ?? serverNow;
  const todayIso = todayIsoInIndia(serverNow);

  const row = await queryOne<PortalPunchRow>(
    `${SELECT_BODY} WHERE p.employee_id = $1 AND p.attendance_date = $2::date`,
    [employeeId, todayIso],
  );
  if (!row?.in_time) {
    throw Object.assign(new Error("Check in before checking out."), { status: 400 });
  }
  if (row.in_status === "rejected") {
    throw Object.assign(new Error("Your check-in was rejected. Submit a new check-in first."), {
      status: 409,
    });
  }
  const windows = assertCheckOutAllowed(emp?.shift_start, serverNow, row.in_time);

  if (row.out_time && row.out_status === "pending") {
    throw Object.assign(new Error("Your check-out is already pending approval."), { status: 409 });
  }
  if (row.out_time && row.out_status === "approved") {
    throw Object.assign(new Error("You have already checked out today."), { status: 409 });
  }

  const outTime = clockHmInIndia(clientDate);
  let approvalTier = row.approval_tier;
  let assignedApproverUserId = row.assigned_approver_user_id;
  if (!assignedApproverUserId) {
    const route = await resolveApprovalRoute(user, employeeId);
    approvalTier = route.approvalTier;
    assignedApproverUserId = route.assignedApproverUserId;
  }

  await query(
    `UPDATE portal_punch_days SET
       out_time = $1, out_client_at = $2, out_server_at = NOW(),
       out_status = 'pending',
       out_decided_by_user_id = NULL, out_decided_at = NULL, out_decision_note = NULL,
       status = 'pending', approval_tier = $3, assigned_approver_user_id = $4,
       updated_at = NOW()
     WHERE id = $5`,
    [outTime, clientDate.toISOString(), approvalTier, assignedApproverUserId, row.id],
  );

  const updated = await queryOne<PortalPunchRow>(`${SELECT_BODY} WHERE p.id = $1`, [row.id]);
  if (!updated) throw Object.assign(new Error("Failed to save check-out"), { status: 500 });
  return { punch: mapDayRow(updated), today: windows };
}

function sortLegs(a: PortalPunchLegRecord, b: PortalPunchLegRecord): number {
  const dateCmp = b.attendanceDate.localeCompare(a.attendanceDate);
  if (dateCmp !== 0) return dateCmp;
  if (a.id !== b.id) return b.id - a.id;
  return a.leg === "in" ? -1 : 1;
}

export async function listMyPortalPunches(user: AuthUser) {
  const rows = await query<PortalPunchRow>(
    `${SELECT_BODY} WHERE p.requester_user_id = $1 ORDER BY p.attendance_date DESC, p.id DESC LIMIT 120`,
    [user.id],
  );
  return rows.flatMap(expandDayToLegs).sort(sortLegs);
}

export async function listPendingPortalPunches(user: AuthUser) {
  return listApprovalInboxPortalPunches(user);
}

export async function listApprovalInboxPortalPunches(user: AuthUser) {
  const exec = isExecutiveLeaveApprover(user);
  const pendingRows = await query<PortalPunchRow>(
    `${SELECT_BODY}
     WHERE (
       (p.in_status = 'pending' AND (
         (p.approval_tier = 'manager' AND p.assigned_approver_user_id = $1)
         OR ($2::boolean AND p.approval_tier = 'leadership_hr')
       ))
       OR
       (p.out_status = 'pending' AND (
         (p.approval_tier = 'manager' AND p.assigned_approver_user_id = $1)
         OR ($2::boolean AND p.approval_tier = 'leadership_hr')
       ))
     )
     ORDER BY p.attendance_date DESC, p.id DESC`,
    [user.id, exec],
  );

  const decidedRows = await query<PortalPunchRow>(
    `${SELECT_BODY}
     WHERE p.in_decided_by_user_id = $1 OR p.out_decided_by_user_id = $1
     ORDER BY GREATEST(
       COALESCE(p.in_decided_at, '1970-01-01'::timestamptz),
       COALESCE(p.out_decided_at, '1970-01-01'::timestamptz)
     ) DESC NULLS LAST, p.id DESC
     LIMIT 200`,
    [user.id],
  );

  const legKey = (row: PortalPunchRow, leg: PortalPunchLegKind) => `${row.id}:${leg}`;
  const legs = new Map<string, PortalPunchLegRecord>();

  for (const row of pendingRows) {
    for (const leg of expandDayToLegs(row)) {
      if (leg.status === "pending") legs.set(legKey(row, leg.leg), leg);
    }
  }
  for (const row of decidedRows) {
    for (const leg of expandDayToLegs(row)) {
      if (leg.decidedByUserId === user.id && leg.status !== "pending") {
        const key = legKey(row, leg.leg);
        if (!legs.has(key)) legs.set(key, leg);
      }
    }
  }

  const merged = [...legs.values()];
  merged.sort((a, b) => {
    const aPending = a.status === "pending";
    const bPending = b.status === "pending";
    if (aPending !== bPending) return aPending ? -1 : 1;
    return sortLegs(a, b);
  });
  return merged;
}

export async function listAllPortalPunches(user: AuthUser) {
  if (!canViewAllPortalPunches(user)) {
    throw Object.assign(new Error("You do not have access to all portal punches"), { status: 403 });
  }
  const { punches } = await listScopedPortalPunchesForViewer(user);
  return punches;
}

export type PortalScopeEmployee = RequestScopeEmployee;

async function loadPortalScopeEmployees(employeeIds: number[]): Promise<PortalScopeEmployee[]> {
  return loadScopeEmployeesByIds(employeeIds);
}

/** Full in/out leg list for approvers: all employees (oversight) or assigned team (managers). */
export async function listScopedPortalPunchesForViewer(user: AuthUser, searchRaw?: unknown) {
  const oversight = isManagementRequestOversight(user);
  const isManager = userIsManager(user);
  if (!oversight && !isManager) {
    throw Object.assign(new Error("You do not have access to this in/out list"), { status: 403 });
  }

  const search = String(searchRaw ?? "").trim();
  const params: unknown[] = [];
  const conditions: string[] = ["1=1"];

  let teamEmployees: PortalScopeEmployee[] | undefined;

  if (oversight) {
    teamEmployees = await loadOversightDirectoryEmployees();
  } else {
    const employeeIds = await getAssignedEmployeeIds(user.id);
    teamEmployees = await loadPortalScopeEmployees(employeeIds);
    if (employeeIds.length === 0) {
      return { scope: "team" as const, punches: [] as PortalPunchLegRecord[], teamEmployees };
    }
    params.push(employeeIds);
    conditions.push(`p.employee_id = ANY($${params.length}::int[])`);
  }

  if (search.length > 0) {
    params.push(`%${search}%`);
    const i = params.length;
    conditions.push(`(
      e.name ILIKE $${i}
      OR e.employee_code ILIKE $${i}
      OR ru.name ILIKE $${i}
      OR ru.email ILIKE $${i}
      OR p.attendance_date::text ILIKE $${i}
      OR COALESCE(p.in_time, '') ILIKE $${i}
      OR COALESCE(p.out_time, '') ILIKE $${i}
      OR COALESCE(p.in_status::text, '') ILIKE $${i}
      OR COALESCE(p.out_status::text, '') ILIKE $${i}
    )`);
  }

  params.push(5000);
  const limitIdx = params.length;

  const rows = await query<PortalPunchRow>(
    `${SELECT_BODY}
     WHERE ${conditions.join(" AND ")}
     ORDER BY p.attendance_date DESC, p.id DESC
     LIMIT $${limitIdx}`,
    params,
  );

  const punches = rows.flatMap(expandDayToLegs).sort(sortLegs);
  return {
    scope: oversight ? ("all" as const) : ("team" as const),
    punches,
    teamEmployees,
  };
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

async function assertCanViewEmployeePortalPunchHistory(user: AuthUser, employeeId: number): Promise<void> {
  if (isManagementRequestOversight(user)) return;
  if (userIsManager(user)) {
    const assigned = await getAssignedEmployeeIds(user.id);
    if (assigned.includes(employeeId)) return;
  }
  const managerUserId = await resolveManagerUserIdForEmployee(employeeId);
  if (managerUserId === user.id) return;
  const ownEmployeeId = await findEmployeeIdByUserEmail(user.email);
  if (ownEmployeeId === employeeId) return;
  throw Object.assign(new Error("You do not have access to this employee's in/out history"), {
    status: 403,
  });
}

export async function getEmployeePortalPunchHistory(
  user: AuthUser,
  employeeIdInput: unknown,
  yearInput?: unknown,
) {
  const employeeId = Number.parseInt(String(employeeIdInput ?? ""), 10);
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    throw Object.assign(new Error("Invalid employee id"), { status: 400 });
  }
  await assertCanViewEmployeePortalPunchHistory(user, employeeId);

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

  const rows = await query<PortalPunchRow>(
    `${SELECT_BODY}
     WHERE p.employee_id = $1
       AND p.attendance_date >= $2::date
       AND p.attendance_date <= $3::date
     ORDER BY p.attendance_date DESC, p.id DESC`,
    [employeeId, yearStart, yearEnd],
  );
  const punches = rows.flatMap(expandDayToLegs).sort(sortLegs);
  const summary = buildPortalPunchHistorySummary(punches, year);

  return {
    year,
    employeeId,
    employeeCode: employee.employee_code,
    employeeName: employee.name,
    summary,
    punches,
  };
}

async function getById(id: number): Promise<PortalPunchRow | null> {
  const row = await queryOne<PortalPunchRow>(`${SELECT_BODY} WHERE p.id = $1`, [id]);
  return row ?? null;
}

export async function decidePortalPunch(
  user: AuthUser,
  id: number,
  input: { leg?: unknown; status: unknown; note?: unknown },
) {
  const leg = parseLegKind(input.leg);
  const status = parseDecisionStatus(input.status);
  const decisionNote = String(input.note ?? "").trim();
  const row = await getById(id);
  if (!row) throw Object.assign(new Error("Portal punch not found"), { status: 404 });
  if (row.requester_user_id === user.id) {
    throw Object.assign(new Error("You cannot approve or reject your own punch record"), { status: 403 });
  }
  if (
    !userCanDecideRequest(user, {
      status: "pending",
      approval_tier: row.approval_tier,
      assigned_approver_user_id: row.assigned_approver_user_id,
      requester_user_id: row.requester_user_id,
    })
  ) {
    throw Object.assign(new Error("You are not allowed to decide on this record"), { status: 403 });
  }

  const legStatus = leg === "in" ? row.in_status : row.out_status;
  const punchTime = leg === "in" ? row.in_time : row.out_time;
  if (!punchTime) {
    throw Object.assign(new Error(`No ${leg === "in" ? "check-in" : "check-out"} time on this record`), {
      status: 400,
    });
  }
  if (legStatus !== "pending") {
    throw Object.assign(new Error("This request is not pending approval"), { status: 409 });
  }

  const actor = actorFrom(user.email);

  await withTransaction(async (client) => {
    if (leg === "in") {
      await client.query(
        `UPDATE portal_punch_days SET
           in_status = $1,
           in_decided_by_user_id = $2,
           in_decided_at = NOW(),
           in_decision_note = $3,
           updated_at = NOW()
         WHERE id = $4`,
        [status, user.id, decisionNote || null, id],
      );
    } else {
      await client.query(
        `UPDATE portal_punch_days SET
           out_status = $1,
           out_decided_by_user_id = $2,
           out_decided_at = NOW(),
           out_decision_note = $3,
           updated_at = NOW()
         WHERE id = $4`,
        [status, user.id, decisionNote || null, id],
      );
    }
    await syncDayAggregateStatus(client, id);

    const fresh = await client.query<PortalPunchRow>(`${SELECT_BODY} WHERE p.id = $1`, [id]);
    const updatedRow = fresh.rows[0];
    if (updatedRow && status === "approved") {
      await maybeApplyAttendanceAfterLegApproval(client, updatedRow, actor);
    }
  });

  const updated = await getById(id);
  if (!updated) throw Object.assign(new Error("Record not found after update"), { status: 500 });
  return mapLeg(updated, leg);
}

export { portalPunchCapabilities };
