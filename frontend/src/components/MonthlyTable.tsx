import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AttendanceFilter,
  CompanyHolidayDay,
  DailyAttendanceRecord,
  NormalizedEmployee,
  WeeklyAttendanceRecord,
} from '../types/attendance'
import {
  calendarWeeksForMonth,
  cellClass,
  countPresentDaysInCalendar,
  dailyRecordForEmployeeDay,
  decimalWorkedHoursToDurationHm,
  employeeDayStatusToken,
  isoDateYmd,
  leaveHoursForPeriod,
  matchesSearch,
  monthlyDayHoursDetail,
  monthlyHoursAndDeficitByCalendar,
  rowMatchesFilter,
  tableRowStripBg,
  weeklyHoursAndDeficitByCalendar,
} from '../utils/attendance'
import {
  collectGridMarkChanges,
  gridMarksDraft,
  isWeeklyRowEditable,
  saveEmployeeGridDayEdits,
} from '../utils/inlineAttendanceSave'
import { AttendanceColorLegend } from './AttendanceColorLegend'
import { BulkSelectCheckbox } from './BulkSelectCheckbox'
import { BulkWeekApprovalBar } from './BulkWeekApprovalBar'
import { EditableMarkSelect } from './EditableMarkSelect'
import { InlineEditActions } from './InlineEditActions'
import { LegendExpandPanel } from './LegendExpandPanel'
import { MonthlyDayCell } from './MonthlyDayCell'
import { downloadMatrixAsXlsx } from '../utils/downloadMatrixXlsx'
import { useBulkWeekApproval } from '../hooks/useBulkWeekApproval'
import { weeklyIdsForEmployeeWeekDays } from '../utils/weeklyApproval'
import { groupRowsByTeam, teamMetaFromEmployee } from '../utils/teamGroups'
import { confirmMonthlyBulkDecision } from '../utils/confirmAction'
import { computeMonthlyTeamPeriodSummary } from '../utils/teamPeriodSummary'
import { TeamPeriodSummarySection } from './TeamPeriodSummarySection'
import { TeamGroupHeader } from './TeamGroupHeader'

function fmtHours(n: number | null): string {
  if (n === null) return '-'
  return decimalWorkedHoursToDurationHm(n)
}

type Props = {
  employees: NormalizedEmployee[]
  search: string
  filter: AttendanceFilter
  reportYear: number
  reportMonth: number
  policyCompany?: string | null
  dailyRecords?: DailyAttendanceRecord[]
  weeklyRecords?: WeeklyAttendanceRecord[]
  onBulkWeeklyAction?: (ids: number[], status: 'approved' | 'rejected') => void | Promise<void>
  allowEdit?: boolean
  /** Monthly view is the only place HR approves attendance for payroll. */
  showBulkApproval?: boolean
  onSaved?: () => void | Promise<void>
  onSaveError?: (message: string) => void
  groupByTeam?: boolean
  showTeamSummary?: boolean
  companyHolidays?: CompanyHolidayDay[]
  simpleExcelExport?: boolean
}

