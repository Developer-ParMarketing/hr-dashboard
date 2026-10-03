import { userCanEdit, userIsAdmin } from "../auth/middleware.js";
import type { AuthUser } from "../auth/users.js";
import { query, queryOne } from "../db/index.js";
import { isExecutiveLeaveApprover } from "../leaveRequests/approvers.js";
import {
  canViewAllRequests,
  parseDecisionStatus,
  parseIsoDate,
  pendingWithLabel,
  requestCapabilities,
  requireSubmitEmployeeId,
  resolveApprovalRoute,
  userCanDecideRequest,
  type ApprovalTier,
  type RequestStatus,
} from "../employeeRequests/workflow.js";

import {
  insertReceipts,
  listReceiptsForRequest,
  parseReceiptFiles,
  type ReimbursementReceiptMeta,
} from "./receipts.js";
import {
  assertReceiptsNotDuplicateElsewhere,
  buildReimbursementSubmissionFlags,
  SubmissionConfirmRequiredError,
} from "./submissionChecks.js";
import { amountNeedsSpecialApproval, loadSpecialApprovalMinAmount } from "./policy.js";

export type ReimbursementCategory = "travel" | "client" | "other";

export type ReimbursementRequestRow = {
  id: number;
  employee_id: number;
  requester_user_id: number;
  expense_date: string;
  category: ReimbursementCategory;
  amount: number;
  description: string;
  status: RequestStatus;
  approval_tier: ApprovalTier;
  assigned_approver_user_id: number | null;
  decided_by_user_id: number | null;
  decided_at: string | null;
  decision_note: string | null;
  submission_flags: unknown;
  requires_special_approval: boolean;
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
};

const CATEGORIES = new Set<ReimbursementCategory>(["travel", "client", "other"]);

const SELECT_BODY = `
  SELECT r.id, r.employee_id, r.requester_user_id, r.expense_date, r.category, r.amount,
         r.description, r.status, r.approval_tier, r.assigned_approver_user_id,
         r.decided_by_user_id, r.decided_at, r.decision_note, r.submission_flags,
         r.requires_special_approval, r.created_at, r.updated_at,
         e.employee_code, e.name AS employee_name,
         ru.name AS requester_name, ru.email AS requester_email,
         au.name AS assigned_approver_name, au.email AS assigned_approver_email,
         du.name AS decided_by_name, du.email AS decided_by_email
  FROM reimbursement_requests r
  JOIN employees e ON e.id = r.employee_id
  JOIN users ru ON ru.id = r.requester_user_id
  LEFT JOIN users au ON au.id = r.assigned_approver_user_id
  LEFT JOIN users du ON du.id = r.decided_by_user_id
`;

function parseFlagsJson(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function mapRow(row: ReimbursementRequestRow, receipts: ReimbursementReceiptMeta[] = []) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    requesterUserId: row.requester_user_id,
    expenseDate: row.expense_date,
    category: row.category,
    amount: row.amount,
    description: row.description,
    status: row.status,
    approvalTier: row.approval_tier,
    assignedApproverUserId: row.assigned_approver_user_id,
    assignedApproverName: row.assigned_approver_name,
    assignedApproverEmail: row.assigned_approver_email,
    pendingWithLabel: pendingWithLabel(row.status, row.approval_tier, row.assigned_approver_name),
    decidedByUserId: row.decided_by_user_id,
    decidedByName: row.decided_by_name,
    decidedByEmail: row.decided_by_email,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    submissionFlags: parseFlagsJson(row.submission_flags),
    requiresSpecialApproval: row.requires_special_approval,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    employeeCode: row.employee_code,
    employeeName: row.employee_name,
    requesterName: row.requester_name,
    requesterEmail: row.requester_email,
    receipts,
  };
}

async function mapRowWithReceipts(row: ReimbursementRequestRow) {
  const receipts = await listReceiptsForRequest(row.id);
  return mapRow(row, receipts);
}

async function mapRowsWithReceipts(rows: ReimbursementRequestRow[]) {
  const result = [];
  for (const row of rows) {
    result.push(await mapRowWithReceipts(row));
  }
  return result;
}

function parseCategory(raw: unknown): ReimbursementCategory {
  const c = String(raw ?? "")
    .trim()
    .toLowerCase() as ReimbursementCategory;
  if (!CATEGORIES.has(c)) {
    throw Object.assign(new Error("category must be travel, client, or other"), { status: 400 });
  }
  return c;
}

function parseAmount(raw: unknown): number {
  const amount = Number(typeof raw === "string" ? raw.trim() : raw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error("amount must be a positive number"), { status: 400 });
  }
  return Math.round(amount * 100) / 100;
}

