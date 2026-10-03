import type { ReportData, ReportType } from '../types/reports'
import { client } from './client'

export async function listAccessibleReports(): Promise<ReportType[]> {
  const { data } = await client.get<{ types: ReportType[] }>('/api/reports')
  return data.types
}

export async function loadReport(
  type: ReportType,
  year: number,
  month: number,
  company: string,
): Promise<ReportData> {
  const params = new URLSearchParams({
    year: String(year),
    month: String(month),
    company,
  })
  const { data } = await client.get<{ report: ReportData }>(`/api/reports/${type}?${params}`)
  return data.report
}