export function MonthlyTable({
  employees,
  search,
  filter,
  reportYear,
  reportMonth,
  policyCompany,
  dailyRecords = [],
  weeklyRecords = [],
  onBulkWeeklyAction,
  allowEdit = true,
  showBulkApproval = true,
  onSaved,
  onSaveError,
  groupByTeam = true,
  showTeamSummary = false,
  companyHolidays = [],
  simpleExcelExport = false,
}: Props) {
  const showApproval = allowEdit && showBulkApproval
  const [dayHoursMode, setDayHoursMode] = useState<'compact' | 'inline'>('compact')
  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null)
  const [weekScope, setWeekScope] = useState<'all' | number>('all')
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [savingCode, setSavingCode] = useState<string | null>(null)
  const [draftMarks, setDraftMarks] = useState<Record<number, string> | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const calendarWeeks = useMemo(
    () => calendarWeeksForMonth(reportYear, reportMonth).filter((w) => w.length > 0),
    [reportYear, reportMonth],
  )

  const filterCalendarDays = useMemo((): number[] | undefined => {
    if (weekScope === 'all') return undefined
    return calendarWeeks[weekScope - 1] ?? undefined
  }, [weekScope, calendarWeeks])

  const rows = useMemo(() => {
    return employees.filter(
      (e) => matchesSearch(e, search) && rowMatchesFilter(e, filter, filterCalendarDays),
    )
  }, [employees, search, filter, filterCalendarDays])

  const groupedRows = useMemo(() => {
    if (!groupByTeam) {
      return [{ group: teamMetaFromEmployee({ teamId: null, teamName: '', teamSortOrder: 0 }), items: rows }]
    }
    return groupRowsByTeam(rows, (emp) => teamMetaFromEmployee(emp))
  }, [groupByTeam, rows])

  useEffect(() => {
    if (weekScope !== 'all' && (weekScope < 1 || weekScope > calendarWeeks.length)) {
      setWeekScope('all')
    }
  }, [calendarWeeks.length, weekScope])

  useEffect(() => {
    if (!expandedDayKey) return
    const close = () => setExpandedDayKey(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [expandedDayKey])

  const showHoursInline = dayHoursMode === 'inline'

  const visibleCalendarWeeks = useMemo(() => {
    if (weekScope === 'all') return calendarWeeks
    const idx = weekScope - 1
    const block = calendarWeeks[idx]
    return block && block.length > 0 ? [block] : calendarWeeks
  }, [calendarWeeks, weekScope])

  /** Original week index (1-based) for each block in `visibleCalendarWeeks` (for labels / API week number). */
  const visibleWeekNumbers = useMemo(() => {
    if (weekScope === 'all') {
      return calendarWeeks.map((_, i) => i + 1)
    }
    return [weekScope]
  }, [calendarWeeks, weekScope])

  const monthDays = useMemo(
    () => calendarWeeks.flat(),
    [calendarWeeks],
  )
  const weekBlockCols = useMemo(
    () => visibleCalendarWeeks.reduce((sum, days) => sum + 1 + days.length + 4, 0),
    [visibleCalendarWeeks],
  )
  const MONTH_SUMMARY_COLS = 5
  const colCount = (showApproval ? 1 : 0) + 2 + weekBlockCols + MONTH_SUMMARY_COLS + (allowEdit ? 1 : 0)
  const monthShort = useMemo(
    () => new Date(reportYear, reportMonth - 1, 1).toLocaleString(undefined, { month: 'short' }),
    [reportYear, reportMonth],
  )

  const visibleDayNumbers = useMemo(
    () => visibleCalendarWeeks.flat(),
    [visibleCalendarWeeks],
  )

  const weeklyIdsByCode = useMemo(() => {
    const map = new Map<string, number[]>()
    for (const emp of rows) {
      map.set(
        emp.employeeCode,
        weeklyIdsForEmployeeWeekDays(
          weeklyRecords,
          emp.employeeCode,
          visibleCalendarWeeks,
          reportYear,
          reportMonth,
        ),
      )
    }
    return map
  }, [rows, weeklyRecords, visibleCalendarWeeks, reportYear, reportMonth])

  const selectableIds = useMemo(() => {
    if (!showApproval) return []
    const ids = new Set<number>()
    for (const group of weeklyIdsByCode.values()) {
      for (const id of group) ids.add(id)
    }
    return [...ids]
  }, [weeklyIdsByCode, showApproval])

  const selectableEmployeeCount = useMemo(() => {
    let n = 0
    for (const ids of weeklyIdsByCode.values()) {
      if (ids.length > 0) n += 1
    }
    return n
  }, [weeklyIdsByCode])

  const bulk = useBulkWeekApproval(selectableIds)

  const bulkSelectedSummary = useMemo(() => {
    if (bulk.selectedCount === 0) return '0 selected'
    const selected = new Set(bulk.selectedIds)
    let employees = 0
    for (const ids of weeklyIdsByCode.values()) {
      if (ids.some((id) => selected.has(id))) employees += 1
    }
    if (employees === 0) return `${bulk.selectedCount} selected`
    return `${employees} employee${employees === 1 ? '' : 's'} for monthly approval`
  }, [bulk.selectedCount, bulk.selectedIds, weeklyIdsByCode])

  const runBulkAction = async (status: 'approved' | 'rejected') => {
    if (!onBulkWeeklyAction || bulk.selectedIds.length === 0) return
    const selected = new Set(bulk.selectedIds)
    let employees = 0
    for (const ids of weeklyIdsByCode.values()) {
      if (ids.some((id) => selected.has(id))) employees += 1
    }
    if (!(await confirmMonthlyBulkDecision(Math.max(employees, 1), status))) return
    bulk.setBusy(true)
    try {
      await onBulkWeeklyAction(bulk.selectedIds, status)
      bulk.clear()
    } finally {
      bulk.setBusy(false)
    }
  }

  const canEditEmployee = useCallback(
    (emp: NormalizedEmployee) => {
      if (!allowEdit) return false
      if (dailyRecords.length === 0) return false
      const weeks = calendarWeeksForMonth(reportYear, reportMonth)
      const affectedWeekIdxs = new Set<number>()
      for (const day of visibleDayNumbers) {
        const idx = weeks.findIndex((days) => days.includes(day))
        if (idx >= 0) affectedWeekIdxs.add(idx)
      }
      for (const weekIdx of affectedWeekIdxs) {
        const weekDays = weeks[weekIdx] ?? []
        if (weekDays.length === 0) continue
        const weekStart = isoDateYmd(reportYear, reportMonth, weekDays[0])
        const rec = weeklyRecords.find(
          (w) =>
            w.employeeCode === emp.employeeCode &&
            w.weekStart.slice(0, 10) === weekStart,
        )
        if (rec && !isWeeklyRowEditable(rec)) return false
      }
      return true
    },
    [allowEdit, dailyRecords.length, reportYear, reportMonth, visibleDayNumbers, weeklyRecords],
  )

  const startEdit = (emp: NormalizedEmployee) => {
    setSaveError(null)
    setEditingCode(emp.employeeCode)
    setDraftMarks(gridMarksDraft(emp, visibleDayNumbers, reportYear, reportMonth))
  }

  const cancelEdit = () => {
    setEditingCode(null)
    setDraftMarks(null)
    setSaveError(null)
  }

  const saveEdit = async (emp: NormalizedEmployee) => {
    if (!draftMarks) return
    const original = gridMarksDraft(emp, visibleDayNumbers, reportYear, reportMonth)
    const edits = collectGridMarkChanges(original, draftMarks, visibleDayNumbers)
    if (edits.length === 0) {
      cancelEdit()
      return
    }
    setSavingCode(emp.employeeCode)
    setSaveError(null)
    try {
      await saveEmployeeGridDayEdits({
        emp,
        edits,
        allDayNumbers: visibleDayNumbers,
        reportYear,
        reportMonth,
        dailyRecords,
        weeklyRecords,
        policyCompany,
      })
      setEditingCode(null)
      setDraftMarks(null)
      await onSaved?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save changes'
      setSaveError(msg)
      onSaveError?.(msg)
    } finally {
      setSavingCode(null)
    }
  }

  const downloadMonthlyExcel = (mode: 'with_time' | 'without_time') => {
    if (rows.length === 0) return
    const headers: string[] = ['EmpCode', 'EmpName']
    visibleCalendarWeeks.forEach((weekDays, blockIdx) => {
      const wn = visibleWeekNumbers[blockIdx] ?? blockIdx + 1
      headers.push(`Late (W${wn})`)
      for (const day of weekDays) headers.push(`${day} ${monthShort}`)
      headers.push('Total working hours')
      headers.push(`Week ${wn} expected`)
      headers.push(`Week ${wn} deficit`)
      headers.push(`Week ${wn} leave hrs`)
    })
    headers.push(
      'Total working hours',
      'Monthly expected',
      'Monthly deficit',
      'Monthly leave hrs',
      'Present days',
    )
    const dataRows: string[][] = []
    for (const emp of rows) {
      const monthLeaveHours = leaveHoursForPeriod(emp, monthDays)
        const monthScoped = monthlyHoursAndDeficitByCalendar(
          emp,
          reportYear,
          reportMonth,
          policyCompany,
          weeklyRecords,
          companyHolidays,
        )
      const row: string[] = [emp.employeeCode || '', emp.employeeName]
      for (let blockIdx = 0; blockIdx < visibleCalendarWeeks.length; blockIdx++) {
        const weekDays = visibleCalendarWeeks[blockIdx]!
        const wn = visibleWeekNumbers[blockIdx] ?? blockIdx + 1
        const weekLateCount = weekDays.reduce((n, day) => {
          const idx = day - 1
          return n + (emp.dayLateFlags[idx] ? 1 : 0)
        }, 0)
        const scoped = weeklyHoursAndDeficitByCalendar(
          emp,
          reportYear,
          reportMonth,
          wn,
          policyCompany,
          weeklyRecords,
          companyHolidays,
        )
        const leaveHours = leaveHoursForPeriod(emp, weekDays)
        row.push(String(weekLateCount))
        for (const day of weekDays) {
          const i = day - 1
          const isSunday = new Date(reportYear, reportMonth - 1, day).getDay() === 0
          if (isSunday) {
            row.push('Sun')
            continue
          }
          const dailyRow = dailyRecordForEmployeeDay(
            dailyRecords,
            emp.employeeCode,
            reportYear,
            reportMonth,
            day,
          )
          const detail = monthlyDayHoursDetail(emp, i, dailyRow)
          row.push(mode === 'with_time' ? detail.withHoursLabel : detail.compactMark)
        }
        row.push(fmtHours(scoped.hours))
        row.push(fmtHours(scoped.expectedTarget))
        row.push(fmtHours(scoped.deficit))
        row.push(fmtHours(leaveHours))
      }
      row.push(fmtHours(monthScoped.hours))
      row.push(fmtHours(monthScoped.expectedTarget))
      row.push(fmtHours(monthScoped.deficit))
      row.push(fmtHours(monthLeaveHours))
      row.push(
        String(
          countPresentDaysInCalendar(
            emp,
            monthDays,
            dailyRecords,
            reportYear,
            reportMonth,
          ),
        ),
      )
      dataRows.push(row)
    }
    const ym = `${reportYear}-${String(reportMonth).padStart(2, '0')}`
    const weekSuffix = weekScope === 'all' ? '' : `-week-${weekScope}`
    downloadMatrixAsXlsx(
      `monthly-${ym}${weekSuffix}-${mode === 'with_time' ? 'with-time' : 'without-time'}.xlsx`,
      'Monthly',
      headers,
      dataRows,
    )
  }

  const thHead =
    'border border-[var(--color-warm-muted)] bg-[color-mix(in_srgb,var(--color-brand-muted)_78%,#fff)] px-2 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-warm-text)] sm:text-xs'

  const teamPeriodSummary = useMemo(() => {
    if (!showTeamSummary || !groupByTeam || rows.length === 0) return null
    const monthLabel = new Date(reportYear, reportMonth - 1, 1).toLocaleString(undefined, {
      month: 'long',
      year: 'numeric',
    })
    return computeMonthlyTeamPeriodSummary({
      employees: rows,
      reportYear,
      reportMonth,
      monthDays,
      policyCompany,
      weeklyRecords,
      monthLabel,
      companyHolidays,
    })
  }, [
    showTeamSummary,
    groupByTeam,
    rows,
    reportYear,
    reportMonth,
    monthDays,
    policyCompany,
    weeklyRecords,
    companyHolidays,
  ])

  return (
    <>
      {teamPeriodSummary ? (
        <TeamPeriodSummarySection kicker="Team totals" summary={teamPeriodSummary} />
      ) : null}
    <section className="card overflow-hidden">
      <div className="card-head">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-brand)]">
              Totals
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--color-ink)]">Monthly</h2>
            <LegendExpandPanel>
              <AttendanceColorLegend variant="grid" />
            </LegendExpandPanel>
            {saveError ? <p className="mt-3 text-sm text-red-700">{saveError}</p> : null}
            {showApproval ? (
              <>
                <p className="mt-3 max-w-2xl text-xs leading-relaxed text-[color-mix(in_srgb,var(--color-warm-text)_88%,transparent)]">
                  Review and edit daily marks here, then select employees and approve monthly attendance for
                  payroll. Daily and weekly tabs are view/edit only.
                </p>
              <BulkWeekApprovalBar
                selectableCount={selectableEmployeeCount}
                countLabel="employees"
                selectedCount={bulk.selectedCount}
                selectedSummary={bulkSelectedSummary}
                allSelected={bulk.allSelected}
                someSelected={bulk.someSelected}
                busy={bulk.busy}
                onToggleAll={bulk.toggleAll}
                onApprove={() => void runBulkAction('approved')}
                onReject={() => void runBulkAction('rejected')}
                variant="monthly"
              />
              </>
            ) : null}
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:ml-auto sm:items-end">
            <div className="flex flex-wrap items-start justify-end gap-2">
              <label className="text-sm text-[var(--color-warm-text)]">
                <span className="mr-2 text-xs font-medium">Day hours</span>
                <select
                  value={dayHoursMode}
                  onChange={(e) => {
                    setDayHoursMode(e.target.value as 'compact' | 'inline')
                    setExpandedDayKey(null)
                  }}
                  className="field field-compact"
                >
                  <option value="compact">Click day to see hours</option>
                  <option value="inline">Show P(08:18) in cells</option>
                </select>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {simpleExcelExport ? (
                  <button
                    type="button"
                    onClick={() => downloadMonthlyExcel('without_time')}
                    disabled={rows.length === 0}
                    className="btn-primary"
                  >
                    Download Excel
                  </button>
                ) : (
                  <>
                    <span className="text-xs font-medium text-[var(--color-warm-text)]">Download</span>
                    <button
                      type="button"
                      onClick={() => downloadMonthlyExcel('without_time')}
                      disabled={rows.length === 0}
                      className="btn-secondary"
                    >
                      Without time
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadMonthlyExcel('with_time')}
                      disabled={rows.length === 0}
                      className="btn-primary"
                    >
                      With time
                    </button>
                  </>
                )}
              </div>
            </div>
            <label className="flex flex-wrap items-center justify-end gap-2 text-sm text-[var(--color-warm-text)]">
              <span className="text-xs font-medium text-[color-mix(in_srgb,var(--color-ink)_50%,transparent)]">
                View by week
              </span>
              <select
                value={weekScope === 'all' ? 'all' : String(weekScope)}
                onChange={(e) => {
                  const v = e.target.value
                  setWeekScope(v === 'all' ? 'all' : Number(v))
                }}
                className="field field-compact"
              >
                <option value="all">All weeks</option>
                {calendarWeeks.map((_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    Week {i + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="min-w-max w-full border-collapse text-left text-xs sm:text-sm">
          <thead className="sticky top-0 z-10 shadow-[0_1px_0_0_color-mix(in_srgb,var(--color-brand)_12%,var(--color-warm-muted))]">
            <tr>
              {showApproval ? (
                <th className={`sticky left-0 z-20 w-10 min-w-10 whitespace-nowrap px-2 text-center ${thHead}`}>
                  <BulkSelectCheckbox
                    checked={bulk.allSelected}
                    indeterminate={bulk.someSelected}
                    disabled={bulk.busy || selectableIds.length === 0}
                    onChange={bulk.toggleAll}
                    ariaLabel="Select all employees for monthly approval"
                  />
                </th>
              ) : null}
              <th
                className={`sticky ${showApproval ? 'left-10' : 'left-0'} z-20 w-24 min-w-24 whitespace-nowrap px-3 text-left ${thHead}`}
              >
                EmpCode
              </th>
              <th
                className={`sticky ${showApproval ? 'left-[7.5rem]' : 'left-24'} z-20 min-w-[10rem] whitespace-nowrap px-3 text-left ${thHead}`}
              >
                EmpName
              </th>
              {visibleCalendarWeeks.map((weekDays, blockIdx) => {
                const wn = visibleWeekNumbers[blockIdx] ?? blockIdx + 1
                return (
                  <Fragment key={`w${wn}-block-head`}>
                    <th className={`whitespace-nowrap text-center ${thHead}`}>
                      {`Late (W${wn})`}
                    </th>
                    {weekDays.map((day) => (
                      <th key={`w${wn}-d${day}`} className={`whitespace-nowrap text-center ${thHead}`}>
                        {`${day} ${monthShort}`}
                      </th>
                    ))}
                    <th className={`whitespace-nowrap text-center ${thHead}`}>Total working hours</th>
                    <th className={`whitespace-nowrap text-center ${thHead}`}>
                      {`Week ${wn} expected`}
                    </th>
                    <th className={`whitespace-nowrap text-center ${thHead}`}>
                      {`Week ${wn} deficit`}
                    </th>
                    <th className={`whitespace-nowrap text-center ${thHead}`}>
                      {`Week ${wn} leave hrs`}
                    </th>
                  </Fragment>
                )
              })}
              <th className={`whitespace-nowrap text-center ${thHead}`}>Total working hours</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Monthly expected</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Monthly deficit</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Monthly leave hrs</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Present days</th>
              {allowEdit ? (
                <th className={`whitespace-nowrap text-center ${thHead}`}>Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="border border-[var(--color-warm-muted)] px-4 py-8 text-center text-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]"
                >
                  No rows match your search or filter.
                </td>
              </tr>
            ) : (
              groupedRows.flatMap((section) => {
                const header =
                  groupByTeam ? (
                    <TeamGroupHeader
                      key={`team-header-${section.group.teamId ?? 'unassigned'}`}
                      group={section.group}
                      memberCount={section.items.length}
                      colSpan={colCount}
                    />
                  ) : null
                const bodyRows = section.items.map((emp, rowIndex) => {
                const stripBg = tableRowStripBg(rowIndex)
                const monthLeaveHours = leaveHoursForPeriod(emp, monthDays)
        const monthScoped = monthlyHoursAndDeficitByCalendar(
          emp,
          reportYear,
          reportMonth,
          policyCompany,
          weeklyRecords,
          companyHolidays,
        )
                const isEditing = editingCode === emp.employeeCode
                const isSaving = savingCode === emp.employeeCode
                const canEdit = canEditEmployee(emp)
                const rowWeeklyIds = weeklyIdsByCode.get(emp.employeeCode) ?? []
                const rowSelectState = bulk.rowState(rowWeeklyIds)
                return (
                  <tr
                    key={`month-${emp.id ?? emp.employeeCode}-${rowIndex}`}
                    className="bg-[var(--color-surface)] even:bg-[color-mix(in_srgb,var(--color-warm-page)_45%,#fff)]"
                  >
                    {showApproval ? (
                      <td className="sticky left-0 z-[1] w-10 min-w-10 border border-[var(--color-warm-muted)] bg-inherit px-2 py-2 text-center">
                        {rowSelectState !== 'none' ? (
                          <BulkSelectCheckbox
                            checked={rowSelectState === 'checked'}
                            indeterminate={rowSelectState === 'indeterminate'}
                            disabled={bulk.busy}
                            onChange={() => {
                              bulk.toggleMany(rowWeeklyIds, rowSelectState !== 'checked')
                            }}
                            ariaLabel={`Select ${emp.employeeName} for monthly approval`}
                          />
                        ) : null}
                      </td>
                    ) : null}
                    <td className={`sticky ${showApproval ? 'left-10' : 'left-0'} z-[1] w-24 min-w-24 whitespace-nowrap border border-[var(--color-warm-muted)] bg-inherit px-3 py-2 font-mono text-[var(--color-ink)]`}>
                      {emp.employeeCode || '-'}
                    </td>
                    <td className={`sticky ${showApproval ? 'left-[7.5rem]' : 'left-24'} z-[1] min-w-[10rem] max-w-[min(200px,40vw)] whitespace-nowrap border border-[var(--color-warm-muted)] bg-inherit px-3 py-2 font-medium text-[var(--color-ink)] sm:max-w-none`}>
                      {emp.employeeName}
                    </td>
                    {visibleCalendarWeeks.map((weekDays, blockIdx) => {
                      const wn = visibleWeekNumbers[blockIdx] ?? blockIdx + 1
                      const weekLateCount = weekDays.reduce((n, day) => {
                        const idx = day - 1
                        return n + (emp.dayLateFlags[idx] ? 1 : 0)
                      }, 0)
                      const scoped = weeklyHoursAndDeficitByCalendar(
                        emp,
                        reportYear,
                        reportMonth,
                        wn,
                        policyCompany,
                        weeklyRecords,
                      )
                      const leaveHours = leaveHoursForPeriod(emp, weekDays)
                      const weekHours = scoped.hours
                      const weekExpected = scoped.expectedTarget
                      const weekDeficit = scoped.deficit
                      return (
                        <Fragment key={`w${wn}-block-${emp.employeeCode}-${emp.employeeName}`}>
                          <td
                            className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center text-xs font-semibold ${
                              weekLateCount > 0 ? 'bg-amber-100 text-amber-900' : 'text-emerald-700'
                            }`}
                          >
                            {weekLateCount}
                          </td>
                          {weekDays.map((day) => {
                            const i = day - 1
                            const dailyRow = dailyRecordForEmployeeDay(
                              dailyRecords,
                              emp.employeeCode,
                              reportYear,
                              reportMonth,
                              day,
                            )
                            const cell = employeeDayStatusToken(emp, i, dailyRow)
                            const late = Boolean(emp.dayLateFlags[i])
                            const isSunday = new Date(reportYear, reportMonth - 1, day).getDay() === 0
                            const detail = monthlyDayHoursDetail(emp, i, dailyRow)
                            const dayKey = `${emp.employeeCode}-${day}`
                            return (
                              <td
                                key={`w${wn}-d${day}-${emp.employeeCode}-${emp.employeeName}`}
                                className={`border border-[var(--color-warm-muted)] px-1.5 py-1.5 text-center text-[11px] sm:text-xs ${
                                  isEditing
                                    ? stripBg
                                    : cellClass(isSunday ? '' : cell, undefined, isSunday ? false : Boolean(emp.dayWfhUnverified[i]))
                                } ${late && !isEditing ? 'ring-2 ring-amber-400 ring-inset' : ''}`}
                              >
                                {isEditing && draftMarks && !isSunday ? (
                                  <EditableMarkSelect
                                    value={draftMarks[day] ?? ''}
                                    onChange={(mark) =>
                                      setDraftMarks({ ...draftMarks, [day]: mark })
                                    }
                                    ariaLabel={`Mark ${day} for ${emp.employeeName}`}
                                  />
                                ) : (
                                  <MonthlyDayCell
                                    detail={detail}
                                    isSunday={isSunday}
                                    showHoursInline={showHoursInline}
                                    expanded={expandedDayKey === dayKey}
                                    hasHours={detail.hoursLabel != null}
                                    onToggle={() => {
                                      setExpandedDayKey((prev) => (prev === dayKey ? null : dayKey))
                                    }}
                                  />
                                )}
                              </td>
                            )
                          })}
                          <td className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${stripBg}`}>
                            {weekHours == null
                              ? '-'
                              : decimalWorkedHoursToDurationHm(weekHours)}
                          </td>
                          <td className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${stripBg}`}>
                            {weekExpected == null
                              ? '-'
                              : decimalWorkedHoursToDurationHm(weekExpected)}
                          </td>
                          <td className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[color-mix(in_srgb,var(--color-brand)_38%,#000)] ${stripBg}`}>
                            {weekDeficit == null
                              ? '-'
                              : decimalWorkedHoursToDurationHm(weekDeficit)}
                          </td>
                          <td className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${stripBg}`}>
                            {leaveHours == null ? '-' : decimalWorkedHoursToDurationHm(leaveHours)}
                          </td>
                        </Fragment>
                      )
                    })}
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${stripBg}`}
                    >
                      {monthScoped.hours == null
                        ? '-'
                        : decimalWorkedHoursToDurationHm(monthScoped.hours)}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${stripBg}`}
                    >
                      {monthScoped.expectedTarget == null
                        ? '-'
                        : decimalWorkedHoursToDurationHm(monthScoped.expectedTarget)}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[color-mix(in_srgb,var(--color-brand)_38%,#000)] ${stripBg}`}
                    >
                      {monthScoped.deficit == null
                        ? '-'
                        : decimalWorkedHoursToDurationHm(monthScoped.deficit)}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${stripBg}`}
                    >
                      {monthLeaveHours == null ? '-' : decimalWorkedHoursToDurationHm(monthLeaveHours)}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums font-semibold text-[var(--color-ink)] ${stripBg}`}
                    >
                      {countPresentDaysInCalendar(
                        emp,
                        monthDays,
                        dailyRecords,
                        reportYear,
                        reportMonth,
                      )}
                    </td>
                    {allowEdit ? (
                      <td className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center ${stripBg}`}>
                        <InlineEditActions
                          editing={isEditing}
                          saving={isSaving}
                          disabled={!canEdit}
                          onEdit={() => startEdit(emp)}
                          onCancel={cancelEdit}
                          onSave={() => void saveEdit(emp)}
                        />
                      </td>
                    ) : null}
                  </tr>
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
