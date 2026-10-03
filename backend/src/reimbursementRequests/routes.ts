import type { Request, Response } from "express";
import type { AuthedRequest } from "../auth/middleware.js";
import {
  cancelReimbursementRequest,
  createReimbursementRequest,
  decideReimbursementRequest,
  listAllReimbursementRequests,
  listMyReimbursementRequests,
  listPendingReimbursementForUser,
  reimbursementRequestCapabilities,
  REIMBURSEMENT_CATEGORIES,
} from "./service.js";
import {
  canManageReimbursementPolicy,
  loadSpecialApprovalMinAmount,
  updateSpecialApprovalMinAmount,
} from "./policy.js";
import { SubmissionConfirmRequiredError } from "./submissionChecks.js";
import {
  addReceiptsToPendingRequest,
  getReceiptFile,
  MAX_RECEIPT_BYTES,
  MAX_RECEIPTS_PER_REQUEST,
} from "./receipts.js";

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

export async function handleReimbursementMeta(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const specialApprovalMinAmount = await loadSpecialApprovalMinAmount();
  res.json({
    categories: REIMBURSEMENT_CATEGORIES,
    capabilities: {
      ...reimbursementRequestCapabilities(user),
      canManageReimbursementPolicy: canManageReimbursementPolicy(user),
    },
    specialApprovalMinAmount,
    maxReceiptBytes: MAX_RECEIPT_BYTES,
    maxReceiptsPerClaim: MAX_RECEIPTS_PER_REQUEST,
    allowedReceiptMime: ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/jpg"],
  });
}

export async function handleUpdateReimbursementSpecialApprovalMin(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = body.amount ?? body.specialApprovalMinAmount ?? body.special_approval_min_amount;
  try {
    const amount = await updateSpecialApprovalMinAmount(user, raw, user.name || user.email);
    res.json({ specialApprovalMinAmount: amount });
  } catch (e) {
    res.status(statusFromError(e)).json({
      message: e instanceof Error ? e.message : "Failed to update policy",
    });
  }
}

export async function handleCreateReimbursement(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const files = (req as Request & { files?: Express.Multer.File[] }).files;
  try {
    const request = await createReimbursementRequest(
      user,
      {
        expenseDate: body.expenseDate ?? body.expense_date,
        category: body.category,
        amount: body.amount,
        description: body.description,
        acknowledgeFlags: body.acknowledgeFlags ?? body.acknowledge_flags,
      },
      files,
    );
    res.status(201).json({ request });
  } catch (e) {
    if (e instanceof SubmissionConfirmRequiredError) {
      res.status(409).json({ message: "Please review flags before submitting.", flags: e.flags });
      return;
    }
    res.status(statusFromError(e)).json({
      message: e instanceof Error ? e.message : "Failed to submit reimbursement",
    });
  }
}

export async function handleListMyReimbursements(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const requests = await listMyReimbursementRequests(user);
    res.json({ requests });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load requests" });
  }
}

export async function handleListPendingReimbursements(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const requests = await listPendingReimbursementForUser(user);
    res.json({ requests });
  } catch (e) {
    res.status(statusFromError(e)).json({
      message: e instanceof Error ? e.message : "Failed to load pending approvals",
    });
  }
}

export async function handleListAllReimbursements(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const requests = await listAllReimbursementRequests(user);
    res.json({ requests });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to load requests" });
  }
}

export async function handleDecideReimbursement(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ message: "Invalid request id" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    const request = await decideReimbursementRequest(user, id, {
      status: body.status,
      note: body.note ?? body.decisionNote,
    });
    res.json({ request });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to update request" });
  }
}

export async function handleCancelReimbursement(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ message: "Invalid request id" });
    return;
  }
  try {
    const request = await cancelReimbursementRequest(user, id);
    res.json({ request });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Failed to cancel request" });
  }
}

export async function handleUploadReimbursementReceipts(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const id = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ message: "Invalid request id" });
    return;
  }
  const files = (req as Request & { files?: Express.Multer.File[] }).files;
  try {
    const receipts = await addReceiptsToPendingRequest(user, id, files ?? []);
    res.status(201).json({ receipts });
  } catch (e) {
    res.status(statusFromError(e)).json({ message: e instanceof Error ? e.message : "Upload failed" });
  }
}

export async function handleDownloadReimbursementReceipt(req: Request, res: Response): Promise<void> {
  const user = requireUser(req, res);
  if (!user) return;
  const receiptId = Number.parseInt(String(req.params.receiptId ?? ""), 10);
  if (!Number.isFinite(receiptId) || receiptId <= 0) {
    res.status(400).json({ message: "Invalid receipt id" });
    return;
  }
  const inline = String(req.query.inline ?? "") === "1" || String(req.query.disposition ?? "") === "inline";
  try {
    const { buffer, fileName, mimeType } = await getReceiptFile(user, receiptId);
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
