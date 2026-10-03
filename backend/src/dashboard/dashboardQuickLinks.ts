import type { AuthUser } from "../auth/users.js";
import { userCanEdit, userIsManager } from "../auth/middleware.js";
import { isManagementRequestOversight } from "../employeeRequests/workflow.js";

export type DashboardQuickLinkDef = {
  id: string;
  moduleId: string;
  href: string;
  title: string;
  hint: string;
};

const EMPLOYEE_LINKS: DashboardQuickLinkDef[] = [
  { id: "ql-leave", moduleId: "leaveRequest", href: "/leave-request", title: "Leave request", hint: "Apply or track leave" },
  { id: "ql-inout", moduleId: "inOutRequest", href: "/in-out-request", title: "In / out", hint: "Portal punch & corrections" },
  { id: "ql-reimb", moduleId: "reimbursement", href: "/reimbursement", title: "Reimbursement", hint: "Submit expense claims" },
  { id: "ql-docs", moduleId: "documents", href: "/documents", title: "Documents", hint: "Upload onboarding files" },
  { id: "ql-attendance", moduleId: "attendance", href: "/attendance", title: "My attendance", hint: "View your register" },
];

const MANAGER_LINKS: DashboardQuickLinkDef[] = [
  { id: "ql-approve", moduleId: "leaveRequest", href: "/leave-request", title: "Approve requests", hint: "Leave, reimbursement, in/out" },
  { id: "ql-team-att", moduleId: "attendance", href: "/attendance", title: "Team attendance", hint: "Review & approve weeks" },
  { id: "ql-perf", moduleId: "performance", href: "/performance", title: "Appraisals", hint: "Team performance forms" },
  { id: "ql-reports", moduleId: "reports", href: "/reports/leave", title: "Reports", hint: "Leave & in/out" },
];

const HR_LINKS: DashboardQuickLinkDef[] = [
  { id: "ql-upload", moduleId: "attendance", href: "/attendance", title: "Attendance", hint: "Upload register" },
  { id: "ql-att-hist", moduleId: "attendanceDetail", href: "/attendance-detail", title: "Attendance history", hint: "Review & approve monthly" },
  { id: "ql-payroll", moduleId: "salary", href: "/salary", title: "Salary", hint: "Run payroll" },
  { id: "ql-people", moduleId: "admin", href: "/admin?section=people", title: "People", hint: "Add person" },
  { id: "ql-leave-pending", moduleId: "leaveRequest", href: "/leave-request?tab=pending", title: "Leave approvals", hint: "Pending leave" },
];

export function dashboardQuickLinksForUser(user: AuthUser, view: "operations" | "manager" | "employee"): DashboardQuickLinkDef[] {
  if (view === "operations" && userCanEdit(user)) {
    return HR_LINKS;
  }
  if (view === "manager" || isManagementRequestOversight(user) || userIsManager(user)) {
    return MANAGER_LINKS;
  }
  return EMPLOYEE_LINKS;
}
