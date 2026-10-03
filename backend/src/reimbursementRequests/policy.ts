import type { AuthUser } from "../auth/users.js";
import { query, queryOne } from "../db/index.js";
import { executiveApproverLabel, isExecutiveLeaveApprover } from "../leaveRequests/approvers.js";

export const REIMBURSEMENT_SPECIAL_APPROVAL_SETTING_KEY = "reimbursement.special_approval_min_amount";
export const DEFAULT_SPECIAL_APPROVAL_MIN_AMOUNT = 2000;

export function canManageReimbursementPolicy(user: AuthUser): boolean {
  return isExecutiveLeaveApprover(user);
}

function parseStoredAmount(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const n = Number.parseFloat(raw.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export async function loadSpecialApprovalMinAmount(): Promise<number> {
  const row = await queryOne<{ value: unknown }>(
    `SELECT value FROM app_settings WHERE key = $1`,
    [REIMBURSEMENT_SPECIAL_APPROVAL_SETTING_KEY],
  );
  const parsed = parseStoredAmount(row?.value);
  return parsed ?? DEFAULT_SPECIAL_APPROVAL_MIN_AMOUNT;
}

export async function updateSpecialApprovalMinAmount(
  user: AuthUser,
  rawAmount: unknown,
  actorLabel: string,
): Promise<number> {
  if (!canManageReimbursementPolicy(user)) {
    throw Object.assign(new Error("You are not allowed to change reimbursement policy"), { status: 403 });
  }
  const amount = Number(typeof rawAmount === "string" ? rawAmount.trim() : rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error("Amount must be a positive number"), { status: 400 });
  }
  if (amount > 10_000_000) {
    throw Object.assign(new Error("Amount is too large"), { status: 400 });
  }
  const rounded = Math.round(amount * 100) / 100;
  await query(
    `INSERT INTO app_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, NOW(), $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [REIMBURSEMENT_SPECIAL_APPROVAL_SETTING_KEY, JSON.stringify(rounded), actorLabel],
  );
  return rounded;
}

export function specialApprovalFlagMessage(amount: number, threshold: number): string {
  return `Amount ${formatInr(amount)} exceeds ${formatInr(threshold)} and needs special approval from ${executiveApproverLabel()}.`;
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function amountNeedsSpecialApproval(amount: number, threshold: number): boolean {
  return amount > threshold;
}
