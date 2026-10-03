import type { MonthlyDayHoursDetail } from '../utils/attendance'
import { formatStoredClock } from '../utils/attendance'

type Props = {
  detail: MonthlyDayHoursDetail
  isSunday: boolean
  showHoursInline: boolean
  expanded: boolean
  onToggle: () => void
  hasHours: boolean
}

export function MonthlyDayCell({
  detail,
  isSunday,
  showHoursInline,
  expanded,
  onToggle,
  hasHours,
}: Props) {
  if (isSunday) {
    return <span>Sun</span>
  }

  if (showHoursInline) {
    return <span className="tabular-nums">{detail.withHoursLabel}</span>
  }

  const canExpand = hasHours || detail.compactMark !== '-'

  if (!canExpand) {
    return <span>{detail.compactMark}</span>
  }

  return (
    <div className="relative min-w-[2.25rem]">
      <button
        type="button"
        onClick={onToggle}
        onMouseDown={(e) => e.stopPropagation()}
        aria-expanded={expanded}
        aria-label={
          expanded
            ? `Hide hours for ${detail.withHoursLabel}`
            : `Show hours for ${detail.compactMark}`
        }
        className="group mx-auto flex w-full flex-col items-center gap-0.5 rounded px-0.5 py-0.5 text-inherit hover:bg-[color-mix(in_srgb,var(--color-brand-muted)_55%,transparent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
      >
        <span className="font-medium">{detail.compactMark}</span>
        {!expanded && hasHours ? (
          <span className="text-[0.55rem] leading-none text-[var(--color-warm-text)] opacity-70 group-hover:text-[var(--color-brand)]">
            ▾ hrs
          </span>
        ) : null}
        {expanded && detail.hoursLabel ? (
          <span className="text-[0.65rem] font-semibold tabular-nums text-[var(--color-brand)]">
            {detail.hoursLabel}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div
          className="absolute left-1/2 top-[calc(100%+2px)] z-30 w-max min-w-[6.5rem] max-w-[10rem] -translate-x-1/2 rounded-lg border border-[color-mix(in_srgb,var(--color-brand)_22%,var(--color-warm-muted))] bg-[var(--color-surface)] px-2.5 py-2 text-left text-[0.65rem] leading-snug shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
          role="dialog"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="font-semibold tabular-nums text-[var(--color-ink)]">{detail.withHoursLabel}</div>
          {detail.inTime ? (
            <div className="mt-1 text-[var(--color-warm-text)]">
              In: <span className="tabular-nums text-[var(--color-ink)]">{formatStoredClock(detail.inTime)}</span>
            </div>
          ) : null}
          {detail.outTime ? (
            <div className="text-[var(--color-warm-text)]">
              Out: <span className="tabular-nums text-[var(--color-ink)]">{formatStoredClock(detail.outTime)}</span>
            </div>
          ) : null}
          {!detail.hoursLabel && !detail.inTime ? (
            <div className="mt-1 text-[var(--color-warm-text)]">No hours recorded</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
