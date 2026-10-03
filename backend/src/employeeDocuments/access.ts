import { userCanEdit } from "../auth/middleware.js";
import type { AuthUser } from "../auth/users.js";
import { normalizeEmail } from "../leaveRequests/approvers.js";
import { canUseOfferLetters } from "../offerLetters/types.js";
import { isLeadershipReviewer } from "../performance/leadership.js";

const EXECUTIVE_DOCUMENT_VIEW_EMAILS = new Set([
  "devanshi.siddhpura@parmarketing.agency",
  "jiya.mehta@parmarketing.agency",
]);

/** HR/admin, Devanshi, Jiya, and leadership (Jay/Mansi) - full employee document review. */
export function canViewAllEmployeeDocuments(user: AuthUser | undefined): boolean {
  if (!user) return false;
  if (canUseOfferLetters(user)) return true;
  if (isLeadershipReviewer(user.email)) return true;
  return EXECUTIVE_DOCUMENT_VIEW_EMAILS.has(normalizeEmail(user.email));
}

/** Employees and managers upload; HR/operators use the all-employee view only. */
export function canUploadEmployeeDocuments(user: AuthUser | undefined): boolean {
  if (!user) return false;
  return !userCanEdit(user);
}
