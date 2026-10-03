import { Link } from 'react-router-dom'
import type { DashboardPendingApprovals } from '../../types/dashboard'
import { DashboardPanel } from './DashboardPanel'

type ApprovalLink = {
  key: keyof DashboardPendingApprovals
  label: string
  href: string
}

const APPROVAL_LINKS: ApprovalLink[] = [
  { key: 'leave', label: 'Leave', href: '/leave-request?tab=pending' },
  { key: 'reimbursement', label: 'Reimbursement', href: '/reimbursement?tab=pending' },
  { key: 'portalPunch', label: 'In / out', href: '/in-out-request?tab=pending' },
]

export function DashboardApprovalsCard({
  pending,
  loading,
  scopeNote,
}: {
  pending: DashboardPendingApprovals | null | undefined
  loading: boolean
  /** When dashboard employee filter is active */
  scopeNote?: string
}) {
  if (!pending) return null

  const total = pending.leave + pending.reimbursement + pending.portalPunch
  if (!loading && total === 0) return null

  return (
    <DashboardPanel title="Requests awaiting your approval">
      {loading ? (
        <p className="par-panel-empty">Loading…</p>
      ) : (
        <>
          <p className="dashboard-approvals-lead">
            <strong>{total}</strong> open request{total === 1 ? '' : 's'} need your decision now
            {scopeNote ? ` (${scopeNote})` : ''} - open the queue for each type.
          </p>
          <ul className="dashboard-approvals-links">
            {APPROVAL_LINKS.map((item) => {
              const count = pending[item.key]
              if (count <= 0) return null
              return (
                <li key={item.key}>
                  <Link to={item.href} className="dashboard-approvals-link">
                    <span className="dashboard-approvals-link-label">{item.label}</span>
                    <span className="dashboard-approvals-link-count">
                      {count} pending
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </DashboardPanel>
  )
}
