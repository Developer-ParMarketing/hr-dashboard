import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { canEditAttendance, canUseDashboardDateFilters, canViewDashboardAttendanceRoster, hasCompanyWideAttendanceRosterScope, isManagerUser, roleLabel } from '../auth/permissions'
import { AppShell } from '../components/AppShell'
import { DashboardPanel } from '../components/dashboard/DashboardPanel'
import { DashboardApprovalsCard } from '../components/dashboard/DashboardApprovalsCard'
import { DashboardAttendanceRosterPanel } from '../components/dashboard/DashboardAttendanceRosterPanel'
import { DashboardPayrollChecklist } from '../components/dashboard/DashboardPayrollChecklist'
import { DashboardFilterBar } from '../components/dashboard/DashboardFilterBar'
import { DashboardWeeklyApprovalsCard, buildWeeklyApprovalView } from '../components/dashboard/DashboardWeeklyApprovalsCard'
import { DonutMetricCard, type MetricStatus } from '../components/dashboard/DonutMetricCard'
import { AccountLinkBanner } from '../components/AccountLinkBanner'
import { DashboardMetricGroup } from '../components/dashboard/DashboardMetricGroup'
import { DashboardBaselineNote } from '../components/dashboard/DashboardBaselineNote'
import { DashboardInsightsLegend } from '../components/dashboard/DashboardInsightsLegend'
import { DashboardRecentRequests } from '../components/dashboard/DashboardRecentRequests'
import { ModuleIcon } from '../components/ModuleIcon'
import { getQuickActionModules } from '../modules/access'
import type { DashboardSummary, DashboardView } from '../types/dashboard'
import { fetchDashboardSummary } from '../utils/dashboardFilterHelpers'
import {
  defaultDashboardFilter,
  parseDashboardFilterFromSearch,
  workspaceMonthFromFilter,
  type DashboardFilterState,
} from '../utils/dashboardFilter'
import { syncDashboardFiltersToSearchParams } from '../utils/dashboardFilterUrl'
import { useWorkspacePeriod } from '../utils/workspacePeriod'
import { formatDisplayDate, isoFromYmd } from '../utils/displayDate'
import { subscribeEmployeeRegistryUpdated } from '../utils/employeeRegistryEvents'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function formatTodayLabel(): string {
  const now = new Date()
  return formatDisplayDate(
    isoFromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate()),
  )
}

function viewKicker(view: DashboardView): string {
  if (view === 'operations') return 'HR workspace'
  if (view === 'manager') return 'Manager workspace'
  return 'My workspace'
}

function viewSubtitle(view: DashboardView, periodLabel: string, company: string, payrollMonthOnly: boolean, companyWideTeam: boolean): string {
  if (view === 'operations') {
    if (payrollMonthOnly) {
      return `${periodLabel} · ${company} - attendance, people, and payroll for this month.`
    }
    return `${periodLabel} · ${company} - metrics below match your filter; use Monthly for the payroll checklist.`
  }
  if (view === 'manager') {
    if (companyWideTeam) {
      return `${periodLabel} · ${company} - company attendance and approvals in this period (your access).`
    }
    return `${periodLabel} - your team’s attendance and requests in this period.`
  }
  return `${periodLabel} - your attendance, requests, and self-service links.`
}

function peopleScopeLabel(
  selectedEmployeeCount: number,
  showEmployeeFilter: boolean,
  companyWide: boolean,
): string {
  if (showEmployeeFilter && selectedEmployeeCount > 0) {
    return `${selectedEmployeeCount} selected employee${selectedEmployeeCount === 1 ? '' : 's'}`
  }
  if (companyWide) return 'Whole company roster'
  return 'Your team'
}

function teamRosterCaption(
  employeeTotal: number,
  selectedEmployeeCount: number,
  showEmployeeFilter: boolean,
  periodLabel: string,
  companyWide: boolean,
): string {
  if (showEmployeeFilter && selectedEmployeeCount > 0) {
    return `${employeeTotal} in your selection (${selectedEmployeeCount} picked in filter)`
  }
  if (companyWide) {
    return `${employeeTotal} active in scope · attendance for ${periodLabel}`
  }
  return `${employeeTotal} on your roster · attendance for ${periodLabel}`
}

