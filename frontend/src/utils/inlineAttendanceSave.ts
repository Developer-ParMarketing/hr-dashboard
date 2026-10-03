import {
  saveDailyAttendanceEdit,
  saveWeeklyAttendanceEdit,
  type WeeklyDayEditPayload,
} from '../api/attendance'
import type {
  DailyAttendanceRecord,
  NormalizedEmployee,
  WeeklyAttendanceRecord,
} from '../types/attendance'
import {
  calendarWeeksForMonth,
  formatHoursHm,
  isoDateYmd,
  markFromAttendanceToken,
  parseHoursInput,
  tokenFromMark,
  weeklyDeductionRupees,
} from './attendance'

export type DailyRowEditDraft = {
  mark: string
  checkIn: string
  outTime: string
  hoursText: string
}

export function dailyRowEditDraftFromRecord(row: DailyAttendanceRecord): DailyRowEditDraft {
  const mark = markFromAttendanceToken(row.statusToken ?? row.dailyStatus ?? '')
  const hours =
    row.workingHours != null && Number.isFinite(row.workingHours)
      ? formatHoursHm(row.workingHours)
      : ''
  return {
    mark,
    checkIn: row.checkInTime ?? row.inTime ?? '',
    outTime: row.outTime ?? '',
    hoursText: hours,
  }
}

export async function saveDailyRowEdit(
  row: DailyAttendanceRecord,
  draft: DailyRowEditDraft,
): Promise<void> {
  const hours = parseHoursInput(draft.hoursText)
  const mark = draft.mark.trim() || 'AB'
  await saveDailyAttendanceEdit(row.id, {
    in_time: draft.checkIn.trim() || null,
    out_time: draft.outTime.trim() || null,
    working_hours: hours,
    status_token: tokenFromMark(mark, hours),
  })
}

export function resolveEmployeeDbId(
  emp: NormalizedEmployee,
  dailyRecords: DailyAttendanceRecord[],
): number | null {
  if (typeof emp.id === 'number' && Number.isFinite(emp.id)) return emp.id
  const hit = dailyRecords.find((r) => r.employeeCode === emp.employeeCode)
  return hit?.employeeId ?? null
}

export function isWeeklyRowEditable(rec: WeeklyAttendanceRecord | undefined): boolean {
  if (!rec) return true
  const s = (rec.status ?? 'draft').trim().toLowerCase()
  return s !== 'approved' && s !== 'locked'
}

export type GridDayEdit = { day: number; mark: string }

export async function saveEmployeeGridDayEdits(opts: {
  emp: NormalizedEmployee
  edits: GridDayEdit[]
  allDayNumbers: number[]
  reportYear: number
  reportMonth: number
  dailyRecords: DailyAttendanceRecord[]
  weeklyRecords: WeeklyAttendanceRecord[]
  policyCompany?: string | null
}): Promise<void> {
  if (opts.edits.length === 0) return
  const employeeId = resolveEmployeeDbId(opts.emp, opts.dailyRecords)
  if (employeeId == null) throw new Error(`Could not resolve employee id for ${opts.emp.employeeCode}`)

  const weeks = calendarWeeksForMonth(opts.reportYear, opts.reportMonth)
  const editsByWeek = new Map<number, GridDayEdit[]>()
  for (const edit of opts.edits) {
    const weekIdx = weeks.findIndex((days) => days.includes(edit.day))
    if (weekIdx < 0) continue
    const list = editsByWeek.get(weekIdx) ?? []
    list.push(edit)
    editsByWeek.set(weekIdx, list)
  }

  for (const [weekIdx, weekEdits] of editsByWeek) {
    const weekDays = weeks[weekIdx] ?? []
    if (weekDays.length === 0) continue
    const weekStart = isoDateYmd(opts.reportYear, opts.reportMonth, weekDays[0])
    const weeklyRec = opts.weeklyRecords.find(
      (w) =>
        w.employeeId === employeeId &&
        w.weekStart.slice(0, 10) === weekStart,
    )

    const daysPayload: WeeklyDayEditPayload[] = weekDays.map((day) => {
      const edited = weekEdits.find((e) => e.day === day)
      const idx = day - 1
      const mark = edited
        ? edited.mark
        : markFromAttendanceToken(opts.emp.days[idx] ?? '') ||
          (new Date(opts.reportYear, opts.reportMonth - 1, day).getDay() === 0 ? 'WO' : '')
      const hours = opts.emp.dayWorkedHours[idx]
      return {
        date: isoDateYmd(opts.reportYear, opts.reportMonth, day),
        mark: mark || 'AB',
        hours: hours != null && Number.isFinite(hours) ? hours : null,
      }
    })

    if (weeklyRec && isWeeklyRowEditable(weeklyRec)) {
      const deduction = weeklyDeductionRupees(
        weeklyRec.salary,
        weeklyRec.deficitHours,
        weeklyRec.deduction,
        opts.policyCompany,
      )
      await saveWeeklyAttendanceEdit(weeklyRec.id, {
        days: daysPayload,
        deduction,
        requiredHours: weeklyRec.requiredHours,
        actor: 'dashboard',
      })
      continue
    }

    for (const edit of weekEdits) {
      const date = isoDateYmd(opts.reportYear, opts.reportMonth, edit.day)
      const daily = opts.dailyRecords.find(
        (r) => r.employeeId === employeeId && r.attendanceDate.slice(0, 10) === date,
      )
      if (!daily) continue
      const hours = opts.emp.dayWorkedHours[edit.day - 1]
      await saveDailyAttendanceEdit(daily.id, {
        status_token: tokenFromMark(edit.mark || 'AB', hours),
      })
    }
  }
}

export function gridMarksDraft(
  emp: NormalizedEmployee,
  dayNumbers: number[],
  reportYear: number,
  reportMonth: number,
): Record<number, string> {
  const out: Record<number, string> = {}
  for (const day of dayNumbers) {
    const idx = day - 1
    const fromToken = markFromAttendanceToken(emp.days[idx] ?? '')
    const isSunday = new Date(reportYear, reportMonth - 1, day).getDay() === 0
    out[day] = fromToken || (isSunday ? 'WO' : '')
  }
  return out
}

export function collectGridMarkChanges(
  original: Record<number, string>,
  draft: Record<number, string>,
  dayNumbers: number[],
): GridDayEdit[] {
  const edits: GridDayEdit[] = []
  for (const day of dayNumbers) {
    const before = (original[day] ?? '').trim()
    const after = (draft[day] ?? '').trim()
    if (before !== after) edits.push({ day, mark: after || 'AB' })
  }
  return edits
}
