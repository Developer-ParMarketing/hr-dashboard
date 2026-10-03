import { useMemo, useState } from 'react'
import type { LeaveRequest, LeaveScopeEmployee } from '../api/leaveRequests'
import {
  employeeMatchesLeaveSearch,
  filterLeaveRequestsBySearch,
  canDecideLeaveRequest,
} from '../utils/leaveApproverSearch'
import { LeaveEmployeeHistoryPanel } from './LeaveEmployeeHistoryPanel'
import { LeaveRequestTable } from './LeaveRequestTableShared'
import { formatInListPendingApproved } from '../utils/approverListSummary'
import { ReportListPaginationBar, useReportListPagination } from './ReportListPagination'

export type EmployeeLeaveGroup = {
  employeeId: number
  employeeName: string
  employeeCode: string
  rows: LeaveRequest[]
  pendingCount: number
}

export function groupLeaveRequestsByEmployee(rows: LeaveRequest[]): EmployeeLeaveGroup[] {
  const map = new Map<number, EmployeeLeaveGroup>()
  for (const row of rows) {
    let group = map.get(row.employeeId)
    if (!group) {
      group = {
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        employeeCode: row.employeeCode,
        rows: [],
        pendingCount: 0,
      }
      map.set(row.employeeId, group)
    }
    group.rows.push(row)
    if (row.status === 'pending') group.pendingCount += 1
  }
  return [...map.values()].sort((a, b) => {
    if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount
    return a.employeeName.localeCompare(b.employeeName)
  })
}

function mergeTeamRosterIntoGroups(
  groups: EmployeeLeaveGroup[],
  roster: LeaveScopeEmployee[] | undefined,
  search: string,
): EmployeeLeaveGroup[] {
  if (!roster?.length) return groups
  const map = new Map<number, EmployeeLeaveGroup>()
  for (const g of groups) map.set(g.employeeId, g)
  for (const emp of roster) {
    if (!employeeMatchesLeaveSearch(emp, search) && search.trim()) {
      const hasRow = groups.some((g) => g.employeeId === emp.employeeId)
      if (!hasRow) continue
    }
    if (!map.has(emp.employeeId)) {
      map.set(emp.employeeId, {
        employeeId: emp.employeeId,
        employeeName: emp.employeeName,
        employeeCode: emp.employeeCode,
        rows: [],
        pendingCount: 0,
      })
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount
    return a.employeeName.localeCompare(b.employeeName)
  })
}

function filterApprovalQueueRows(
  rows: LeaveRequest[],
  mode: 'pending' | 'all',
  viewerUserId: number,
  isExecutiveApprover: boolean,
): LeaveRequest[] {
  if (mode !== 'pending') return rows
  return rows.filter((row) => {
    if (row.status !== 'pending') return true
    return canDecideLeaveRequest(row, viewerUserId, isExecutiveApprover)
  })
}

function sortApproverListRows(rows: LeaveRequest[]): LeaveRequest[] {
  return [...rows].sort((a, b) => {
    const aPending = a.status === 'pending'
    const bPending = b.status === 'pending'
    if (aPending !== bPending) return aPending ? -1 : 1
    if (aPending) {
      return a.startDate.localeCompare(b.startDate) || a.id - b.id
    }
    return b.createdAt.localeCompare(a.createdAt) || b.id - a.id
  })
}

type LeaveApproverRequestGroupsProps = {
  rows: LeaveRequest[]
  scope: 'all' | 'team'
  teamEmployees?: LeaveScopeEmployee[]
  mode: 'pending' | 'all'
  viewerUserId: number
  isExecutiveApprover: boolean
  onDecided?: () => void
  onDecideError?: (message: string) => void
}

