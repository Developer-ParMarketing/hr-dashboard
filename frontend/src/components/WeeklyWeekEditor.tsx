import { useMemo, useState } from 'react'
import type { DailyAttendanceRecord, WeeklyAttendanceRecord } from '../types/attendance'
import { formatDisplayDate } from '../utils/displayDate'
import { APPROVAL_WORKFLOW_LABELS } from '../constants/workflowStatus'
import {
  formatHoursHm,
  formatInr,
  hoursCountTowardWeek,
  markFromAttendanceToken,
  parseHoursInput,
  weeklyDeductionRupees,
} from '../utils/attendance'
import { WorkflowSpinner } from './WorkflowStatus'

const MARKS = [
  { value: 'P', label: 'Present' },
  { value: 'AB', label: 'Absent' },
  { value: 'SL', label: 'Leave (SL)' },
  { value: 'PL', label: 'Leave (PL)' },
  { value: 'CL', label: 'Leave (CL)' },
  { value: 'WFH', label: 'WFH' },
  { value: 'WO', label: 'Weekly off' },
] as const

type DayEdit = {
  date: string
  mark: string
  hoursText: string
}

function datesInclusive(start: string, end: string): string[] {
  const out: string[] = []
  const cur = new Date(`${start}T00:00:00`)
  const last = new Date(`${end}T00:00:00`)
  while (cur.getTime() <= last.getTime()) {
    const y = cur.getFullYear()
    const m = String(cur.getMonth() + 1).padStart(2, '0')
    const d = String(cur.getDate()).padStart(2, '0')
    out.push(`${y}-${m}-${d}`)
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

type Props = {
  week: WeeklyAttendanceRecord
  dailyRecords: DailyAttendanceRecord[]
  saving: boolean
  policyCompany?: string | null
  onCancel: () => void
  onSave: (payload: {
    days: { date: string; mark: string; hours: number | null }[]
    deduction: number
    requiredHours: number | null
  }) => void | Promise<void>
}

export function WeeklyWeekEditor({ week, dailyRecords, saving, policyCompany, onCancel, onSave }: Props) {
  const weekStart = week.weekStart.slice(0, 10)
  const weekEnd = week.weekEnd.slice(0, 10)
  const byDate = useMemo(() => {
    const map = new Map<string, DailyAttendanceRecord>()
    for (const row of dailyRecords) {
      if (row.employeeId === week.employeeId || row.employeeCode === week.employeeCode) {
        map.set(row.attendanceDate.slice(0, 10), row)
      }
    }
    return map
  }, [dailyRecords, week.employeeCode, week.employeeId])

  const [days, setDays] = useState<DayEdit[]>(() =>
    datesInclusive(weekStart, weekEnd).map((date) => {
      const row = byDate.get(date)
      const mark = markFromAttendanceToken(row?.statusToken ?? row?.dailyStatus ?? '')
      const hours = row?.workingHours
      return {
        date,
        mark: mark || (new Date(`${date}T00:00:00`).getDay() === 0 ? 'WO' : ''),
        hoursText: hours != null && Number.isFinite(hours) ? formatHoursHm(hours) : '',
      }
    }),
  )
  const [deductionText, setDeductionText] = useState(() =>
    String(week.deduction != null && week.deduction > 24 ? week.deduction : weeklyDeductionRupees(week.salary, week.deficitHours, week.deduction, policyCompany)),
  )
  const [totalHours, setTotalHours] = useState(week.totalHours)
  const [deficitHours, setDeficitHours] = useState(week.deficitHours ?? 0)
  const requiredHours = week.requiredHours

  const setDay = (date: string, patch: Partial<DayEdit>) => {
    setDays((prev) => prev.map((d) => (d.date === date ? { ...d, ...patch } : d)))
  }

  const recalculate = () => {
    let total = 0
    for (const day of days) {
      const hours = parseHoursInput(day.hoursText)
      total += hoursCountTowardWeek(day.mark, hours)
    }
    const required = requiredHours ?? 0
    const deficit = Math.max(0, required - total)
    const deduction = weeklyDeductionRupees(week.salary, deficit, null, policyCompany)
    setTotalHours(total)
    setDeficitHours(deficit)
    setDeductionText(String(deduction))
  }

  const save = async () => {
    const deduction = Number.parseFloat(deductionText)
    void onSave({
      days: days.map((d) => ({
        date: d.date,
        mark: d.mark || 'AB',
        hours: parseHoursInput(d.hoursText),
      })),
      deduction: Number.isFinite(deduction) ? deduction : 0,
      requiredHours: requiredHours,
    })
  }

  const inputClass =
    'rounded-md border border-[var(--color-warm-muted)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-ink)] outline-none focus:border-[var(--color-brand)]'

  return (
    <div className="border-t border-[var(--color-warm-muted)] bg-[color-mix(in_srgb,var(--color-warm-page)_40%,#fff)] px-4 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">
            Edit {week.employeeName} ({week.employeeCode})
          </h3>
          <p className="text-xs text-[var(--color-warm-text)]">
            Correct attendance, leave, WFH, hours, and deduction, then recalculate and save. Locked after
            approval.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={recalculate}
            className="btn-secondary px-3 py-1.5 text-xs"
          >
            Recalculate
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="btn-primary inline-flex items-center px-3 py-1.5 text-xs"
          >
            {saving ? (
              <>
                <WorkflowSpinner className="mr-1.5 h-3.5 w-3.5" />
                {APPROVAL_WORKFLOW_LABELS.saving}
              </>
            ) : (
              'Save'
            )}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="min-w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="border border-[var(--color-warm-muted)] px-2 py-1.5 text-left">Date</th>
              <th className="border border-[var(--color-warm-muted)] px-2 py-1.5 text-left">Attendance</th>
              <th className="border border-[var(--color-warm-muted)] px-2 py-1.5 text-left">Hours</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <td className="border border-[var(--color-warm-muted)] px-2 py-1.5 tabular-nums">
                  {formatDisplayDate(day.date)}
                </td>
                <td className="border border-[var(--color-warm-muted)] px-2 py-1.5">
                  <select
                    value={day.mark}
                    onChange={(e) => setDay(day.date, { mark: e.target.value })}
                    className={inputClass}
                    aria-label={`Attendance for ${formatDisplayDate(day.date)}`}
                  >
                    <option value="">-</option>
                    {MARKS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="border border-[var(--color-warm-muted)] px-2 py-1.5">
                  <input
                    value={day.hoursText}
                    onChange={(e) => setDay(day.date, { hoursText: e.target.value })}
                    placeholder="H:MM"
                    className={`${inputClass} w-24 tabular-nums`}
                    aria-label={`Hours for ${formatDisplayDate(day.date)}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-4">
        <div>
          <div className="text-[color-mix(in_srgb,var(--color-ink)_55%,transparent)]">Total hours</div>
          <div className="font-semibold tabular-nums">{formatHoursHm(totalHours)}</div>
        </div>
        <div>
          <div className="text-[color-mix(in_srgb,var(--color-ink)_55%,transparent)]">Required</div>
          <div className="font-semibold tabular-nums">{formatHoursHm(requiredHours)}</div>
        </div>
        <div>
          <div className="text-[color-mix(in_srgb,var(--color-ink)_55%,transparent)]">Deficit</div>
          <div className="font-semibold tabular-nums">{formatHoursHm(deficitHours)}</div>
        </div>
        <label>
          <span className="text-[color-mix(in_srgb,var(--color-ink)_55%,transparent)]">Deduction (₹)</span>
          <input
            value={deductionText}
            onChange={(e) => setDeductionText(e.target.value)}
            className={`${inputClass} mt-0.5 w-full tabular-nums`}
          />
          <span className="mt-0.5 block text-[color-mix(in_srgb,var(--color-warm-text)_80%,transparent)]">
            Preview {formatInr(Number.parseFloat(deductionText) || 0)}
          </span>
        </label>
      </div>
    </div>
  )
}
