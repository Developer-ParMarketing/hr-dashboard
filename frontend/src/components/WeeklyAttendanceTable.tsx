import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  calendarWeeksForMonth,
  formatHoursHm,
  formatInr,
  rowMatchesFilter,
  tableRowStripBg,
  weekIndexForIsoDate,
  weeklyStatusLabel,
} from '../utils/attendance'
import { formatDisplayDateRange } from '../utils/displayDate'
import {
  APPROVAL_WORKFLOW_LABELS,
  EMAIL_WORKFLOW_LABELS,
  approvalWorkflowTone,
  emailWorkflowTone,
  weeklyRecordApprovalStep,
} from '../constants/workflowStatus'
import {
  emailStatusError,
  notificationIndex,
  weeklyEmailStatus,
  type NotificationStatusEntry,
} from '../utils/emailWorkflow'
import { downloadMatrixAsXlsx } from '../utils/downloadMatrixXlsx'
import { BulkSelectCheckbox } from './BulkSelectCheckbox'
import { BulkWeekApprovalBar } from './BulkWeekApprovalBar'
import { WorkflowStatusBadge } from './WorkflowStatus'
import { useBulkWeekApproval } from '../hooks/useBulkWeekApproval'
import { isWeeklyRecordSelectable } from '../utils/weeklyApproval'
import { buildWeeklyCalcRows } from '../utils/weeklyAttendanceRows'
import { computeWeeklyTeamPeriodSummary } from '../utils/teamPeriodSummary'
import { TeamPeriodSummarySection } from './TeamPeriodSummarySection'
import {
  groupRowsByTeam,
  teamMetaFromEmployee,
  UNASSIGNED_TEAM_LABEL,
} from '../utils/teamGroups'
import { TeamGroupHeader } from './TeamGroupHeader'
import { confirmWeeklyBulkDecision } from '../utils/confirmAction'
import type {
  AttendanceFilter,
  CompanyHolidayDay,
  NormalizedEmployee,
  WeeklyAttendanceRecord,
  WeeklyAttendanceStatus,
} from '../types/attendance'

type Props = {
  employees: NormalizedEmployee[]
  weeklyRecords: WeeklyAttendanceRecord[]
  search: string
  filter?: AttendanceFilter
  reportYear: number
  reportMonth: number
  policyCompany?: string | null
  notificationStatus?: NotificationStatusEntry[]
  onBulkWeeklyAction?: (ids: number[], status: 'approved' | 'rejected') => void | Promise<void>
  allowEdit?: boolean
  showBulkApproval?: boolean
  groupByTeam?: boolean
  showTeamSummary?: boolean
  companyHolidays?: CompanyHolidayDay[]
  pinnedWeekStart?: string | null
  lockWeekPicker?: boolean
}

function approvalBadge(status: WeeklyAttendanceStatus) {
  const step = weeklyRecordApprovalStep(status)
  const label =
    step === 'idle' || step === 'error' ? APPROVAL_WORKFLOW_LABELS.draft : APPROVAL_WORKFLOW_LABELS[step]
  return (
    <WorkflowStatusBadge
      label={label}
      tone={approvalWorkflowTone(step === 'idle' ? 'draft' : step)}
      compact
    />
  )
}

function emailBadge(
  status: ReturnType<typeof weeklyEmailStatus>,
  error: string | null,
) {
  if (status === 'none') return <span className="text-[var(--color-warm-text)]">-</span>
  return (
    <span title={error ?? undefined}>
      <WorkflowStatusBadge
        label={EMAIL_WORKFLOW_LABELS[status]}
        tone={emailWorkflowTone(status)}
        compact
      />
    </span>
  )
}

type CalcRow = {
  id: number | null
  employeeCode: string
  employeeName: string
  totalHours: number | null
  requiredHours: number
  deficitHours: number
  deduction: number
  status: WeeklyAttendanceStatus
}

