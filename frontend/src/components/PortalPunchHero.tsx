import { useMemo } from 'react'
import {
  formatHm12,
  type IstClockSnapshot,
  type PortalWindowInfo,
} from '../api/portalPunch'

type Props = {
  clock: IstClockSnapshot
  today: PortalWindowInfo
  checkedIn: boolean
  awaitingCheckOut: boolean
  inTime: string | null
  outTime: string | null
  checkInLate?: boolean
  lateMinutes?: number
}

function hmToMinutes(hm: string): number | null {
  const m = hm.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return Number.parseInt(m[1], 10) * 60 + Number.parseInt(m[2], 10)
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function pctOnTimeline(valueMin: number, startMin: number, endMin: number): number {
  if (endMin <= startMin) return 0
  return clamp(((valueMin - startMin) / (endMin - startMin)) * 100, 0, 100)
}

function AnalogClock({ clock, accent }: { clock: IstClockSnapshot; accent: string }) {
  const secDeg = clock.seconds * 6
  const minDeg = clock.minutes * 6 + clock.seconds * 0.1
  const hourDeg = (clock.hours % 12) * 30 + clock.minutes * 0.5

  return (
    <div
      className="portal-punch-analog relative mx-auto shrink-0"
      aria-hidden
    >
      <svg viewBox="0 0 120 120" className="h-[7.5rem] w-[7.5rem] sm:h-[8.5rem] sm:w-[8.5rem]">
        <defs>
          <linearGradient id="portalClockFace" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fff" />
            <stop offset="100%" stopColor="color-mix(in srgb, var(--color-brand-soft) 80%, #fff)" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r="54" fill="url(#portalClockFace)" />
        <circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          stroke="color-mix(in srgb, var(--color-brand) 22%, transparent)"
          strokeWidth="2"
        />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 * Math.PI) / 180
          const x1 = 60 + Math.sin(a) * 44
          const y1 = 60 - Math.cos(a) * 44
          const x2 = 60 + Math.sin(a) * 48
          const y2 = 60 - Math.cos(a) * 48
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="color-mix(in srgb, var(--color-ink) 25%, transparent)"
              strokeWidth={i % 3 === 0 ? 2 : 1}
              strokeLinecap="round"
            />
          )
        })}
        <line
          x1="60"
          y1="60"
          x2="60"
          y2="34"
          stroke={accent}
          strokeWidth="3.5"
          strokeLinecap="round"
          transform={`rotate(${hourDeg} 60 60)`}
          opacity="0.9"
        />
        <line
          x1="60"
          y1="60"
          x2="60"
          y2="26"
          stroke="var(--color-ink)"
          strokeWidth="2.5"
          strokeLinecap="round"
          transform={`rotate(${minDeg} 60 60)`}
          opacity="0.75"
        />
        <line
          x1="60"
          y1="60"
          x2="60"
          y2="22"
          stroke="var(--color-brand)"
          strokeWidth="1.5"
          strokeLinecap="round"
          transform={`rotate(${secDeg} 60 60)`}
        />
        <circle cx="60" cy="60" r="3.5" fill="var(--color-brand)" />
      </svg>
      <span className="portal-punch-analog-glow" style={{ background: accent }} />
    </div>
  )
}

