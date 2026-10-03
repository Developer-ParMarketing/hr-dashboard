import {
  leaveTypeLabel,
  statusLabel,
  type LeaveRequest,
  type LeaveScopeEmployee,
} from '../api/leaveRequests'

export function matchesLeaveSearch(row: LeaveRequest, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    row.employeeName.toLowerCase().includes(q) ||
    row.employeeCode.toLowerCase().includes(q) ||
    row.requesterName.toLowerCase().includes(q) ||
    row.requesterEmail.toLowerCase().includes(q) ||
    leaveTypeLabel(row.leaveType).toLowerCase().includes(q) ||
    row.leaveType.includes(q) ||
    statusLabel(row.status).toLowerCase().includes(q) ||
    row.status.includes(q) ||
    (row.reason ?? '').toLowerCase().includes(q) ||
    row.startDate.includes(q) ||
    row.endDate.includes(q) ||
    (row.pendingWithLabel ?? '').toLowerCase().includes(q) ||
    (row.decidedByName ?? '').toLowerCase().includes(q)
  )
}

export function filterLeaveRequestsBySearch(rows: LeaveRequest[], query: string): LeaveRequest[] {
  const q = query.trim()
  if (!q) return rows
  return rows.filter((row) => matchesLeaveSearch(row, q))
}

export function employeeMatchesLeaveSearch(employee: LeaveScopeEmployee, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    employee.employeeName.toLowerCase().includes(q) ||
    employee.employeeCode.toLowerCase().includes(q)
  )
}

export function canDecideLeaveRequest(
  row: LeaveRequest,
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