export async function createReimbursementRequest(
  user: AuthUser,
  input: {
    expenseDate: unknown;
    category: unknown;
    amount: unknown;
    description?: unknown;
    acknowledgeFlags?: unknown;
  },
  receiptFiles?: Express.Multer.File[],
) {
  const employeeId = await requireSubmitEmployeeId(user, "reimbursement");
  const expenseDate = parseIsoDate(input.expenseDate, "expenseDate");
  const category = parseCategory(input.category);
  const amount = parseAmount(input.amount);
  const description = String(input.description ?? "").trim();

  const specialApprovalMinAmount = await loadSpecialApprovalMinAmount();
  const requiresSpecialApproval = amountNeedsSpecialApproval(amount, specialApprovalMinAmount);

  let { approvalTier, assignedApproverUserId } = await resolveApprovalRoute(user, employeeId);
  if (requiresSpecialApproval) {
    approvalTier = "leadership_hr";
    assignedApproverUserId = null;
  }

  const files = parseReceiptFiles(receiptFiles);
  if (!files.length) {
    throw Object.assign(new Error("At least one receipt is required"), { status: 400 });
  }

  await assertReceiptsNotDuplicateElsewhere(files);

  const submissionFlags = await buildReimbursementSubmissionFlags({
    employeeId,
    amount,
    specialApprovalMinAmount,
  });
  const acknowledge =
    input.acknowledgeFlags === true ||
    String(input.acknowledgeFlags ?? "").trim().toLowerCase() === "true";
  if (submissionFlags.length > 0 && !acknowledge) {
    throw new SubmissionConfirmRequiredError(submissionFlags);
  }

  const inserted = await queryOne<{ id: number }>(
    `INSERT INTO reimbursement_requests (
       employee_id, requester_user_id, expense_date, category, amount, description,
       status, approval_tier, assigned_approver_user_id, submission_flags, requires_special_approval, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9::jsonb, $10, NOW())
     RETURNING id`,
    [
      employeeId,
      user.id,
      expenseDate,
      category,
      amount,
      description,
      approvalTier,
      assignedApproverUserId,
      JSON.stringify(submissionFlags),
      requiresSpecialApproval,
    ],
  );
  if (!inserted) {
    throw Object.assign(new Error("Failed to create reimbursement request"), { status: 500 });
  }

  await insertReceipts(inserted.id, user.id, files);

  const row = await queryOne<ReimbursementRequestRow>(`${SELECT_BODY} WHERE r.id = $1`, [inserted.id]);
  if (!row) {
    throw Object.assign(new Error("Reimbursement request not found after create"), { status: 500 });
  }
  return mapRowWithReceipts(row);
}

export async function listMyReimbursementRequests(user: AuthUser) {
  const rows = await query<ReimbursementRequestRow>(
    `${SELECT_BODY} WHERE r.requester_user_id = $1 ORDER BY r.created_at DESC, r.id DESC`,
    [user.id],
  );
  return mapRowsWithReceipts(rows);
}

export async function listPendingReimbursementForUser(user: AuthUser) {
  const rows: ReimbursementRequestRow[] = [];

  const managerRows = await query<ReimbursementRequestRow>(
    `${SELECT_BODY}
     WHERE r.status = 'pending'
       AND r.approval_tier = 'manager'
       AND r.assigned_approver_user_id = $1
     ORDER BY r.expense_date ASC, r.id ASC`,
    [user.id],
  );
  rows.push(...managerRows);

  if (isExecutiveLeaveApprover(user)) {
    const execRows = await query<ReimbursementRequestRow>(
      `${SELECT_BODY}
       WHERE r.status = 'pending' AND r.approval_tier = 'leadership_hr'
       ORDER BY r.expense_date ASC, r.id ASC`,
    );
    rows.push(...execRows);
  }

  const seen = new Set<number>();
  return mapRowsWithReceipts(
    rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true))),
  );
}

export async function listAllReimbursementRequests(user: AuthUser) {
  if (!canViewAllRequests(user)) {
    throw Object.assign(new Error("You do not have access to all reimbursement requests"), { status: 403 });
  }
  const rows = await query<ReimbursementRequestRow>(
    `${SELECT_BODY} ORDER BY r.created_at DESC, r.id DESC LIMIT 500`,
  );
  return mapRowsWithReceipts(rows);
}

async function getById(id: number): Promise<ReimbursementRequestRow | null> {
  const row = await queryOne<ReimbursementRequestRow>(`${SELECT_BODY} WHERE r.id = $1`, [id]);
  return row ?? null;
}

export async function decideReimbursementRequest(
  user: AuthUser,
  id: number,
  input: { status: unknown; note?: unknown },
) {
  const statusRaw = parseDecisionStatus(input.status);
  const decisionNote = String(input.note ?? "").trim();

  const row = await getById(id);
  if (!row) {
    throw Object.assign(new Error("Reimbursement request not found"), { status: 404 });
  }
  if (row.requester_user_id === user.id) {
    throw Object.assign(new Error("You cannot approve or reject your own reimbursement request"), {
      status: 403,
    });
  }
  if (!userCanDecideRequest(user, row)) {
    throw Object.assign(new Error("You are not allowed to decide on this reimbursement request"), {
      status: 403,
    });
  }

  await query(
    `UPDATE reimbursement_requests
     SET status = $2, decided_by_user_id = $3, decided_at = NOW(), decision_note = $4, updated_at = NOW()
     WHERE id = $1 AND status = 'pending'`,
    [id, statusRaw, user.id, decisionNote || null],
  );

  const updated = await getById(id);
  if (!updated) {
    throw Object.assign(new Error("Reimbursement request not found"), { status: 404 });
  }
  return mapRowWithReceipts(updated);
}

export async function cancelReimbursementRequest(user: AuthUser, id: number) {
  const row = await getById(id);
  if (!row) {
    throw Object.assign(new Error("Reimbursement request not found"), { status: 404 });
  }
  if (row.requester_user_id !== user.id && !userIsAdmin(user) && !userCanEdit(user)) {
    throw Object.assign(new Error("You can only cancel your own reimbursement requests"), { status: 403 });
  }
  if (row.status !== "pending") {
    throw Object.assign(new Error("Only pending requests can be cancelled"), { status: 400 });
  }

  await query(`UPDATE reimbursement_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [id]);

  const updated = await getById(id);
  if (!updated) {
    throw Object.assign(new Error("Reimbursement request not found"), { status: 404 });
  }
  return mapRowWithReceipts(updated);
}

export function reimbursementRequestCapabilities(user: AuthUser) {
  return requestCapabilities(user);
}

export const REIMBURSEMENT_CATEGORIES = [
  { id: "travel" as const, label: "Travel" },
  { id: "client" as const, label: "Client visit" },
  { id: "other" as const, label: "Other" },
];
