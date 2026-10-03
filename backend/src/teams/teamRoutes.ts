import type { Request, Response } from "express";
import { getTeamMembers, listTeams, seedPinnedEmployeeTeams, setTeamManager, setTeamMembers } from "../teams/teams.js";
import type { AuthedRequest } from "../auth/middleware.js";
import { actorFromRequest } from "../auth/middleware.js";

function parseRouteId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function statusFromError(e: unknown): number {
  if (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return 500;
}

export async function handleListTeams(_req: Request, res: Response): Promise<void> {
  try {
    res.json({ teams: await listTeams() });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to list teams" });
  }
}

export async function handleGetTeamMembers(req: Request, res: Response): Promise<void> {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid team id" });
    return;
  }
  try {
    res.json(await getTeamMembers(id));
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load team" });
  }
}

export async function handleSetTeamMembers(req: Request, res: Response): Promise<void> {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid team id" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const employeeIds = Array.isArray(body.employeeIds)
    ? body.employeeIds
        .map((v) => Number.parseInt(String(v), 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  try {
    const result = await setTeamMembers(
      id,
      employeeIds,
      actorFromRequest(req as AuthedRequest, body.actor),
    );
    res.json(result);
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to save team" });
  }
}

export async function handleReapplyTeamPins(_req: Request, res: Response): Promise<void> {
  try {
    await seedPinnedEmployeeTeams();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to reapply team pins" });
  }
}

export async function handleSetTeamManager(req: Request, res: Response): Promise<void> {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid team id" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = body.managerUserId;
  const managerUserId =
    raw === null || raw === undefined || raw === ""
      ? null
      : Number.parseInt(String(raw), 10);
  if (managerUserId != null && (!Number.isFinite(managerUserId) || managerUserId <= 0)) {
    res.status(400).json({ message: "Invalid managerUserId" });
    return;
  }
  try {
    const team = await setTeamManager(
      id,
      managerUserId,
      actorFromRequest(req as AuthedRequest, body.actor),
    );
    res.json({ team });
  } catch (e) {
    res.status(statusFromError(e)).json({
      message: e instanceof Error ? e.message : "Failed to update team manager",
    });
  }
}
