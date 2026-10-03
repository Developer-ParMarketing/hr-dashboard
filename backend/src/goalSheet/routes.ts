import type { Request, Response } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import { userCanEdit, userIsAdmin } from "../auth/middleware.js";
import {
  buildGoalSheetSubmissionView,
  getGoalSheetRatingScale,
  listAdminGoalSheetSummaries,
  listLeadershipGoalSheetSummaries,
  listTeamGoalSheetSummaries,
  resolveDefaultGoalSheetCycleYear,
  resolveMyEmployeeId,
  saveGoalSheetSubmission,
} from "./service.js";
import { coerceCycleYearForView, defaultCycleYearForPolicy } from "../cycleForm/windowPolicy.js";

function parseYear(raw: unknown): number | null {
  const year = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;
  return year;
}

function parseEmployeeId(raw: unknown): number | null {
  const id = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  return id;
}

function statusFromError(e: unknown): number {
  if (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number") {
    return (e as { status: number }).status;
  }
  return 500;
}

async function resolveGoalSheetYear(raw: unknown, employeeId?: number | null): Promise<number> {
  const active =
    employeeId != null
      ? await resolveDefaultGoalSheetCycleYear(employeeId)
      : defaultCycleYearForPolicy({ kind: "goal_sheet_january", doj: null });
  const parsed = parseYear(raw);
  if (parsed == null) return active;
  return coerceCycleYearForView(parsed, active);
}

export async function handleGetGoalSheetMeta(_req: Request, res: Response): Promise<void> {
  res.json({ ratingScale: getGoalSheetRatingScale() });
}

export async function handleGetMyGoalSheet(req: Request, res: Response): Promise<void> {
  const user = (req as AuthedRequest).authUser;
  if (!user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  try {
    const employeeId = await resolveMyEmployeeId(user);
    const year = await resolveGoalSheetYear(req.query.year, employeeId);
    if (employeeId == null) {
      if (userIsAdmin(user) || userCanEdit(user)) {
        res.json({ linked: false, submission: null });
        return;
      }
      res.status(404).json({
        message:
          "Your login is not linked to an employee profile. Ask HR to add your work email on your employee record.",
      });
      return;
    }
    res.json({ linked: true, submission: await buildGoalSheetSubmissionView(user, employeeId, year) });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load goal sheet" });
  }
}

export async function handleGetGoalSheetForEmployee(req: Request, res: Response): Promise<void> {
  const user = (req as AuthedRequest).authUser;
  if (!user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const employeeId = parseEmployeeId(req.params.employeeId);
  if (employeeId == null) {
    res.status(400).json({ message: "Invalid employee id" });
    return;
  }
  const year = await resolveGoalSheetYear(req.query.year, employeeId);
  try {
    res.json({ submission: await buildGoalSheetSubmissionView(user, employeeId, year) });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load goal sheet" });
  }
}

export async function handleListTeamGoalSheet(req: Request, res: Response): Promise<void> {
  const user = (req as AuthedRequest).authUser;
  if (!user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const year = await resolveGoalSheetYear(req.query.year);
  try {
    res.json({ year, members: await listTeamGoalSheetSummaries(user, year) });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to list team" });
  }
}

export async function handleSaveGoalSheet(req: Request, res: Response): Promise<void> {
  const user = (req as AuthedRequest).authUser;
  if (!user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const employeeId = parseEmployeeId(req.params.employeeId);
  if (employeeId == null) {
    res.status(400).json({ message: "Invalid employee id" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const year = await resolveGoalSheetYear(body.year ?? req.query.year, employeeId);
  const rawRole = String(body.role ?? "employee");
  const role =
    rawRole === "manager"
      ? "manager"
      : rawRole === "management"
        ? "management"
        : "employee";
  const submit = body.submit === true;

  const parseOptionalRating = (value: unknown): number | null | undefined => {
    if (value === null) return null;
    if (value === undefined || value === "") return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };

  try {
    const submission = await saveGoalSheetSubmission(user, employeeId, year, {
      role,
      submit,
      overallRating: parseOptionalRating(body.overallRating),
      overallComments:
        body.overallComments === undefined
          ? undefined
          : body.overallComments === null
            ? null
            : String(body.overallComments),
      answers: Array.isArray(body.answers)
        ? body.answers.map((row) => {
            const item = row as Record<string, unknown>;
            return {
              criterionIndex: Number.parseInt(String(item.criterionIndex ?? ""), 10),
              rating: parseOptionalRating(item.rating),
              comments: item.comments as string | null | undefined,
            };
          })
        : [],
    });
    res.json({ submission });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to save goal sheet" });
  }
}

export async function handleListLeadershipGoalSheet(req: Request, res: Response): Promise<void> {
  const user = (req as AuthedRequest).authUser;
  if (!user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  const year = await resolveGoalSheetYear(req.query.year);
  try {
    res.json({ year, members: await listLeadershipGoalSheetSummaries(user, year) });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to list leadership queue" });
  }
}

export async function handleAdminListGoalSheet(req: Request, res: Response): Promise<void> {
  const user = (req as AuthedRequest).authUser;
  if (!user) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  if (!userIsAdmin(user) && !userCanEdit(user)) {
    res.status(403).json({ message: "Admin or HR permission is required." });
    return;
  }
  const year = await resolveGoalSheetYear(req.query.year);
  try {
    res.json({ year, rows: await listAdminGoalSheetSummaries(year) });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to list goal sheets" });
  }
}
