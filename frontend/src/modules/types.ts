export type ModuleId =
  | 'dashboard'
  | 'settings'
  | 'attendance'
  | 'attendanceDetail'
  | 'policies'
  | 'holidayList'
  | 'leaveRequest'
  | 'inOutRequest'
  | 'salary'
  | 'payslip'
  | 'taxInfo'
  | 'tds'
  | 'form16'
  | 'reimbursement'
  | 'reports'
  | 'documents'
  | 'performance'
  | 'goalSheet'
  | 'offerLetter'
  | 'relievingLetter'
  | 'admin'

export type ModuleGroupId =
  | 'overview'
  | 'time'
  | 'requests'
  | 'payroll'
  | 'reports'
  | 'people'
  | 'admin'

export type ModuleDefinition = {
  id: ModuleId
  label: string
  description: string
  group: ModuleGroupId
  /** Short glyph for sidebar / launcher tiles */
  icon: string
  href: string
  adminOnly?: boolean
  /** HR + admin only */
  editorOnly?: boolean
  /**
   * Marketing / stub route - still linked, but badged “Coming soon” and
   * de-emphasized in nav/launcher until wired to API/data.
   */
  comingSoon?: boolean
  quickActionLabel?: string
}

export type ModuleGroupDefinition = {
  id: ModuleGroupId
  label: string
}
