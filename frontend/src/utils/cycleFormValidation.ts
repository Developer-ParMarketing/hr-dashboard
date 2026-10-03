import type { AppraisalTemplate } from '../api/performance'

type DraftRow = {
  criterionIndex: number
  employeeRating: string
  employeeComments: string
  managerRating: string
  managerComments: string
  managementRating: string
  managementComments: string
}

export type CycleFormEditMode = 'employee' | 'manager' | 'management'

export type CriterionPairStatus = 'empty' | 'complete' | 'needsRating' | 'needsComments'

export function criterionPairStatus(rating: string, comments: string): CriterionPairStatus {
  const hasRating = rating.trim() !== ''
  const hasComments = comments.trim() !== ''
  if (hasRating && hasComments) return 'complete'
  if (!hasRating && !hasComments) return 'empty'
  if (hasRating && !hasComments) return 'needsComments'
  return 'needsRating'
}

function ratingAndCommentsForMode(row: DraftRow | undefined, mode: CycleFormEditMode): {
  rating: string
  comments: string
} {
  if (!row) return { rating: '', comments: '' }
  if (mode === 'employee') {
    return { rating: row.employeeRating, comments: row.employeeComments }
  }
  if (mode === 'manager') {
    return { rating: row.managerRating, comments: row.managerComments }
  }
  return { rating: row.managementRating, comments: row.managementComments }
}

export function criterionPairStatusForMode(
  row: DraftRow | undefined,
  mode: CycleFormEditMode,
): CriterionPairStatus {
  const { rating, comments } = ratingAndCommentsForMode(row, mode)
  return criterionPairStatus(rating, comments)
}

export function overallPairStatusForMode(
  mode: CycleFormEditMode,
  overallEmployee: string,
  overallManager: string,
  overallManagement: string,
  overallEmployeeComments: string,
  overallManagerComments: string,
  overallManagementComments: string,
): CriterionPairStatus {
  if (mode === 'employee') {
    return criterionPairStatus(overallEmployee, overallEmployeeComments)
  }
  if (mode === 'manager') {
    return criterionPairStatus(overallManager, overallManagerComments)
  }
  return criterionPairStatus(overallManagement, overallManagementComments)
}

/** Short labels for inline hints (rating without comments or the reverse). */
export function pairStatusShortLabel(status: CriterionPairStatus): string | null {
  if (status === 'needsComments') return 'Add comments to match your rating'
  if (status === 'needsRating') return 'Add a rating to match your comments'
  return null
}

export function pairStatusWarning(status: CriterionPairStatus): string | null {
  if (status === 'needsComments') {
    return 'You chose a rating - add comments before you submit this item.'
  }
  if (status === 'needsRating') {
    return 'You wrote comments - pick a rating before you submit this item.'
  }
  return null
}

export type CycleFormPairIssue = {
  step: number | 'overall'
  title: string
  status: 'needsRating' | 'needsComments'
}

export function collectCycleFormPairIssues(
  mode: CycleFormEditMode,
  template: AppraisalTemplate,
  draft: DraftRow[],
  overallEmployee: string,
  overallManager: string,
  overallManagement: string,
  overallEmployeeComments: string,
  overallManagerComments: string,
  overallManagementComments: string,
): CycleFormPairIssue[] {
  const issues: CycleFormPairIssue[] = []
  for (const c of template.criteria) {
    const row = draft.find((d) => d.criterionIndex === c.index)
    const status = criterionPairStatusForMode(row, mode)
    if (status === 'needsRating' || status === 'needsComments') {
      issues.push({
        step: c.index,
        title: c.title,
        status,
      })
    }
  }
  const overallStatus = overallPairStatusForMode(
    mode,
    overallEmployee,
    overallManager,
    overallManagement,
    overallEmployeeComments,
    overallManagerComments,
    overallManagementComments,
  )
  if (overallStatus === 'needsRating' || overallStatus === 'needsComments') {
    issues.push({ step: 'overall', title: 'Overall rating', status: overallStatus })
  }
  return issues
}

