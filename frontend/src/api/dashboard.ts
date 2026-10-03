import type { DashboardRangePreset } from '../types/dashboard'
import { client } from './client'

export type DashboardEmployeeOption = {
  id: number
  name: string
  code: string | null
}

export type LoadDashboardSummaryInput = {
  year: number
  month: number
  company: string
  preset?: DashboardRangePreset
  quarter?: number
  dateFrom?: string
  dateTo?: string
  employeeIds?: number[]
}

export async function loadDashboardSummary(input: LoadDashboardSummaryInput) {
  const params = new URLSearchParams({
    year: String(input.year),
    month: String(input.month),
    company: input.company,
  })
  if (input.preset && input.preset !== 'monthly') {
    params.set('preset', input.preset)
  }
  if (input.preset === 'quarterly' && input.quarter) {
    params.set('quarter', String(input.quarter))
  }
  if (input.preset === 'custom') {
    if (input.dateFrom) params.set('dateFrom', input.dateFrom)
    if (input.dateTo) params.set('dateTo', input.dateTo)
  }
  if (input.employeeIds && input.employeeIds.length > 0) {
    params.set('employeeIds', input.employeeIds.join(','))
  }
  const { data } = await client.get<{ summary: import('../types/dashboard').DashboardSummary }>(
    `/api/dashboard/summary?${params}`,
  )
  return data.summary
}

export async function loadDashboardEmployeeOptions(company: string): Promise<DashboardEmployeeOption[]> {
  const params = new URLSearchParams({ company })
  const { data } = await client.get<{ employees: DashboardEmployeeOption[] }>(
    `/api/dashboard/employee-filter-options?${params}`,
  )
  return data.employees
}
