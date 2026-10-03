import type { Request, Response } from "express";
import fs from "fs";
import type { AuthedRequest } from "../auth/middleware.js";
import {
  createAppUser,
  deleteAppUser,
  listAppUsers,
  updateAppUser,
} from "../auth/adminUsers.js";
import {
  checkSimilarWorkEmails,
  createAdminEmployee,
  getAdminEmployee,
  listAdminEmployees,
  parseAdminEmployeeBody,
  updateAdminEmployee,
} from "../auth/adminEmployees.js";
import {
  getManagerAssignments,
  listEmployeesForAssignment,
  listManagers,
  setManagerAssignments,
} from "../auth/managerAssignments.js";
import { actorFromRequest } from "../auth/routes.js";
import {
  deleteSalaryWorkbook,
  getSalaryWorkbook,
  saveSalaryWorkbook,
} from "../salary/salaryWorkbook.js";

function parseRouteId(raw: string | string[] | undefined): number | null {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (text == null || text === "") return null;
  const id = Number.parseInt(text, 10);
  return Number.isFinite(id) ? id : null;
}

function parseOptionalInt(raw: unknown): number | undefined {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (text == null || text === "") return undefined;
  const n = Number.parseInt(String(text), 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseYearMonth(query: Record<string, unknown>): { year: number; month: number; company: string } | null {
  const year = Number.parseInt(String(query.year ?? ""), 10);
  const month = Number.parseInt(String(query.month ?? ""), 10);
  const company =
    (typeof query.company === "string" ? query.company : typeof query.companyName === "string" ? query.companyName : "")
      .trim() || "PM";
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month, company };
}

function statusFromError(e: unknown): number {
  return e instanceof Error && "status" in e && typeof (e as { status: number }).status === "number"
    ? (e as { status: number }).status
    : 500;
}

export async function handleListUsers(_req: Request, res: Response): Promise<void> {
  try {
    res.json({ users: await listAppUsers() });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to list users" });
  }
}

export async function handleCreateUser(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const user = await createAppUser({
      email: typeof body.email === "string" ? body.email : "",
      name: typeof body.name === "string" ? body.name : "",
      password: typeof body.password === "string" ? body.password : undefined,
      role: typeof body.role === "string" ? body.role : "viewer",
    });
    res.status(201).json({ user });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to create user" });
  }
}

export async function handleUpdateUser(req: Request, res: Response): Promise<void> {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid user id" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const authed = req as AuthedRequest;
  try {
    const user = await updateAppUser(
      id,
      {
        email: typeof body.email === "string" ? body.email : undefined,
        name: typeof body.name === "string" ? body.name : undefined,
        role: typeof body.role === "string" ? body.role : undefined,
        password: typeof body.password === "string" && body.password ? body.password : undefined,
      },
      authed.authUser?.id ?? 0,
    );
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    res.json({ user });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to update user" });
  }
}

export async function handleDeleteUser(req: Request, res: Response): Promise<void> {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid user id" });
    return;
  }
  const authed = req as AuthedRequest;
  const result = await deleteAppUser(id, authed.authUser?.id ?? 0);
  if (!result.ok) {
    res.status(result.status).json({ message: result.message });
    return;
  }
  res.json({ ok: true });
}

export async function handleGetSalaryWorkbook(req: Request, res: Response): Promise<void> {
  const parsed = parseYearMonth((req.query ?? {}) as Record<string, unknown>);
  if (!parsed) {
    res.status(400).json({ message: "year and month (1-12) query params are required" });
    return;
  }
  try {
    const workbook = await getSalaryWorkbook(parsed.year, parsed.month, parsed.company);
    res.json({ workbook });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to load salary workbook" });
  }
}

export async function handleSaveSalaryWorkbook(req: Request, res: Response): Promise<void> {
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file?.path) {
    res.status(400).json({ message: "Missing salary Excel file (field name: file)" });
    return;
  }
  const parsed = parseYearMonth((req.body ?? {}) as Record<string, unknown>);
  if (!parsed) {
    res.status(400).json({ message: "year and month (1-12) are required" });
    return;
  }

  try {
    const buffer = fs.readFileSync(file.path);
    const workbook = await saveSalaryWorkbook({
      buffer,
      fileName: file.originalname ?? "salary.xlsx",
      year: parsed.year,
      month: parsed.month,
      company: parsed.company,
      actor: actorFromRequest(req as AuthedRequest, req.body?.actor),
    });
    res.json({ workbook });
  } catch (e) {
    const status =
      statusFromError(e) === 500 && e instanceof Error && e.message.includes("Excel")
        ? 400
        : statusFromError(e);
    res.status(status).json({ message: e instanceof Error ? e.message : "Failed to save salary workbook" });
  } finally {
    fs.unlink(file.path, () => {});
  }
}

