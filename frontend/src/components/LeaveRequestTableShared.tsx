import { useState } from 'react'
import axios from 'axios'
import { ReportTableShell } from './ReportTableShell'
import {
  decideLeaveRequest,
  formatDateRange,
  leaveTypeAccent,
  leaveTypeLabel,
  statusLabel,
  type LeaveRequest,
} from '../api/leaveRequests'
import { formatDisplayDateTime } from '../utils/displayDate'
import { confirmRequestDecision } from '../utils/confirmAction'
import { canDecideLeaveRequest } from '../utils/leaveApproverSearch'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

function statusClass(status: LeaveRequest['status']): string {
  if (status === 'approved') return 'text-emerald-700'
  if (status === 'rejected') return 'text-red-700'
  if (status === 'cancelled') return 'text-[var(--color-warm-text)]'
  return 'text-amber-700'
}

function showRequesterColumn(rows: LeaveRequest[]): boolean {
  return rows.some(
    (r) => r.requesterUserId !== r.employeeId || r.requesterName.trim() !== r.employeeName.trim(),
  )
}

export function LeaveRequestTable({
  rows,
  showEmployee,
  showRequester,
  showDecidedBy,
  showPendingWith,
  allowCancel,
  allowDecide,
  viewerUserId,
  isExecutiveApprover,
  onCancel,
  onDecided,
  onDecideError,
}: {
  rows: LeaveRequest[]
  showEmployee?: boolean
  showRequester?: boolean
  showDecidedBy?: boolean
  showPendingWith?: boolean
  allowCancel?: boolean
  allowDecide?: boolean
  viewerUserId?: number
  isExecutiveApprover?: boolean
  onCancel?: (id: number) => void
  onDecided?: () => void
  onDecideError?: (message: string) => void
}) {
  const [decisionNote, setDecisionNote] = useState<Record<number, string>>({})
  const [busyId, setBusyId] = useState<number | null>(null)
  const requesterCol = showRequester ?? showRequesterColumn(rows)

  if (rows.length === 0) {
    return (
      <div className="card border p-8 text-sm text-[var(--color-warm-text)]">
        No leave requests in this view.
      </div>
    )
  }

  async function decide(id: number, status: 'approved' | 'rejected') {
    const row = rows.find((r) => r.id === id)
    const summary = row
      ? `${row.employeeName} · ${leaveTypeLabel(row.leaveType)} · ${formatDateRange(row.startDate, row.endDate)}`
      : `Request #${id}`
    if (!(await confirmRequestDecision(status, summary))) return
    setBusyId(id)
    try {
      await decideLeaveRequest(id, { status, note: decisionNote[id] ?? '' })
      onDecided?.()
    } catch (e) {
      onDecideError?.(errorMessage(e, 'Could not save decision'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <ReportTableShell minTableWidth="44rem">
      <table className="report-table">
        <thead>
          <tr>
            {showEmployee ? <th>Employee</th> : null}
            {requesterCol ? <th>Submitted by</th> : null}
            <th>Type</th>
            <th>Dates</th>
            <th>Reason</th>
            <th>Status</th>
            {showPendingWith ? <th>Pending with</th> : null}
            {showDecidedBy ? <th>Decided by</th> : null}
            <th>Submitted</th>
            {(allowCancel || allowDecide) && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {showEmployee ? (
                <td>
                  <span className="font-medium">{row.employeeName}</span>
                  <span className="block text-xs text-[var(--color-warm-text)]">{row.employeeCode}</span>
                </td>
              ) : null}
              {requesterCol ? (
                <td className="text-sm">
                  {row.requesterName}
                  {row.approvalTier === 'leadership_hr' && row.status === 'pending' ? (
                    <span className="block text-xs text-[var(--color-warm-text)]">Manager route · HR/leadership</span>
                  ) : null}
                </td>
              ) : null}
              <td>
                <span
                  className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold ${leaveTypeAccent(row.leaveType).soft}`}
                >
                  {leaveTypeLabel(row.leaveType)}
                </span>
              </td>
              <td className="whitespace-nowrap">{formatDateRange(row.startDate, row.endDate)}</td>
              <td className="report-cell-wrap" title={row.reason}>
                {row.reason || '-'}
                {row.applyWarnings && row.applyWarnings.length > 0 ? (
                  <ul className="mt-1 list-inside list-disc text-xs text-amber-800">
                    {row.applyWarnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
              </td>
              <td className={statusClass(row.status)}>{statusLabel(row.status)}</td>
              {showPendingWith ? (
                <td>{row.status === 'pending' ? row.pendingWithLabel ?? '-' : '-'}</td>
              ) : null}
              {showDecidedBy ? (
                <td>
                  {row.decidedByName ? (
                    <>
                      <span className="block">{row.decidedByName}</span>
                      {row.decisionNote ? (
                        <span className="block text-xs text-[var(--color-warm-text)]" title={row.decisionNote}>
                          {row.decisionNote}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    '-'
                  )}
                </td>
              ) : null}
              <td className="whitespace-nowrap text-[var(--color-warm-text)]">
                {formatDisplayDateTime(row.createdAt)}
              </td>
              {(allowCancel || allowDecide) && (
                <td className="report-cell-actions">
                  {allowCancel && row.status === 'pending' ? (
                    <button
                      type="button"
                      className="btn-ghost text-xs text-red-700"
                      onClick={() => onCancel?.(row.id)}
                    >
                      Cancel
                    </button>
                  ) : null}
                  {allowDecide &&
                  row.status === 'pending' &&
                  viewerUserId != null &&
                  canDecideLeaveRequest(row, viewerUserId, isExecutiveApprover === true) ? (
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        className="field field-compact w-full min-w-[8rem]"
                        placeholder="Note (optional)"
                        value={decisionNote[row.id] ?? ''}
                        onChange={(e) =>
                          setDecisionNote((prev) => ({ ...prev, [row.id]: e.target.value }))
                        }
                      />
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="btn-secondary px-2 py-1 text-xs"
                          disabled={busyId === row.id}
                          onClick={() => void decide(row.id, 'approved')}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn-ghost px-2 py-1 text-xs"
                          disabled={busyId === row.id}
                          onClick={() => void decide(row.id, 'rejected')}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ) : null}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </ReportTableShell>
  )
}
