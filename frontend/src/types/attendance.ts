import type { NotificationStatusEntry } from '../utils/emailWorkflow'

/** Normalized employee row used by tables */
export interface NormalizedEmployee {
  employeeCode: string
  employeeName: string
  department?: string
  teamId?: number | null
  teamName?: string
  teamSortOrder?: number
  teamManagerName?: string
  /** Employee shift start time from ESSL row, if available (e.g., 09:00, 09:00 AM) */
  shiftStart?: string
  /** Row-level actual punch-in from ESSL (e.g. column InTime) when not in day1..day31 InTime cells */
  inTime?: string
  /** Day 1-31, empty string if unknown */
  days: string[]
  /** Actual first punch-in time by day (day1..day31), if available */
  dayInTimes: string[]
  /** Late flags by day (day1..day31); first punch after shift start + 15 min grace */
  dayLateFlags: boolean[]
  /** Decimal hours worked that day when the sheet exposes them (e.g. HOURS D1, Work Dur.) */
  dayWorkedHours: (number | null)[]
  /** True when WFH came from leave export only (no row on WFH file for that day); UI highlights */
  dayWfhUnverified: boolean[]
  /** Parser `total_late_days` when present; use when per-day late columns are missing */
  totalLateDays?: number | null
  week1: number | null
  week2: number | null
  week3: number | null
  week4: number | null
  week5: number | null
  week1Deficit: number | null
  week2Deficit: number | null
  week3Deficit: number | null
  week4Deficit: number | null
  week5Deficit: number | null
  totalHours: number | null
  /** Monthly deficit / shortfall hours from Excel, if present */
  deficitHours: number | null
  /** Postgres employee id when loaded from saved month snapshot */
  id?: number
}

export type AttendanceFilter = 'all' | 'present' | 'absent'

/** Raw API payload - tolerant to backend field naming */
export interface RawEmployee {
  employeeCode?: string
  empCode?: string
  code?: string
  employeeName?: string
  empName?: string
  name?: string
  department?: string
  dept?: string
  teamId?: unknown
  team_id?: unknown
  teamName?: unknown
  team_name?: unknown
  teamSortOrder?: unknown
  team_sort_order?: unknown
  teamManagerName?: unknown
  team_manager_name?: unknown
  shiftStart?: unknown
  shift_start?: unknown
  shift?: unknown
  shiftTime?: unknown
  shift_time?: unknown
  dutyStart?: unknown
  duty_start?: unknown
  inTime?: unknown
  in_time?: unknown
  daily?: Record<string, unknown> | unknown[]
  attendance?: Record<string, unknown> | unknown[]
  days?: unknown[]
  day1?: unknown
  week1?: unknown
  week2?: unknown
  week3?: unknown
  week4?: unknown
  week5?: unknown
  week1Deficit?: unknown
  week2Deficit?: unknown
  week3Deficit?: unknown
  week4Deficit?: unknown
  week5Deficit?: unknown
  week1_deficit?: unknown
  week2_deficit?: unknown
  week3_deficit?: unknown
  week4_deficit?: unknown
  week5_deficit?: unknown
  totalHours?: unknown
  totalMonthlyHours?: unknown
  monthlyHours?: unknown
  deficitHours?: unknown
  deficit_hours?: unknown
  deficit?: unknown
  monthly_deficit_hours?: unknown
  totalLateDays?: unknown
  total_late_days?: unknown
  /** Per-day: set by merge when WFH is from leave calendar only */
  day1WfhUnverified?: unknown
  [key: string]: unknown
}

/** When leave/WFH Excel files are merged, server may return replacement counts */
export interface CrossCheckSummary {
  replacedAb?: number
  leaveKeys?: number
  wfhKeys?: number
}

/** Returned by backend bridge after PDF parse or direct file read */
export interface ParseMeta {
  source?: string
  pdfPath?: string
  excelPath?: string
  excelSheet?: string | null
  rowsInSheet?: number
  employeeCount?: number
  inputKind?: string
  /** Reserved; daily column is inferred client-side from uploaded data */
  targetDay?: number | null
  /** PDF register date (day of month 1-31) - authoritative for the daily column */
  reportDay?: number
  /** Human-readable register date from parser, e.g. "Tue, 10 Apr 2025" */
  reportDate?: string
  /** ISO calendar date YYYY-MM-DD */
  reportDateIso?: string
}

