import type { AuthUser } from "../auth/users.js";
import type {
  DashboardAction,
  DashboardChecklistItem,
  DashboardPendingApprovals,
  DashboardView,
} from "./dashboardService.js";
import { dashboardQuickLinksForUser, type DashboardQuickLinkDef } from "./dashboardQuickLinks.js";

export type DashboardNotificationTier = "critical" | "important" | "normal" | "shortcut";

export type DashboardNotification = {
  id: string;
  tier: DashboardNotificationTier;
  /** Higher = more urgent (ranked descending). */
  priorityScore: number;
  rank: number;
  title: string;
  message: string;
  href: string;
  actionLabel: string;
  moduleId: string | null;
  source: "action" | "checklist" | "approval" | "shortcut";
};

type Scored = DashboardNotification & { priorityScore: number };

const ACTION_WEIGHT: Record<string, number> = {
  "profile-unlinked": 98,
  "people-email-login-mismatch": 92,
  "teams-need-setup": 75,
  "people-missing-doj": 70,
  "people-not-in-register": 68,
  "team-attendance-missing": 65,
  "weekly-pending": 62,
  "approvals-pending": 58,
  "my-requests-pending": 35,
  "my-attendance-missing": 30,
  "payslip-ready": 28,
};

const CHECKLIST_WEIGHT: Record<string, number> = {
  "upload-attendance": 90,
  "approve-weeks": 85,
  "people-payroll-ready": 80,
  "sheet-errors": 78,
  "calculate-payroll": 72,
  "export-results": 40,
};

function tierFromScore(score: number, source: DashboardNotification["source"]): DashboardNotificationTier {
  if (source === "shortcut") return "shortcut";
  if (score >= 85) return "critical";
  if (score >= 55) return "important";
  return "normal";
}

function scoreAction(action: DashboardAction): number {
  let score = ACTION_WEIGHT[action.id] ?? 45;
  if (action.severity === "warning") score += 8;
  return score;
}

function scoreChecklist(item: DashboardChecklistItem): number {
  let score = CHECKLIST_WEIGHT[item.id] ?? 50;
  if (item.status === "blocked") score += 12;
  if (item.status === "todo") score += 6;
  if (item.status === "done") score -= 100;
  score += Math.max(0, 7 - item.step);
  return score;
}

function scoreShortcut(_link: DashboardQuickLinkDef, index: number): number {
  return Math.max(5, 22 - index * 2);
}

function moduleForActionId(id: string): string | null {
  if (id.includes("attendance") || id.includes("weekly")) return "attendance";
  if (id.includes("approvals") || id.includes("requests")) return "leaveRequest";
  if (id.includes("people") || id.includes("profile")) return "admin";
  if (id.includes("teams")) return "admin";
  if (id.includes("payslip")) return "payslip";
  return null;
}

function moduleForChecklistId(id: string): string | null {
  if (id.startsWith("upload") || id.includes("week")) return "attendance";
  if (id.includes("people")) return "admin";
  if (id.includes("sheet") || id.includes("calculate") || id.includes("export")) return "salary";
  return null;
}

function approvalNotifications(
  pending: DashboardPendingApprovals | null,
  view: DashboardView,
  skipDuplicate: boolean,
): Scored[] {
  if (skipDuplicate || !pending || view === "employee") return [];
  const total = pending.leave + pending.reimbursement + pending.portalPunch;
  if (total <= 0) return [];

  const parts: string[] = [];
  if (pending.leave > 0) parts.push(`${pending.leave} leave`);
  if (pending.reimbursement > 0) parts.push(`${pending.reimbursement} reimbursement`);
  if (pending.portalPunch > 0) parts.push(`${pending.portalPunch} in/out`);

  const score = 60 + Math.min(25, total * 3);
  return [
    {
      id: "notif-pending-approvals",
      tier: "important",
      priorityScore: score,
      rank: 0,
      title: "Pending approvals",
      message: `${total} request${total === 1 ? "" : "s"} waiting on you (${parts.join(", ")}).`,
      href: "/leave-request?tab=pending",
      actionLabel: "Review queue",
      moduleId: "leaveRequest",
      source: "approval",
    },
  ];
}

/**
 * Feature-weighted priority ranker (severity, payroll stage, blocking state, queue size).
 * Items are sorted so the most impactful work surfaces first after login.
 */