export function LeaveApproverRequestGroups({
  rows,
  scope,
  teamEmployees,
  mode,
  viewerUserId,
  isExecutiveApprover,
  onDecided,
  onDecideError,
}: LeaveApproverRequestGroupsProps) {
  const [search, setSearch] = useState('')

  const filteredRows = useMemo(() => filterLeaveRequestsBySearch(rows, search), [rows, search])
  const queueRows = useMemo(
    () => filterApprovalQueueRows(filteredRows, mode, viewerUserId, isExecutiveApprover),
    [filteredRows, mode, viewerUserId, isExecutiveApprover],
  )
  const rosterForHistory = mode === 'all' ? teamEmployees : undefined
  const groups = useMemo(
    () => mergeTeamRosterIntoGroups(groupLeaveRequestsByEmployee(queueRows), rosterForHistory, search),
    [queueRows, rosterForHistory, search],
  )
  const listRows = useMemo(() => sortApproverListRows(queueRows), [queueRows])

  const pagination = useReportListPagination(listRows, true, `${mode}:${search}`)
  const tableRows = pagination.pageItems

  const pendingInView = listRows.filter((r) => r.status === 'pending').length
  const actionableInView = useMemo(
    () =>
      listRows.filter(
        (r) =>
          r.status === 'pending' &&
          canDecideLeaveRequest(r, viewerUserId, isExecutiveApprover),
      ).length,
    [listRows, viewerUserId, isExecutiveApprover],
  )

  const scopeHint =
    mode === 'pending'
      ? `${actionableInView} for you to approve or reject · ${pendingInView} pending in queue`
      : scope === 'all'
        ? `${teamEmployees?.length ?? groups.length} employees · ${rows.length} requests loaded`
        : `${teamEmployees?.length ?? groups.length} on your team · ${rows.length} requests loaded`

  return (
    <div className="flex flex-col gap-8">
      <div className="leave-approver-search-row">
        <label className="feature-field leave-approver-search-field">
          <span>Search</span>
          <input
            type="search"
            className="field mt-1 w-full"
            placeholder="Name, employee code, leave type, status, dates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <p className="text-sm text-[var(--color-warm-text)]">
          {scopeHint}
          {search.trim() ? ` · ${listRows.length} matching` : ''}
        </p>
      </div>

      <section aria-label={mode === 'pending' ? 'Leave requests' : 'All leave requests'}>
        <div className="report-block-head mb-4">
          <h2 className="report-block-title">
            {mode === 'pending' ? 'Approval queue' : 'All requests'}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-warm-text)]">
            {mode === 'pending'
              ? `${actionableInView} you can act on · ${listRows.length} total · ${pagination.rangeLabel}`
              : `${pendingInView} pending · ${listRows.length} total · ${pagination.rangeLabel}`}
          </p>
        </div>
        <div className="approver-records-table-panel">
          {listRows.length === 0 ? (
            <div className="p-8 text-sm text-[var(--color-warm-text)]">
              {search.trim()
                ? 'No leave requests match your search.'
                : 'No leave requests in this view yet.'}
            </div>
          ) : (
            <div className="report-table-wrap p-0">
              <LeaveRequestTable
                rows={tableRows}
                showEmployee
                showRequester
                showDecidedBy
                showPendingWith
                allowDecide={mode === 'pending'}
                viewerUserId={viewerUserId}
                isExecutiveApprover={isExecutiveApprover}
                onDecided={onDecided}
                onDecideError={onDecideError}
              />
            </div>
          )}
          <ReportListPaginationBar
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            rangeLabel={pagination.rangeLabel}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        </div>
      </section>

      {mode === 'all' ? (
      <section className="leave-approver-history-club" aria-label="Leave history by employee">
        <div className="report-block-head">
          <h2 className="report-block-title">Leave history by employee</h2>
          <p className="mt-1 text-sm text-[var(--color-warm-text)]">
            {groups.length} people
            {search.trim() ? ' matching search' : ' (all active employees)'} - expand for year summary.
          </p>
        </div>
        {groups.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-warm-text)]">No employees match this search.</p>
        ) : (
          <div className="leave-approver-employee-scroll mt-4">
            <div className="leave-approver-group">
            {groups.map((group) => (
              <details key={group.employeeId} className="leave-approver-group-panel">
                <summary className="leave-approver-group-summary">
                  <span>
                    {group.employeeName}
                    <span className="ml-2 font-normal text-[var(--color-warm-text)]">
                      {group.employeeCode}
                    </span>
                  </span>
                  <span className="text-xs font-normal text-[var(--color-warm-text)]">
                    {formatInListPendingApproved(group.rows)}
                  </span>
                </summary>
                <div className="leave-approver-group-body">
                  <LeaveEmployeeHistoryPanel
                    employeeId={group.employeeId}
                    employeeName={group.employeeName}
                    employeeCode={group.employeeCode}
                  />
                </div>
              </details>
            ))}
            </div>
          </div>
        )}
      </section>
      ) : null}
    </div>
  )
}
