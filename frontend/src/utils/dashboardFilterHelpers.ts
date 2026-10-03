import type { DashboardFilterState } from '../utils/dashboardFilter'
import type { DashboardRangePreset } from '../types/dashboard'
import { loadDashboardEmployeeOptions, loadDashboardSummary } from '../api/dashboard'
import type { DashboardSummary } from '../types/dashboard'

export type { DashboardEmployeeOption } from '../api/dashboard'

export async function fetchDashboardSummary(
  filter: DashboardFilterState,
  company: string,
): Promise<DashboardSummary> {
  return loadDashboardSummary({
    year: filter.year,
    month: filter.month,
    company,
    preset: filter.preset,
    quarter: filter.preset === 'quarterly' ? filter.quarter : undefined,
    dateFrom: filter.preset === 'custom' ? filter.dateFrom : undefined,
    dateTo: filter.preset === 'custom' ? filter.dateTo : undefined,
    employeeIds: filter.employeeIds.length > 0 ? filter.employeeIds : undefined,
  })
}

export { loadDashboardEmployeeOptions }

export const DASHBOARD_PRESET_LABELS: Record<DashboardRangePreset, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  custom: 'Custom dates',
}