export async function handleDeleteSalaryWorkbook(req: Request, res: Response): Promise<void> {
  const parsed = parseYearMonth((req.query ?? {}) as Record<string, unknown>);
  if (!parsed) {
    res.status(400).json({ message: "year and month (1-12) query params are required" });
    return;
  }
  try {
    const removed = await deleteSalaryWorkbook(parsed.year, parsed.month, parsed.company);
    if (!removed) {
      res.status(404).json({ message: "No salary workbook registered for this period" });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to delete salary workbook" });
  }
}

export { handleGetSalaryWorkbook as handlePublicSalaryWorkbook };

export async function handleListManagers(_req: Request, res: Response): Promise<void> {
  try {
    res.json({ managers: await listManagers() });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to list managers" });
  }
}

export async function handleGetManagerAssignments(req: Request, res: Response): Promise<void> {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid manager id" });
    return;
  }
  try {
    res.json(await getManagerAssignments(id));
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load assignments" });
  }
}

export async function handleSetManagerAssignments(req: Request, res: Response): Promise<void> {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid manager id" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const employeeIds = Array.isArray(body.employeeIds)
    ? body.employeeIds
        .map((v) => Number.parseInt(String(v), 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  try {
    const result = await setManagerAssignments(
      id,
      employeeIds,
      actorFromRequest(req as AuthedRequest, body.actor),
    );
    res.json(result);
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to save assignments" });
  }
}

export async function handleListEmployeesForAssignment(req: Request, res: Response): Promise<void> {
  const company = typeof req.query.company === "string" ? req.query.company : undefined;
  try {
    res.json({ employees: await listEmployeesForAssignment(company) });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to list employees" });
  }
}

export async function handleListAdminEmployees(req: Request, res: Response): Promise<void> {
  const company = typeof req.query.company === "string" ? req.query.company : undefined;
  const registerYear = parseOptionalInt(req.query.registerYear);
  const registerMonth = parseOptionalInt(req.query.registerMonth);
  try {
    res.json({
      employees: await listAdminEmployees({
        company,
        registerYear,
        registerMonth,
      }),
    });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to list employees" });
  }
}

export async function handleCheckSimilarWorkEmail(req: Request, res: Response): Promise<void> {
  const email = typeof req.query.email === "string" ? req.query.email : "";
  const excludeRaw = typeof req.query.excludeEmployeeId === "string" ? req.query.excludeEmployeeId : "";
  const excludeEmployeeId =
    excludeRaw.trim() === "" ? null : Number.parseInt(excludeRaw, 10);
  if (!email.trim()) {
    res.status(400).json({ message: "email query parameter is required" });
    return;
  }
  try {
    const matches = await checkSimilarWorkEmails({
      email,
      excludeEmployeeId: Number.isFinite(excludeEmployeeId) ? excludeEmployeeId : null,
    });
    res.json({ matches });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Check failed" });
  }
}

export async function handleGetAdminEmployee(req: Request, res: Response): Promise<void> {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid employee id" });
    return;
  }
  const company = typeof req.query.company === "string" ? req.query.company : undefined;
  try {
    const employee = await getAdminEmployee(id, company);
    if (!employee) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }
    res.json({ employee });
  } catch (e) {
    res.status(500).json({ message: e instanceof Error ? e.message : "Failed to load employee" });
  }
}

export async function handleCreateAdminEmployee(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = parseAdminEmployeeBody(body);
  const company = parsed.company?.trim() || "PM";
  if (!parsed.employeeCode?.trim() || !parsed.name?.trim()) {
    res.status(400).json({ message: "employeeCode and name are required" });
    return;
  }
  if (!parsed.email?.trim()) {
    res.status(400).json({ message: "Work email is required" });
    return;
  }
  if (!parsed.salaryBase) {
    res.status(400).json({ message: "salaryBase with In Hand is required for new employees" });
    return;
  }
  try {
    const employee = await createAdminEmployee({
      employeeCode: parsed.employeeCode,
      name: parsed.name,
      email: parsed.email!,
      company,
      department: parsed.department ?? undefined,
      gender: parsed.gender ?? undefined,
      dateOfJoining: parsed.dateOfJoining ?? undefined,
      teamId: parsed.teamId,
      shiftStart: parsed.shiftStart ?? undefined,
      status: parsed.status ?? "active",
      salaryBase: parsed.salaryBase,
      actor: actorFromRequest(req as AuthedRequest, body.actor),
    });
    res.status(201).json({ employee });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to create employee" });
  }
}

export async function handleUpdateAdminEmployee(req: Request, res: Response): Promise<void> {
  const id = parseRouteId(req.params.id);
  if (id == null) {
    res.status(400).json({ message: "Invalid employee id" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parsed = parseAdminEmployeeBody(body);
  try {
    const employee = await updateAdminEmployee(id, {
      ...parsed,
      actor: actorFromRequest(req as AuthedRequest, body.actor),
    });
    if (!employee) {
      res.status(404).json({ message: "Employee not found" });
      return;
    }
    res.json({ employee });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to update employee" });
  }
}
