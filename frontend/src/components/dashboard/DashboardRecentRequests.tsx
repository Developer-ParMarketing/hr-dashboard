import { Link } from 'react-router-dom'
import type { DashboardRecentRequest } from '../../types/dashboard'
import { formatDisplayDateTime } from '../../utils/displayDate'

function kindLabel(kind: DashboardRecentRequest['kind']): string {
  if (kind === 'leave') return 'Leave'
  if (kind === 'reimbursement') return 'Reimbursement'
  return 'In / out'
}

function statusLabel(status: string): string {
  if (status === 'pending') return 'Pending'
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'open') return 'Open'
  return status
}

function statusClass(status: string): string {
  if (status === 'approved') return 'dashboard-recent-status dashboard-recent-status-ok'
  if (status === 'rejected') return 'dashboard-recent-status dashboard-recent-status-bad'
  if (status === 'pending' || status === 'open') return 'dashboard-recent-status dashboard-recent-status-pending'
  return 'dashboard-recent-status'
}

function formatSubmittedAt(iso: string): string {
  return formatDisplayDateTime(iso)
}

export function DashboardRecentRequests({
  rows,
  loading,
}: {
  rows: DashboardRecentRequest[] | null | undefined
  loading: boolean
}) {
  if (loading) {
    return <p className="par-panel-empty">Loading your requests…</p>
  }

  if (!rows || rows.length === 0) {
    return (
      <p className="par-panel-empty">
        No requests yet. Use quick actions to submit leave, reimbursement, or in/out corrections.
      </p>
    )
  }

  return (
    <ul className="dashboard-recent-requests">
      {rows.map((row) => (
        <li key={`${row.kind}-${row.id}`} className="dashboard-recent-row">
          <div className="dashboard-recent-main">
            <span className="dashboard-recent-kind">{kindLabel(row.kind)}</span>
            <p className="dashboard-recent-summary">{row.summary}</p>
            <p className="dashboard-recent-meta">Submitted {formatSubmittedAt(row.submittedAt)}</p>
          </div>
          <div className="dashboard-recent-aside">
            <span className={statusClass(row.status)}>{statusLabel(row.status)}</span>
            <Link to={row.href} className="btn-ghost text-sm">
              View
            </Link>
          </div>
        </li>
      ))}
    </ul>
  )
}
