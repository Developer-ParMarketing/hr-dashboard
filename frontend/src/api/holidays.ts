import { client } from './client'

export type HolidayDayType = 'full' | 'half'

export type HolidayEntry = {
  id: number
  year: number
  holidayDate: string
  name: string
  dayType: HolidayDayType
  sortOrder: number
  dayLabel: string
  shortDateLabel: string
  updatedBy: string | null
  updatedAt: string
}

export type HolidayListResponse = {
  year: number
  holidays: HolidayEntry[]
  meta?: {
    canManage: boolean
    yearOptions: number[]
    copySourceYear?: number | null
  }
}

export type HolidayCopyPreviewResponse = {
  year: number
  sourceYear: number
  holidays: Array<{
    holidayDate: string
    name: string
    dayType: HolidayDayType
    dayLabel: string
    shortDateLabel: string
  }>
}

export async function fetchHolidays(year: number): Promise<HolidayListResponse> {
  const { data } = await client.get<HolidayListResponse>(`/api/holidays?year=${year}`)
  return data
}

export async function saveHolidays(
  year: number,
  holidays: Array<{ holidayDate: string; name: string; dayType?: HolidayDayType }>,
): Promise<HolidayListResponse> {
  const { data } = await client.put<HolidayListResponse>('/api/admin/holidays', { year, holidays })
  return data
}

export async function previewCopyHolidaysFromEarlierYear(
  year: number,
): Promise<HolidayCopyPreviewResponse> {
  const { data } = await client.post<HolidayCopyPreviewResponse>(
    '/api/admin/holidays/copy-from-previous',
    { year, preview: true },
  )
  return data
}

export async function copyHolidaysFromPreviousYear(year: number): Promise<HolidayListResponse> {
  const { data } = await client.post<HolidayListResponse>(
    '/api/admin/holidays/copy-from-previous',
    { year },
  )
  return data
}
