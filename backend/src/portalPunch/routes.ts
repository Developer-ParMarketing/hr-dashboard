import type { Request, Response } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import {
  decidePortalPunch,
  getEmployeePortalPunchHistory,
  getPortalPunchToday,
  listAllPortalPunches,
  listApprovalInboxPortalPunches,
  listMyPortalPunches,
  listScopedPortalPunchesForViewer,
  portalPunchMeta,
  punchCheckIn,
  punchCheckOut,
} from "./service.js";

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

export async function handlePortalPunchMeta(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const meta = portalPunchMeta(user);
  try {
    const state = await getPortalPunchToday(user);
    res.json({ ...meta, ...state });
  } catch (e) {
    res.json({ ...meta, today: null, punch: null });
  }
}

export async function handlePortalCheckIn(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const result = await punchCheckIn(user, body.clientTime ?? body.client_time);
    res.status(201).json(result);
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Check-in failed" });
  }
}

export async function handlePortalCheckOut(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const result = await punchCheckOut(user, body.clientTime ?? body.client_time);
    res.json(result);
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Check-out failed" });
  }
}

export async function handleListMyPortalPunches(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const punches = await listMyPortalPunches(user);
    res.json({ punches });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load records" });
  }
}

export async function handleListPendingPortalPunches(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const punches = await listApprovalInboxPortalPunches(user);
    res.json({ punches });
  } catch (e) {
    res.status(statusFromError(e)).json({
      message: e instanceof Error ? e.message : "Failed to load pending approvals",
    });
  }
}

export async function handleListAllPortalPunches(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const punches = await listAllPortalPunches(user);
    res.json({ punches });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load records" });
  }
}

export async function handleListScopedPortalPunches(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const q = (req.query as { q?: string }).q;
  try {
    const payload = await listScopedPortalPunchesForViewer(user, q);
    res.json(payload);
  } catch (e) {
    res.status(statusFromError(e)).json({
      message: e instanceof Error ? e.message : "Failed to load in/out records",
    });
  }
}

export async function handleEmployeePortalPunchHistory(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const employeeId = req.params.employeeId;
  const year = (req.query as { year?: string }).year;
  try {
    const payload = await getEmployeePortalPunchHistory(user, employeeId, year);
    res.json(payload);
  } catch (e) {
    res.status(statusFromError(e)).json({
      message: e instanceof Error ? e.message : "Failed to load in/out history",
    });
  }
}

export async function handleDecidePortalPunch(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ message: "Invalid record id" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const punch = await decidePortalPunch(user, id, {
      leg: body.leg ?? body.punchLeg ?? body.kind,
      status: body.status,
      note: body.note ?? body.decisionNote,
    });
    res.json({ punch });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to update record" });
  }
}
