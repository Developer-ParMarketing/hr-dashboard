import type { AuthUser } from "../auth/users.js";
import { query, queryOne } from "../db/index.js";
import { assertReceiptsNotDuplicateElsewhere, receiptContentSha256 } from "./submissionChecks.js";
import { canViewAllRequests, userCanDecideRequest, type ApprovalTier, type RequestStatus } from "../employeeRequests/workflow.js";
import { isExecutiveLeaveApprover } from "../leaveRequests/approvers.js";

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const MAX_RECEIPTS_PER_REQUEST = 5;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/jpg",
]);

export type ReimbursementReceiptMeta = {
  id: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
};

export function parseReceiptFiles(files: Express.Multer.File[] | undefined): Express.Multer.File[] {
  if (!files?.length) return [];
  return files.filter((f) => f.buffer?.length);
}

export function validateReceiptFile(file: Express.Multer.File): void {
  const buffer = file.buffer;
  if (!buffer?.length) {
    throw Object.assign(new Error("Empty file"), { status: 400 });
  }
  if (buffer.length > MAX_RECEIPT_BYTES) {
    throw Object.assign(new Error("Each receipt must be 10 MB or smaller"), { status: 400 });
  }
  const mime = (file.mimetype || "application/octet-stream").toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    throw Object.assign(new Error("Allowed receipt formats: PDF, JPEG, PNG, WebP"), { status: 400 });
  }
}

export function sanitizeReceiptFileName(raw: string): string {
  return (raw || "receipt").replace(/[^\w.\- ()]/g, "_").slice(0, 200);
}

export async function countReceiptsForRequest(requestId: number): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM reimbursement_receipts WHERE reimbursement_request_id = $1`,
    [requestId],
  );
  return row?.n ?? 0;
}

export async function insertReceipts(
  requestId: number,
  userId: number,
  files: Express.Multer.File[],
): Promise<void> {
  if (!files.length) return;
  const existing = await countReceiptsForRequest(requestId);
  if (existing + files.length > MAX_RECEIPTS_PER_REQUEST) {
    throw Object.assign(
      new Error(`You can attach up to ${MAX_RECEIPTS_PER_REQUEST} receipts per claim`),
      { status: 400 },
    );
  }
  for (const file of files) {
    validateReceiptFile(file);
    const fileName = sanitizeReceiptFileName(file.originalname);
    const mime = (file.mimetype || "application/octet-stream").toLowerCase();
    await query(
      `INSERT INTO reimbursement_receipts (
         reimbursement_request_id, file_name, mime_type, file_data, file_size, content_sha256, uploaded_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        requestId,
        fileName,
        mime,
        file.buffer,
        file.buffer!.length,
        receiptContentSha256(file.buffer),
        userId,
      ],
    );
  }
}

export function mapReceiptRow(row: {
  id: number;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_at: string;
}): ReimbursementReceiptMeta {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    uploadedAt: row.uploaded_at,
  };
}

export async function listReceiptsForRequest(requestId: number): Promise<ReimbursementReceiptMeta[]> {
  const rows = await query<{
    id: number;
    file_name: string;
    mime_type: string;
    file_size: number;
    uploaded_at: string;
  }>(
    `SELECT id, file_name, mime_type, file_size, uploaded_at
     FROM reimbursement_receipts
     WHERE reimbursement_request_id = $1
     ORDER BY id ASC`,
    [requestId],
  );
  return rows.map(mapReceiptRow);
}

export function userCanAccessReimbursementRequest(
  user: AuthUser,
  row: {
    requester_user_id: number;
    approval_tier: ApprovalTier;
    assigned_approver_user_id: number | null;
    status: RequestStatus;
  },
): boolean {
  if (row.requester_user_id === user.id) return true;
  if (canViewAllRequests(user)) return true;
  if (row.assigned_approver_user_id === user.id) return true;
  if (row.approval_tier === "leadership_hr" && isExecutiveLeaveApprover(user)) return true;
  if (userCanDecideRequest(user, row)) return true;
  return false;
}

export async function getRequestForReceiptAccess(user: AuthUser, requestId: number) {
  const row = await queryOne<{
    id: number;
    requester_user_id: number;
    approval_tier: ApprovalTier;
    assigned_approver_user_id: number | null;
    status: RequestStatus;
  }>(
    `SELECT id, requester_user_id, approval_tier, assigned_approver_user_id, status
     FROM reimbursement_requests WHERE id = $1`,
    [requestId],
  );
  if (!row) {
    throw Object.assign(new Error("Reimbursement request not found"), { status: 404 });
  }
  if (!userCanAccessReimbursementRequest(user, row)) {
    throw Object.assign(new Error("You do not have access to this reimbursement claim"), { status: 403 });
  }
  return row;
}

export async function getReceiptFile(
  user: AuthUser,
  receiptId: number,
): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
  const row = await queryOne<{
    id: number;
    reimbursement_request_id: number;
    file_name: string;
    mime_type: string;
    file_data: Buffer;
  }>(
    `SELECT id, reimbursement_request_id, file_name, mime_type, file_data
     FROM reimbursement_receipts WHERE id = $1`,
    [receiptId],
  );
  if (!row) {
    throw Object.assign(new Error("Receipt not found"), { status: 404 });
  }
  await getRequestForReceiptAccess(user, row.reimbursement_request_id);
  return {
    buffer: row.file_data,
    fileName: row.file_name,
    mimeType: row.mime_type,
  };
}

export async function addReceiptsToPendingRequest(
  user: AuthUser,
  requestId: number,
  files: Express.Multer.File[],
) {
  const row = await getRequestForReceiptAccess(user, requestId);
  if (row.requester_user_id !== user.id) {
    throw Object.assign(new Error("Only the claim submitter can upload receipts"), { status: 403 });
  }
  if (row.status !== "pending") {
    throw Object.assign(new Error("Receipts can only be added while the claim is pending"), { status: 400 });
  }
  const parsed = parseReceiptFiles(files);
  if (!parsed.length) {
    throw Object.assign(new Error("Missing file (field name: receipt)"), { status: 400 });
  }
  await assertReceiptsNotDuplicateElsewhere(parsed, requestId);
  await insertReceipts(requestId, user.id, parsed);
  return listReceiptsForRequest(requestId);
}
