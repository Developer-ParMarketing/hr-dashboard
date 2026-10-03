import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  countInclusiveDays,
  formatDateRange,
  formatLeaveDateShort,
  leaveTypeAccent,
  leaveTypeLabel,
  previewLeaveApply,
  statusLabel,
  toIsoDateLocal,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveType,
} from '../api/leaveRequests'
import { istClockSnapshot } from '../api/portalPunch'
import {
  buildDayLeaveMap,
  existingLeaveDayClasses,
  primaryDayLeaveEntry,
  type DayLeaveEntry,
} from '../utils/leaveCalendar'

type LeaveTypeOption = { id: LeaveType; label: string }

type Props = {
  leaveTypes: LeaveTypeOption[]
  leaveType: LeaveType
  onLeaveTypeChange: (type: LeaveType) => void
  startDate: string
  endDate: string
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
  reason: string
  onReasonChange: (value: string) => void
  submitting: boolean
  onSubmit: (e: React.FormEvent) => void
  myRequests?: LeaveRequest[]
}

function parseIsoDateLocal(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number.parseInt(m[2], 10) - 1, Number.parseInt(m[3], 10))
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function buildMonthCells(year: number, month: number) {
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: Array<{ day: number; iso: string } | null> = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, iso: toIsoDateLocal(new Date(year, month, d)) })
  }
  return cells
}

