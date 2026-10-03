import type { Request, Response } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import {
  cancelLeaveRequest,
  createLeaveRequest,
  decideLeaveRequest,
  getEmployeeLeaveHistory,
  getLeaveBalanceForUser,
  leaveRequestCapabilities,
  listScopedLeaveRequestsForViewer,
  listAllLeaveRequests,
  listApprovalInboxForUser,
  listMyLeaveRequests,
} from "./service.js";
import { LeaveApplyConfirmRequiredError } from "./applyConfirm.js";
import { buildLeaveApplyWarnings } from "./applyChecks.js";
import { parseIsoDate, requireSubmitEmployeeId } from "../employeeRequests/workflow.js";

function statusFromError(e: unknown): number {
  if (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return 500;
}

function requireUser(req: Request, res: Response): AuthedRequest["authUser"] | null {
  const user = (req as AuthedRequest).authUser;
  if (!user) {
    res.status(401).json({ message: "Authentication required" });
    return null;
  }
  return user;
}

export async function handleLeaveRequestMeta(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({
    leaveTypes: [
      { id: "pl", label: "Personal Leave (PL)" },
      { id: "sl", label: "Sick Leave (SL)" },
      { id: "cl", label: "Casual Leave (CL)" },
    ],
    capabilities: leaveRequestCapabilities(user),
  });
}

export async function handleLeaveRequestBalance(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const year = (req.query as { year?: string }).year;
    const balance = await getLeaveBalanceForUser(user, year);
    res.json({ balance });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load balance" });
  }
}

export async function handlePreviewLeaveApply(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const employeeId = await requireSubmitEmployeeId(user, "leave");
    const startDate = parseIsoDate(body.startDate ?? body.start_date, "startDate");
    const endDate = parseIsoDate(body.endDate ?? body.end_date, "endDate");
    const warnings = await buildLeaveApplyWarnings({ employeeId, startDate, endDate });
    res.json({ warnings });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Preview failed" });
  }
}

export async function handleCreateLeaveRequest(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const request = await createLeaveRequest(user, {
      leaveType: body.leaveType ?? body.leave_type,
      startDate: body.startDate ?? body.start_date,
      endDate: body.endDate ?? body.end_date,
      reason: body.reason,
      acknowledgeWarnings: body.acknowledgeWarnings ?? body.acknowledge_warnings,
    });
    res.status(201).json({ request });
  } catch (e) {
    if (e instanceof LeaveApplyConfirmRequiredError) {
      res.status(409).json({ message: "Please review warnings before submitting.", warnings: e.warnings });
      return;
    }
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to submit leave" });
  }
}

export async function handleListMyLeaveRequests(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const requests = await listMyLeaveRequests(user);
    res.json({ requests });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load requests" });
  }
}

export async function handleListPendingLeaveRequests(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const requests = await listApprovalInboxForUser(user);
    res.json({ requests });
  } catch (e) {
    res.status(statusFromError(e)).json({
      message: e instanceof Error ? e.message : "Failed to load pending approvals",
    });
  }
}

export async function handleListScopedLeaveRequests(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const q = (req.query as { q?: string }).q;
  try {
    const payload = await listScopedLeaveRequestsForViewer(user, q);
    res.json(payload);
  } catch (e) {
    res.status(statusFromError(e)).json({
      message: e instanceof Error ? e.message : "Failed to load leave requests",
    });
  }
}

export async function handleListAllLeaveRequests(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const requests = await listAllLeaveRequests(user);
    res.json({ requests });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load requests" });
  }
}

export async function handleEmployeeLeaveHistory(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const employeeId = req.params.employeeId;
  const year = (req.query as { year?: string }).year;
  try {
    const payload = await getEmployeeLeaveHistory(user, employeeId, year);
    res.json(payload);
  } catch (e) {
    res.status(statusFromError(e)).json({
      message: e instanceof Error ? e.message : "Failed to load leave history",
    });
  }
}

export async function handleDecideLeaveRequest(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ message: "Invalid request id" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const request = await decideLeaveRequest(user, id, {
      status: body.status,
      note: body.note ?? body.decisionNote,
    });
    res.json({ request });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to update request" });
  }
}

export async function handleCancelLeaveRequest(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ message: "Invalid request id" });
    return;
  }
  try {
    const request = await cancelLeaveRequest(user, id);
    res.json({ request });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to cancel request" });
  }
}