export function PortalPunchHero({
  clock,
  today,
  checkedIn,
  awaitingCheckOut,
  inTime,
  outTime,
  checkInLate,
  lateMinutes,
}: Props) {
  const logoutHm = today.expectedCheckOut ?? today.shiftEnd

  const timeline = useMemo(() => {
    const shiftStart = hmToMinutes(today.shiftStart) ?? 9 * 60
    const logout = hmToMinutes(logoutHm) ?? shiftStart + 9 * 60
    const graceEnd = hmToMinutes(today.checkOutUntil) ?? logout + 60
    const start = shiftStart - 45
    const end = graceEnd + 30
    const nowMin = hmToMinutes(clock.hm) ?? shiftStart
    const inMin = inTime ? hmToMinutes(inTime) : null
    return {
      start,
      end,
      nowPct: pctOnTimeline(nowMin, start, end),
      shiftPct: pctOnTimeline(shiftStart, start, end),
      inPct: inMin != null ? pctOnTimeline(inMin, start, end) : null,
      logoutPct: pctOnTimeline(logout, start, end),
    }
  }, [clock.hm, inTime, logoutHm, today.checkOutUntil, today.shiftStart])

  const actionLine = useMemo(() => {
    if (outTime) return 'Your approver will confirm both times for attendance.'
    if (awaitingCheckOut) {
      if (today.checkOutOpen) {
        return `Check out now - open until ${formatHm12(today.checkOutUntil)}.`
      }
      return `Logout at ${formatHm12(logoutHm)} · check-out from ${formatHm12(today.checkOutFrom)}.`
    }
    if (!checkedIn) {
      if (today.checkInOpen) {
        return `Check in open until ${formatHm12(today.checkInUntil)}.`
      }
      return `Check-in window ${formatHm12(today.checkInFrom)}-${formatHm12(today.checkInUntil)}.`
    }
    return null
  }, [awaitingCheckOut, checkedIn, logoutHm, outTime, today])

  let statusLabel = 'Not started'
  let statusTone: 'neutral' | 'open' | 'work' | 'checkout' | 'done' | 'late' = 'neutral'
  if (outTime) {
    statusLabel = 'Day complete - pending approval'
    statusTone = 'done'
  } else if (awaitingCheckOut && today.checkOutOpen) {
    statusLabel = 'Check-out window open'
    statusTone = 'checkout'
  } else if (awaitingCheckOut) {
    statusLabel = checkInLate ? 'On the clock · late' : 'On the clock'
    statusTone = checkInLate ? 'late' : 'work'
  } else if (today.checkInOpen) {
    statusLabel = 'Check-in open'
    statusTone = 'open'
  } else if (!checkedIn) {
    statusLabel = 'Check-in closed'
    statusTone = 'neutral'
  }

  const accent =
    statusTone === 'checkout'
      ? 'var(--insight-attendance)'
      : statusTone === 'late'
        ? '#d97706'
        : statusTone === 'open'
          ? 'var(--color-brand)'
          : 'color-mix(in srgb, var(--color-brand) 55%, var(--color-ink))'

  const toneClass =
    statusTone === 'checkout'
      ? 'bg-[var(--insight-attendance-soft)] text-emerald-900 ring-emerald-200'
      : statusTone === 'late'
        ? 'bg-amber-50 text-amber-950 ring-amber-200'
        : statusTone === 'open'
          ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)] ring-orange-200'
          : statusTone === 'work'
            ? 'bg-[var(--insight-attendance-soft)] text-emerald-900 ring-emerald-200'
            : statusTone === 'done'
              ? 'bg-violet-50 text-violet-900 ring-violet-200'
              : 'bg-white/80 text-[var(--color-warm-text)] ring-[color-mix(in_srgb,var(--color-warm-muted)_60%,transparent)]'

  return (
    <section
      className="portal-punch-hero overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--color-brand)_18%,transparent)] bg-[linear-gradient(145deg,color-mix(in_srgb,var(--color-brand-soft)_90%,#fff)_0%,#fff_42%,color-mix(in_srgb,var(--insight-attendance-soft)_35%,#fff)_100%)] p-5 shadow-[var(--shadow-card)] sm:p-6"
      aria-label="Live time and shift timeline"
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-5 sm:gap-6">
          <AnalogClock clock={clock} accent={accent} />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-warm-text)]">
              India Standard Time
            </p>
            <p className="portal-punch-digital-time mt-1 tabular-nums text-[var(--color-ink)]">
              {clock.time12WithSeconds}
            </p>
            <p className="mt-1 text-sm text-[var(--color-warm-text)]">{clock.dateLabel}</p>
            <span
              className={`mt-3 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${toneClass}`}
            >
              {statusLabel}
            </span>
            {actionLine ? (
              <p className="mt-2 max-w-md text-sm leading-snug text-[var(--color-warm-text)]">
                {checkInLate && lateMinutes != null && lateMinutes > 0 && !outTime
                  ? `${lateMinutes} min after shift start · `
                  : null}
                {actionLine}
              </p>
            ) : null}
          </div>
        </div>

        {inTime || outTime ? (
          <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:text-right">
            {inTime ? (
              <div>
                <dt className="text-[var(--color-warm-text)]">In</dt>
                <dd className="font-semibold tabular-nums text-[var(--color-ink)]">
                  {formatHm12(inTime)}
                </dd>
              </div>
            ) : null}
            {outTime ? (
              <div>
                <dt className="text-[var(--color-warm-text)]">Out</dt>
                <dd className="font-semibold tabular-nums text-[var(--color-ink)]">
                  {formatHm12(outTime)}
                </dd>
              </div>
            ) : awaitingCheckOut ? (
              <div>
                <dt className="text-[var(--color-warm-text)]">Out</dt>
                <dd className="font-semibold tabular-nums text-[var(--color-warm-text)]">-</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>

      <div className="mt-6">
        <div className="portal-punch-timeline relative mb-6 h-3 rounded-full bg-[color-mix(in_srgb,var(--color-warm-muted)_45%,#fff)]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-brand)_35%,transparent),color-mix(in_srgb,var(--insight-attendance)_40%,transparent))]"
            style={{
              left: `${timeline.shiftPct}%`,
              width: `${Math.max(timeline.logoutPct - timeline.shiftPct, 2)}%`,
            }}
          />
          <div
            className="portal-punch-now-marker absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--color-brand)] shadow-md"
            style={{ left: `${timeline.nowPct}%` }}
            title={`Now ${clock.hm}`}
          />
          {timeline.inPct != null ? (
            <div
              className="absolute top-1/2 z-[5] h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-600 ring-2 ring-white"
              style={{ left: `${timeline.inPct}%` }}
              title={`Check-in ${inTime}`}
            />
          ) : null}
          <div
            className="absolute top-full mt-1.5 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium tabular-nums text-[var(--color-warm-text)]"
            style={{ left: `${timeline.shiftPct}%` }}
          >
            {formatHm12(today.shiftStart)}
          </div>
          <div
            className="absolute top-full mt-1.5 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium tabular-nums text-[var(--color-warm-text)]"
            style={{ left: `${timeline.logoutPct}%` }}
          >
            {formatHm12(logoutHm)}
          </div>
        </div>
      </div>
    </section>
  )
}