export function buildRankedDashboardNotifications(input: {
  user: AuthUser;
  view: DashboardView;
  actions: DashboardAction[];
  checklist: DashboardChecklistItem[] | null;
  pendingApprovals: DashboardPendingApprovals | null;
  salaryStale: boolean;
}): DashboardNotification[] {
  const candidates: Scored[] = [];

  for (const action of input.actions) {
    const priorityScore = scoreAction(action);
    candidates.push({
      id: `action-${action.id}`,
      tier: "normal",
      priorityScore,
      rank: 0,
      title: action.actionLabel,
      message: action.message,
      href: action.href,
      actionLabel: action.actionLabel,
      moduleId: moduleForActionId(action.id),
      source: "action",
    });
  }

  if (input.checklist) {
    for (const item of input.checklist) {
      if (item.status === "done") continue;
      const priorityScore = scoreChecklist(item);
      if (input.salaryStale && (item.id === "calculate-payroll" || item.id === "sheet-errors")) {
        candidates.push({
          id: `checklist-${item.id}-stale`,
          tier: "critical",
          priorityScore: 88,
          rank: 0,
          title: "Recalculate payroll",
          message: item.detail,
          href: item.href,
          actionLabel: item.actionLabel,
          moduleId: "salary",
          source: "checklist",
        });
      }
      candidates.push({
        id: `checklist-${item.id}`,
        tier: "normal",
        priorityScore,
        rank: 0,
        title: item.title,
        message: item.detail,
        href: item.href,
        actionLabel: item.actionLabel,
        moduleId: moduleForChecklistId(item.id),
        source: "checklist",
      });
    }
  }

  candidates.push(
    ...approvalNotifications(
      input.pendingApprovals,
      input.view,
      input.actions.some((a) => a.id === "approvals-pending"),
    ),
  );

  const shortcutLinks = dashboardQuickLinksForUser(input.user, input.view);
  const actionHrefs = new Set(candidates.map((c) => c.href.split("?")[0]));
  shortcutLinks.forEach((link, index) => {
    if (actionHrefs.has(link.href.split("?")[0])) return;
    const priorityScore = scoreShortcut(link, index);
    candidates.push({
      id: link.id,
      tier: "shortcut",
      priorityScore,
      rank: 0,
      title: link.title,
      message: link.hint,
      href: link.href,
      actionLabel: link.title,
      moduleId: link.moduleId,
      source: "shortcut",
    });
  });

  candidates.sort((a, b) => b.priorityScore - a.priorityScore || a.title.localeCompare(b.title));

  const seen = new Set<string>();
  const deduped: Scored[] = [];
  for (const item of candidates) {
    const key = `${item.source}:${item.href}:${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped.map((item, index) => ({
    ...item,
    rank: index + 1,
    tier: tierFromScore(item.priorityScore, item.source),
  }));
}

export type DashboardNotificationsMeta = {
  total: number;
  urgentCount: number;
  shortcutCount: number;
  loginReminder: string | null;
};

export function notificationsMeta(items: DashboardNotification[]): DashboardNotificationsMeta {
  const urgentItems = items.filter((n) => n.source !== "shortcut" && n.priorityScore >= 55);
  const uniqueUrgent = urgentItems.length;
  const shortcutCount = items.filter((n) => n.source === "shortcut").length;
  const loginReminder =
    uniqueUrgent > 0
      ? `You have ${uniqueUrgent} prioritized item${uniqueUrgent === 1 ? "" : "s"} to complete - sorted below from most to least important.`
      : items.length > 0
        ? "Shortcuts for your role are below - no urgent blockers right now."
        : null;

  return {
    total: items.length,
    urgentCount: uniqueUrgent,
    shortcutCount,
    loginReminder,
  };
}

export function buildDashboardNotificationsPayload(input: {
  user: AuthUser;
  view: DashboardView;
  actions: DashboardAction[];
  checklist: DashboardChecklistItem[] | null;
  pendingApprovals: DashboardPendingApprovals | null;
  salaryStale: boolean;
}): { notifications: DashboardNotification[]; notificationsMeta: DashboardNotificationsMeta } {
  const notifications = buildRankedDashboardNotifications(input);
  return { notifications, notificationsMeta: notificationsMeta(notifications) };
}
