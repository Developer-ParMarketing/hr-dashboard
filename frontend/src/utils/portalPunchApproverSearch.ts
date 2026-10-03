import {
  portalLegLabel,
  portalStatusLabel,
  type PortalPunchLegRecord,
  type PortalScopeEmployee,
} from '../api/portalPunch'

export function matchesPortalPunchSearch(row: PortalPunchLegRecord, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    row.employeeName.toLowerCase().includes(q) ||
    row.employeeCode.toLowerCase().includes(q) ||
    row.requesterName.toLowerCase().includes(q) ||
    row.requesterEmail.toLowerCase().includes(q) ||
    row.attendanceDate.includes(q) ||
    portalLegLabel(row.leg).toLowerCase().includes(q) ||
    row.leg.includes(q) ||
    portalStatusLabel(row.status).toLowerCase().includes(q) ||
    row.status.includes(q) ||
    (row.punchTime ?? '').toLowerCase().includes(q) ||
    (row.shiftStart ?? '').toLowerCase().includes(q) ||
    (row.pendingWithLabel ?? '').toLowerCase().includes(q) ||
    (row.decidedByName ?? '').toLowerCase().includes(q)
  )
}

export function filterPortalPunchesBySearch(
  rows: PortalPunchLegRecord[],
  query: string,
): PortalPunchLegRecord[] {
  const q = query.trim()
  if (!q) return rows
  return rows.filter((row) => matchesPortalPunchSearch(row, q))
}

export function employeeMatchesPortalSearch(employee: PortalScopeEmployee, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    employee.employeeName.toLowerCase().includes(q) ||
    employee.employeeCode.toLowerCase().includes(q)
  )
}

export function canDecidePortalPunch(
  row: PortalPunchLegRecord,
  viewerUserId: number,
  isExecutiveApprover: boolean,
): boolean {
  if (row.status !== 'pending') return false
  if (row.requesterUserId === viewerUserId) return false
  if (row.approvalTier === 'manager') {
    return row.assignedApproverUserId === viewerUserId
  }
  return isExecutiveApprover
}
