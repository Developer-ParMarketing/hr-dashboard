import type { ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** Extra classes on the scroll container (e.g. `card border`). */
  className?: string
  /** Minimum table width before horizontal scroll kicks in. */
  minTableWidth?: string
}

/**
 * Keeps `report-table` layouts inside the page: horizontal scroll on narrow viewports,
 * never `overflow: visible` spilling past the shell.
 */
export function ReportTableShell({
  children,
  className = 'card border p-0',
  minTableWidth = '42rem',
}: Props) {
  return (
    <div
      className={`report-table-wrap min-w-0 ${className}`.trim()}
      style={{ ['--report-table-min-width' as string]: minTableWidth }}
    >
      {children}
    </div>
  )
}
