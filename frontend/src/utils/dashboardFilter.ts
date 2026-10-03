import type { DashboardRangePreset } from '../types/dashboard'

export type DashboardFilterState = {
  preset: DashboardRangePreset
  year: number
  month: number
  quarter: number
  dateFrom: string
  dateTo: string
  employeeIds: number[]
}

export function defaultDashboardFilter(year: number, month: number): DashboardFilterState {
  return {
    preset: 'monthly',
    year,
    month,
    quarter: Math.ceil(month / 3),
    dateFrom: '',
    dateTo: '',
    employeeIds: [],
  }
}

export function dashboardFilterToSearchParams(filter: DashboardFilterState, company: string): URLSearchParams {
  const p = new URLSearchParams()
  p.set('year', String(filter.year))
  p.set('month', String(filter.month))
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

/** Align workspace month (quick links) with the end of the applied dashboard range. */
export function workspaceMonthFromFilter(filter: DashboardFilterState): { year: number; month: number } {
  if (filter.preset === 'monthly') {
    return { year: filter.year, month: filter.month }
  }
  if (filter.preset === 'yearly') {
    return { year: filter.year, month: 12 }
  }
  if (filter.preset === 'quarterly') {
    return { year: filter.year, month: filter.quarter * 3 }
  }
  if (filter.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(filter.dateTo)) {
    return {
      year: Number.parseInt(filter.dateTo.slice(0, 4), 10),
      month: Number.parseInt(filter.dateTo.slice(5, 7), 10),
    }
  }
  return { year: filter.year, month: filter.month }
}

export function parseDashboardFilterFromSearch(
  params: URLSearchParams,
  fallbackYear: number,
  fallbackMonth: number,
): DashboardFilterState {
  const preset = (params.get('preset') ?? 'monthly') as DashboardRangePreset
  const year = Number.parseInt(params.get('year') ?? String(fallbackYear), 10)
  const month = Number.parseInt(params.get('month') ?? String(fallbackMonth), 10)
  const quarter = Number.parseInt(params.get('quarter') ?? String(Math.ceil(month / 3)), 10)
  const employeesRaw = params.get('employeeIds') ?? params.get('employees') ?? ''
  const employeeIds = employeesRaw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0)

  return {
    preset: ['monthly', 'quarterly', 'yearly', 'custom'].includes(preset) ? preset : 'monthly',
    year: Number.isFinite(year) ? year : fallbackYear,
    month: Number.isFinite(month) && month >= 1 && month <= 12 ? month : fallbackMonth,
    quarter: Number.isFinite(quarter) && quarter >= 1 && quarter <= 4 ? quarter : Math.ceil(month / 3),
    dateFrom: params.get('dateFrom') ?? '',
    dateTo: params.get('dateTo') ?? '',
    employeeIds: [...new Set(employeeIds)],
  }
}
