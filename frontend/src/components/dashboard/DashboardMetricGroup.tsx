import type { ReactNode } from 'react'

type Props = {
  title: string
  description?: string
  children: ReactNode
  columns?: 1 | 2 | 3
  /** Span both columns in the dashboard metrics grid (e.g. three attendance cards). */
  span?: 'full'
}

export function DashboardMetricGroup({ title, description, children, columns = 2, span }: Props) {
  const colClass =
    columns === 1
      ? 'dashboard-metric-group-grid-cols-1'
      : columns === 3
        ? 'dashboard-metric-group-grid-cols-3'
        : 'dashboard-metric-group-grid-cols-2'

  return (
    <section
      className={`dashboard-metric-group card border${span === 'full' ? ' dashboard-metric-group-span-full' : ''}`}
      aria-labelledby={`metric-group-${title.replace(/\s+/g, '-')}`}
    >
      <header className="dashboard-metric-group-head">
        <h3 id={`metric-group-${title.replace(/\s+/g, '-')}`} className="dashboard-metric-group-title">
          {title}
        </h3>
        {description ? <p className="dashboard-metric-group-desc">{description}</p> : null}
      </header>
      <div className={`dashboard-metric-group-grid ${colClass}`}>{children}</div>
    </section>
  )
}