/** @deprecated use collectCycleFormPairIssues for UI */
export function collectCycleFormPairWarnings(
  mode: CycleFormEditMode,
  template: AppraisalTemplate,
  draft: DraftRow[],
  overallEmployee: string,
  overallManager: string,
  overallManagement: string,
  overallEmployeeComments: string,
  overallManagerComments: string,
  overallManagementComments: string,
): string[] {
  const lines: string[] = []
  for (const c of template.criteria) {
    const row = draft.find((d) => d.criterionIndex === c.index)
    const status = criterionPairStatusForMode(row, mode)
    const hint = pairStatusWarning(status)
    if (hint) {
      lines.push(`Item ${c.index} (${c.title}): ${hint}`)
    }
  }
  const overallStatus = overallPairStatusForMode(
    mode,
    overallEmployee,
    overallManager,
    overallManagement,
    overallEmployeeComments,
    overallManagerComments,
    overallManagementComments,
  )
  const overallHint = pairStatusWarning(overallStatus)
  if (overallHint) {
    lines.push(`Overall: ${overallHint}`)
  }
  return lines
}

export function validateCycleFormSubmit(
  mode: CycleFormEditMode,
  template: AppraisalTemplate,
  draft: DraftRow[],
  overallEmployee: string,
  overallManager: string,
  overallManagement: string,
  overallEmployeeComments: string,
  overallManagerComments: string,
  overallManagementComments: string,
): { ok: true } | { ok: false; message: string; criterionIndex?: number } {
  const missing: string[] = []
  let firstMissingIndex: number | undefined

  for (const c of template.criteria) {
    const row = draft.find((d) => d.criterionIndex === c.index)
    const rating =
      mode === 'employee'
        ? row?.employeeRating ?? ''
        : mode === 'manager'
          ? row?.managerRating ?? ''
          : row?.managementRating ?? ''
    const comments =
      mode === 'employee'
        ? (row?.employeeComments ?? '').trim()
        : mode === 'manager'
          ? (row?.managerComments ?? '').trim()
          : (row?.managementComments ?? '').trim()

    if (!rating) {
      missing.push(`Item ${c.index}: rating`)
      firstMissingIndex ??= c.index
    }
    if (!comments) {
      missing.push(`Item ${c.index}: comments`)
      firstMissingIndex ??= c.index
    }
  }

  const overall =
    mode === 'employee'
      ? overallEmployee
      : mode === 'manager'
        ? overallManager
        : overallManagement
  if (!overall) {
    missing.push('Overall rating')
  }

  const overallComments =
    mode === 'employee'
      ? overallEmployeeComments.trim()
      : mode === 'manager'
        ? overallManagerComments.trim()
        : overallManagementComments.trim()
  if (!overallComments) {
    missing.push('Overall comments')
  }

  if (missing.length === 0) return { ok: true }

  const preview = missing.slice(0, 4).join('; ')
  const extra = missing.length > 4 ? ` (+${missing.length - 4} more)` : ''
  return {
    ok: false,
    criterionIndex: firstMissingIndex,
    message: `Submit requires a rating (1-5) and comments on every item, plus an overall rating and overall comments. Save progress allows partial entries. Still missing: ${preview}${extra}.`,
  }
}

export function isCycleFormSubmitReady(
  mode: CycleFormEditMode,
  template: AppraisalTemplate,
  draft: DraftRow[],
  overallEmployee: string,
  overallManager: string,
  overallManagement: string,
  overallEmployeeComments: string,
  overallManagerComments: string,
  overallManagementComments: string,
): boolean {
  return validateCycleFormSubmit(
    mode,
    template,
    draft,
    overallEmployee,
    overallManager,
    overallManagement,
    overallEmployeeComments,
    overallManagerComments,
    overallManagementComments,
  ).ok
}
