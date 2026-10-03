import { useState } from 'react'
import axios from 'axios'
import { ReportTableShell } from './ReportTableShell'
import {
  decidePortalPunch,
  legRowKey,
  portalLegLabel,
  portalStatusLabel,
  type PortalPunchLegRecord,
} from '../api/portalPunch'
import { formatDisplayDate, formatDisplayDateTime } from '../utils/displayDate'
import { confirmRequestDecision } from '../utils/confirmAction'
import { canDecidePortalPunch } from '../utils/portalPunchApproverSearch'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

function statusClass(status: PortalPunchLegRecord['status']): string {
  if (status === 'approved') return 'text-emerald-700'
  if (status === 'rejected') return 'text-red-700'
  return 'text-amber-700'
}

function showRequesterColumn(rows: PortalPunchLegRecord[]): boolean {
  return rows.some(
    (r) => r.requesterUserId !== r.employeeId || r.requesterName.trim() !== r.employeeName.trim(),
  )
}

export function PortalPunchTable({
  rows,
  showEmployee,
  showRequester,
  showDecidedBy,
  showPendingWith,
  allowDecide,
  viewerUserId,
  isExecutiveApprover,
  onDecided,
  onDecideError,
}: {
  rows: PortalPunchLegRecord[]
  showEmployee?: boolean
  showRequester?: boolean
  showDecidedBy?: boolean
  showPendingWith?: boolean
  allowDecide?: boolean
  viewerUserId?: number
  isExecutiveApprover?: boolean
  onDecided?: () => void
  onDecideError?: (message: string) => void
}) {
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const requesterCol = showRequester ?? showRequesterColumn(rows)

  if (rows.length === 0) {
    return (
      <div className="card border p-8 text-sm text-[var(--color-warm-text)]">
        No portal punch records in this view.
      </div>
    )
  }

  async function decide(row: PortalPunchLegRecord, status: 'approved' | 'rejected') {
    const key = legRowKey(row)
    const summary = `${row.employeeName} · ${formatDisplayDate(row.attendanceDate)} · ${portalLegLabel(row.leg)} ${row.punchTime ?? ''}`
    if (!(await confirmRequestDecision(status, summary))) return
    setBusyKey(key)
    try {
      await decidePortalPunch(row.id, { leg: row.leg, status, note: decisionNote[key] ?? '' })
      onDecided?.()
    } catch (e) {
      onDecideError?.(errorMessage(e, 'Could not save decision'))
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <ReportTableShell minTableWidth="48rem">
      <table className="report-table">
        <thead>
          <tr>
            {showEmployee ? <th>Employee</th> : null}
            {requesterCol ? <th>Submitted by</th> : null}
            <th>Date</th>
            <th>Request</th>
            <th>Time</th>
            <th>Shift</th>
            <th>Status</th>
            {showPendingWith ? <th>Pending with</th> : null}
            {showDecidedBy ? <th>Decided by</th> : null}
            <th>Submitted</th>
            {allowDecide ? <th>Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = legRowKey(row)
            const canDecide =
              allowDecide &&
              viewerUserId != null &&
              canDecidePortalPunch(row, viewerUserId, isExecutiveApprover === true)
            return (
              <tr key={key}>
                {showEmployee ? (
                  <td>
                    <span className="font-medium">{row.employeeName}</span>
                    <span className="block font-mono text-xs text-[var(--color-warm-text)]">
                      {row.employeeCode}
                    </span>
                  </td>
                ) : null}
                {requesterCol ? (
                  <td className="text-sm">
                    {row.requesterName}
                    {row.approvalTier === 'leadership_hr' && row.status === 'pending' ? (
                      <span className="block text-xs text-[var(--color-warm-text)]">
                        Manager route · HR/leadership
                      </span>
                    ) : null}
                  </td>
                ) : null}
                <td className="whitespace-nowrap">{formatDisplayDate(row.attendanceDate)}</td>
                <td className="whitespace-nowrap font-medium">{portalLegLabel(row.leg)}</td>
                <td className="whitespace-nowrap tabular-nums">{row.punchTime ?? '-'}</td>
                <td className="whitespace-nowrap">{row.shiftStart ?? '-'}</td>
                <td className={statusClass(row.status)}>{portalStatusLabel(row.status)}</td>
                {showPendingWith ? (
                  <td className="text-sm text-[var(--color-warm-text)]">
                    {row.status === 'pending' ? row.pendingWithLabel ?? '-' : '-'}
                  </td>
                ) : null}
                {showDecidedBy ? (
                  <td className="text-sm text-[var(--color-warm-text)]">
                    {row.decidedByName ?? '-'}
                    {row.decisionNote ? (
                      <span className="block text-xs">{row.decisionNote}</span>
                    ) : null}
                  </td>
                ) : null}
                <td className="whitespace-nowrap text-sm text-[var(--color-warm-text)]">
                  {formatDisplayDateTime(row.updatedAt)}
                </td>
                {allowDecide ? (
                  <td className="report-cell-actions">
                    {canDecide ? (
                      <div className="flex min-w-[11rem] max-w-[16rem] flex-col gap-2">
                        <input
                          type="text"
                          className="field text-xs"
                          placeholder="Note (optional)"
                          value={decisionNote[key] ?? ''}
                          onChange={(e) =>
                            setDecisionNote((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn-primary text-xs"
                            disabled={busyKey === key}
                            onClick={() => void decide(row, 'approved')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn-ghost text-xs"
                            disabled={busyKey === key}
                            onClick={() => void decide(row, 'rejected')}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            )
          })}
        </tbody>
      </table>
    </ReportTableShell>
  )
}
