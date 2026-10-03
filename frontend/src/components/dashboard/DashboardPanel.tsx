import { forwardRef, type ReactNode } from 'react'

type DashboardPanelProps = {
  title: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export const DashboardPanel = forwardRef<HTMLElement, DashboardPanelProps>(function DashboardPanel(
  { title, actions, children, className },
  ref,
) {
  return (
    <section ref={ref} className={`par-panel card border${className ? ` ${className}` : ''}`}>
      <header className="par-panel-header">
        <h3 className="par-panel-title">{title}</h3>
        {actions ? <div className="par-panel-actions">{actions}</div> : null}
      </header>
      <div className="par-panel-body">{children}</div>
    </section>
  )
})
