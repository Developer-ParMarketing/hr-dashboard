import * as XLSX from 'xlsx'
import type { DailyAttendanceRecord, NormalizedEmployee } from '../types/attendance'
import {
  dailyRecordsForCalendarDay,
  dailyRecordMarkLabel,
  formatStoredClock,
  formatWorkingHoursDisplay,
  isDailyRecordPresent,
  lateMarkForRecord,
} from './attendance'
import { formatDisplayDate, isoFromYmd } from './displayDate'
import {
  computeDailyTeamPresenceSummary,
  computeTeamPresenceDetailRows,
  teamPresencePresentDenominator,
} from './dailyTeamPresence'

function dashToEmpty(value: string): string {
  return value === '-' ? '' : value
}

function excelRowsForDay(
  stored: DailyAttendanceRecord[],
  employees: NormalizedEmployee[],
  reportYear: number,
  reportMonth: number,
  calendarDay: number,
): DailyAttendanceRecord[] {
  return dailyRecordsForCalendarDay(
    stored,
    employees,
    reportYear,
    reportMonth,
    calendarDay,
  )
}

function toExcelRow(row: DailyAttendanceRecord) {
  const lateMark = lateMarkForRecord(row)
  return {
    Employee: row.employeeName
      ? `${row.employeeName}${row.employeeCode ? ` (${row.employeeCode})` : ''}`
      : row.employeeCode || '',
    Date: formatDisplayDate(row.attendanceDate),
    Mark: dashToEmpty(dailyRecordMarkLabel(row)),
    'In Time': dashToEmpty(formatStoredClock(row.shiftStart)),
    'Check-in': dashToEmpty(formatStoredClock(row.checkInTime ?? row.inTime)),
    'Out Time': dashToEmpty(formatStoredClock(row.outTime)),
    'Working Hours': dashToEmpty(formatWorkingHoursDisplay(row.workingHours)),
    'Late Mark': lateMark,
    'Late minutes':
      lateMark === 'Late' && row.lateMinutes != null && Number.isFinite(row.lateMinutes)
        ? row.lateMinutes
        : '',
  }
}

export function downloadDailyViewAsXlsx(
  stored: DailyAttendanceRecord[],
  employees: NormalizedEmployee[],
  calendarDay: number,
  reportYear: number,
  reportMonth: number,
): void {
  const rows = excelRowsForDay(stored, employees, reportYear, reportMonth, calendarDay).map(
    toExcelRow,
  )
  if (rows.length === 0) return

  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, `Day ${calendarDay}`)
  XLSX.writeFile(wb, `attendance-day-${calendarDay}.xlsx`)
}

/** Absent employees only for the selected day. */
export function downloadAbsenceReportAsXlsx(
  stored: DailyAttendanceRecord[],
  employees: NormalizedEmployee[],
  calendarDay: number,
  reportYear: number,
  reportMonth: number,
): number {
  const dayLabel = formatDisplayDate(isoFromYmd(reportYear, reportMonth, calendarDay))
  const absent = excelRowsForDay(stored, employees, reportYear, reportMonth, calendarDay).filter(
    (row) => !isDailyRecordPresent(row),
  )
  if (absent.length === 0) return 0

  const rows = absent.map(toExcelRow)
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Absence')
  const slug = dayLabel.replace(/\s+/g, '-').toLowerCase()
  XLSX.writeFile(wb, `absence-report-${slug}.xlsx`)
  return rows.length
}

const TEAM_PRESENCE_HEADERS = [
  'Team',
  'Manager',
  'Present',
  'Total headcount',
  'Absent',
  'Weekly off',
  'On leave',
  'Present %',
] as const

function presentPct(present: number, row: Pick<{ total: number; weeklyOff: number; leave: number }, 'total' | 'weeklyOff' | 'leave'>): number | '' {
  const denom = teamPresencePresentDenominator(row)
  if (denom <= 0) return ''
  return Math.round((present / denom) * 1000) / 10
}

function summaryRowToAoa(row: {
  teamName: string
  manager: string
  present: number
  total: number
  absent: number
  weeklyOff: number
  leave: number
}): (string | number)[] {
  return [
    row.teamName,
    row.manager,
    row.present,
    row.total,
    row.absent,
    row.weeklyOff,
    row.leave,
    presentPct(row.present, row),
  ]
}

export function downloadTeamPresenceSummaryAsXlsx(
  stored: DailyAttendanceRecord[],
  employees: NormalizedEmployee[],
  calendarDay: number,
  reportYear: number,
  reportMonth: number,
  dateLabelOverride?: string | null,
): boolean {
  const summary = computeDailyTeamPresenceSummary(
    employees,
    stored,
    reportYear,
    reportMonth,
    calendarDay,
    dateLabelOverride,
  )
  if (summary.rows.length === 0) return false

  const teamRows = summary.rows.map((row) =>
    summaryRowToAoa({
      teamName: row.group.teamName,
      manager: row.group.teamManagerName ?? '',
      present: row.present,
      total: row.total,
      absent: row.absent,
      weeklyOff: row.weeklyOff,
      leave: row.leave,
    }),
  )

  const totalsRow = summaryRowToAoa({
    teamName: 'All teams',
    manager: '',
    present: summary.totalPresent,
    total: summary.totalHeadcount,
    absent: summary.totalAbsent,
    weeklyOff: summary.totalWeeklyOff,
    leave: summary.totalLeave,
  })

  const summaryAoa: (string | number)[][] = [
    ['Team presence summary'],
    ['Date', summary.dateLabel],
    ['Register date (ISO)', summary.dateIso],
    [],
    [...TEAM_PRESENCE_HEADERS],
    ...teamRows,
    [],
    totalsRow,
  ]

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryAoa)
  summaryWs['!cols'] = [
    { wch: 24 },
    { wch: 22 },
    { wch: 10 },
    { wch: 16 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 12 },
  ]

  const detail = computeTeamPresenceDetailRows(
    employees,
    stored,
    reportYear,
    reportMonth,
    calendarDay,
  )
  const detailAoa: (string | number)[][] = [
    ['Employee detail', '', '', '', ''],
    ['Date', summary.dateLabel, 'ISO', summary.dateIso, ''],
    [],
    ['Team', 'Manager', 'Employee', 'Code', 'Mark', 'Status'],
    ...detail.map((d) => [
      d.teamName,
      d.managerName,
      d.employeeName,
      d.employeeCode,
      d.mark,
      d.category,
    ]),
  ]
  const detailWs = XLSX.utils.aoa_to_sheet(detailAoa)
  detailWs['!cols'] = [
    { wch: 22 },
    { wch: 20 },
    { wch: 26 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary')
  XLSX.utils.book_append_sheet(wb, detailWs, 'By employee')
  XLSX.writeFile(wb, `team-presence-${summary.dateIso}.xlsx`)
  return true
}
