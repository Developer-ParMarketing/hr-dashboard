import type { AuthUser } from '../api/auth'

const EDITOR_ROLES = new Set(['hr', 'admin'])

/** Stored in `users.role`; `viewer` is the standard employee login. */
export const DASHBOARD_ROLE_OPTIONS = [
  {
    value: 'viewer',
    label: 'Employee',
    hint: 'Own attendance (uploaded by HR), requests, payslips, and other self-service modules.',
  },
  {
    value: 'manager',
    label: 'Manager',
    hint: 'Employee access plus team attendance and request approvals.',
  },
  {
    value: 'hr',
    label: 'HR',
    hint: 'Upload and edit attendance, payroll, and people records.',
  },
  {
    value: 'admin',
    label: 'Admin',
    hint: 'Full HR access plus system settings and access control.',
  },
] as const

export type AttendanceViewMode = 'full' | 'team' | 'self'

export function canEditAttendance(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  return EDITOR_ROLES.has(user.role.trim().toLowerCase())
}

export function isAdminUser(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  return user.role.trim().toLowerCase() === 'admin'
}

export function isManagerUser(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  return user.role.trim().toLowerCase() === 'manager'
}

/** Non-HR, non-manager dashboard user (typical employee login). */
export function isEmployeeDashboardUser(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  const role = user.role.trim().toLowerCase()
  return role === 'viewer' || (!canEditAttendance(user) && !isManagerUser(user))
}

export function isEmployeeUser(user: AuthUser | null | undefined): boolean {
  return isEmployeeDashboardUser(user)
}

export function getAttendanceViewMode(user: AuthUser | null | undefined): AttendanceViewMode {
  if (!user) return 'self'
  if (canEditAttendance(user)) return 'full'
  if (isManagerUser(user)) return 'team'
  return 'self'
}

/** Daily, weekly, and monthly grids from HR-saved registers (scoped by role on the API). */
export function attendanceRegisterViews(
  _mode: AttendanceViewMode,
): Array<'daily' | 'weekly' | 'monthly'> {
  return ['daily', 'weekly', 'monthly']
}

/** @deprecated Use isEmployeeDashboardUser */
export function isViewOnlyUser(user: AuthUser | null | undefined): boolean {
  return isEmployeeDashboardUser(user)
}

const OFFER_LETTER_OPERATOR_EMAILS = new Set([
  'devanshi.siddhpura@parmarketing.agency',
  'jiya.mehta@parmarketing.agency',
])

export function canUseOfferLetters(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  if (canEditAttendance(user)) return true
  return OFFER_LETTER_OPERATOR_EMAILS.has(user.email.trim().toLowerCase())
}

export function canViewAllEmployeeDocuments(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  if (canEditAttendance(user)) return true
  if (OFFER_LETTER_OPERATOR_EMAILS.has(user.email.trim().toLowerCase())) return true
  if (LEADERSHIP_DASHBOARD_EMAILS.has(user.email.trim().toLowerCase())) return true
  return false
}

export function canManageCompanyHolidays(user: AuthUser | null | undefined): boolean {
  return canUseOfferLetters(user)
}

export function employeeHolidayCalendarYear(): number {
  return new Date().getFullYear()
}

export function holidayYearOptionsForEditors(): number[] {
  const now = employeeHolidayCalendarYear()
  return [now - 1, now, now + 1, now + 2]
}

export function visibleHolidayYearOptions(user: AuthUser | null | undefined): number[] {
  if (canManageCompanyHolidays(user)) return holidayYearOptionsForEditors()
  return [employeeHolidayCalendarYear()]
}

export function canUploadEmployeeDocuments(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  return !canEditAttendance(user)
}

const LEADERSHIP_DASHBOARD_EMAILS = new Set([
  'jay.parmar@parmarketing.agency',
  'mansi.prasad@parmarketing.agency',
])

/** Managers, HR, management (Jay/Mansi), and executive approvers - not plain employees. */
export function canViewDashboardAttendanceRoster(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  if (canEditAttendance(user) || isManagerUser(user)) return true
  const email = user.email.trim().toLowerCase()
  if (OFFER_LETTER_OPERATOR_EMAILS.has(email)) return true
  if (LEADERSHIP_DASHBOARD_EMAILS.has(email)) return true
  return false
}

/** Company-wide attendance roster (HR, management, Devanshi/Jiya) vs manager team only. */
export function hasCompanyWideAttendanceRosterScope(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  if (canEditAttendance(user)) return true
  const email = user.email.trim().toLowerCase()
  if (OFFER_LETTER_OPERATOR_EMAILS.has(email)) return true
  if (LEADERSHIP_DASHBOARD_EMAILS.has(email)) return true
  return false
}

/** HR, leadership, executive approvers (Jiya/Devanshi), and managers - not plain employees. */
export function canUseDashboardDateFilters(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  if (canEditAttendance(user) || isManagerUser(user)) return true
  const email = user.email.trim().toLowerCase()
  if (OFFER_LETTER_OPERATOR_EMAILS.has(email)) return true
  if (LEADERSHIP_DASHBOARD_EMAILS.has(email)) return true
  return false
}

export function roleLabel(user: AuthUser | null | undefined): string {
  if (!user) return 'Guest'
  const role = user.role.trim().toLowerCase()
  if (role === 'admin') return 'Admin'
  if (role === 'hr') return 'HR'
  if (role === 'manager') return 'Manager'
  if (role === 'viewer') return 'Employee'
  return user.role
}
