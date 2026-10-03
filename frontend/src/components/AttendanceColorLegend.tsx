import type { ReactNode } from 'react'
import { LATE_GRACE_MINUTES } from '../utils/attendance'

/** Legend-only chips: deeper fills than table cells so the key stays readable on the header gradient. */
const swatchFrame =
  'inline-block h-5 w-5 shrink-0 rounded-md border-2 border-[color-mix(in_srgb,#44403c_35%,#a8a29e)] shadow-[0_1px_3px_rgba(0,0,0,0.14)] align-middle'

function Item({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-2.5">{children}</span>
}

function Swatch({ className }: { className: string }) {
  return <span className={`${swatchFrame} ${className}`} aria-hidden />
}

/** Explains table colours for Daily vs week/month grid views. */
export function AttendanceColorLegend({ variant }: { variant: 'daily' | 'grid' }) {
  const lateNote = `Late uses the register (and clock-in when available), including after shift + ${LATE_GRACE_MINUTES} min.`

  if (variant === 'daily') {
    return (
      <div className="mt-2 space-y-3 text-sm text-[color-mix(in_srgb,var(--color-warm-text)_92%,transparent)]">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[color-mix(in_srgb,var(--color-ink)_62%,transparent)]">
            Mark column
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2.5">
            <Item>
              <Swatch className="bg-emerald-200" />
              Present / worked
            </Item>
            <Item>
              <Swatch className="bg-sky-200" />
              WFH
            </Item>
            <Item>
              <span
                className={`${swatchFrame} bg-[color-mix(in_srgb,#f59e0b_28%,#ffedd5)] ring-2 ring-amber-500/90 ring-offset-1 ring-offset-[color-mix(in_srgb,var(--color-surface)_95%,#fafaf9)]`}
                aria-hidden
              />
              WFH unverified
            </Item>
            <Item>
              <Swatch className="bg-violet-200" />
              Paid leave
            </Item>
            <Item>
              <Swatch className="bg-red-200" />
              Absent
            </Item>
            <Item>
              <Swatch className="bg-[color-mix(in_srgb,var(--color-warm-muted)_78%,#d6d3d1)]" />
              Weekly off
            </Item>
            <Item>
              <span
                className={`${swatchFrame} h-5 w-5 bg-emerald-200 ring-2 ring-amber-500 ring-inset`}
                aria-hidden
              />
              Late (amber ring on mark)
            </Item>
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[color-mix(in_srgb,var(--color-ink)_62%,transparent)]">
            Late mark
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2.5">
            <Item>
              <Swatch className="bg-amber-200" />
              Late
            </Item>
            <Item>
              <Swatch className="bg-emerald-200" />
              <span className="font-medium text-emerald-900">On time</span>
            </Item>
            <Item>
              <Swatch className="bg-stone-300" />
              <span className="text-[color-mix(in_srgb,var(--color-warm-text)_82%,transparent)]">
                - (not applicable)
              </span>
            </Item>
          </div>
            <p className="mt-1.5 text-xs leading-relaxed text-[color-mix(in_srgb,var(--color-warm-text)_88%,transparent)]">
              In Time is the scheduled shift start. Check-in and Out Time are stored punches.
              Late minutes is how long after shift start the check-in was. {lateNote}
            </p>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[color-mix(in_srgb,var(--color-ink)_62%,transparent)]">
              Data layer
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-2.5">
              <Item>
                <Swatch className="bg-stone-200" />
                Calculated from import
              </Item>
              <Item>
                <Swatch className="bg-amber-200" />
                HR edit (import kept)
              </Item>
              <Item>
                <Swatch className="bg-emerald-200" />
                Approved weekly result
              </Item>
            </div>
          </div>
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-3 text-sm text-[color-mix(in_srgb,var(--color-warm-text)_92%,transparent)]">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[color-mix(in_srgb,var(--color-ink)_62%,transparent)]">
          Day cells (marks)
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2.5">
          <Item>
            <Swatch className="bg-emerald-200" />
            Present / worked
          </Item>
          <Item>
            <Swatch className="bg-red-200" />
            Absent
          </Item>
          <Item>
            <Swatch className="bg-[color-mix(in_srgb,var(--color-warm-muted)_78%,#d6d3d1)]" />
            Off / weekly off
          </Item>
          <Item>
            <Swatch className="bg-sky-200" />
            WFH
          </Item>
          <Item>
            <span
              className={`${swatchFrame} bg-[color-mix(in_srgb,#f59e0b_28%,#ffedd5)] ring-2 ring-amber-500/90 ring-offset-1 ring-offset-[color-mix(in_srgb,var(--color-surface)_95%,#fafaf9)]`}
              aria-hidden
            />
            WFH unverified (no OUT / HD)
          </Item>
          <Item>
            <Swatch className="bg-violet-200" />
            Paid leave
          </Item>
          <Item>
            <Swatch className="border-dashed border-stone-500/50 bg-[var(--color-surface)]" />
            Other mark
          </Item>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[color-mix(in_srgb,var(--color-ink)_62%,transparent)]">
          Late highlight & week count
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2.5">
          <Item>
            <span
              className={`${swatchFrame} h-5 w-5 bg-emerald-200 ring-2 ring-amber-500 ring-inset`}
              aria-hidden
            />
            Late that day (amber ring)
          </Item>
          <Item>
            <Swatch className="bg-amber-200" />
            Lates in week (amber when count is positive)
          </Item>
          <Item>
            <span
              className={`${swatchFrame} flex items-center justify-center bg-emerald-200 text-[0.7rem] font-bold text-emerald-950`}
              aria-hidden
            >
              0
            </span>
            No lates in week (green count)
          </Item>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-[color-mix(in_srgb,var(--color-warm-text)_88%,transparent)]">
          {lateNote} Sunday shows as Sun (no mark).
        </p>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[color-mix(in_srgb,var(--color-ink)_62%,transparent)]">
          Hours & deficit
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2.5">
          <Item>
            <span
              className={`${swatchFrame} flex min-w-[2.75rem] items-center justify-center bg-[color-mix(in_srgb,var(--color-brand-muted)_50%,#fff7ed)] px-1.5 text-xs font-semibold text-[color-mix(in_srgb,var(--color-brand)_48%,#0c0a09)]`}
              aria-hidden
            >
              1:30
            </span>
            Deficit (shortfall) when non-zero
          </Item>
          <Item>
            <span
              className={`${swatchFrame} flex min-w-[2.75rem] items-center justify-center bg-stone-300 px-1.5 text-xs font-medium text-stone-700`}
              aria-hidden
            >
              0:00
            </span>
            Deficit zero / neutral totals
          </Item>
        </div>
      </div>
    </div>
  )
}
