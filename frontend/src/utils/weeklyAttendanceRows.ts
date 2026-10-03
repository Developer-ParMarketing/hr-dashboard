import { isPmPolicyCompany } from '../constants/companies'
import type {
  CompanyHolidayDay,
  NormalizedEmployee,
  WeeklyAttendanceRecord,
  WeeklyAttendanceStatus,
} from '../types/attendance'
import {
  matchesSearch,
  weeklyDeductionRupees,
  weeklyHoursAndDeficitByCalendar,
  WEEKLY_HOURS_THRESHOLD,
} from './attendance'

export type WeeklyCalcRow = {
  id: number | null
  employeeCode: string
  employeeName: string
  totalHours: number | null
  requiredHours: number
  deficitHours: number
  deduction: number
  status: WeeklyAttendanceStatus
}

function normalizeStatus(status: string | null | undefined): WeeklyAttendanceStatus {
  const s = (status ?? 'draft').trim().toLowerCase()
  if (s === 'pending' || s === 'pending_approval' || s === 'pending approval') return 'pending'
  if (s === 'approved') return 'approved'
  if (s === 'locked') return 'locked'
  return 'draft'
}

export function buildWeeklyCalcRows(input: {
  employees: NormalizedEmployee[]
  weeklyRecords: WeeklyAttendanceRecord[]
  weekStart: string
  activeWeekNo: number
  reportYear: number
  reportMonth: number
  search: string
  policyCompany?: string | null
  companyHolidays?: CompanyHolidayDay[]
}): WeeklyCalcRow[] {
  const {
    employees,
    weeklyRecords,
    weekStart,
    activeWeekNo,
    reportYear,
    reportMonth,
    search,
    policyCompany,
    companyHolidays = [],
  } = input
  const byCode = new Map(employees.map((e) => [e.employeeCode, e]))
  const stored = weeklyRecords.filter((w) => w.weekStart === weekStart)
  const storedCodes = new Set(stored.map((w) => w.employeeCode))

  const fromStore: WeeklyCalcRow[] = stored
    .filter((w) => {
      if (!search.trim()) return true
      const q = search.trim().toLowerCase()
      const name = w.employeeName || byCode.get(w.employeeCode)?.employeeName || ''
      return name.toLowerCase().includes(q) || w.employeeCode.toLowerCase().includes(q)
    })
    .map((w) => {
      const required =
        w.requiredHours != null && Number.isFinite(w.requiredHours)
          ? w.requiredHours
          : isPmPolicyCompany(policyCompany)
            ? WEEKLY_HOURS_THRESHOLD
            : 0
      const total = w.totalHours
      const deficit =
        w.deficitHours != null && Number.isFinite(w.deficitHours)
          ? Math.max(0, w.deficitHours)
          : total != null
            ? Math.max(0, required - total)
            : 0
      return {
        id: w.id,
        employeeCode: w.employeeCode,
        employeeName: w.employeeName || byCode.get(w.employeeCode)?.employeeName || w.employeeCode,
        totalHours: total,
        requiredHours: required,
        deficitHours: deficit,
        deduction: weeklyDeductionRupees(w.salary, deficit, w.deduction, policyCompany),
        status: normalizeStatus(w.status),
      }
    })

  const derived: WeeklyCalcRow[] = employees
    .filter((e) => !storedCodes.has(e.employeeCode) && matchesSearch(e, search))
    .map((emp) => {
      const scoped = weeklyHoursAndDeficitByCalendar(
        emp,
        reportYear,
        reportMonth,
        activeWeekNo,
        policyCompany,
        weeklyRecords,
        companyHolidays,
      )
      const required =
        scoped.expectedTarget ?? (isPmPolicyCompany(policyCompany) ? WEEKLY_HOURS_THRESHOLD : 0)
      const total = scoped.hours
      const deficit =
        scoped.deficit != null ? Math.max(0, scoped.deficit) : total != null ? Math.max(0, required - total) : 0
      return {
        id: null,
        employeeCode: emp.employeeCode,
        employeeName: emp.employeeName,
        totalHours: total,
        requiredHours: required,
        deficitHours: deficit,
        deduction: 0,
        status: 'draft' as const,
      }
    })

  return [...fromStore, ...derived].sort((a, b) =>
    a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true }),
  )
}
