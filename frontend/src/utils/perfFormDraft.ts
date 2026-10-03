import type { AppraisalSubmission } from '../api/performance'

type DraftRow = {
  criterionIndex: number
  employeeRating: string
  employeeComments: string
  managerRating: string
  managerComments: string
  managementRating: string
  managementComments: string
}

export type PerfFormEditMode = 'employee' | 'manager' | 'management' | 'view'

export function draftRowsFromSubmission(submission: AppraisalSubmission): DraftRow[] {
  const template = submission.template
  if (!template) return []
  return template.criteria.map((c) => {
    const saved = submission.answers.find((a) => a.criterionIndex === c.index)
    return {
      criterionIndex: c.index,
      employeeRating: saved?.employeeRating != null ? String(saved.employeeRating) : '',
      employeeComments: saved?.employeeComments ?? '',
      managerRating: saved?.managerRating != null ? String(saved.managerRating) : '',
      managerComments: saved?.managerComments ?? '',
      managementRating: saved?.managementRating != null ? String(saved.managementRating) : '',
      managementComments: saved?.managementComments ?? '',
    }
  })
}

function snapshotForMode(
  rows: DraftRow[],
  mode: PerfFormEditMode,
  overallEmployee: string,
  overallManager: string,
  overallManagement: string,
  overallEmployeeComments: string,
  overallManagerComments: string,
  overallManagementComments: string,
): string {
  const mapped = rows.map((row) => {
    if (mode === 'employee') {
      return {
        i: row.criterionIndex,
        r: row.employeeRating,
        c: row.employeeComments.trim(),
      }
    }
    if (mode === 'manager') {
      return {
        i: row.criterionIndex,
        r: row.managerRating,
        c: row.managerComments.trim(),
      }
    }
    if (mode === 'management') {
      return {
        i: row.criterionIndex,
        r: row.managementRating,
        c: row.managementComments.trim(),
      }
    }
    return { i: row.criterionIndex }
  })
  const overall =
    mode === 'employee'
      ? overallEmployee
      : mode === 'manager'
        ? overallManager
        : mode === 'management'
          ? overallManagement
          : ''
  const overallComments =
    mode === 'employee'
      ? overallEmployeeComments.trim()
      : mode === 'manager'
        ? overallManagerComments.trim()
        : mode === 'management'
          ? overallManagementComments.trim()
          : ''
  return JSON.stringify({ mapped, overall, overallComments })
}

export function perfFormIsDirty(
  submission: AppraisalSubmission,
  mode: PerfFormEditMode,
  draft: DraftRow[],
  overallEmployee: string,
  overallManager: string,
  overallManagement: string,
  overallEmployeeComments: string,
  overallManagerComments: string,
  overallManagementComments: string,
): boolean {
  if (mode === 'view') return false
  const savedRows = draftRowsFromSubmission(submission)
  const savedOverallEmployee =
    submission.overallEmployeeRating != null ? String(submission.overallEmployeeRating) : ''
  const savedOverallManager =
    submission.overallManagerRating != null ? String(submission.overallManagerRating) : ''
  const savedOverallManagement =
    submission.overallManagementRating != null ? String(submission.overallManagementRating) : ''
  const savedOverallEmployeeComments = submission.overallEmployeeComments ?? ''
  const savedOverallManagerComments = submission.overallManagerComments ?? ''
  const savedOverallManagementComments = submission.overallManagementComments ?? ''

  const saved = snapshotForMode(
    savedRows,
    mode,
    savedOverallEmployee,
    savedOverallManager,
    savedOverallManagement,
    savedOverallEmployeeComments,
    savedOverallManagerComments,
    savedOverallManagementComments,
  )
  const current = snapshotForMode(
    draft,
    mode,
    overallEmployee,
    overallManager,
    overallManagement,
    overallEmployeeComments,
    overallManagerComments,
    overallManagementComments,
  )
  return saved !== current
}

export function lastSavedLabel(
  submission: AppraisalSubmission,
  mode: PerfFormEditMode,
): string | null {
  const iso =
    mode === 'employee'
      ? submission.employeeUpdatedAt
      : mode === 'manager'
        ? submission.managerUpdatedAt
        : mode === 'management'
          ? submission.managementUpdatedAt
          : null
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
