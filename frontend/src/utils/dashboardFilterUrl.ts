import type { DashboardFilterState } from './dashboardFilter'
import { workspaceMonthFromFilter } from './dashboardFilter'

/** Persist applied dashboard filters in the URL (with workspace year/month/company). */
export function syncDashboardFiltersToSearchParams(
  filter: DashboardFilterState,
  company: string,
): URLSearchParams {
  const anchor = workspaceMonthFromFilter(filter)
  const p = new URLSearchParams()
  p.set('year', String(anchor.year))
  p.set('month', String(anchor.month))
  p.set('company', company)
  if (filter.preset !== 'monthly') {
    p.set('preset', filter.preset)
  }
  if (filter.preset === 'quarterly') {
    p.set('quarter', String(filter.quarter))
  }
  if (filter.preset === 'custom') {
    if (filter.dateFrom) p.set('dateFrom', filter.dateFrom)
    if (filter.dateTo) p.set('dateTo', filter.dateTo)
  }
  if (filter.employeeIds.length > 0) {
    p.set('employeeIds', filter.employeeIds.join(','))
  }
  return p
}
