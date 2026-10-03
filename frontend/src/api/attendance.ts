import type {
  AttendanceBrowsePeriod,
  DailyAttendanceRecord,
  GroupedRecentUpload,
  MonthSnapshotResponse,
  ProcessAttendanceResponse,
  SavedPeriod,
  WeeklyAttendanceRecord,
} from '../types/attendance'
import { extractEmployees, normalizeEmployee } from '../utils/attendance'
import type { NormalizedEmployee } from '../types/attendance'
import { client } from './client'

/** Monthly PDF parsing often exceeds 2 minutes; process uses its own limit. */
const ATTENDANCE_PROCESS_TIMEOUT_MS = 900_000

export type ProcessAttendanceOptions = {
  /** Optional fallback when the file has no parseable register date (API defaults to today). */
  reportYear?: number
  reportMonth?: number
  leaveFile?: File | null
  wfhFile?: File | null
  actor?: string
}

export async function processAttendancePdf(
  file: File,
  companyName: string,
  reportType: 'daily' | 'weekly' | 'monthly',
  options?: ProcessAttendanceOptions,
): Promise<{ employees: NormalizedEmployee[]; raw: ProcessAttendanceResponse }> {
  const requestTs = Date.now()
  const form = new FormData()
  form.append('file', file)
  form.append('company', companyName)
  form.append('companyName', companyName)
  form.append('reportType', reportType)
  form.append('_ts', String(requestTs))
  if (options) {
    if (options.reportYear != null) form.append('reportYear', String(options.reportYear))
    if (options.reportMonth != null) form.append('reportMonth', String(options.reportMonth))
    if (options.leaveFile) form.append('leaveFile', options.leaveFile)
    if (options.wfhFile) form.append('wfhFile', options.wfhFile)
    if (options.actor) form.append('actor', options.actor)
  }

  const { data } = await client.post<ProcessAttendanceResponse>(
    `/api/attendance/process?ts=${requestTs}`,
    form,
    {
      timeout: ATTENDANCE_PROCESS_TIMEOUT_MS,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
      },
    },
  )

  const rawList = extractEmployees(data as Record<string, unknown>)
  const employees = rawList.map(normalizeEmployee)
  return { employees, raw: data }
}

/** Download Excel from backend - tries common paths; adjust to your API */
export async function downloadExcelBlob(): Promise<Blob> {
  const { data } = await client.get('/api/attendance/export', {
    responseType: 'blob',
  })
  return data
}

export async function loadSavedMonth(
  year: number,
  month: number,
  company?: string,
): Promise<MonthSnapshotResponse> {
  const { data } = await client.get<MonthSnapshotResponse>('/api/attendance/month', {
    params: { year, month, company: company || undefined },
  })
  return data
}

export async function listSavedPeriods(limit = 60): Promise<SavedPeriod[]> {
  const { data } = await client.get<{ periods: SavedPeriod[] }>('/api/attendance/saved-periods', {
    params: { limit },
  })
  return data.periods ?? []
}

export type { AttendanceBrowsePeriod } from '../types/attendance'

export async function listBrowsePeriods(
  reportType: 'daily' | 'weekly' | 'monthly',
  limit = 90,
): Promise<{ total: number; periods: AttendanceBrowsePeriod[] }> {
  const { data } = await client.get<{ total: number; periods: AttendanceBrowsePeriod[] }>(
    '/api/attendance/browse-registers',
    { params: { reportType, limit } },
  )
  return { total: data.total ?? 0, periods: data.periods ?? [] }
}

export type UploadHistoryPage = {
  uploads: GroupedRecentUpload[]
  total: number
  limit: number
  offset: number
}

export async function listRecentUploads(opts?: {
  limit?: number
  offset?: number
}): Promise<UploadHistoryPage> {
  const { data } = await client.get<UploadHistoryPage>('/api/attendance/recent-uploads', {
    params: { limit: opts?.limit, offset: opts?.offset },
  })
  return {
    uploads: data.uploads ?? [],
    total: data.total ?? 0,
    limit: data.limit ?? opts?.limit ?? 20,
    offset: data.offset ?? opts?.offset ?? 0,
  }
}

export async function approveWeeklyAttendance(
  id: number,
  actor?: string,
): Promise<WeeklyAttendanceRecord> {
  const { data } = await client.post<WeeklyAttendanceRecord>(
    `/api/attendance/weekly/${id}/approve`,
    { actor },
  )
  return data
}

export async function setWeeklyAttendanceStatus(
  id: number,
  status: 'draft' | 'pending' | 'approved' | 'locked' | 'rejected',
  actor?: string,
): Promise<WeeklyAttendanceRecord> {
  const { data } = await client.post<WeeklyAttendanceRecord>(
    `/api/attendance/weekly/${id}/status`,
    { status, actor },
  )
  return data
}

export type WeeklyDayEditPayload = {
  date: string
  mark: string
  hours: number | null
}

export type DailyEditPayload = {
  in_time?: string | null
  out_time?: string | null
  working_hours?: number | null
  status_token?: string | null
  late?: boolean | number | null
  late_minutes?: number | null
  note?: string | null
}

export async function saveDailyAttendanceEdit(
  id: number,
  patch: DailyEditPayload,
  actor?: string,
): Promise<DailyAttendanceRecord> {
  const { data } = await client.patch<DailyAttendanceRecord>(`/api/attendance/daily/${id}`, {
    ...patch,
    actor: actor ?? 'dashboard',
  })
  return data
}

export async function saveWeeklyAttendanceEdit(
  id: number,
  payload: {
    days: WeeklyDayEditPayload[]
    deduction?: number | null
    requiredHours?: number | null
    actor?: string
  },
): Promise<WeeklyAttendanceRecord> {
  const { data } = await client.patch<WeeklyAttendanceRecord>(`/api/attendance/weekly/${id}`, payload)
  return data
}
