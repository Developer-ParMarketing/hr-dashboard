import type { Request, Response } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import {
  deleteDocument,
  documentsMeta,
  getDocumentFile,
  getEmployeeDocumentsAdmin,
  getMyDocuments,
  listEmployeesWithDocumentStatus,
  uploadDocument,
  requireEmployeeIdForUser,
} from "./service.js";
import {
  savePreviousEmployersForEmployee,
} from "./previousEmployers.js";

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

export async function handleDocumentsMeta(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  res.json(documentsMeta(user));
}

export async function handleGetMyDocuments(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    res.json(await getMyDocuments(user));
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load documents" });
  }
}

export async function handleListEmployeesDocuments(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const employees = await listEmployeesWithDocumentStatus(user);
    res.json({ employees });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load employees" });
  }
}

export async function handleGetEmployeeDocuments(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const employeeId = Number.parseInt(String(req.params.employeeId ?? ""), 10);
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    res.status(400).json({ message: "Invalid employee id" });
    return;
  }
  try {
    res.json(await getEmployeeDocumentsAdmin(user, employeeId));
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load documents" });
  }
}

export async function handleUploadDocument(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (!file?.buffer) {
    res.status(400).json({ message: "Missing file (field name: file)" });
    return;
  }
  const documentType = String(req.body?.documentType ?? req.body?.document_type ?? "").trim();
  const slot = Number.parseInt(String(req.body?.slot ?? "0"), 10);
  try {
    const result = await uploadDocument(user, { documentType, slot: Number.isFinite(slot) ? slot : 0, file });
    res.status(201).json(result);
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Upload failed" });
  }
}

export async function handleDeleteDocument(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ message: "Invalid document id" });
    return;
  }
  try {
    await deleteDocument(user, id);
    res.json({ ok: true });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Delete failed" });
  }
}

export async function handleDownloadDocument(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ message: "Invalid document id" });
    return;
  }
  const inline = String(req.query.inline ?? "") === "1" || String(req.query.disposition ?? "") === "inline";
  try {
    const { buffer, fileName, mimeType } = await getDocumentFile(user, id);
    res.setHeader("Content-Type", mimeType);
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${fileName.replace(/"/g, "")}"`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(buffer);
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Download failed" });
  }
}

export async function handleSavePreviousEmployers(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const employeeId = await requireEmployeeIdForUser(user);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const employers = await savePreviousEmployersForEmployee(user, employeeId, body.employers);
    res.json({ previousEmployers: employers });
  } catch (e) {
    res.status(statusFromError(e)).json({
      message: e instanceof Error ? e.message : "Failed to save previous employer details",
    });
  }
}
