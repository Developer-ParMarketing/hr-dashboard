import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { listBrowsePeriods } from '../api/attendance'
import type { AttendanceBrowsePeriod } from '../types/attendance'
import { isoDateYmd } from '../utils/attendance'
import { formatDisplayDate, formatDisplayDateRange } from '../utils/displayDate'

type ReportView = 'daily' | 'weekly' | 'monthly'

type Props = {
  reportType: ReportView
  emptyHint: string
  onSelect: (period: AttendanceBrowsePeriod) => void
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
}

function monthStamp(y: number, m: number): number {
  return y * 12 + (m - 1)
}

function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const d = new Date(y, m - 1 + delta, 1)
  return { y: d.getFullYear(), m: d.getMonth() + 1 }
}

function buildMonthCells(year: number, month: number): Array<{ day: number; iso: string } | null> {
  const firstDow = new Date(year, month - 1, 1).getDay()
  const dim = new Date(year, month, 0).getDate()
  const cells: Array<{ day: number; iso: string } | null> = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= dim; d++) {
    cells.push({ day: d, iso: isoDateYmd(year, month, d) })
  }
  return cells
}

function formatWeekRange(weekStart: string, weekEnd: string): string {
  return formatDisplayDateRange(weekStart, weekEnd)
}

type MonthBounds = { minY: number; minM: number; maxY: number; maxM: number }

function useMonthView(bounds: MonthBounds | null, seed: { y: number; m: number } | null) {
  const [year, setYear] = useState(seed?.y ?? new Date().getFullYear())
  const [month, setMonth] = useState(seed?.m ?? new Date().getMonth() + 1)

  useEffect(() => {
    if (!seed) return
    setYear(seed.y)
    setMonth(seed.m)
  }, [seed?.y, seed?.m])

  const canPrev = bounds ? monthStamp(year, month) > monthStamp(bounds.minY, bounds.minM) : false
  const canNext = bounds ? monthStamp(year, month) < monthStamp(bounds.maxY, bounds.maxM) : false

  const goPrev = useCallback(() => {
    if (!canPrev) return
    const next = shiftMonth(year, month, -1)
    setYear(next.y)
    setMonth(next.m)
  }, [canPrev, year, month])

  const goNext = useCallback(() => {
    if (!canNext) return
    const next = shiftMonth(year, month, 1)
    setYear(next.y)
    setMonth(next.m)
  }, [canNext, year, month])

  return { year, month, canPrev, canNext, goPrev, goNext }
}

function MonthNav({
  year,
  month,
  onPrev,
  onNext,
  canPrev,
  canNext,
}: {
  year: number
  month: number
  onPrev: () => void
  onNext: () => void
  canPrev: boolean
  canNext: boolean
}) {
  const label = new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        className="btn-ghost min-w-[2.5rem] px-2 py-1.5 text-sm"
        disabled={!canPrev}
        aria-label="Previous month"
        onClick={onPrev}
      >
        ←
      </button>
      <p className="flex-1 text-center text-sm font-semibold text-[var(--color-ink)]">{label}</p>
      <button
        type="button"
        className="btn-ghost min-w-[2.5rem] px-2 py-1.5 text-sm"
        disabled={!canNext}
        aria-label="Next month"
        onClick={onNext}
      >
        →
      </button>
    </div>
  )
}

function monthBoundsFromIsoDates(dates: string[]): MonthBounds | null {
  let minY = 9999
  let minM = 12
  let maxY = 0
  let maxM = 1
  for (const iso of dates) {
    const p = parseIso(iso)
    if (!p) continue
    const stamp = monthStamp(p.y, p.m)
    if (stamp < monthStamp(minY, minM)) {
      minY = p.y
      minM = p.m
    }
    if (stamp > monthStamp(maxY, maxM)) {
      maxY = p.y
      maxM = p.m
    }
  }
  if (maxY === 0) return null
  return { minY, minM, maxY, maxM }
}

function weekOverlapsMonth(weekStart: string, weekEnd: string, year: number, month: number): boolean {
  const start = parseIso(weekStart)
  const end = parseIso(weekEnd)
  if (!start || !end) return false
  const viewStart = monthStamp(year, month)
  const viewEnd = monthStamp(year, month)
  const wStart = monthStamp(start.y, start.m)
  const wEnd = monthStamp(end.y, end.m)
  return wStart <= viewEnd && wEnd >= viewStart
}

