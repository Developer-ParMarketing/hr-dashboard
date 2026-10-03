/** Maps report status labels (from API) to subtle badge styling. */
export function reportStatusBadgeClass(label: string): string {
  const value = label.trim().toLowerCase()
  if (value.includes('pending') || value.includes('awaiting') || value.includes('checked in')) {
    return 'report-status report-status--pending'
  }
  if (value.includes('approved')) return 'report-status report-status--ok'
  if (value.includes('reject') || value.includes('fail')) return 'report-status report-status--bad'
  if (value.includes('cancel')) return 'report-status report-status--neutral'
  return 'report-status report-status--neutral'
}

export function isReportStatusColumn(columnKey: string): boolean {
  return columnKey === 'status'
}
