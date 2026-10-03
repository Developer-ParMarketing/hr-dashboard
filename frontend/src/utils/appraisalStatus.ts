export type AppraisalStatusTone = 'ok' | 'pending' | 'neutral'

export type AppraisalStatusDisplay = {
  label: string
  tone: AppraisalStatusTone
}

/** Status for team / admin directory rows (not the full submission form). */
export function appraisalDirectoryStatus(row: {
  canFill?: boolean
  employeeSubmittedAt?: string | null
  overallEmployeeRating: number | null
  overallManagerRating: number | null
  managerSubmittedAt?: string | null
  employeeUpdatedAt?: string | null
  managerUpdatedAt?: string | null
}): AppraisalStatusDisplay {
  if (row.managerSubmittedAt) {
    return { label: 'Mgr submitted', tone: 'ok' }
  }

  if (row.canFill === false && !row.employeeSubmittedAt) {
    return { label: 'Not eligible yet', tone: 'neutral' }
  }

  if (!row.employeeSubmittedAt) {
    const selfStarted =
      row.employeeUpdatedAt != null && row.employeeUpdatedAt !== ''
    return selfStarted
      ? { label: 'Self-assessment in progress', tone: 'pending' }
      : { label: 'Not started', tone: 'neutral' }
  }

  const managerInProgress =
    row.managerUpdatedAt != null && row.managerUpdatedAt !== ''

  if (managerInProgress) {
    return { label: 'Manager review in progress', tone: 'pending' }
  }

  return { label: 'Awaiting manager review', tone: 'pending' }
}

export function appraisalStatusBadgeClass(tone: AppraisalStatusTone): string {
  if (tone === 'ok') return 'doc-status-badge doc-status-badge--ok'
  if (tone === 'pending') return 'doc-status-badge doc-status-badge--pending'
  return 'doc-status-badge doc-status-badge--neutral'
}

/** Directory table cell for a rating column - hides draft scores. */
export function appraisalDirectoryRatingCell(
  rating: number | null,
  submitted: boolean,
): string {
  if (!submitted) return 'In progress'
  return rating != null ? String(rating) : '-'
}