function payrollMetric(salary: DashboardSummary['salary']): {
  percent: number | null
  status: MetricStatus
  progressLabel: string
  caption: string
  value: string | number
} {
  if (!salary) {
    return {
      percent: null,
      status: 'info',
      progressLabel: 'Not available',
      caption: 'Payroll metrics are for HR accounts.',
      value: '-',
    }
  }

  const total = salary.totalRows
  const saved = salary.savedPayrollCount
  const ready = salary.matchedRows
  const errors = salary.errorRows
  const blocked = salary.blockedByApproval
  const denom = total > 0 ? total : ready
  const value =
    denom > 0 ? `${Math.min(saved, denom)}/${denom}` : saved > 0 ? String(saved) : '-'
  const percent = denom > 0 ? Math.round((Math.min(saved, denom) / denom) * 100) : null

  const payrollIssues: string[] = []
  if (errors > 0) payrollIssues.push(`${errors} sheet error${errors === 1 ? '' : 's'}`)
  if (blocked > 0) {
    payrollIssues.push(`${blocked} blocked by weekly approval`)
  }
  const issueSuffix = payrollIssues.length > 0 ? ` · ${payrollIssues.join(' · ')}` : ''

  if (salary.attendanceStale) {
    return {
      percent: null,
      status: 'attention',
      progressLabel: 'Recalculate required',
      caption: salary.staleMessage ?? 'Attendance changed after the last salary run.',
      value: denom > 0 ? `${saved}/${denom}` : 'Stale',
    }
  }

  if (!salary.hasAttendanceData) {
    return {
      percent: null,
      status: 'not_started',
      progressLabel: 'Awaiting attendance',
      caption: 'Upload attendance before running salary for this period.',
      value: '-',
    }
  }

  if (saved === 0 && !salary.hasResults) {
    return {
      percent: denom > 0 ? 0 : null,
      status: 'in_progress',
      progressLabel: 'Not calculated yet',
      caption:
        denom > 0
          ? `${ready} of ${total} salary sheet rows ready to run${issueSuffix}`
          : 'Open Salary to build the sheet for this month.',
      value: denom > 0 ? `0/${denom}` : 'Pending',
    }
  }

  const allSaved = denom > 0 && saved >= denom && errors === 0 && blocked === 0

  if (allSaved) {
    return {
      percent: 100,
      status: 'done',
      progressLabel: 'All payslips saved',
      caption:
        denom === total
          ? `Payroll saved for all ${total} rows on this month's sheet`
          : `Payroll saved for ${saved} employee${saved === 1 ? '' : 's'}`,
      value,
    }
  }

  return {
    percent,
    status: errors > 0 || blocked > 0 ? 'attention' : 'in_progress',
    progressLabel:
      denom > saved
        ? `${denom - saved} payslip${denom - saved === 1 ? '' : 's'} still to save`
        : 'Review salary sheet',
    caption: `Saved ${saved} of ${denom} on the salary sheet${issueSuffix} - open Salary`,
    value,
  }
}

