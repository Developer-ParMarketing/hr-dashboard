import { useCallback, useEffect, useMemo, useState } from 'react'
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
  dailyRecordForEmployeeDay,
  decimalWorkedHoursToDurationHm,
  formatWeeklyDayCellLabel,
  isPresentToken,
  leaveHoursForPeriod,
  matchesSearch,
  plainDayDisplayMark,
  rowMatchesFilter,
  tableRowStripBg,
  weekIndexForIsoDate,
  weeklyHoursAndDeficitByCalendar,
  weeklyRecordForWeekStart,
  employeeDayStatusToken,
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
import { WeekScopedSummaryCells, WeekScopedSummaryHeaders } from './HoursSummary'
import { downloadMatrixAsXlsx } from '../utils/downloadMatrixXlsx'
import { useBulkWeekApproval } from '../hooks/useBulkWeekApproval'
import { isWeeklyRecordSelectable } from '../utils/weeklyApproval'
import { groupRowsByTeam, teamMetaFromEmployee } from '../utils/teamGroups'
import { confirmWeeklyBulkDecision } from '../utils/confirmAction'
import { TeamGroupHeader } from './TeamGroupHeader'

function fmtHours(n: number | null): string {
  if (n === null) return '-'
  return decimalWorkedHoursToDurationHm(n)
}

function lateCountInWeek(emp: NormalizedEmployee, dayNumbers: number[]): number {
  let n = 0
  for (const day of dayNumbers) {
    const idx = day - 1
    if (idx >= 0 && idx < emp.dayLateFlags.length && emp.dayLateFlags[idx]) n += 1
  }
  return n
}

type Props = {
  employees: NormalizedEmployee[]
  search: string
  filter: AttendanceFilter
  reportYear: number
  reportMonth: number
  hoursRollupPresent: boolean
  policyCompany?: string | null
  weeklyRecords?: WeeklyAttendanceRecord[]
  dailyRecords?: DailyAttendanceRecord[]
  companyHolidays?: CompanyHolidayDay[]
  onBulkWeeklyAction?: (ids: number[], status: 'approved' | 'rejected') => void | Promise<void>
  allowEdit?: boolean
  showBulkApproval?: boolean
  onSaved?: () => void | Promise<void>
  onSaveError?: (message: string) => void
  groupByTeam?: boolean
  pinnedWeekStart?: string | null
  lockWeekPicker?: boolean
  simpleExcelExport?: boolean
}