export interface ProcessAttendanceResponse {
  employees?: RawEmployee[]
  data?: RawEmployee[]
  results?: RawEmployee[]
  company?: string
  downloadUrl?: string
  excelUrl?: string
  crossCheck?: CrossCheckSummary
  parseMeta?: ParseMeta
  /** PDF register day-of-month (1-31) from backend; use for daily column instead of guessing */
  reportDay?: number
  /** Human-readable register date from parser */
  reportDate?: string
  reportDateIso?: string
  /** Calendar month/year used when saving (from ESSL register date). */
  reportYear?: number
  reportMonth?: number
  requestId?: string
  processedAt?: string
  uploadName?: string
  uploadSize?: number
  persisted?: PersistSummary
  saved?: boolean
  sourceOfTruth?: string
  weekly?: WeeklyAttendanceRecord[]
  daily?: DailyAttendanceRecord[]
  persistError?: string
  [key: string]: unknown
}

export type PersistSummary = {
  employeesUpserted: number
  dailyUpserted: number
  weeklyUpserted: number
  leaveUpserted: number
  wfhUpserted: number
  salaryUpserted: number
  skippedApprovedWeeks: number
  skippedMissingCode?: number
}

/** Saved month bucket for employee/manager browse (no file names). */
export type AttendanceBrowsePeriod =
  | { kind: 'daily'; date: string; lastUpdated: string }
  | { kind: 'weekly'; weekStart: string; weekEnd: string; lastUpdated: string }
  | { kind: 'monthly'; year: number; month: number; lastUpdated: string }

/** One saved month/company bucket in Postgres (upload page history). */
export type SavedPeriod = {
  year: number
  month: number
  company: string | null
  employeeCount: number
  lastUpdated: string
  approvedWeeks: number
}

/** One processing run for a register file. */
export type UploadHistoryRun = {
  id: number
  requestId: string | null
  actor: string | null
  employeeCount: number | null
  dailyUpserted: number | null
  fileSize: number | null
  reportDay?: number | null
  processedAt: string
}

/** Grouped register file in upload history (one row per file + period). */
export type GroupedRecentUpload = {
  id: number
  fileName: string
  fileSize: number | null
  reportType: 'daily' | 'weekly' | 'monthly' | string
  reportYear: number
  reportMonth: number
  company: string | null
  reportDay?: number | null
  lastProcessedAt: string
  runCount: number
  runs: UploadHistoryRun[]
}

/** @deprecated Use GroupedRecentUpload - kept for legacy flat responses. */
export type RecentUpload = {
  id: number
  requestId: string | null
  fileName: string
  fileSize: number | null
  reportType: 'daily' | 'weekly' | 'monthly' | string
  reportYear: number
  reportMonth: number
  company: string | null
  actor: string | null
  employeeCount: number | null
  dailyUpserted: number | null
  processedAt: string
}

export type WeeklyAttendanceStatus = 'draft' | 'pending' | 'approved' | 'locked' | 'rejected'

export type WeeklyAttendanceRecord = {
  id: number
  employeeId: number
  employeeCode: string
  employeeName: string
  salary: number | null
  weekStart: string
  weekEnd: string
  totalHours: number | null
  requiredHours: number | null
  deficitHours: number | null
  deduction: number | null
  status: WeeklyAttendanceStatus | string
  approvedBy: string | null
  approvedAt: string | null
  layer?: 'calculated' | 'hr_edit' | 'approved' | string
  hrDeduction?: number | null
}

export type DailyAttendanceRecord = {
  id: number
  employeeId: number
  employeeCode: string
  employeeName: string
  /** Scheduled / complete in time (shift start). */
  shiftStart: string
  attendanceDate: string
  /** Actual first punch (check-in). */
  inTime: string | null
  checkInTime: string | null
  /** Complete out time (stored punch or in + working hours). */
  outTime: string | null
  workingHours: number | null
  late: boolean
  lateMinutes: number | null
  dailyStatus: string | null
  statusToken: string | null
  note: string | null
  origin?: 'raw' | 'calculated' | 'hr_edit' | 'approved' | string | null
  rawWorkingHours?: number | null
  rawStatusToken?: string | null
  rawInTime?: string | null
}

export type MonthSnapshotResponse = {
  year: number
  month: number
  employees: Array<NormalizedEmployee & { id?: number; notes?: Record<string, string> }>
  daily: DailyAttendanceRecord[]
  weekly: WeeklyAttendanceRecord[]
  notifications?: NotificationStatusEntry[]
  holidays?: CompanyHolidayDay[]
}

/** Company calendar entry - full day (0h expected) or half day (4.5h expected on Mon-Sat). */
export type CompanyHolidayDay = {
  holidayDate: string
  dayType: 'full' | 'half'
  name?: string
}
