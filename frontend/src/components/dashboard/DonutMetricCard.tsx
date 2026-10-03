export type MetricInsight = 'people' | 'attendance' | 'payroll' | 'actions'

/** Honest workflow state - prefer this over decorative percentages. */
export type MetricStatus = 'not_started' | 'in_progress' | 'done' | 'attention' | 'info'

const INSIGHT_LABEL: Record<MetricInsight, string> = {
  people: 'Headcount',
  attendance: 'Approvals',
  payroll: 'Payroll',
  actions: 'Actions',
}

const STATUS_LABEL: Record<MetricStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  attention: 'Needs attention',
  info: 'Snapshot',
}

type DonutMetricCardProps = {
  title: string
  value: number | string
  caption?: string
  /**
   * Real 0-100 completion only (e.g. approved/total).
   * Pass null/undefined to avoid a fake ring - status drives the label instead.
   */
  percent?: number | null
  status?: MetricStatus
  insight?: MetricInsight
  progressLabel?: string
}

function ringPercent(percent: number | null | undefined, status: MetricStatus): number {
  if (percent != null && Number.isFinite(percent)) {
    return Math.max(0, Math.min(100, percent))
  }
  if (status === 'done') return 100
  return 0
}

export function DonutMetricCard({
  title,
  value,
  caption,
  percent = null,
  status = 'info',
  insight = 'people',
  progressLabel,
}: DonutMetricCardProps) {
  const clamped = ringPercent(percent, status)
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (clamped / 100) * circumference
  const statusLabel = progressLabel ?? STATUS_LABEL[status]
  const showFraction = percent != null && Number.isFinite(percent)
  const showRing =
    showFraction || status === 'done' || status === 'in_progress' || status === 'attention'

  return (
    <article className={`par-metric-card par-metric-${insight} par-metric-status-${status} card border`}>
      <div className="par-metric-accent" aria-hidden />
      <div className="par-metric-head">
        <div className="par-metric-tags">
          <span className="par-metric-tag">{INSIGHT_LABEL[insight]}</span>
          <span className={`par-metric-status-pill par-metric-status-pill-${status}`}>
            {STATUS_LABEL[status]}
          </span>
        </div>
        <h2 className="par-metric-title">{title}</h2>
      </div>
      <div className={`par-metric-body${showRing ? '' : ' par-metric-body-stat'}`}>
        {showRing ? (
          <div
            className={`par-donut${clamped === 0 && status !== 'done' ? ' par-donut-empty' : ''}`}
            aria-hidden
          >
            <svg viewBox="0 0 120 120">
              <circle className="par-donut-track" cx="60" cy="60" r={radius} />
              <circle
                className="par-donut-fill"
                cx="60"
                cy="60"
                r={radius}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
              />
            </svg>
            <span className="par-donut-value">{value}</span>
          </div>
        ) : (
          <p className="par-metric-stat-value" aria-label={`${title}: ${value}`}>{value}</p>
        )}
        <div className="par-metric-copy">
          <p className="par-metric-progress">
            {statusLabel}
            {showFraction ? ` · ${Math.round(clamped)}%` : null}
          </p>
          {caption ? <p className="par-metric-caption">{caption}</p> : null}
        </div>
      </div>
    </article>
  )
}
