import { useId, useState, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** Shown when the guide is collapsed */
  expandLabel?: string
  /** Shown when the guide is open */
  collapseLabel?: string
}

/** Collapses long colour / notes blocks until the user opens them. */
export function LegendExpandPanel({
  children,
  expandLabel = 'View colour guide & notes',
  collapseLabel = 'Hide colour guide & notes',
}: Props) {
  const [open, setOpen] = useState(false)
  const panelId = useId().replace(/:/g, '')
  const toggleId = `${panelId}-legend-toggle`

  return (
    <div className="mt-2">
      <button
        type="button"
        id={toggleId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="btn-ghost px-3 py-1.5 text-xs text-[var(--color-brand)]"
      >
        <span className="tabular-nums text-[color-mix(in_srgb,var(--color-warm-text)_70%,transparent)]" aria-hidden>
          {open ? '▲' : '▼'}
        </span>
        {open ? collapseLabel : expandLabel}
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={toggleId}
          className="mt-3 max-w-4xl rounded-xl border border-[color-mix(in_srgb,var(--color-warm-muted)_65%,transparent)] bg-[color-mix(in_srgb,var(--color-surface)_92%,var(--color-warm-page))] p-4 ring-1 ring-black/[0.04]"
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}