export function WeeklyAttendanceTable({
  employees,
  weeklyRecords,
  search,
  filter = 'all',
  reportYear,
  reportMonth,
  policyCompany,
  notificationStatus,
  onBulkWeeklyAction,
  allowEdit = true,
  showBulkApproval = false,
  groupByTeam = true,
  showTeamSummary = false,
  companyHolidays = [],
  pinnedWeekStart = null,
  lockWeekPicker = false,
}: Props) {
  const showApproval = allowEdit && showBulkApproval
  const [weekNo, setWeekNo] = useState(1)
  const notifyIndex = useMemo(() => notificationIndex(notificationStatus), [notificationStatus])

  useEffect(() => {
    if (!pinnedWeekStart) return
    setWeekNo(weekIndexForIsoDate(reportYear, reportMonth, pinnedWeekStart))
  }, [pinnedWeekStart, reportYear, reportMonth])

  const thHead =
    'border border-[var(--color-warm-muted)] bg-[color-mix(in_srgb,var(--color-brand-muted)_78%,#fff)] px-2 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-warm-text)] sm:text-xs'

  const calendarWeeks = useMemo(
    () => calendarWeeksForMonth(reportYear, reportMonth),
    [reportYear, reportMonth],
  )
  const weekOptions = useMemo(
    () =>
      calendarWeeks
        .map((days, idx) => ({ weekNo: idx + 1, days }))
        .filter(({ days }) => days.length > 0),
    [calendarWeeks],
  )
  const activeWeekDays = useMemo(() => {
    const d = calendarWeeks[weekNo - 1] ?? []
    if (d.length > 0) return d
    return weekOptions[0]?.days ?? []
  }, [calendarWeeks, weekNo, weekOptions])
  const activeWeekNo = useMemo(() => {
    const d = calendarWeeks[weekNo - 1] ?? []
    if (d.length > 0) return weekNo
    return weekOptions[0]?.weekNo ?? weekNo
  }, [calendarWeeks, weekNo, weekOptions])

  const weekStart =
    activeWeekDays.length > 0
      ? `${reportYear}-${String(reportMonth).padStart(2, '0')}-${String(activeWeekDays[0]).padStart(2, '0')}`
      : ''
  const weekEnd =
    activeWeekDays.length > 0
      ? `${reportYear}-${String(reportMonth).padStart(2, '0')}-${String(activeWeekDays[activeWeekDays.length - 1]).padStart(2, '0')}`
      : ''
  const weekRangeLabel = useMemo(
    () => (weekStart && weekEnd ? formatDisplayDateRange(weekStart, weekEnd) : ''),
    [weekStart, weekEnd],
  )

  const employeesScoped = useMemo(
    () =>
      filter === 'all'
        ? employees
        : employees.filter((e) => rowMatchesFilter(e, filter, activeWeekDays)),
    [employees, filter, activeWeekDays],
  )

  const rows = useMemo(
    (): CalcRow[] =>
      buildWeeklyCalcRows({
        employees: employeesScoped,
        weeklyRecords,
        weekStart,
        activeWeekNo,
        reportYear,
        reportMonth,
        search,
        policyCompany,
        companyHolidays,
      }),
    [
      employeesScoped,
      weeklyRecords,
      weekStart,
      activeWeekNo,
      reportYear,
      reportMonth,
      search,
      policyCompany,
      companyHolidays,
    ],
  )

  const teamPeriodSummary = useMemo(() => {
    if (!showTeamSummary || !groupByTeam) return null
    const weekLabel =
      weekStart && weekEnd
        ? `Week ${activeWeekNo} (${weekRangeLabel})`
        : `Week ${activeWeekNo}`
    return computeWeeklyTeamPeriodSummary({
      calcRows: rows,
      employees,
      weekLabel,
    })
  }, [showTeamSummary, groupByTeam, rows, employees, weekStart, weekEnd, activeWeekNo, weekRangeLabel])

  const employeeByCode = useMemo(
    () => new Map(employees.map((emp) => [emp.employeeCode, emp])),
    [employees],
  )

  const groupedRows = useMemo(() => {
    if (!groupByTeam) {
      return [{ group: teamMetaFromEmployee({ teamId: null, teamName: '', teamSortOrder: 0 }), items: rows }]
    }
    return groupRowsByTeam(rows, (row) => {
      const emp = employeeByCode.get(row.employeeCode)
      return (
        emp
          ? teamMetaFromEmployee(emp)
          : teamMetaFromEmployee({
              teamId: null,
              teamName: UNASSIGNED_TEAM_LABEL,
              teamSortOrder: 9999,
            })
      )
    })
  }, [groupByTeam, rows, employeeByCode])

  const rowWeeklyIds = useMemo(
    () => {
      if (!showApproval) return rows.map(() => null)
      return rows.map((row) => {
        if (row.id == null) return null
        const rec = weeklyRecords.find((w) => w.id === row.id)
        return rec && isWeeklyRecordSelectable(rec) ? rec.id : null
      })
    },
    [rows, weeklyRecords, showApproval],
  )

  const selectableIds = useMemo(
    () => rowWeeklyIds.filter((id): id is number => id != null),
    [rowWeeklyIds],
  )

  const bulk = useBulkWeekApproval(selectableIds)

  const runBulkAction = async (status: 'approved' | 'rejected') => {
    if (!onBulkWeeklyAction || bulk.selectedIds.length === 0) return
    if (!(await confirmWeeklyBulkDecision(bulk.selectedIds.length, status))) return
    bulk.setBusy(true)
    try {
      await onBulkWeeklyAction(bulk.selectedIds, status)
      bulk.clear()
    } finally {
      bulk.setBusy(false)
    }
  }

  const downloadExcel = () => {
    downloadMatrixAsXlsx(
      `weekly-attendance-week-${activeWeekNo}.xlsx`,
      `Week ${activeWeekNo}`,
      ['Employee', 'Total Hours', 'Required', 'Deficit', 'Deduction', 'Status'],
      rows.map((row) => [
        `${row.employeeName}${row.employeeCode ? ` (${row.employeeCode})` : ''}`,
        formatHoursHm(row.totalHours),
        formatHoursHm(row.requiredHours),
        formatHoursHm(row.deficitHours),
        formatInr(row.deduction),
        weeklyStatusLabel(row.status),
      ]),
    )
  }

  return (
    <>
      {teamPeriodSummary ? (
        <TeamPeriodSummarySection kicker="Team hours" summary={teamPeriodSummary} />
      ) : null}
      <section className="card overflow-hidden">
      <div className="card-head flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-brand)]">
            Hours
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--color-ink)]">
            Weekly Attendance
          </h2>
          <p className="mt-1 text-sm text-[color-mix(in_srgb,var(--color-warm-text)_88%,transparent)]">
            {showApproval
              ? 'Select employees, then approve or reject the week in bulk. Edit day marks in the weekly grid below before approval.'
              : 'Weekly hours and status for review. Approve the full month on the Monthly tab before payroll.'}
            {weekRangeLabel ? ` · ${weekRangeLabel}` : ''}
          </p>
          {showApproval ? (
          <BulkWeekApprovalBar
            selectableCount={selectableIds.length}
            selectedCount={bulk.selectedCount}
            allSelected={bulk.allSelected}
            someSelected={bulk.someSelected}
            busy={bulk.busy}
            onToggleAll={bulk.toggleAll}
            onApprove={() => void runBulkAction('approved')}
            onReject={() => void runBulkAction('rejected')}
          />
          ) : null}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-warm-text)]">
            <span>Draft</span>
            <span>Pending</span>
            <span>Approved</span>
            <span>Locked</span>
            <span>Email: Pending / Sent / Failed</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {lockWeekPicker ? (
            <p className="text-sm text-[var(--color-warm-text)]">
              Week {activeWeekNo}
              {weekRangeLabel ? ` · ${weekRangeLabel}` : ''}
            </p>
          ) : (
            <label className="text-sm text-[var(--color-warm-text)]">
              <span className="mr-2 text-xs font-medium">Week</span>
              <select
                value={activeWeekNo}
                onChange={(e) => setWeekNo(Number(e.target.value))}
                className="field field-compact"
              >
                {weekOptions.map(({ weekNo: wn }) => (
                  <option key={wn} value={wn}>
                    Week {wn}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={downloadExcel}
            disabled={rows.length === 0}
            className="btn-primary"
          >
            Download Excel
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="min-w-max w-full border-collapse text-left text-xs sm:text-sm">
          <thead className="sticky top-0 z-10 shadow-[0_1px_0_0_color-mix(in_srgb,var(--color-brand)_12%,var(--color-warm-muted))]">
            <tr>
              {showApproval ? (
                <th className={`sticky left-0 z-20 w-10 min-w-10 whitespace-nowrap px-2 py-3 text-center ${thHead}`}>
                  <BulkSelectCheckbox
                    checked={bulk.allSelected}
                    indeterminate={bulk.someSelected}
                    disabled={bulk.busy || selectableIds.length === 0}
                    onChange={bulk.toggleAll}
                    ariaLabel="Select all employees for approval"
                  />
                </th>
              ) : null}
              <th className={`sticky ${showApproval ? 'left-10' : 'left-0'} z-20 min-w-[12rem] whitespace-nowrap px-3 text-left ${thHead}`}>
                Employee
              </th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Total Hours</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Required</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Deficit</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Deduction</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Status</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Email</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={showApproval ? 8 : 7}
                  className="border border-[var(--color-warm-muted)] px-4 py-8 text-center text-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]"
                >
                  No weekly attendance records for this week.
                </td>
              </tr>
            ) : (
              groupedRows.flatMap((section) => {
                const colCount = showApproval ? 8 : 7
                const header =
                  groupByTeam ? (
                    <TeamGroupHeader
                      key={`team-header-${section.group.teamId ?? 'unassigned'}`}
                      group={section.group}
                      memberCount={section.items.length}
                      colSpan={colCount}
                    />
                  ) : null
                const bodyRows = section.items.map((row, rowIndex) => {
                const stripBg = tableRowStripBg(rowIndex)
                const deficitClass =
                  row.deficitHours > 0
                    ? 'bg-amber-50 font-semibold text-amber-900'
                    : `${stripBg} text-[var(--color-warm-text)]`
                const stored = row.id != null ? weeklyRecords.find((w) => w.id === row.id) : undefined
                const emailStatus = stored
                  ? weeklyEmailStatus(notifyIndex, stored.employeeId, weekStart)
                  : 'none'
                const emailErr = stored
                  ? emailStatusError(notifyIndex, 'weekly_hours', stored.employeeId, weekStart) ??
                    emailStatusError(notifyIndex, 'weekly_data_review', stored.employeeId, weekStart)
                  : null
                const weeklyId =
                  row.id != null && stored && isWeeklyRecordSelectable(stored) ? row.id : null
                return (
                  <Fragment key={`${row.employeeCode}-${weekStart}`}>
                  <tr>
                    {showApproval ? (
                      <td
                        className={`sticky left-0 z-[5] w-10 min-w-10 border border-[var(--color-warm-muted)] px-2 py-2 text-center ${stripBg}`}
                      >
                        {weeklyId != null ? (
                          <BulkSelectCheckbox
                            checked={bulk.isSelected(weeklyId)}
                            disabled={bulk.busy}
                            onChange={() => bulk.toggle(weeklyId)}
                            ariaLabel={`Select ${row.employeeName} for approval`}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    <td
                      className={`sticky ${showApproval ? 'left-10' : 'left-0'} z-[5] min-w-[12rem] border border-[var(--color-warm-muted)] px-3 py-2 ${stripBg}`}
                    >
                      <div className="font-medium text-[var(--color-ink)]">{row.employeeName || '-'}</div>
                      <div className="font-mono text-[0.7rem] text-[var(--color-warm-text)]">
                        {row.employeeCode || '-'}
                      </div>
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-ink)] ${stripBg}`}
                    >
                      {formatHoursHm(row.totalHours)}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${stripBg}`}
                    >
                      {formatHoursHm(row.requiredHours)}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums ${deficitClass}`}
                    >
                      {formatHoursHm(row.deficitHours)}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums ${
                        row.deduction > 0
                          ? 'bg-amber-50 font-semibold text-amber-900'
                          : `${stripBg} text-[var(--color-warm-text)]`
                      }`}
                    >
                      {formatInr(row.deduction)}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center ${stripBg}`}
                    >
                      {approvalBadge(row.status)}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center ${stripBg}`}
                    >
                      {emailBadge(emailStatus, emailErr)}
                    </td>
                  </tr>
                  </Fragment>
                )
                })
                return header ? [header, ...bodyRows] : bodyRows
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
    </>
  )
}
