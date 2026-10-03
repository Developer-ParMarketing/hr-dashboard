import type {
  DailyAttendanceRecord,
  GroupedRecentUpload,
  ProcessAttendanceResponse,
  WeeklyAttendanceRecord,
} from '../types/attendance'
import type { UploadCompanySelection } from '../constants/companies'
import { companyFromStored } from '../constants/companies'
import {
  inferDailyRegisterDay,
  isoDateYmd,
  weekRangeForCalendarDay,
} from './attendance'

export type ReportView = 'daily' | 'weekly' | 'monthly'

export type OpenedRegisterContext = {
  fileName: string
  reportType: ReportView
  reportYear: number
  reportMonth: number
  company: UploadCompanySelection
  lastProcessedAt: string
  reportDay?: number | null
  reportDateIso?: string | null
  weekStartIso?: string | null
  weekEndIso?: string | null
}

export function normalizeReportView(type: string): ReportView {
  if (type === 'daily' || type === 'weekly' || type === 'monthly') return type
  return 'monthly'
}

export { inferDailyRegisterDay }

export function inferWeeklyRegisterWeek(
  weeklyRecords: WeeklyAttendanceRecord[],
  year: number,
  month: number,
  reportDay?: number | null,
): { weekStartIso: string; weekEndIso: string } | null {
  if (typeof reportDay === 'number' && reportDay >= 1 && reportDay <= 31) {
    const range = weekRangeForCalendarDay(year, month, reportDay)
    if (range) {
      return { weekStartIso: range.weekStart, weekEndIso: range.weekEnd }
    }
  }

  const monthStart = isoDateYmd(year, month, 1)
  const lastDay = new Date(year, month, 0).getDate()
  const monthEnd = isoDateYmd(year, month, lastDay)

  const counts = new Map<string, { weekEnd: string; count: number }>()
  for (const row of weeklyRecords) {
    const ws = row.weekStart.slice(0, 10)
    const we = row.weekEnd.slice(0, 10)
    if (we < monthStart || ws > monthEnd) continue
    const prev = counts.get(ws)
    counts.set(ws, { weekEnd: we, count: (prev?.count ?? 0) + 1 })
  }
  if (counts.size === 0) return null

  let bestStart: string | null = null
  let bestEnd: string | null = null
  let bestCount = 0
  for (const [ws, meta] of counts) {
    if (meta.count > bestCount) {
      bestStart = ws
      bestEnd = meta.weekEnd
      bestCount = meta.count
    }
  }
  if (!bestStart || !bestEnd) return null
  return { weekStartIso: bestStart, weekEndIso: bestEnd }
}

export function processedRegisterFromUploadResponse(
  raw: ProcessAttendanceResponse,
  reportType: ReportView,
  fileName: string,
  year: number,
  month: number,
): Pick<
  OpenedRegisterContext,
  'fileName' | 'reportType' | 'reportDay' | 'reportDateIso' | 'weekStartIso' | 'weekEndIso'
> {
  const reportDay =
    typeof raw.reportDay === 'number'
      ? raw.reportDay
      : typeof raw.parseMeta?.reportDay === 'number'
        ? raw.parseMeta.reportDay
        : null
  const reportDateIso =
    typeof raw.reportDateIso === 'string'
      ? raw.reportDateIso
      : typeof raw.parseMeta?.reportDateIso === 'string'
        ? raw.parseMeta.reportDateIso
        : reportDay != null
          ? `${year}-${String(month).padStart(2, '0')}-${String(reportDay).padStart(2, '0')}`
          : undefined

  let weekStartIso: string | null = null
  let weekEndIso: string | null = null
  if (reportType === 'weekly') {
    const week = inferWeeklyRegisterWeek(raw.weekly ?? [], year, month, reportDay)
    weekStartIso = week?.weekStartIso ?? null
    weekEndIso = week?.weekEndIso ?? null
  }

  return {
    fileName,
    reportType,
    reportDay: reportType === 'daily' ? reportDay : reportDay,
    reportDateIso: reportType === 'daily' ? reportDateIso ?? null : reportDateIso ?? null,
    weekStartIso,
    weekEndIso,
  }
}

