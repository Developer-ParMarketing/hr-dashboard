import type { DailyAttendanceRecord, NormalizedEmployee } from '../types/attendance'
import {
  dailyRecordsForCalendarDay,
  dailyRecordMarkLabel,
  dailyRecordToken,
  isAbsentToken,
  isDailyRecordPresent,
  isWeeklyOffToken,
} from './attendance'
import {
  employeeTeamLookup,
  teamMetaFromEmployee,
  UNASSIGNED_TEAM_LABEL,
  type TeamGroupingMeta,
} from './teamGroups'
import { formatDisplayDate } from './displayDate'

export type TeamPresenceRow = {
  group: TeamGroupingMeta
  present: number
  absent: number
  weeklyOff: number
  leave: number
  total: number
}

export type DailyTeamPresenceSummary = {
  dateIso: string
  dateLabel: string
  rows: TeamPresenceRow[]
  totalPresent: number
  totalHeadcount: number
  totalAbsent: number
  totalWeeklyOff: number
  totalLeave: number
}

/** Denominator for “X/Y present” and Present % (excludes weekly off and leave). */
export function teamPresencePresentDenominator(
  row: Pick<TeamPresenceRow, 'total' | 'weeklyOff' | 'leave'>,
): number {
  return Math.max(0, row.total - row.weeklyOff - row.leave)
}

function registerMarkForRow(
  employees: NormalizedEmployee[],
  row: DailyAttendanceRecord,
  calendarDay: number,
): string {
  const emp = employees.find(
    (e) =>
      (row.employeeId != null && e.id === row.employeeId) ||
      e.employeeCode === row.employeeCode,
  )
  if (!emp) return ''
  const idx = calendarDay - 1
  if (idx < 0 || idx >= emp.days.length) return ''
  return (emp.days[idx] ?? '').trim()
}

function isLeaveMark(row: DailyAttendanceRecord, registerMark: string): boolean {
  const token = (registerMark || dailyRecordToken(row)).trim().toUpperCase()
  const status = (row.dailyStatus ?? '').trim().toLowerCase()
  if (status === 'leave') return true
  if (token === 'LEAVE') return true
  return token === 'SL' || token === 'PL' || token === 'CL'
}

function isWeeklyOffMark(row: DailyAttendanceRecord, registerMark: string): boolean {
  const token = registerMark || dailyRecordToken(row)
  if (isWeeklyOffToken(token)) return true
  return (row.dailyStatus ?? '').trim().toLowerCase() === 'weekly_off'
}

function isAbsentMark(row: DailyAttendanceRecord, registerMark: string): boolean {
  if (isWeeklyOffMark(row, registerMark) || isLeaveMark(row, registerMark)) return false
  if (isDailyRecordPresent(row)) return false
  const token = registerMark || dailyRecordToken(row)
  if (isAbsentToken(token)) return true
  return (row.dailyStatus ?? '').trim().toLowerCase() === 'absent'
}

function classifyPresenceCategory(
  row: DailyAttendanceRecord,
  registerMark: string,
): 'Present' | 'Absent' | 'Weekly off' | 'Leave' {
  if (isWeeklyOffMark(row, registerMark)) return 'Weekly off'
  if (isLeaveMark(row, registerMark)) return 'Leave'
  if (isDailyRecordPresent(row)) return 'Present'
  return 'Absent'
}

export type TeamPresenceDetailRow = {
  teamName: string
  managerName: string
  employeeName: string
  employeeCode: string
  mark: string
  category: 'Present' | 'Absent' | 'Weekly off' | 'Leave'
}

export function computeTeamPresenceDetailRows(
  employees: NormalizedEmployee[],
  stored: DailyAttendanceRecord[],
  year: number,
  month: number,
  calendarDay: number,
): TeamPresenceDetailRow[] {
  const day = Math.min(Math.max(1, calendarDay), 31)
  const dayRecords = dailyRecordsForCalendarDay(stored, employees, year, month, day)
  const teamLookup = employeeTeamLookup(employees)

  return dayRecords
    .map((row) => {
      const meta =
        teamLookup.get(row.employeeId) ??
        teamMetaFromEmployee({
          teamId: null,
          teamName: UNASSIGNED_TEAM_LABEL,
          teamSortOrder: 9999,
        })
      const registerMark = registerMarkForRow(employees, row, day)
      return {
        teamName: meta.teamName,
        managerName: meta.teamManagerName ?? '',
        employeeName: row.employeeName,
        employeeCode: row.employeeCode,
        mark: dailyRecordMarkLabel(row) !== '-' ? dailyRecordMarkLabel(row) : registerMark || dailyRecordToken(row),
        category: classifyPresenceCategory(row, registerMark),
      }
    })
    .sort((a, b) => {
      const team = a.teamName.localeCompare(b.teamName)
      if (team !== 0) return team
      return a.employeeName.localeCompare(b.employeeName)
    })
}

function teamKey(meta: TeamGroupingMeta): string {
  return meta.teamId != null ? String(meta.teamId) : 'unassigned'
}

export function computeDailyTeamPresenceSummary(
  employees: NormalizedEmployee[],
  stored: DailyAttendanceRecord[],
  year: number,
  month: number,
  calendarDay: number,
  dateLabelOverride?: string | null,
): DailyTeamPresenceSummary {
  const day = Math.min(Math.max(1, calendarDay), 31)
  const date = new Date(year, month - 1, day)
  const dateIso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const dateLabel =
    dateLabelOverride?.trim() ||
    formatDisplayDate(dateIso)

  const dayRecords = dailyRecordsForCalendarDay(stored, employees, year, month, day)
  const teamLookup = employeeTeamLookup(employees)

  const map = new Map<string, TeamPresenceRow>()
  for (const row of dayRecords) {
    const meta =
      teamLookup.get(row.employeeId) ??
      teamMetaFromEmployee({
        teamId: null,
        teamName: UNASSIGNED_TEAM_LABEL,
        teamSortOrder: 9999,
      })
    const key = teamKey(meta)
    const bucket =
      map.get(key) ??
      (() => {
        const initial: TeamPresenceRow = {
          group: meta,
          present: 0,
          total: 0,
          absent: 0,
          weeklyOff: 0,
          leave: 0,
        }
        map.set(key, initial)
        return initial
      })()
    bucket.total += 1
    const registerMark = registerMarkForRow(employees, row, day)
    if (isWeeklyOffMark(row, registerMark)) {
      bucket.weeklyOff += 1
    } else if (isLeaveMark(row, registerMark)) {
      bucket.leave += 1
    } else if (isDailyRecordPresent(row)) {
      bucket.present += 1
    } else if (isAbsentMark(row, registerMark)) {
      bucket.absent += 1
    } else {
      bucket.absent += 1
    }
  }

  const rows = [...map.values()].sort((a, b) => {
    if (a.group.teamSortOrder !== b.group.teamSortOrder) {
      return a.group.teamSortOrder - b.group.teamSortOrder
    }
    return a.group.teamName.localeCompare(b.group.teamName)
  })

  let totalPresent = 0
  let totalHeadcount = 0
  let totalAbsent = 0
  let totalWeeklyOff = 0
  let totalLeave = 0
  for (const r of rows) {
    totalPresent += r.present
    totalHeadcount += r.total
    totalAbsent += r.absent
    totalWeeklyOff += r.weeklyOff
    totalLeave += r.leave
  }

  return {
    dateIso,
    dateLabel,
    rows,
    totalPresent,
    totalHeadcount,
    totalAbsent,
    totalWeeklyOff,
    totalLeave,
  }
}
