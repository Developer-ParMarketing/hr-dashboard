import type { AttendanceScope } from "../auth/attendanceScope.js";
import { userCanEdit, userIsManager } from "../auth/middleware.js";
import type { AuthUser } from "../auth/users.js";
import { isManagementRequestOversight } from "../employeeRequests/workflow.js";
import { mergeEmployeeScope } from "./dateRange.js";

export type DashboardView = "operations" | "manager" | "employee";

/**
 * Employee IDs used for dashboard metrics (attendance, people, roster, scoped payroll).
 * HR / leadership oversight: company roster, optional employee filter.
 * Managers: assigned team, optional filter.
 * Everyone else: own record only.
 */
export function resolveDashboardEmployeeScope(
  user: AuthUser,
  attendanceScope: AttendanceScope,
  employeeIdsFilter: number[] | null,
): number[] | null {
  if (userCanEdit(user)) {
    return mergeEmployeeScope(null, employeeIdsFilter);
  }
  if (userIsManager(user)) {
    return mergeEmployeeScope(attendanceScope.restrictToEmployeeIds, employeeIdsFilter);
  }
  if (isManagementRequestOversight(user)) {
    return mergeEmployeeScope(null, employeeIdsFilter);
  }
  return mergeEmployeeScope(attendanceScope.restrictToEmployeeIds, employeeIdsFilter);
}

export function resolveDashboardView(
  user: AuthUser,
  scopeMode: AttendanceScope["mode"],
  canEdit: boolean,
): DashboardView {
  if (canEdit) return "operations";
  if (scopeMode === "team" || userIsManager(user)) return "manager";
  if (isManagementRequestOversight(user)) return "manager";
  return "employee";
}