function LeaveMonthGrid({
  year,
  month,
  startDate,
  endDate,
  onDayClick,
  todayIso,
  minSelectableIso,
  dayMap,
}: {
  year: number
  month: number
  startDate: string
  endDate: string
  onDayClick: (iso: string) => void
  todayIso: string
  minSelectableIso: string
  dayMap?: Map<string, DayLeaveEntry[]>
}) {
  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  })
  const cells = useMemo(() => buildMonthCells(year, month), [year, month])
  const rangeStart = startDate ? parseIsoDateLocal(startDate) : null
  const rangeEnd = parseIsoDateLocal(endDate || startDate)

  return (
    <div className="leave-cal-month min-w-0">
      <p className="mb-3 text-center text-sm font-semibold text-[var(--color-ink)]">{monthLabel}</p>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium text-[var(--color-warm-text)] sm:text-xs">
        {WEEKDAY_LABELS.map((w) => (
          <span key={w} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-0.5">
        {cells.map((cell, i) => {
          if (!cell) return <span key={`e-${i}`} className="aspect-square" aria-hidden />
          const dt = parseIsoDateLocal(cell.iso)!
          const inRange =
            rangeStart && rangeEnd ? dt >= rangeStart && dt <= rangeEnd : false
          const isStart = startDate === cell.iso
          const isEnd = (endDate || startDate) === cell.iso
          const isSingle = isStart && isEnd && startDate === endDate
          const isToday = cell.iso === todayIso
          const isPast = cell.iso < minSelectableIso
          const entries = dayMap?.get(cell.iso) ?? []
          const existing = entries.length > 0 ? primaryDayLeaveEntry(entries) : null
          const existingClasses = existingLeaveDayClasses(existing, inRange)
          const canSelect = !isPast

          return (
            <button
              key={cell.iso}
              type="button"
              onClick={() => onDayClick(cell.iso)}
              aria-label={formatLeaveDateShort(cell.iso)}
              aria-pressed={inRange}
              aria-disabled={isPast && !existing ? true : undefined}
              tabIndex={isPast && !existing ? -1 : undefined}
              className={[
                'leave-cal-day leave-overview-day relative flex aspect-square flex-col items-center justify-center rounded-lg text-xs tabular-nums transition sm:text-sm',
                isPast ? 'leave-cal-day--past' : '',
                canSelect && inRange && !isStart && !isEnd && !isSingle
                  ? 'bg-[color-mix(in_srgb,var(--insight-people)_20%,#fff)] text-[var(--color-ink)]'
                  : canSelect && !existing
                    ? 'text-[var(--color-ink)] hover:bg-[color-mix(in_srgb,var(--insight-people)_12%,#fff)]'
                    : '',
                canSelect && isSingle
                  ? 'bg-[var(--insight-people)] font-semibold text-white shadow-sm ring-2 ring-[var(--insight-people)] ring-offset-1'
                  : '',
                canSelect && isStart && !isSingle
                  ? 'rounded-r-none bg-[var(--insight-people)] font-semibold text-white ring-2 ring-[var(--insight-people)] ring-offset-1'
                  : '',
                canSelect && isEnd && !isSingle
                  ? 'rounded-l-none bg-[var(--insight-people)] font-semibold text-white ring-2 ring-[var(--insight-people)] ring-offset-1'
                  : '',
                canSelect && inRange && !isStart && !isEnd
                  ? 'rounded-none bg-[color-mix(in_srgb,var(--insight-people)_22%,#fff)]'
                  : '',
                isToday && !inRange && !existing ? 'ring-1 ring-[color-mix(in_srgb,var(--color-brand)_40%,transparent)]' : '',
                existingClasses,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span>{cell.day}</span>
              {existing && !inRange ? (
                <span className="leave-overview-day-tags">{existing.leaveType.toUpperCase()}</span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function LeaveCalendarLegend() {
  return (
    <ul className="leave-requests-cal-legend mt-3" aria-label="Calendar legend">
      <li>
        <span className="leave-requests-cal-swatch leave-requests-cal-swatch--selection" /> New
        selection
      </li>
      <li>
        <span className="leave-requests-cal-swatch leave-requests-cal-swatch--approved" /> Approved
      </li>
      <li>
        <span className="leave-requests-cal-swatch leave-requests-cal-swatch--pending" /> Requested
      </li>
      <li>
        <span className="leave-requests-cal-swatch leave-requests-cal-swatch--rejected" /> Rejected
      </li>
    </ul>
  )
}

function statusBadgeClass(status: LeaveRequest['status']): string {
  if (status === 'approved') return 'report-status report-status--ok'
  if (status === 'pending') return 'report-status report-status--pending'
  if (status === 'rejected') return 'report-status report-status--bad'
  return 'report-status report-status--neutral'
}

function LeaveRangeCalendar({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  myRequests,
}: {
  startDate: string
  endDate: string
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
  myRequests: LeaveRequest[]
}) {
  const todayIso = useMemo(() => istClockSnapshot().isoDate, [])
  const minSelectableIso = todayIso
  const dayMap = useMemo(() => buildDayLeaveMap(myRequests), [myRequests])
  const initialAnchor =
    parseIsoDateLocal(startDate) ??
    parseIsoDateLocal(myRequests[0]?.startDate ?? '') ??
    new Date()
  const [cursor, setCursor] = useState(() => ({
    year: initialAnchor.getFullYear(),
    month: initialAnchor.getMonth(),
  }))
  const [focusIso, setFocusIso] = useState<string | null>(null)

  useEffect(() => {
    if (startDate && startDate < minSelectableIso) {
      onStartDateChange('')
      onEndDateChange('')
    } else if (endDate && endDate < minSelectableIso) {
      onEndDateChange(startDate >= minSelectableIso ? startDate : '')
    }
  }, [endDate, minSelectableIso, onEndDateChange, onStartDateChange, startDate])

  const secondMonth = useMemo(() => {
    const d = new Date(cursor.year, cursor.month + 1, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  }, [cursor.year, cursor.month])

  const handleDayClick = useCallback(
    (iso: string) => {
      if (iso < minSelectableIso) {
        if ((dayMap.get(iso) ?? []).length > 0) setFocusIso(iso)
        return
      }
      setFocusIso(iso)
      if (!startDate) {
        onStartDateChange(iso)
        onEndDateChange(iso)
        return
      }
      const s = startDate
      const e = endDate || startDate
      if (s !== e) {
        onStartDateChange(iso)
        onEndDateChange(iso)
        return
      }
      if (iso === s) return
      const anchor = parseIsoDateLocal(s)!
      const clicked = parseIsoDateLocal(iso)!
      if (clicked >= anchor) {
        onEndDateChange(iso)
      } else {
        onStartDateChange(iso)
        onEndDateChange(s)
      }
    },
    [dayMap, endDate, minSelectableIso, onEndDateChange, onStartDateChange, startDate],
  )

  const focusRequests = useMemo(() => {
    if (!focusIso) return []
    const ids = new Set((dayMap.get(focusIso) ?? []).map((e) => e.requestId))
    return myRequests.filter((r) => ids.has(r.id))
  }, [dayMap, focusIso, myRequests])

  function shiftMonths(delta: number) {
    setCursor((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
  }

  function clearRange() {
    onStartDateChange('')
    onEndDateChange('')
  }

  const selectionHint = !startDate
    ? 'Select today or a future date. Past days show existing leave only.'
    : startDate === (endDate || startDate)
      ? 'One day selected - click another day to extend the range.'
      : `${formatLeaveDateShort(startDate)} - ${formatLeaveDateShort(endDate)}`

  return (
    <div className="leave-range-cal rounded-2xl border border-[color-mix(in_srgb,var(--insight-people)_18%,transparent)] bg-white/80 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-ink)]">Calendar</p>
          <p className="mt-0.5 text-xs text-[var(--color-warm-text)]">{selectionHint}</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost px-2 py-1 text-sm" onClick={() => shiftMonths(-1)} aria-label="Previous month">
            ‹
          </button>
          <button type="button" className="btn-ghost px-2 py-1 text-sm" onClick={() => shiftMonths(1)} aria-label="Next month">
            ›
          </button>
          {startDate ? (
            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={clearRange}>
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <LeaveCalendarLegend />

      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <LeaveMonthGrid
          year={cursor.year}
          month={cursor.month}
          startDate={startDate}
          endDate={endDate}
          onDayClick={handleDayClick}
          todayIso={todayIso}
          minSelectableIso={minSelectableIso}
          dayMap={dayMap}
        />
        <LeaveMonthGrid
          year={secondMonth.year}
          month={secondMonth.month}
          startDate={startDate}
          endDate={endDate}
          onDayClick={handleDayClick}
          todayIso={todayIso}
          minSelectableIso={minSelectableIso}
          dayMap={dayMap}
        />
      </div>

      {focusIso && focusRequests.length > 0 ? (
        <div className="leave-requests-cal-detail mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
            On {formatLeaveDateShort(focusIso)}
          </h3>
          <ul className="leave-requests-cal-detail-list">
            {focusRequests.map((row) => (
              <li key={row.id} className="leave-requests-cal-detail-item">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${leaveTypeAccent(row.leaveType).soft}`}
                  >
                    {leaveTypeLabel(row.leaveType)}
                  </span>
                  <span className={statusBadgeClass(row.status)}>{statusLabel(row.status)}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--color-ink)]">
                  {formatDateRange(row.startDate, row.endDate)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function LeaveApplyPanel({
  leaveTypes,
  leaveType,
  onLeaveTypeChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  reason,
  onReasonChange,
  submitting,
  onSubmit,
  myRequests = [],
}: Props) {
  const options =
    leaveTypes.length > 0
      ? leaveTypes
      : [
          { id: 'pl' as const, label: 'Personal Leave (PL)' },
          { id: 'sl' as const, label: 'Sick Leave (SL)' },
          { id: 'cl' as const, label: 'Casual Leave (CL)' },
        ]

  const dayCount = countInclusiveDays(startDate, endDate)
  const minRequestDate = useMemo(() => istClockSnapshot().isoDate, [])
  const typeDisplay =
    options.find((o) => o.id === leaveType)?.label.replace(/\s*\([A-Z]+\)\s*$/, '') ??
    leaveTypeLabel(leaveType)
  const previewReady =
    Boolean(startDate && endDate && dayCount != null) &&
    startDate >= minRequestDate &&
    endDate >= startDate

  const summaryLine = previewReady
    ? `${typeDisplay} · ${dayCount} day${dayCount === 1 ? '' : 's'} · ${formatLeaveDateShort(startDate)}${
        startDate !== endDate ? ` - ${formatLeaveDateShort(endDate)}` : ''
      }`
    : 'Pick a leave type and dates on the calendar.'

  const canSubmit = previewReady

  const [applyPreviewWarnings, setApplyPreviewWarnings] = useState<string[]>([])
  const [applyPreviewLoading, setApplyPreviewLoading] = useState(false)

  useEffect(() => {
    if (!previewReady || !startDate || !endDate) {
      setApplyPreviewWarnings([])
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setApplyPreviewLoading(true)
      previewLeaveApply({ startDate, endDate })
        .then((warnings) => {
          if (!cancelled) setApplyPreviewWarnings(warnings)
        })
        .catch(() => {
          if (!cancelled) setApplyPreviewWarnings([])
        })
        .finally(() => {
          if (!cancelled) setApplyPreviewLoading(false)
        })
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [previewReady, startDate, endDate])

  return (
    <form
      className="card max-w-4xl overflow-hidden border p-0"
      onSubmit={onSubmit}
      aria-label="New leave request"
    >
      <input type="hidden" name="startDate" value={startDate} required />
      <input type="hidden" name="endDate" value={endDate} required />

      <div className="leave-apply-hero border-b border-[color-mix(in_srgb,var(--insight-people)_12%,transparent)] bg-[linear-gradient(145deg,var(--insight-people-soft)_0%,#fff_55%,color-mix(in_srgb,var(--insight-actions-soft)_40%,#fff)_100%)] p-6 sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-warm-text)]">
          New leave request
        </p>
        <p className="mt-2 text-lg font-semibold text-[var(--color-ink)]">{summaryLine}</p>
        <p className="mt-2 text-sm text-[var(--color-warm-text)]">Sent to your approver once you submit.</p>

        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
            Leave type
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Leave type">
            {options.map((t) => {
              const style = leaveTypeAccent(t.id)
              const selected = leaveType === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={[
                    'leave-type-tile flex items-start gap-3 rounded-xl border p-3 text-left transition',
                    selected
                      ? `border-[color-mix(in_srgb,var(--insight-people)_35%,transparent)] bg-white shadow-sm ring-2 ring-inset ${style.ring}`
                      : 'border-[color-mix(in_srgb,var(--color-warm-muted)_70%,transparent)] bg-white/60 hover:bg-white',
                  ].join(' ')}
                  onClick={() => onLeaveTypeChange(t.id)}
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${style.soft}`}
                  >
                    {style.badge}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[var(--color-ink)]">
                      {t.label.replace(/\s*\([A-Z]+\)\s*$/, '')}
                    </span>
                    <span className="block text-xs text-[var(--color-warm-text)]">{style.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {previewReady && dayCount != null ? (
          <div className="leave-duration-bar mt-6">
            <div className="mb-2 flex items-center justify-between text-xs text-[var(--color-warm-text)]">
              <span>{dayCount === 1 ? 'Single day' : 'Duration'}</span>
              <span className="font-semibold tabular-nums text-[var(--color-ink)]">
                {dayCount} calendar day{dayCount === 1 ? '' : 's'}
              </span>
            </div>
            <div className="relative h-2.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-warm-muted)_40%,#fff)]">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--insight-people)_55%,transparent),color-mix(in_srgb,var(--insight-actions)_45%,transparent))]"
                style={{ width: `${Math.min(100, (dayCount / 14) * 100)}%` }}
              />
            </div>
          </div>
        ) : null}

        {previewReady && (applyPreviewLoading || applyPreviewWarnings.length > 0) ? (
          <div
            className="mt-4 rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-sm text-amber-950"
            role="status"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/80">
              Before you submit
            </p>
            {applyPreviewLoading ? (
              <p className="mt-1 text-xs text-amber-900/70">Checking dates…</p>
            ) : (
              <ul className="mt-1 list-inside list-disc text-xs">
                {applyPreviewWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      <div className="space-y-5 p-6 sm:p-7">
        <LeaveRangeCalendar
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={onStartDateChange}
          onEndDateChange={onEndDateChange}
          myRequests={myRequests}
        />

        <label className="feature-field block">
          <span>Reason</span>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="Brief reason for leave"
            className="field mt-1 w-full resize-y"
          />
        </label>

        <button type="submit" className="btn-primary" disabled={submitting || !canSubmit}>
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
        {!previewReady ? (
          <p className="text-xs text-[var(--color-warm-text)]">Choose dates on the calendar to continue.</p>
        ) : null}
      </div>
    </form>
  )
}

export function LeaveRequestStats({ rows }: { rows: LeaveRequest[] }) {
  const stats = useMemo(() => {
    const pending = rows.filter((r) => r.status === 'pending').length
    const approved = rows.filter((r) => r.status === 'approved').length
    const rejected = rows.filter((r) => r.status === 'rejected').length
    return { pending, approved, rejected, total: rows.length }
  }, [rows])

  if (stats.total === 0) return null

  const items = [
    { label: 'Pending', value: stats.pending },
    { label: 'Approved', value: stats.approved },
    { label: 'Rejected', value: stats.rejected },
  ]

  return (
    <div className="report-summary" aria-label="Your leave request summary">
      {items.map((item) => (
        <div key={item.label} className="report-summary-item">
          <span className="report-summary-value">{item.value}</span>
          <span className="report-summary-label">{item.label}</span>
        </div>
      ))}
    </div>
  )
}

type LeaveBalancePanelProps = {
  balance: LeaveBalance
}

function balancePercent(remaining: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (remaining / total) * 100))
}

function usagePercent(used: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (used / total) * 100))
}

function requestedLabel(days: number): string | null {
  if (days <= 0) return null
  return days === 1
    ? '1 day requested - pending approval'
    : `${days} days requested - pending approval`
}

export function LeaveBalancePanel({ balance }: LeaveBalancePanelProps) {
  const types = [
    {
      key: 'pl' as const,
      code: 'PL',
      name: 'Personal',
      annual: balance.allowance.pl,
      accent: leaveTypeAccent('pl'),
    },
    {
      key: 'sl' as const,
      code: 'SL',
      name: 'Sick',
      annual: balance.allowance.sl,
      accent: leaveTypeAccent('sl'),
    },
    {
      key: 'cl' as const,
      code: 'CL',
      name: 'Casual',
      annual: balance.allowance.cl,
      accent: leaveTypeAccent('cl'),
    },
  ]

  return (
    <section className="leave-balance" aria-label={`Leave balance for ${balance.year}`}>
      <header className="leave-balance-intro">
        <div className="leave-balance-intro-text">
          <p className="leave-balance-kicker">Calendar year</p>
          <h2 className="leave-balance-heading">{balance.year}</h2>
          <p className="leave-balance-lede">
            Annual entitlement is <strong>12 PL, 6 SL, and 6 CL</strong> per calendar year,
            credited as <strong>6+3+3 on 1 January</strong> and{' '}
            <strong>6+3+3 from 1 July</strong>.
          </p>
          <p className="leave-balance-lede mt-1.5">
            Leave not used in January-June may still be taken in July-December of the same year.
            Unused balance does not carry forward to the next calendar year.
          </p>
        </div>
      </header>

      <div className="leave-balance-cards">
        {types.map(({ key, code, name, annual, accent }) => {
          const remaining = balance.remaining[key]
          const used = balance.used[key]
          const requested = balance.requested?.[key] ?? 0
          const requestedNote = requestedLabel(requested)
          const remainingPct = balancePercent(remaining, annual)
          const requestedPct = usagePercent(requested, annual)
          const usedPct = usagePercent(used, annual)

          return (
            <article key={key} className="leave-balance-card">
              <div className="leave-balance-card-accent" style={{ background: accent.soft }} aria-hidden />
              <div className="leave-balance-card-body">
                <div className="leave-balance-card-head">
                  <div>
                    <p className="leave-balance-card-name">{name}</p>
                    <span className={`leave-balance-card-badge ${accent.soft}`}>{code}</span>
                  </div>
                  <p className="leave-balance-card-remaining">
                    <span className="leave-balance-card-remaining-num tabular-nums">{remaining}</span>
                    <span className="leave-balance-card-remaining-label">of {annual} left</span>
                  </p>
                </div>

                {requestedNote ? (
                  <p className="leave-balance-card-requested">
                    <span className="report-status report-status--pending">{requestedNote}</span>
                  </p>
                ) : null}

                <div
                  className="leave-balance-meter"
                  role="progressbar"
                  aria-valuenow={remaining}
                  aria-valuemin={0}
                  aria-valuemax={annual}
                  aria-label={`${code}: ${remaining} of ${annual} days left${requested > 0 ? `; ${requested} requested` : ''}`}
                >
                  <div className="leave-balance-meter-track leave-balance-meter-track--stacked">
                    <div className="leave-balance-meter-used" style={{ width: `${usedPct}%` }} />
                    {requested > 0 ? (
                      <div className="leave-balance-meter-pending" style={{ width: `${requestedPct}%` }} />
                    ) : null}
                    <div
                      className="leave-balance-meter-free"
                      style={{ width: `${remainingPct}%` }}
                      aria-hidden
                    />
                  </div>
                  <p className="leave-balance-meter-caption">
                    <span className="tabular-nums">
                      {used} used
                      {requested > 0 ? ` · ${requested} requested` : ''}
                    </span>
                  </p>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
