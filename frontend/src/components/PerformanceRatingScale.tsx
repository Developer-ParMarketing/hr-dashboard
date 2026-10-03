import type { RatingScaleEntry } from '../api/performance'

const DEFAULT_SCALE: RatingScaleEntry[] = [
  { value: 1, label: 'Needs Development', note: '' },
  { value: 2, label: 'Below Expectations', note: '' },
  { value: 3, label: 'Meets Expectations', note: '' },
  { value: 4, label: 'Above Par', note: '' },
  { value: 5, label: 'Significantly Above Par', note: '' },
]

type Props = {
  ratingScale: RatingScaleEntry[]
  collapsible?: boolean
}

export function PerformanceRatingScale({ ratingScale, collapsible = true }: Props) {
  const rows = ratingScale.length > 0 ? ratingScale : DEFAULT_SCALE

  const body = (
    <div className="perf-scale-grid">
      {rows.map((row) => (
        <div key={row.value} className="perf-scale-item">
          <p className="perf-scale-value">{row.value}</p>
          <p className="mt-1 text-xs font-medium leading-snug text-[var(--color-ink)]">{row.label}</p>
          {row.note ? (
            <p className="mt-0.5 text-[0.65rem] leading-snug text-[var(--color-warm-text)]">{row.note}</p>
          ) : null}
        </div>
      ))}
    </div>
  )

  if (!collapsible) {
    return (
      <section className="card overflow-hidden">
        <div className="card-head">
          <p className="text-sm font-semibold text-[var(--color-ink)]">Rating scale</p>
          <p className="mt-1 text-sm text-[var(--color-warm-text)]">
            Use 1-5 for each goal or skill. Tap a number when filling the form.
          </p>
        </div>
        {body}
      </section>
    )
  }

  return (
    <details className="card group overflow-hidden">
      <summary className="card-head cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[var(--color-ink)]">Rating scale (1-5)</p>
            <p className="mt-1 text-sm text-[var(--color-warm-text)]">
              Expand to see what each rating means.
            </p>
          </div>
          <span className="text-xs font-medium text-[var(--color-brand)] group-open:hidden">Show</span>
          <span className="hidden text-xs font-medium text-[var(--color-brand)] group-open:inline">
            Hide
          </span>
        </div>
      </summary>
      {body}
    </details>
  )
}
