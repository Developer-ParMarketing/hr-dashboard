import { createHash } from "crypto";
import { query } from "../db/index.js";
import { specialApprovalFlagMessage } from "./policy.js";

export type ReimbursementSubmissionFlag = string;

export function receiptContentSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function assertReceiptsNotDuplicateElsewhere(
  files: Express.Multer.File[],
  excludeRequestId?: number | null,
): Promise<void> {
  for (const file of files) {
    const buf = file.buffer;
    if (!buf?.length) continue;
    const sha = receiptContentSha256(buf);
    const row = await query<{ request_id: number; status: string; file_name: string }>(
      `SELECT rr.reimbursement_request_id AS request_id, r.status, rr.file_name
       FROM reimbursement_receipts rr
       JOIN reimbursement_requests r ON r.id = rr.reimbursement_request_id
       WHERE rr.content_sha256 = $1
         AND r.status <> 'cancelled'
         AND ($2::int IS NULL OR rr.reimbursement_request_id <> $2)
       LIMIT 1`,
      [sha, excludeRequestId ?? null],
    );
    if (row[0]) {
      throw Object.assign(
        new Error(
          `Receipt "${file.originalname || row[0].file_name}" matches a file already submitted on claim #${row[0].request_id} (${row[0].status}). Use a different receipt.`,
        ),
        { status: 409 },
      );
    }
  }
}

export async function buildReimbursementSubmissionFlags(input: {
  employeeId: number;
  amount: number;
  specialApprovalMinAmount?: number;
}): Promise<ReimbursementSubmissionFlag[]> {
  const flags: ReimbursementSubmissionFlag[] = [];
  const threshold = input.specialApprovalMinAmount;
  if (threshold != null && Number.isFinite(threshold) && input.amount > threshold) {
    flags.push(specialApprovalFlagMessage(input.amount, threshold));
  }
  const past = await query<{ amount: number }>(
    `SELECT amount::float8 AS amount
     FROM reimbursement_requests
     WHERE employee_id = $1 AND status = 'approved'
     ORDER BY decided_at DESC NULLS LAST
     LIMIT 24`,
    [input.employeeId],
  );
  if (past.length < 3) return flags;

  const amounts = past.map((r) => Number(r.amount)).filter((n) => Number.isFinite(n) && n > 0);
  if (amounts.length < 3) return flags;

  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance =
    amounts.reduce((sum, n) => sum + (n - mean) ** 2, 0) / Math.max(1, amounts.length - 1);
  const std = Math.sqrt(variance);
  const maxPast = Math.max(...amounts);
  const highVsMean = mean > 0 && input.amount > mean + Math.max(std * 2, mean * 0.75);
  const highVsMax = maxPast > 0 && input.amount > maxPast * 2;

  if (highVsMean || highVsMax) {
    flags.push(
      `Amount ₹${input.amount.toFixed(2)} is higher than your usual approved claims (recent average about ₹${mean.toFixed(0)}). Your manager will still review this claim.`,
    );
  }
  return flags;
}

export class SubmissionConfirmRequiredError extends Error {
  status = 409;
  flags: string[];
  constructor(flags: string[]) {
    super("Confirmation required");
    this.name = "SubmissionConfirmRequiredError";
    this.flags = flags;
  }
}
