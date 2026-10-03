export type DashboardAction = {
  id: string
  severity: 'warning' | 'info'
  message: string
  href: string
  actionLabel: string
}

export type DashboardChecklistStatus = 'todo' | 'done' | 'blocked'

export type DashboardChecklistItem = {
  id: string
  step: number
  title: string
  detail: string
  status: DashboardChecklistStatus
  href: string
  actionLabel: string
}

export type DashboardNotificationTier = 'critical' | 'important' | 'normal' | 'shortcut'

export type DashboardNotification = {
  id: string
  tier: DashboardNotificationTier
  priorityScore: number
  rank: number
  title: string
  message: string
  href: string
  actionLabel: string
  moduleId: string | null
  source: 'action' | 'checklist' | 'approval' | 'shortcut'
}

export type DashboardNotificationsMeta = {
  total: number
  urgentCount: number
  shortcutCount: number
  loginReminder: string | null
}

export type DashboardView = 'operations' | 'manager' | 'employee'

export type DashboardPendingApprovals = {
  leave: number
  reimbursement: number
  portalPunch: number
}

export type DashboardMyRequests = {
  leavePending: number
  reimbursementPending: number
  totalPending: number
}

export type DashboardBaselineInsight = {
  tone: 'info' | 'warning'
  message: string
}

export type DashboardEmployeeSnapshot = {
  linked: boolean
  loginEmail?: string
  hasAttendance: boolean
  payDays: number | null
  wfhDays: number | null
  lateMarks: number | null
  hasPayslip: boolean
  baselineInsight?: DashboardBaselineInsight | null
}

export type DashboardRecentRequestKind = 'leave' | 'reimbursement' | 'portalPunch'

export type DashboardRecentRequest = {
  kind: DashboardRecentRequestKind
  id: number
  status: string
  summary: string
  submittedAt: string
  href: string
}

export type DashboardAttendanceEmployeeRow = {
  employeeId: number
  employeeCode: string
  employeeName: string
  teamName: string | null
  hasAttendance: boolean
  payDays: number | null
  wfhDays: number | null
  lateMarks: number | null
  absentDays: number | null
  warnings: string[]
  insights: string[]
  anomalyScore: number
  /** 1 when last month's register exists for comparison; else 0. */
  patternHistoryMonths: number
}

export type DashboardWeeklyWeekSummary = {
  weekStart: string
  weekEnd: string
  peopleTotal: number
  peopleApproved: number
  complete: boolean
}

export type DashboardRangePreset = 'monthly' | 'quarterly' | 'yearly' | 'custom'

export type DashboardSummary = {
  view: DashboardView
  period: {
    year: number
    month: number
    company: string
    label: string
    preset: DashboardRangePreset
    quarter: number | null
    dateFrom: string
    dateTo: string
    isSingleCalendarMonth: boolean
  }
  attendance: {
    hasData: boolean
    employeeCount: number
    weeklyTotal: number
    weeklyApproved: number
    weeklyPending: number
    weeklyCalendarWeeksTotal: number
    weeklyCalendarWeeksComplete: number
    weeklyWeeks: DashboardWeeklyWeekSummary[]
    teamLateMarks?: number | null
    teamBaselineInsight?: DashboardBaselineInsight | null
  }
  salary: {
    hasAttendanceData: boolean
    hasResults: boolean
    attendanceStale: boolean
    staleMessage: string | null
    matchedRows: number
    totalRows: number
    errorRows: number
    blockedByApproval: number
    savedPayrollCount: number
  } | null
  people: {
    total: number
    missingBaseSalary: number
    unlinkedEmail: number
    missingDoj: number
    absentFromRegister: number
    payrollReadyCount: number
  } | null
  teams: {
    withoutManager: number
    withoutMembers: number
  } | null
  pendingApprovals: DashboardPendingApprovals | null
  myRequests: DashboardMyRequests | null
  employeeSnapshot: DashboardEmployeeSnapshot | null
  recentRequests: DashboardRecentRequest[] | null
  attendanceEmployeeRoster: DashboardAttendanceEmployeeRow[] | null
  attendanceRosterPatternCompareLabel: string | null
  actions: DashboardAction[]
  checklist: DashboardChecklistItem[] | null
  notifications: DashboardNotification[]
  notificationsMeta: DashboardNotificationsMeta
}