export function WeeklyTable({
  employees,
  search,
  filter,
  reportYear,
  reportMonth,
  hoursRollupPresent,
  policyCompany,
  weeklyRecords = [],
  dailyRecords = [],
  companyHolidays = [],
  onBulkWeeklyAction,
  allowEdit = true,
  showBulkApproval = false,
  onSaved,
  onSaveError,
  groupByTeam = true,
  pinnedWeekStart = null,
  lockWeekPicker = false,
  simpleExcelExport = false,
}: Props) {
  const showApproval = allowEdit && showBulkApproval
  const [sortDesc, setSortDesc] = useState(true)
  const [weekNo, setWeekNo] = useState(1)
  const [tokenView, setTokenView] = useState<'with_time' | 'without_time'>('without_time')
  const [downloadMode, setDownloadMode] = useState<'with_time' | 'without_time'>('without_time')
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [savingCode, setSavingCode] = useState<string | null>(null)
  const [draftMarks, setDraftMarks] = useState<Record<number, string> | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!pinnedWeekStart) return
    setWeekNo(weekIndexForIsoDate(reportYear, reportMonth, pinnedWeekStart))
  }, [pinnedWeekStart, reportYear, reportMonth])

  const thHead =
    'border border-[var(--color-warm-muted)] bg-[color-mix(in_srgb,var(--color-brand-muted)_78%,#fff)] px-2 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-warm-text)] sm:text-xs'
  const monthShort = useMemo(
    () => new Date(reportYear, reportMonth - 1, 1).toLocaleString(undefined, { month: 'short' }),
    [reportYear, reportMonth],
  )
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

  /** Same numeric basis as the "Total working hours" column for the selected week. */
  const weekTotalHours = useCallback(
    (emp: NormalizedEmployee): number | null =>
      weeklyHoursAndDeficitByCalendar(
        emp,
        reportYear,
        reportMonth,
        activeWeekNo,
        policyCompany,
        weeklyRecords,
        companyHolidays,
      ).hours,
    [reportYear, reportMonth, activeWeekNo, policyCompany, weeklyRecords, companyHolidays],
  )

  const rows = useMemo(() => {
    const filtered = employees.filter(
      (e) => matchesSearch(e, search) && rowMatchesFilter(e, filter, activeWeekDays),
    )
    const sorted = [...filtered].sort((a, b) => {
      const ha = weekTotalHours(a)
      const hb = weekTotalHours(b)
      const rank = (h: number | null, highFirst: boolean) =>
        h == null ? (highFirst ? -Infinity : Infinity) : h
      const ta = rank(ha, sortDesc)
      const tb = rank(hb, sortDesc)
      return sortDesc ? tb - ta : ta - tb
    })
    return sorted
  }, [employees, search, filter, sortDesc, weekTotalHours, activeWeekDays])

  const groupedRows = useMemo(() => {
    if (!groupByTeam) {
      return [{ group: teamMetaFromEmployee({ teamId: null, teamName: '', teamSortOrder: 0 }), items: rows }]
    }
    return groupRowsByTeam(rows, (emp) => teamMetaFromEmployee(emp))
  }, [groupByTeam, rows])

  const activeWeekStart =
    activeWeekDays.length > 0
      ? `${reportYear}-${String(reportMonth).padStart(2, '0')}-${String(activeWeekDays[0]).padStart(2, '0')}`
      : ''

  const weeklyIdByCode = useMemo(() => {
    const map = new Map<string, number | null>()
    if (!showApproval) {
      for (const emp of rows) map.set(emp.employeeCode, null)
      return map
    }
    for (const emp of rows) {
      const rec = weeklyRecordForWeekStart(weeklyRecords, emp.employeeCode, activeWeekStart)
      map.set(emp.employeeCode, rec && isWeeklyRecordSelectable(rec) ? rec.id : null)
    }
    return map
  }, [rows, weeklyRecords, activeWeekStart, showApproval])

  const selectableIds = useMemo(
    () => [...weeklyIdByCode.values()].filter((id): id is number => id != null),
    [weeklyIdByCode],
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

  const WEEK_SCOPED_SUMMARY_COL_COUNT = 4
  const colCount =
    (showApproval ? 1 : 0) + 3 + activeWeekDays.length + WEEK_SCOPED_SUMMARY_COL_COUNT + (allowEdit ? 1 : 0)

  const canEditEmployeeWeek = useCallback(
    (emp: NormalizedEmployee) => {
      if (!allowEdit) return false
      if (dailyRecords.length === 0) return false
      const rec = weeklyRecords.find(
        (w) => w.employeeCode === emp.employeeCode && w.weekStart.slice(0, 10) === activeWeekStart,
      )
      return isWeeklyRowEditable(rec)
    },
    [allowEdit, dailyRecords.length, weeklyRecords, activeWeekStart],
  )

  const startEdit = (emp: NormalizedEmployee) => {
    setSaveError(null)
    setEditingCode(emp.employeeCode)
    setDraftMarks(gridMarksDraft(emp, activeWeekDays, reportYear, reportMonth))
  }

  const cancelEdit = () => {
    setEditingCode(null)
    setDraftMarks(null)
    setSaveError(null)
  }

  const saveEdit = async (emp: NormalizedEmployee) => {
    if (!draftMarks) return
    const original = gridMarksDraft(emp, activeWeekDays, reportYear, reportMonth)
    const edits = collectGridMarkChanges(original, draftMarks, activeWeekDays)
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
        allDayNumbers: activeWeekDays,
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
  const downloadWeeklyExcel = (mode: 'with_time' | 'without_time') => {
    if (rows.length === 0) return
    const headers = [
      'EmpCode',
      'EmpName',
      `Late (W${activeWeekNo})`,
      ...activeWeekDays.map((day) => `${day} ${monthShort}`),
      'Total working hours',
      `Week ${activeWeekNo} expected`,
      `Week ${activeWeekNo} deficit`,
      `Week ${activeWeekNo} leave hrs`,
    ]
    const dataRows: string[][] = []
    for (const emp of rows) {
      const lateCount = lateCountInWeek(emp, activeWeekDays)
      const dayCells = activeWeekDays.map((day) => {
        const dayIdx = day - 1
        const token = emp.days[dayIdx] ?? ''
        const isSunday = new Date(reportYear, reportMonth - 1, day).getDay() === 0
        if (!token.trim()) return isSunday ? 'Sun' : '-'
        if (mode === 'with_time') return formatWeeklyDayCellLabel(emp, dayIdx)
        if (isPresentToken(token)) return 'P'
        if (token.toUpperCase().startsWith('WFH')) return 'WFH'
        return token
      })
      const scoped = weeklyHoursAndDeficitByCalendar(
        emp,
        reportYear,
        reportMonth,
        activeWeekNo,
        policyCompany,
        weeklyRecords,
        companyHolidays,
      )
      const leaveHours = leaveHoursForPeriod(emp, activeWeekDays)
      dataRows.push([
        emp.employeeCode || '',
        emp.employeeName,
        String(lateCount),
        ...dayCells,
        fmtHours(scoped.hours),
        fmtHours(scoped.expectedTarget),
        fmtHours(scoped.deficit),
        fmtHours(leaveHours),
      ])
    }
    downloadMatrixAsXlsx(
      `weekly-week-${activeWeekNo}-${mode === 'with_time' ? 'with-time' : 'without-time'}.xlsx`,
      `Week ${activeWeekNo}`,
      headers,
      dataRows,
    )
  }

  return (
    <section className="card overflow-hidden">
      <div className="card-head flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-brand)]">
            Grid
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--color-ink)]">Weekly</h2>
          <p className="mt-1 text-sm text-[color-mix(in_srgb,var(--color-warm-text)_88%,transparent)]">
            Hours completed and deficit per week, same columns as monthly
          </p>
          <LegendExpandPanel>
            <AttendanceColorLegend variant="grid" />
            {!hoursRollupPresent && employees.length > 0 && (
              <p className="mt-4 max-w-3xl border-t border-[color-mix(in_srgb,var(--color-warm-muted)_70%,transparent)] pt-4 text-xs leading-relaxed text-[color-mix(in_srgb,var(--color-warm-text)_88%,transparent)]">
                Those totals come from the Excel row. If everything shows -, your{' '}
                <strong className="font-medium text-[var(--color-ink)]">weekly</strong> PDF export likely
                has no <code className="rounded bg-black/[0.04] px-1">week*_hours</code> /{' '}
                <code className="rounded bg-black/[0.04] px-1">total_hours</code> columns. Process the{' '}
                <strong className="font-medium text-[var(--color-ink)]">monthly</strong> ESSL (or full
                sheet) to populate them.
              </p>
            )}
          </LegendExpandPanel>
          {saveError ? <p className="mt-3 text-sm text-red-700">{saveError}</p> : null}
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
        </div>
        <div className="ml-auto flex flex-wrap items-start justify-end gap-2 text-right">
          {lockWeekPicker ? (
            <p className="text-sm text-[var(--color-warm-text)]">
              Week {activeWeekNo}
              {activeWeekStart && activeWeekDays.length > 0
                ? ` · ${activeWeekStart} to ${reportYear}-${String(reportMonth).padStart(2, '0')}-${String(activeWeekDays[activeWeekDays.length - 1]).padStart(2, '0')}`
                : ''}
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
            onClick={() => setSortDesc((s) => !s)}
            className="btn-secondary self-start"
          >
            Sort: {sortDesc ? 'high hours first' : 'low hours first'}
          </button>
          <label className="text-sm text-[var(--color-warm-text)]">
            <span className="mr-2 text-xs font-medium">Token view</span>
            <select
              value={tokenView}
              onChange={(e) =>
                setTokenView(e.target.value as 'with_time' | 'without_time')
              }
              className="field field-compact"
            >
              <option value="without_time">Without time</option>
              <option value="with_time">With time</option>
            </select>
          </label>
          <div className="flex flex-col items-end gap-2">
            {simpleExcelExport ? (
              <button
                type="button"
                onClick={() => downloadWeeklyExcel('without_time')}
                className="btn-primary"
              >
                Download Excel
              </button>
            ) : (
              <>
                <label className="text-sm text-[var(--color-warm-text)]">
                  <span className="mr-2 text-xs font-medium">Download mode</span>
                  <select
                    value={downloadMode}
                    onChange={(e) =>
                      setDownloadMode(e.target.value as 'with_time' | 'without_time')
                    }
                    className="field field-compact"
                  >
                    <option value="without_time">Without time</option>
                    <option value="with_time">With time</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => downloadWeeklyExcel(downloadMode)}
                  className="btn-primary"
                >
                  Download Weekly Excel
                </button>
              </>
            )}
          </div>
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
              <th className={`sticky ${showApproval ? 'left-10' : 'left-0'} z-20 w-24 min-w-24 whitespace-nowrap px-3 py-3 text-left ${thHead}`}>
                EmpCode
              </th>
              <th
                className={`sticky ${showApproval ? 'left-[7.5rem]' : 'left-24'} z-20 min-w-[10rem] whitespace-nowrap px-3 py-3 text-left ${thHead}`}
              >
                EmpName
              </th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>
                Late (W{activeWeekNo})
              </th>
              {activeWeekDays.map((day) => {
                return (
                  <th key={`d${day}`} className={`whitespace-nowrap text-center ${thHead}`}>
                    {`${day} ${monthShort}`}
                  </th>
                )
              })}
              <WeekScopedSummaryHeaders weekNo={activeWeekNo} thHead={thHead} />
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
                const weekLateCount = lateCountInWeek(emp, activeWeekDays)
                const isEditing = editingCode === emp.employeeCode
                const isSaving = savingCode === emp.employeeCode
                const canEdit = canEditEmployeeWeek(emp)
                const weeklyId = weeklyIdByCode.get(emp.employeeCode) ?? null
                return (
                <tr
                  key={`${emp.employeeCode}-${emp.employeeName}-weekly`}
                  className="bg-[var(--color-surface)] even:bg-[color-mix(in_srgb,var(--color-warm-page)_45%,#fff)]"
                >
                  {showApproval ? (
                    <td className="sticky left-0 z-[1] w-10 min-w-10 border border-[var(--color-warm-muted)] bg-inherit px-2 py-2.5 text-center">
                      {weeklyId != null ? (
                        <BulkSelectCheckbox
                          checked={bulk.isSelected(weeklyId)}
                          disabled={bulk.busy}
                          onChange={() => bulk.toggle(weeklyId)}
                          ariaLabel={`Select ${emp.employeeName} for approval`}
                        />
                      ) : null}
                    </td>
                  ) : null}
                  <td className={`sticky ${showApproval ? 'left-10' : 'left-0'} z-[1] w-24 min-w-24 border border-[var(--color-warm-muted)] bg-inherit px-3 py-2.5 font-mono text-[var(--color-ink)]`}>
                    {emp.employeeCode || '-'}
                  </td>
                  <td className={`sticky ${showApproval ? 'left-[7.5rem]' : 'left-24'} z-[1] min-w-[10rem] border border-[var(--color-warm-muted)] bg-inherit px-3 py-2.5 font-medium text-[var(--color-ink)]`}>
                    {emp.employeeName}
                  </td>
                  <td
                    className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center text-xs font-semibold tabular-nums ${
                      weekLateCount > 0
                        ? 'bg-amber-100 text-amber-900'
                        : 'text-emerald-700'
                    }`}
                  >
                    {weekLateCount}
                  </td>
                  {activeWeekDays.map((day) => {
                    const dayIdx = day - 1
                    const dailyRow = dailyRecordForEmployeeDay(
                      dailyRecords,
                      emp.employeeCode,
                      reportYear,
                      reportMonth,
                      day,
                    )
                    const token = employeeDayStatusToken(emp, dayIdx, dailyRow)
                    const isLate = Boolean(emp.dayLateFlags[dayIdx])
                    const isSunday = new Date(reportYear, reportMonth - 1, day).getDay() === 0
                    const displayToken = isSunday
                      ? 'Sun'
                      : token.trim()
                        ? tokenView === 'with_time'
                          ? formatWeeklyDayCellLabel(emp, dayIdx, dailyRow)
                          : plainDayDisplayMark(emp, dayIdx, dailyRow)
                        : '-'
                    return (
                      <td
                        key={`status-${day}`}
                        className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center text-xs ${
                          isEditing
                            ? stripBg
                            : cellClass(isSunday ? '' : token, undefined, isSunday ? false : Boolean(emp.dayWfhUnverified[dayIdx]))
                        } ${isLate && !isEditing ? 'ring-2 ring-amber-400 ring-inset' : ''}`}
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
                          displayToken
                        )}
                      </td>
                    )
                  })}
                  <WeekScopedSummaryCells
                    emp={emp}
                    weekNo={activeWeekNo}
                    reportYear={reportYear}
                    reportMonth={reportMonth}
                    rowStripBg={stripBg}
                    policyCompany={policyCompany}
                    weeklyRecords={weeklyRecords}
                    companyHolidays={companyHolidays}
                  />
                  {allowEdit ? (
                    <td className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center text-xs ${stripBg}`}>
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
  )
}