export function openedRegisterFromUpload(upload: GroupedRecentUpload): OpenedRegisterContext {
  const company = companyFromStored(upload.company)
  const reportType = normalizeReportView(upload.reportType)
  const latestRun = upload.runs[0]
  const reportDay = upload.reportDay ?? latestRun?.reportDay ?? null
  const reportDateIso =
    reportType === 'daily' && reportDay != null
      ? `${upload.reportYear}-${String(upload.reportMonth).padStart(2, '0')}-${String(reportDay).padStart(2, '0')}`
      : null

  let weekStartIso: string | null = null
  let weekEndIso: string | null = null
  if (reportType === 'weekly') {
    const week = inferWeeklyRegisterWeek([], upload.reportYear, upload.reportMonth, reportDay)
    weekStartIso = week?.weekStartIso ?? null
    weekEndIso = week?.weekEndIso ?? null
  }

  return {
    fileName: upload.fileName,
    reportType,
    reportYear: upload.reportYear,
    reportMonth: upload.reportMonth,
    company,
    lastProcessedAt: upload.lastProcessedAt,
    reportDay,
    reportDateIso,
    weekStartIso,
    weekEndIso,
  }
}

export function lastRawForOpenedRegister(
  opened: OpenedRegisterContext,
  dailyRecords: DailyAttendanceRecord[],
  weeklyRecords: WeeklyAttendanceRecord[] = [],
): ProcessAttendanceResponse {
  const reportDay =
    opened.reportDay ??
    (opened.reportType === 'daily'
      ? inferDailyRegisterDay(dailyRecords, opened.reportYear, opened.reportMonth)
      : opened.reportType === 'weekly' && opened.weekStartIso
        ? Number.parseInt(opened.weekStartIso.slice(8, 10), 10)
        : null)

  const reportDateIso =
    opened.reportDateIso ??
    (reportDay != null
      ? `${opened.reportYear}-${String(opened.reportMonth).padStart(2, '0')}-${String(reportDay).padStart(2, '0')}`
      : undefined)

  let weekStartIso = opened.weekStartIso ?? null
  let weekEndIso = opened.weekEndIso ?? null
  if (opened.reportType === 'weekly' && (!weekStartIso || !weekEndIso)) {
    const week = inferWeeklyRegisterWeek(
      weeklyRecords,
      opened.reportYear,
      opened.reportMonth,
      reportDay,
    )
    weekStartIso = week?.weekStartIso ?? weekStartIso
    weekEndIso = week?.weekEndIso ?? weekEndIso
  }

  return {
    parseMeta: {
      source: 'postgres',
      ...(reportDay != null ? { reportDay } : {}),
      ...(reportDateIso ? { reportDateIso } : {}),
    },
    uploadName: opened.fileName,
    reportYear: opened.reportYear,
    reportMonth: opened.reportMonth,
    ...(reportDay != null ? { reportDay } : {}),
    ...(reportDateIso ? { reportDateIso, reportDate: reportDateIso } : {}),
    ...(weekStartIso ? { weekStartIso } : {}),
    ...(weekEndIso ? { weekEndIso } : {}),
  }
}

export function openedRegisterFromParts(
  parts: {
    fileName: string
    reportType: ReportView
    reportYear: number
    reportMonth: number
    company: UploadCompanySelection
    reportDay?: number | null
    reportDateIso?: string | null
    weekStartIso?: string | null
    weekEndIso?: string | null
  },
  dailyRecords: DailyAttendanceRecord[] = [],
  weeklyRecords: WeeklyAttendanceRecord[] = [],
): OpenedRegisterContext {
  const reportType = parts.reportType
  let reportDay = parts.reportDay ?? null
  let weekStartIso = parts.weekStartIso ?? null
  let weekEndIso = parts.weekEndIso ?? null

  if (reportType === 'daily' && reportDay == null) {
    reportDay = inferDailyRegisterDay(dailyRecords, parts.reportYear, parts.reportMonth)
  }
  if (reportType === 'weekly' && (!weekStartIso || !weekEndIso)) {
    const week = inferWeeklyRegisterWeek(
      weeklyRecords,
      parts.reportYear,
      parts.reportMonth,
      reportDay,
    )
    weekStartIso = week?.weekStartIso ?? weekStartIso
    weekEndIso = week?.weekEndIso ?? weekEndIso
    if (reportDay == null && weekStartIso) {
      reportDay = Number.parseInt(weekStartIso.slice(8, 10), 10)
    }
  }

  const reportDateIso =
    parts.reportDateIso ??
    (reportType === 'daily' && reportDay != null
      ? `${parts.reportYear}-${String(parts.reportMonth).padStart(2, '0')}-${String(reportDay).padStart(2, '0')}`
      : null)

  return {
    fileName: parts.fileName,
    reportType,
    reportYear: parts.reportYear,
    reportMonth: parts.reportMonth,
    company: parts.company,
    lastProcessedAt: new Date().toISOString(),
    reportDay,
    reportDateIso,
    weekStartIso,
    weekEndIso,
  }
}
