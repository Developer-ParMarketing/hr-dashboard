import type { DashboardRangePreset } from '../types/dashboard'
import { client } from './client'
import type { DashboardNotification, DashboardNotificationsMeta } from '../types/dashboard'

export type LoadDashboardNotificationsInput = {
  year: number
  month: number
  company: string
  preset?: DashboardRangePreset
  quarter?: number
  dateFrom?: string
  dateTo?: string
  employeeIds?: number[]
}

export async function loadDashboardNotifications(input: LoadDashboardNotificationsInput): Promise<{
  notifications: DashboardNotification[]
  notificationsMeta: DashboardNotificationsMeta
}> {
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
  const { data } = await client.get<{
    notifications: DashboardNotification[]
    notificationsMeta: DashboardNotificationsMeta
  }>(`/api/dashboard/notifications?${params}`)
  return data
}
