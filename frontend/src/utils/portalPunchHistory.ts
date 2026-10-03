import type { PortalPunchLegRecord } from '../api/portalPunch'

export type PortalPunchHistoryRequestCounts = {
  total: number
  pending: number
  approved: number
  rejected: number
}

export type PortalPunchHistoryLegCounts = {
  in: number
  out: number
}

export type PortalPunchHistoryMonthBucket = {
  month: number
  label: string
  requestCount: number
  inCount: number
  outCount: number
  pendingCount: number
}

export type PortalPunchHistorySummary = {
  year: number
  requestCounts: PortalPunchHistoryRequestCounts
  legCounts: PortalPunchHistoryLegCounts
  pendingLegCounts: PortalPunchHistoryLegCounts
  monthly: PortalPunchHistoryMonthBucket[]
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export function filterPortalPunchesForYear(
  punches: PortalPunchLegRecord[],
  year: number,
): PortalPunchLegRecord[] {
  return punches.filter((p) => Number(p.attendanceDate.slice(0, 4)) === year)
}

export function buildPortalPunchHistorySummary(
  punches: PortalPunchLegRecord[],
  year: number,
): PortalPunchHistorySummary {
  const requestCounts: PortalPunchHistoryRequestCounts = {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
  }
  const legCounts: PortalPunchHistoryLegCounts = { in: 0, out: 0 }
  const pendingLegCounts: PortalPunchHistoryLegCounts = { in: 0, out: 0 }

  const monthly: PortalPunchHistoryMonthBucket[] = MONTH_LABELS.map((label, i) => ({
    month: i + 1,
    label,
    requestCount: 0,
    inCount: 0,
    outCount: 0,
    pendingCount: 0,
  }))

  for (const row of punches) {
    if (Number(row.attendanceDate.slice(0, 4)) !== year) continue

    requestCounts.total += 1
    requestCounts[row.status] += 1
    legCounts[row.leg] += 1
    if (row.status === 'pending') pendingLegCounts[row.leg] += 1

    const month = Number.parseInt(row.attendanceDate.slice(5, 7), 10)
    if (month >= 1 && month <= 12) {
      const bucket = monthly[month - 1]
      bucket.requestCount += 1
      if (row.leg === 'in') bucket.inCount += 1
      else bucket.outCount += 1
      if (row.status === 'pending') bucket.pendingCount += 1
    }
  }

  return {
    year,
    requestCounts,
    legCounts,
    pendingLegCounts,
    monthly,
  }
}

export function summarizePortalPunchesForYear(
  punches: PortalPunchLegRecord[],
  year: number,
): PortalPunchHistorySummary {
  return buildPortalPunchHistorySummary(filterPortalPunchesForYear(punches, year), year)
}
