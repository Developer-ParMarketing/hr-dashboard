import type { AttendanceBrowsePeriod } from '../types/attendance'
import type { UploadCompanySelection } from '../constants/companies'
import type { OpenedRegisterContext, ReportView } from './openRegister'
import { formatDisplayDate, formatDisplayDateRange } from './displayDate'

export function openedRegisterFromBrowsePeriod(
  period: AttendanceBrowsePeriod,
  company: UploadCompanySelection,
): OpenedRegisterContext {
  if (period.kind === 'daily') {
    const [y, m, d] = period.date.split('-').map((part) => Number.parseInt(part, 10))
    return {
      fileName: '',
      reportType: 'daily',
      reportYear: y,
      reportMonth: m,
      company,
      lastProcessedAt: period.lastUpdated,
      reportDay: d,
      reportDateIso: period.date,
    }
  }
  if (period.kind === 'weekly') {
    const [y, m] = period.weekStart.split('-').map((part) => Number.parseInt(part, 10))
    return {
      fileName: '',
      reportType: 'weekly',
      reportYear: y,
      reportMonth: m,
      company,
      lastProcessedAt: period.lastUpdated,
      weekStartIso: period.weekStart,
      weekEndIso: period.weekEnd,
    }
  }
  return {
    fileName: '',
    reportType: 'monthly',
    reportYear: period.year,
    reportMonth: period.month,
    company,
    lastProcessedAt: period.lastUpdated,
  }
}

export function browsePeriodKey(period: AttendanceBrowsePeriod): string {
  if (period.kind === 'daily') return `d:${period.date}`
  if (period.kind === 'weekly') return `w:${period.weekStart}:${period.weekEnd}`
  return `m:${period.year}-${period.month}`
}

export function browseViewForPeriod(period: AttendanceBrowsePeriod): ReportView {
  return period.kind
}

export function browsePeriodSummaryLabel(period: AttendanceBrowsePeriod): string {
  if (period.kind === 'daily') {
    return formatDisplayDate(period.date)
  }
  if (period.kind === 'weekly') {
    return formatDisplayDateRange(period.weekStart, period.weekEnd)
  }
  return new Date(period.year, period.month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}
