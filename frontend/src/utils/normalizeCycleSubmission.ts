import type { AppraisalSubmission } from '../api/performance'

function bool(raw: unknown, fallback = false): boolean {
  if (typeof raw === 'boolean') return raw
  if (raw === 'true' || raw === 1) return true
  if (raw === 'false' || raw === 0) return false
  return fallback
}

/** Normalize API payloads (handles stale servers or snake_case). */
export function normalizeCycleSubmission(raw: AppraisalSubmission): AppraisalSubmission {
  const r = raw as AppraisalSubmission & Record<string, unknown>
  return {
    ...raw,
    canEditEmployeeFields: bool(
      r.canEditEmployeeFields ?? r.can_edit_employee_fields,
      raw.canEditEmployeeFields ?? true,
    ),
    canEditManagerFields: bool(
      r.canEditManagerFields ?? r.can_edit_manager_fields,
      raw.canEditManagerFields ?? false,
    ),
    canEditManagementFields: bool(
      r.canEditManagementFields ?? r.can_edit_management_fields,
      raw.canEditManagementFields ?? false,
    ),
    showManagerReview: bool(r.showManagerReview ?? r.show_manager_review, raw.showManagerReview ?? true),
    showManagementReview: bool(
      r.showManagementReview ?? r.show_management_review,
      raw.showManagementReview ?? false,
    ),
    overallEmployeeComments:
      (r.overallEmployeeComments as string | null | undefined) ??
      (r.overall_employee_comments as string | null | undefined) ??
      raw.overallEmployeeComments ??
      null,
    overallManagerComments:
      (r.overallManagerComments as string | null | undefined) ??
      (r.overall_manager_comments as string | null | undefined) ??
      raw.overallManagerComments ??
      null,
    overallManagementComments:
      (r.overallManagementComments as string | null | undefined) ??
      (r.overall_management_comments as string | null | undefined) ??
      raw.overallManagementComments ??
      null,
    historyCycleYears: (r.historyCycleYears as number[] | undefined) ??
      (r.history_cycle_years as number[] | undefined) ??
      raw.historyCycleYears ??
      [],
    activeCycleYear:
      (r.activeCycleYear as number | undefined) ??
      (r.active_cycle_year as number | undefined) ??
      raw.activeCycleYear ??
      raw.cycleYear,
    employeeWindowOpen: bool(
      r.employeeWindowOpen ?? r.employee_window_open,
      raw.employeeWindowOpen ?? false,
    ),
    employeeEditNote:
      (r.employeeEditNote as string | null | undefined) ??
      (r.employee_edit_note as string | null | undefined) ??
      raw.employeeEditNote ??
      null,
  }
}
