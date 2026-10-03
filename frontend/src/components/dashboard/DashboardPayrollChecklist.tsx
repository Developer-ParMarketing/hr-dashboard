import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardChecklistItem } from '../../types/dashboard'

type Props = {
  items: DashboardChecklistItem[]
  periodLabel: string
  loading?: boolean
  hrefFor: (path: string) => string
}

const STATUS_LABEL: Record<DashboardChecklistItem['status'], string> = {
  done: 'Done',
  todo: 'To do',
  blocked: 'Waiting',
}

function ChecklistRow({
  item,
  hrefFor,
  compact = false,
}: {
  item: DashboardChecklistItem
  hrefFor: (path: string) => string
  compact?: boolean
}) {
  return (
    <li
      className={`dashboard-checklist-item dashboard-checklist-item-${item.status}${compact ? ' dashboard-checklist-item-compact' : ''}`}
    >
      <span className="dashboard-checklist-step" aria-hidden>
        {item.status === 'done' ? '✓' : item.step}
      </span>
      <div className="dashboard-checklist-body">
        <div className="dashboard-checklist-title-row">
          <h3 className="dashboard-checklist-title">{item.title}</h3>
          <span className={`dashboard-checklist-status dashboard-checklist-status-${item.status}`}>
            {STATUS_LABEL[item.status]}
          </span>
        </div>
        <p className="dashboard-checklist-detail">{item.detail}</p>
      </div>
      <Link
        to={hrefFor(item.href)}
        className={
          item.status === 'done'
            ? 'btn-ghost dashboard-checklist-btn shrink-0'
            : item.status === 'blocked'
              ? 'btn-ghost dashboard-checklist-btn shrink-0'
              : 'btn-secondary dashboard-checklist-btn shrink-0'
        }
      >
        {item.actionLabel}
      </Link>
    </li>
  )
}

export function DashboardPayrollChecklist({ items, periodLabel, loading, hrefFor }: Props) {
  const [showDone, setShowDone] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const doneCount = items.filter((i) => i.status === 'done').length
  const nextTodo = items.find((i) => i.status === 'todo')
  const activeItems = useMemo(
    () => items.filter((i) => i.status === 'todo' || i.status === 'blocked'),
    [items],
  )
  const doneItems = useMemo(() => items.filter((i) => i.status === 'done'), [items])
  const progressPct = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0

  if (loading) {
    return <p className="par-panel-empty">Loading checklist…</p>
  }

  return (
    <div className="dashboard-checklist">
      <div className="dashboard-checklist-summary">
        <div className="dashboard-checklist-summary-head">
          <div>
            <p className="dashboard-checklist-period">{periodLabel}</p>
            <p className="dashboard-checklist-progress-label">
              {doneCount} of {items.length} steps complete
              {nextTodo ? (
                <>
                  {' '}
                  · Next: <span className="dashboard-checklist-next-title">{nextTodo.title}</span>
                </>
              ) : (
                <> · <span className="dashboard-checklist-all-done">All steps complete</span></>
              )}
            </p>
          </div>
          <p className="dashboard-checklist-progress-pct" aria-hidden>{progressPct}%</p>
        </div>
        <div
          className="dashboard-checklist-progress"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Payroll checklist ${progressPct}% complete`}
        >
          <div className="dashboard-checklist-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <button
          type="button"
          className="dashboard-checklist-help-toggle"
          onClick={() => setShowHelp((v) => !v)}
          aria-expanded={showHelp}
        >
          {showHelp ? 'Hide note' : 'How pay days and weekly approval work'}
        </button>
        {showHelp ? (
          <p className="dashboard-checklist-note">
            Pay days come from the daily register. Salary still needs each week approved and locked before you run
            payroll.
          </p>
        ) : null}
      </div>

      {activeItems.length > 0 ? (
        <ol className="dashboard-checklist-list">
          {activeItems.map((item) => (
            <ChecklistRow key={item.id} item={item} hrefFor={hrefFor} />
          ))}
        </ol>
      ) : (
        <p className="dashboard-checklist-all-clear">
          No open steps. Expand completed steps below if you need a link.
        </p>
      )}

      {doneItems.length > 0 ? (
        <div className="dashboard-checklist-done-wrap">
          <button
            type="button"
            className="dashboard-checklist-done-toggle"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
          >
            {showDone ? 'Hide' : 'Show'} {doneItems.length} completed step
            {doneItems.length === 1 ? '' : 's'}
            <span className="dashboard-checklist-done-chevron" aria-hidden>{showDone ? '▴' : '▾'}</span>
          </button>
          {showDone ? (
            <ol className="dashboard-checklist-list dashboard-checklist-list-done">
              {doneItems.map((item) => (
                <ChecklistRow key={item.id} item={item} hrefFor={hrefFor} compact />
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