function DailyProcessedCalendar({
  periods,
  onSelect,
}: {
  periods: Extract<AttendanceBrowsePeriod, { kind: 'daily' }>[]
  onSelect: (period: AttendanceBrowsePeriod) => void
}) {
  const byDate = useMemo(() => new Map(periods.map((p) => [p.date, p])), [periods])
  const bounds = useMemo(() => monthBoundsFromIsoDates(periods.map((p) => p.date)), [periods])
  const seed = useMemo(() => {
    const p = parseIso(periods[0]?.date ?? '')
    return p ? { y: p.y, m: p.m } : null
  }, [periods])
  const { year, month, canPrev, canNext, goPrev, goNext } = useMonthView(bounds, seed)

  const cells = useMemo(() => buildMonthCells(year, month), [year, month])
  const todayIso = isoDateYmd(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    new Date().getDate(),
  )
  const countThisMonth = periods.filter((p) => {
    const parts = parseIso(p.date)
    return parts && parts.y === year && parts.m === month
  }).length

  return (
    <div className="attendance-period-picker-inner">
      <MonthNav
        year={year}
        month={month}
        onPrev={goPrev}
        onNext={goNext}
        canPrev={canPrev}
        canNext={canNext}
      />
      <p className="mt-3 text-xs text-[var(--color-warm-text)]">
        {countThisMonth > 0
          ? `${countThisMonth} day${countThisMonth === 1 ? '' : 's'} with saved attendance.`
          : 'No saved days in this month.'}
      </p>
      <div className="attendance-period-cal mt-4">
        <div className="attendance-period-cal-head">
          {WEEKDAY_LABELS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="attendance-period-cal-grid">
          {cells.map((cell, i) => {
            if (!cell) {
              return <span key={`e-${i}`} className="attendance-period-cal-empty" aria-hidden />
            }
            const period = byDate.get(cell.iso)
            const isToday = cell.iso === todayIso
            if (!period) {
              return (
                <span key={cell.iso} className="attendance-period-cal-day attendance-period-cal-day-muted">
                  {cell.day}
                </span>
              )
            }
            return (
              <button
                key={cell.iso}
                type="button"
                onClick={() => onSelect(period)}
                aria-label={formatDisplayDate(cell.iso)}
                className={[
                  'attendance-period-cal-day attendance-period-cal-day-active',
                  isToday ? 'attendance-period-cal-day-today' : '',
                ].join(' ')}
              >
                {cell.day}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function WeeklyProcessedPicker({
  periods,
  onSelect,
}: {
  periods: Extract<AttendanceBrowsePeriod, { kind: 'weekly' }>[]
  onSelect: (period: AttendanceBrowsePeriod) => void
}) {
  const allIso = useMemo(
    () => periods.flatMap((p) => [p.weekStart.slice(0, 10), p.weekEnd.slice(0, 10)]),
    [periods],
  )
  const bounds = useMemo(() => monthBoundsFromIsoDates(allIso), [allIso])
  const seed = useMemo(() => {
    const p = parseIso(periods[0]?.weekStart ?? '')
    return p ? { y: p.y, m: p.m } : null
  }, [periods])
  const { year, month, canPrev, canNext, goPrev, goNext } = useMonthView(bounds, seed)

  const inMonth = useMemo(
    () =>
      periods.filter((p) => weekOverlapsMonth(p.weekStart, p.weekEnd, year, month)),
    [periods, year, month],
  )

  return (
    <div className="attendance-period-picker-inner">
      <MonthNav
        year={year}
        month={month}
        onPrev={goPrev}
        onNext={goNext}
        canPrev={canPrev}
        canNext={canNext}
      />
      <p className="mt-3 text-xs text-[var(--color-warm-text)]">
        {inMonth.length > 0
          ? `${inMonth.length} week${inMonth.length === 1 ? '' : 's'} with saved data.`
          : 'No saved weeks in this month.'}
      </p>
      {inMonth.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {inMonth.map((period) => (
            <li key={`${period.weekStart}-${period.weekEnd}`}>
              <button
                type="button"
                onClick={() => onSelect(period)}
                className="attendance-period-list-btn"
              >
                {formatWeekRange(period.weekStart, period.weekEnd)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function MonthlyProcessedPicker({
  periods,
  onSelect,
}: {
  periods: Extract<AttendanceBrowsePeriod, { kind: 'monthly' }>[]
  onSelect: (period: AttendanceBrowsePeriod) => void
}) {
  const byKey = useMemo(
    () => new Map(periods.map((p) => [`${p.year}-${p.month}`, p])),
    [periods],
  )
  const years = useMemo(
    () => [...new Set(periods.map((p) => p.year))].sort((a, b) => b - a),
    [periods],
  )
  const [year, setYear] = useState(years[0] ?? new Date().getFullYear())

  useEffect(() => {
    if (years.length > 0) setYear(years[0])
  }, [years])

  const yearIdx = years.indexOf(year)

  return (
    <div className="attendance-period-picker-inner">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn-ghost min-w-[2.5rem] px-2 py-1.5 text-sm"
          disabled={yearIdx >= years.length - 1}
          aria-label="Previous year"
          onClick={() => setYear(years[yearIdx + 1])}
        >
          ←
        </button>
        <p className="flex-1 text-center text-sm font-semibold text-[var(--color-ink)]">{year}</p>
        <button
          type="button"
          className="btn-ghost min-w-[2.5rem] px-2 py-1.5 text-sm"
          disabled={yearIdx <= 0}
          aria-label="Next year"
          onClick={() => setYear(years[yearIdx - 1])}
        >
          →
        </button>
      </div>
      <p className="mt-3 text-xs text-[var(--color-warm-text)]">
        Months with saved register data are selectable.
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {MONTH_SHORT.map((label, idx) => {
          const monthNum = idx + 1
          const period = byKey.get(`${year}-${monthNum}`)
          if (!period) {
            return (
              <div key={label} className="attendance-period-month-muted">
                {label}
              </div>
            )
          }
          return (
            <button
              key={label}
              type="button"
              onClick={() => onSelect(period)}
              className="attendance-period-month-btn"
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function AttendancePeriodPicker({ reportType, emptyHint, onSelect }: Props) {
  const [periods, setPeriods] = useState<AttendanceBrowsePeriod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listBrowsePeriods(reportType)
      setPeriods(result.periods)
    } catch (e) {
      if (axios.isAxiosError(e)) {
        const msg =
          typeof e.response?.data === 'string'
            ? e.response.data
            : (e.response?.data as { message?: string })?.message
        setError(msg || e.message || 'Could not load periods')
      } else {
        setError(e instanceof Error ? e.message : 'Could not load periods')
      }
      setPeriods([])
    } finally {
      setLoading(false)
    }
  }, [reportType])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="attendance-period-picker card border p-5">
        <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="attendance-period-picker card border p-5 text-sm">
        <p className="alert-error">{error}</p>
        <button type="button" className="btn-secondary mt-3" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  }

  if (periods.length === 0) {
    return (
      <div className="attendance-period-picker card border p-5 text-sm leading-relaxed text-[var(--color-warm-text)] sm:p-6">
        {emptyHint}
      </div>
    )
  }

  return (
    <div className="attendance-period-picker card border p-4 sm:p-5">
      {reportType === 'daily' ? (
        <DailyProcessedCalendar
          periods={periods.filter((p): p is Extract<AttendanceBrowsePeriod, { kind: 'daily' }> => p.kind === 'daily')}
          onSelect={onSelect}
        />
      ) : null}
      {reportType === 'weekly' ? (
        <WeeklyProcessedPicker
          periods={periods.filter((p): p is Extract<AttendanceBrowsePeriod, { kind: 'weekly' }> => p.kind === 'weekly')}
          onSelect={onSelect}
        />
      ) : null}
      {reportType === 'monthly' ? (
        <MonthlyProcessedPicker
          periods={periods.filter((p): p is Extract<AttendanceBrowsePeriod, { kind: 'monthly' }> => p.kind === 'monthly')}
          onSelect={onSelect}
        />
      ) : null}
    </div>
  )
}

/** @deprecated Use AttendancePeriodPicker */
export const AttendanceRegisterBrowseList = AttendancePeriodPicker