export function DashboardPage() {
  const { user } = useAuth()
  const { year: reportYear, month: reportMonth, company, setPeriod, href } = useWorkspacePeriod()
  const [searchParams, setSearchParams] = useSearchParams()
  const filterHydrated = useRef(false)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<DashboardFilterState>(() =>
    defaultDashboardFilter(reportYear, reportMonth),
  )
  const allowEdit = canEditAttendance(user)
  const isManager = isManagerUser(user)
  const showAdvancedFilters = canUseDashboardDateFilters(user)

  useEffect(() => {
    if (!user || !showAdvancedFilters || filterHydrated.current) return
    filterHydrated.current = true
    setFilter(parseDashboardFilterFromSearch(searchParams, reportYear, reportMonth))
  }, [user, showAdvancedFilters, searchParams, reportYear, reportMonth])

  useEffect(() => {
    if (!showAdvancedFilters) return
    setFilter((prev) =>
      prev.preset === 'monthly' ? { ...prev, year: reportYear, month: reportMonth } : prev,
    )
  }, [reportYear, reportMonth, showAdvancedFilters])

  const activeFilter = useMemo((): DashboardFilterState => {
    if (!showAdvancedFilters) {
      return { ...defaultDashboardFilter(reportYear, reportMonth), preset: 'monthly' }
    }
    return filter
  }, [filter, reportYear, reportMonth, showAdvancedFilters])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchDashboardSummary(activeFilter, company)
      setSummary(data)
    } catch (e) {
      setSummary(null)
      setError(e instanceof Error ? e.message : 'Could not load dashboard')
    } finally {
      setLoading(false)
    }
  }, [activeFilter, company])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return subscribeEmployeeRegistryUpdated(() => {
      void refresh()
    })
  }, [refresh])

  if (!user) return null

  const view = summary?.view ?? (allowEdit ? 'operations' : isManager ? 'manager' : 'employee')
  const quickActions = getQuickActionModules(user)
  const periodLabel = summary?.period.label ?? `${MONTHS[reportMonth - 1] ?? 'Month'} ${reportYear}`
  const payrollMonthOnly = summary?.period.isSingleCalendarMonth ?? true
  const firstName = user.name?.split(' ')[0] ?? user.email?.split('@')[0] ?? 'there'

  const attendance = summary?.attendance
  const salary = summary?.salary
  const people = summary?.people
  const pendingApprovals = summary?.pendingApprovals
  const myRequests = summary?.myRequests
  const snapshot = summary?.employeeSnapshot
  const recentRequests = summary?.recentRequests
  const attendanceRoster = summary?.attendanceEmployeeRoster

  const showAttendanceRoster = canViewDashboardAttendanceRoster(user)

  const attendanceRosterScopeLabel = hasCompanyWideAttendanceRosterScope(user)
    ? 'All employees'
    : 'Your team'

  const companyWideDashboardScope = hasCompanyWideAttendanceRosterScope(user)

  const pendingApprovalTotal = pendingApprovals
    ? pendingApprovals.leave + pendingApprovals.reimbursement + pendingApprovals.portalPunch
    : 0

  const showApprovalsCard =
    pendingApprovals != null && (view === 'manager' || view === 'operations') && (loading || pendingApprovalTotal > 0)

  const employeeTotal = people?.total ?? attendance?.employeeCount ?? 0
  const missingBaseSalary = people?.missingBaseSalary ?? 0
  const missingDoj = people?.missingDoj ?? 0
  const absentFromRegister = people?.absentFromRegister ?? 0
  const unlinkedEmail = people?.unlinkedEmail ?? 0
  const peopleReadinessGaps =
    missingBaseSalary + missingDoj + unlinkedEmail + (attendance?.hasData ? absentFromRegister : 0)
  const payrollReadyCount = people?.payrollReadyCount ?? 0
  const peopleNotReady = Math.max(0, employeeTotal - payrollReadyCount)
  const payrollReadyPercent =
    employeeTotal > 0 ? Math.round((payrollReadyCount / employeeTotal) * 100) : null
  const selectedEmployeeCount = showAdvancedFilters ? activeFilter.employeeIds.length : 0
  const peopleScope = peopleScopeLabel(selectedEmployeeCount, showAdvancedFilters, companyWideDashboardScope)

  const peopleReadinessCaption = (() => {
    if (loading) return 'Loading…'
    if (employeeTotal === 0) return `No people in scope · ${peopleScope}`
    const scopePrefix = `${peopleScope} · `
    if (peopleReadinessGaps === 0) {
      return `${scopePrefix}all ${payrollReadyCount}/${employeeTotal} payroll-ready (register gaps use ${periodLabel})`
    }
    const parts: string[] = []
    if (missingBaseSalary > 0) parts.push(`${missingBaseSalary} base salary`)
    if (missingDoj > 0) parts.push(`${missingDoj} DOJ`)
    if (unlinkedEmail > 0) parts.push(`${unlinkedEmail} email/login`)
    if (attendance?.hasData && absentFromRegister > 0) {
      parts.push(`${absentFromRegister} not in register for ${periodLabel}`)
    }
    return `${scopePrefix}${parts.join(' · ')} - open People`
  })()

  const weeklyView = useMemo(
    () => buildWeeklyApprovalView(loading ? undefined : attendance, { payrollMonthOnly }),
    [attendance, loading, payrollMonthOnly],
  )
  const payroll = payrollMetric(
    loading || view !== 'operations' || !payrollMonthOnly ? null : salary ?? null,
  )
  const openActions = summary?.actions.length ?? 0

  const pendingApprovalsScopeSuffix =
    showAdvancedFilters && selectedEmployeeCount > 0
      ? ` · ${selectedEmployeeCount} selected`
      : ''

  const withPeriod = (path: string) => href(path)

  return (
    <AppShell active="dashboard">
      <main className="dashboard-page">
        <header className="dashboard-hero">
          <div className="dashboard-hero-glow" aria-hidden />
          <div className="dashboard-hero-main">
            <p className="page-kicker">{viewKicker(view)}</p>
            <h1 className="dashboard-hero-title">
              Welcome, <span>{firstName}</span>
            </h1>
            <p className="dashboard-hero-role">{roleLabel(user)}</p>
            <p className="dashboard-hero-sub">{viewSubtitle(view, periodLabel, company, payrollMonthOnly, companyWideDashboardScope)}</p>

            <div className="dashboard-hero-controls">
              {showAdvancedFilters ? (
                <DashboardFilterBar
                  filter={filter}
                  company={company}
                  showCompany={view === 'operations' || allowEdit}
                  onApply={(next, nextCompany) => {
                    setFilter(next)
                    const anchor = workspaceMonthFromFilter(next)
                    setPeriod({ year: anchor.year, month: anchor.month, company: nextCompany })
                    setSearchParams(syncDashboardFiltersToSearchParams(next, nextCompany), { replace: true })
                  }}
                  onShiftMonth={
                    filter.preset === 'monthly'
                      ? (delta) => {
                          const prev = shiftMonth(filter.year, filter.month, delta)
                          const next = { ...filter, year: prev.year, month: prev.month }
                          setFilter(next)
                          setPeriod({ year: prev.year, month: prev.month })
                        }
                      : undefined
                  }
                />
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      const prev = shiftMonth(reportYear, reportMonth, -1)
                      setPeriod({ year: prev.year, month: prev.month })
                    }}
                  >
                    ← Prev
                  </button>
                  <span className="dashboard-period-chip">{periodLabel}</span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      const next = shiftMonth(reportYear, reportMonth, +1)
                      setPeriod({ year: next.year, month: next.month })
                    }}
                  >
                    Next →
                  </button>
                </>
              )}
              <button type="button" className="btn-primary" onClick={() => void refresh()} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            {showAdvancedFilters && !payrollMonthOnly && view === 'operations' ? (
              <p className="dashboard-range-note">
                Payroll checklist and salary status apply to a single calendar month. Switch period to{' '}
                <strong>Monthly</strong> for those steps, or use this range for attendance and people metrics.
              </p>
            ) : null}
          </div>

          <div className="dashboard-hero-aside">
            <div className="dashboard-hero-avatar" aria-hidden>
              {(user.name || user.email || 'H').slice(0, 1).toUpperCase()}
            </div>
            <span className="dashboard-date-chip">{formatTodayLabel()}</span>
            {view === 'operations' ? <span className="dashboard-company-chip">{company}</span> : null}
          </div>
        </header>

        {error ? (
          <p className="alert-error" role="alert">
            {error}
          </p>
        ) : null}

        {view === 'operations' && !loading && (people?.unlinkedEmail ?? 0) > 0 ? (
          <AccountLinkBanner variant="admin" unlinkedCount={people?.unlinkedEmail ?? 0} className="mb-5 rounded-xl" />
        ) : null}
        {view === 'employee' && !loading && snapshot && !snapshot.linked ? (
          <AccountLinkBanner
            variant="employee"
            loginEmail={snapshot.loginEmail ?? user.email}
            className="mb-5 rounded-xl"
          />
        ) : null}

        <section className="dashboard-insights">
          <div className="dashboard-insights-head">
            <h2 className="dashboard-insights-title">
              {view === 'employee'
                ? 'This month'
                : view === 'manager'
                  ? `Team overview · ${periodLabel}`
                  : `Insights · ${periodLabel}`}
            </h2>
            <DashboardInsightsLegend />
          </div>
          <div className="dashboard-metrics-stack">
            {view === 'employee' ? (
              <>
                <DashboardMetricGroup
                  title="Your attendance"
                  description="From HR-uploaded registers for this period"
                  columns={3}
                  span="full"
                >
                <DonutMetricCard
                  title="Pay days"
                  value={loading ? '…' : snapshot?.linked ? (snapshot.payDays ?? 0) : '-'}
                  caption={
                    loading
                      ? 'Loading…'
                      : snapshot?.linked
                        ? snapshot.hasAttendance
                          ? 'From HR-uploaded attendance'
                          : 'Attendance not published yet'
                        : 'Profile not linked'
                  }
                  percent={
                    snapshot?.hasAttendance && snapshot.payDays != null
                      ? Math.min(100, Math.round((snapshot.payDays / 26) * 100))
                      : null
                  }
                  status={
                    snapshot?.hasAttendance
                      ? 'done'
                      : snapshot?.linked
                        ? 'not_started'
                        : 'attention'
                  }
                  insight="attendance"
                  progressLabel={
                    snapshot?.hasAttendance
                      ? `${snapshot.payDays ?? 0} of ~26 pay days`
                      : snapshot?.linked
                        ? 'Waiting on HR'
                        : 'Ask HR to link your profile'
                  }
                />
                <DonutMetricCard
                  title="WFH days"
                  value={loading ? '…' : snapshot?.wfhDays ?? 0}
                  caption="Count for this month (not a completion %)"
                  percent={null}
                  status="info"
                  insight="attendance"
                  progressLabel={`${snapshot?.wfhDays ?? 0} WFH day${snapshot?.wfhDays === 1 ? '' : 's'}`}
                />
                <DonutMetricCard
                  title="Late marks"
                  value={loading ? '…' : snapshot?.lateMarks ?? 0}
                  caption="From your uploaded attendance register"
                  percent={null}
                  status={(snapshot?.lateMarks ?? 0) > 0 ? 'attention' : 'info'}
                  insight="payroll"
                  progressLabel={`${snapshot?.lateMarks ?? 0} this month`}
                />
                </DashboardMetricGroup>
                {snapshot?.baselineInsight ? (
                  <DashboardBaselineNote
                    tone={snapshot.baselineInsight.tone}
                    message={snapshot.baselineInsight.message}
                    className="mt-3"
                  />
                ) : null}
                <DashboardMetricGroup
                  title="Weekly approval"
                  description="Approved/locked weeks from the weekly register (same source as payroll)"
                  columns={1}
                  span="full"
                >
                  <DashboardWeeklyApprovalsCard
                    attendance={loading ? undefined : attendance}
                    loading={loading}
                    payrollMonthOnly={payrollMonthOnly}
                    periodLabel={periodLabel}
                    cardTitle="Your weekly approval"
                  />
                </DashboardMetricGroup>
                <DashboardMetricGroup title="Requests" description="Leave, reimbursement, and in/out you submitted" columns={1}>
                <DonutMetricCard
                  title="My requests"
                  value={loading ? '…' : myRequests?.totalPending ?? 0}
                  caption={myRequests?.totalPending ? 'Awaiting approval' : 'No open requests'}
                  percent={null}
                  status={myRequests?.totalPending ? 'in_progress' : 'done'}
                  insight="actions"
                  progressLabel={myRequests?.totalPending ? 'In progress' : 'All clear'}
                />
                </DashboardMetricGroup>
              </>
            ) : view === 'manager' ? (
              <>
                <DashboardMetricGroup title="Your team" description={`Roster and attendance for ${periodLabel}`} columns={3}>
                <DonutMetricCard
                  title="Team members"
                  value={loading ? '…' : employeeTotal}
                  caption={teamRosterCaption(
                    employeeTotal,
                    selectedEmployeeCount,
                    showAdvancedFilters,
                    periodLabel,
                    companyWideDashboardScope,
                  )}
                  percent={null}
                  status="info"
                  insight="people"
                  progressLabel={`${employeeTotal} on your roster`}
                />
                <DashboardWeeklyApprovalsCard
                  attendance={loading ? undefined : attendance}
                  loading={loading}
                  payrollMonthOnly={payrollMonthOnly}
                  periodLabel={periodLabel}
                  cardTitle="Team weekly approvals"
                />
                <DonutMetricCard
                  title="Team late marks"
                  value={
                    loading
                      ? '…'
                      : attendance?.teamLateMarks != null
                        ? attendance.teamLateMarks
                        : '-'
                  }
                  caption={
                    loading
                      ? 'Loading…'
                      : attendance?.hasData
                        ? `Late days across your team in ${periodLabel}`
                        : 'No team attendance uploaded yet'
                  }
                  percent={null}
                  status={
                    attendance?.teamBaselineInsight
                      ? 'attention'
                      : (attendance?.teamLateMarks ?? 0) > 0
                        ? 'in_progress'
                        : 'info'
                  }
                  insight="payroll"
                  progressLabel={
                    attendance?.teamLateMarks != null
                      ? `${attendance.teamLateMarks} late day${attendance.teamLateMarks === 1 ? '' : 's'}`
                      : '-'
                  }
                />
                </DashboardMetricGroup>
                {attendance?.teamBaselineInsight ? (
                  <DashboardBaselineNote
                    tone={attendance.teamBaselineInsight.tone}
                    message={attendance.teamBaselineInsight.message}
                    className="mt-3"
                  />
                ) : null}
                <DashboardMetricGroup title="Needs your action" description="Approvals and your own open requests" columns={2}>
                <DonutMetricCard
                  title="Pending approvals"
                  value={loading ? '…' : pendingApprovalTotal}
                  caption={
                    pendingApprovalTotal
                      ? `${pendingApprovals?.leave ?? 0} leave · ${pendingApprovals?.reimbursement ?? 0} reimb · ${pendingApprovals?.portalPunch ?? 0} in/out · all open${pendingApprovalsScopeSuffix}`
                      : 'Nothing waiting on you'
                  }
                  percent={null}
                  status={pendingApprovalTotal ? 'attention' : 'done'}
                  insight="actions"
                  progressLabel={pendingApprovalTotal ? 'Needs your decision' : 'All clear'}
                />
                <DonutMetricCard
                  title="Your requests"
                  value={loading ? '…' : myRequests?.totalPending ?? 0}
                  caption="Leave & claims you submitted"
                  percent={null}
                  status={myRequests?.totalPending ? 'in_progress' : 'done'}
                  insight="people"
                  progressLabel={myRequests?.totalPending ? 'Open' : 'None open'}
                />
                </DashboardMetricGroup>
              </>
            ) : (
              <>
                <DashboardMetricGroup
                  title="People"
                  description={`Directory readiness · ${peopleScope}`}
                  columns={1}
                >
                <DonutMetricCard
                  title="People & payroll ready"
                  value={loading ? '…' : employeeTotal > 0 ? `${payrollReadyCount}/${employeeTotal}` : '0'}
                  caption={peopleReadinessCaption}
                  percent={payrollReadyPercent}
                  status={
                    loading
                      ? 'info'
                      : employeeTotal === 0
                        ? 'not_started'
                        : peopleNotReady > 0
                          ? 'attention'
                          : 'done'
                  }
                  insight="people"
                  progressLabel={
                    loading
                      ? 'Loading…'
                      : peopleNotReady > 0
                        ? `${peopleNotReady} people need fixes before payroll`
                        : employeeTotal > 0
                          ? 'Everyone payroll-ready'
                          : 'Add people in Admin'
                  }
                />
                </DashboardMetricGroup>
                <DashboardMetricGroup
                  title="Attendance"
                  description={
                    payrollMonthOnly
                      ? `Weekly register and approvals for ${periodLabel}`
                      : `Weeks overlapping ${periodLabel}`
                  }
                  columns={1}
                >
                <DashboardWeeklyApprovalsCard
                  attendance={loading ? undefined : attendance}
                  loading={loading}
                  payrollMonthOnly={payrollMonthOnly}
                  periodLabel={periodLabel}
                  cardTitle={weeklyView.cardTitle}
                />
                </DashboardMetricGroup>
                {payrollMonthOnly ? (
                  <DashboardMetricGroup title="Payroll" description={`Calculate and export for ${periodLabel}`} columns={1}>
                <DonutMetricCard
                  title="Payroll status"
                  value={loading ? '…' : payroll.value}
                  caption={payroll.caption}
                  percent={payroll.percent}
                  status={payroll.status}
                  insight="payroll"
                  progressLabel={payroll.progressLabel}
                />
                </DashboardMetricGroup>
                ) : null}
                <DashboardMetricGroup title="Follow-ups" description="Cross-cutting items from the checklist" columns={1}>
                <DonutMetricCard
                  title="Pending actions"
                  value={loading ? '…' : openActions}
                  caption={
                    loading
                      ? 'Loading…'
                      : openActions
                        ? 'Items need attention this period'
                        : 'All clear for this period'
                  }
                  percent={null}
                  status={openActions ? 'attention' : 'done'}
                  insight="actions"
                  progressLabel={
                    openActions
                      ? `${openActions} open item${openActions === 1 ? '' : 's'}`
                      : 'All clear'
                  }
                />
                </DashboardMetricGroup>
              </>
            )}
          </div>
        </section>

        {showAttendanceRoster ? (
          <DashboardAttendanceRosterPanel
            rows={attendanceRoster ?? null}
            loading={loading}
            periodLabel={periodLabel}
            patternCompareLabel={summary?.attendanceRosterPatternCompareLabel ?? null}
            periodPreset={summary?.period.preset ?? 'monthly'}
            isSingleCalendarMonth={summary?.period.isSingleCalendarMonth ?? true}
            hasRegisterData={Boolean(
              attendance?.hasData || attendanceRoster?.some((r) => r.hasAttendance),
            )}
            scopeLabel={attendanceRosterScopeLabel}
            href={withPeriod}
          />
        ) : null}

        <div className={`par-panels-grid${view === 'operations' ? ' par-panels-grid-operations' : ''}`}>
          {showApprovalsCard ? (
            <div className="dashboard-panel-span-all">
              <DashboardApprovalsCard
                pending={pendingApprovals}
                loading={loading}
                scopeNote={
                  showAdvancedFilters && selectedEmployeeCount > 0
                    ? `${selectedEmployeeCount} selected employee${selectedEmployeeCount === 1 ? '' : 's'}`
                    : undefined
                }
              />
            </div>
          ) : null}

          {view === 'operations' ? (
            <DashboardPanel title="Module shortcuts" className="dashboard-panel-quick">
              {allowEdit && quickActions.length > 0 ? (
                <div className="par-quick-grid par-quick-grid-operations">
                  {quickActions.map((mod) => (
                    <Link key={mod.id} to={withPeriod(mod.href)} className="par-quick-link">
                      <span className="par-quick-icon">
                        <ModuleIcon id={mod.id} className="h-5 w-5" />
                      </span>
                      <span className="par-quick-text">
                        <strong>{mod.label}</strong>
                        <span>{mod.quickActionLabel}</span>
                      </span>
                    </Link>
                  ))}
                  <Link to={withPeriod('/attendance-detail')} className="par-quick-link">
                    <span className="par-quick-icon">
                      <ModuleIcon id="attendanceDetail" className="h-5 w-5" />
                    </span>
                    <span className="par-quick-text">
                      <strong>Attendance history</strong>
                      <span>Review &amp; approve monthly</span>
                    </span>
                  </Link>
                  {pendingApprovalTotal > 0 ? (
                    <>
                      <Link to="/leave-request?tab=pending" className="par-quick-link">
                        <span className="par-quick-icon">
                          <ModuleIcon id="leaveRequest" className="h-5 w-5" />
                        </span>
                        <span className="par-quick-text">
                          <strong>Leave approvals</strong>
                          <span>{pendingApprovals?.leave ?? 0} pending</span>
                        </span>
                      </Link>
                      {(pendingApprovals?.reimbursement ?? 0) > 0 ? (
                        <Link to="/reimbursement?tab=pending" className="par-quick-link">
                          <span className="par-quick-icon">
                            <ModuleIcon id="reimbursement" className="h-5 w-5" />
                          </span>
                          <span className="par-quick-text">
                            <strong>Reimbursement</strong>
                            <span>{pendingApprovals?.reimbursement ?? 0} pending</span>
                          </span>
                        </Link>
                      ) : null}
                      {(pendingApprovals?.portalPunch ?? 0) > 0 ? (
                        <Link to="/in-out-request?tab=pending" className="par-quick-link">
                          <span className="par-quick-icon">
                            <ModuleIcon id="inOutRequest" className="h-5 w-5" />
                          </span>
                          <span className="par-quick-text">
                            <strong>In / out</strong>
                            <span>{pendingApprovals?.portalPunch ?? 0} pending</span>
                          </span>
                        </Link>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : (
                <p className="par-panel-empty">No quick actions for your role.</p>
              )}
            </DashboardPanel>
          ) : null}

          <DashboardPanel
            className={view === 'operations' ? 'dashboard-panel-checklist' : undefined}
            title={
              view === 'employee'
                ? 'For you'
                : view === 'operations'
                  ? payrollMonthOnly
                    ? 'Monthly payroll checklist'
                    : 'Payroll checklist'
                  : 'Action required'
            }
            actions={
              <button type="button" className="btn-ghost text-sm" onClick={() => void refresh()} disabled={loading}>
                Refresh
              </button>
            }
          >
            {view === 'employee' ? (
              <>
                <h3 className="dashboard-subpanel-title">My recent requests</h3>
                <DashboardRecentRequests rows={recentRequests} loading={loading} />
                {loading ? null : summary && summary.actions.length > 0 ? (
                  <>
                    <h3 className="dashboard-subpanel-title dashboard-subpanel-title-spaced">Your updates</h3>
                    <ul className="par-action-table">
                      {summary.actions.map((action) => (
                        <li
                          key={action.id}
                          className={`par-action-row${action.severity === 'warning' ? ' par-action-row-warning' : ''}`}
                        >
                          <div>
                            <p className="par-action-message">{action.message}</p>
                            <p className="par-action-meta">
                              {action.severity === 'warning'
                                ? 'Needs attention'
                                : action.id === 'my-requests-pending'
                                  ? 'Waiting on approver'
                                  : 'Review'}
                            </p>
                          </div>
                          <Link to={withPeriod(action.href)} className="btn-secondary text-sm">
                            {action.actionLabel}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : summary && summary.actions.length === 0 && (!recentRequests || recentRequests.length === 0) ? (
                  <div className="par-panel-success dashboard-subpanel-spaced">
                    {`You're all set for ${periodLabel}.`}
                  </div>
                ) : null}
              </>
            ) : view === 'operations' ? (
              payrollMonthOnly ? (
              <DashboardPayrollChecklist
                items={summary?.checklist ?? []}
                periodLabel={periodLabel}
                loading={loading}
                hrefFor={withPeriod}
              />
              ) : (
                <p className="par-panel-empty">
                  Switch the period filter to <strong>Monthly</strong> for the step-by-step payroll checklist.
                  Quick actions stay available; insight numbers above follow your current filter.
                </p>
              )
            ) : loading ? (
              <p className="par-panel-empty">Loading…</p>
            ) : summary && summary.actions.length > 0 ? (
              <ul className="par-action-table">
                {summary.actions.map((action) => (
                  <li
                    key={action.id}
                    className={`par-action-row${action.severity === 'warning' ? ' par-action-row-warning' : ''}`}
                  >
                    <div>
                      <p className="par-action-message">{action.message}</p>
                      <p className="par-action-meta">{action.severity === 'warning' ? 'Needs attention' : 'Review'}</p>
                    </div>
                    <Link to={withPeriod(action.href)} className="btn-secondary text-sm">
                      {action.actionLabel}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="par-panel-success">
                {`All clear for ${periodLabel}. No pending items.`}
              </div>
            )}
          </DashboardPanel>
        </div>
      </main>
    </AppShell>
  )
}
