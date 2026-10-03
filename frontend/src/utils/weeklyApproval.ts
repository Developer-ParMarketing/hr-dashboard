import type { WeeklyAttendanceRecord } from '../types/attendance'
import { isoDateYmd, weeklyRecordForWeekStart } from './attendance'

export function normalizeWeeklyStatus(status: string | null | undefined): string {
  const s = (status ?? 'draft').trim().toLowerCase()
  if (s === 'pending' || s === 'pending_approval' || s === 'pending approval') return 'pending'
  if (s === 'approved') return 'approved'
  if (s === 'locked') return 'locked'
  if (s === 'rejected') return 'rejected'
  return 'draft'
}

export function isWeeklyRecordFrozen(record?: WeeklyAttendanceRecord | null): boolean {
  if (!record) return true
  const s = normalizeWeeklyStatus(record.status)
  return s === 'approved' || s === 'locked'
}

export function isWeeklyRecordSelectable(record?: WeeklyAttendanceRecord | null): boolean {
  return record != null && !isWeeklyRecordFrozen(record)
}

export function weeklyIdsForEmployeeWeekDays(
  weeklyRecords: WeeklyAttendanceRecord[],
  employeeCode: string,
  weekDayBlocks: number[][],
  reportYear: number,
  reportMonth: number,
): number[] {
  const ids: number[] = []
  for (const weekDays of weekDayBlocks) {
    if (weekDays.length === 0) continue
    const weekStart = isoDateYmd(reportYear, reportMonth, weekDays[0])
    const rec = weeklyRecordForWeekStart(weeklyRecords, employeeCode, weekStart)
    if (rec && isWeeklyRecordSelectable(rec)) ids.push(rec.id)
  }
  return ids
}
