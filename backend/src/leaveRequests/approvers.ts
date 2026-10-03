import { userCanEdit } from "../auth/middleware.js";
import type { AuthUser } from "../auth/users.js";

const EXECUTIVE_LEAVE_APPROVER_EMAILS = new Set([
  "devanshi.siddhpura@parmarketing.agency",
  "jiya.mehta@parmarketing.agency",
]);

export function executiveAdminNotificationEmails(): string[] {
  return [...EXECUTIVE_LEAVE_APPROVER_EMAILS];
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isExecutiveLeaveApprover(user: AuthUser): boolean {
  if (userCanEdit(user)) return true;
  return EXECUTIVE_LEAVE_APPROVER_EMAILS.has(normalizeEmail(user.email));
}

export function executiveApproverLabel(): string {
  return "HR";
}
