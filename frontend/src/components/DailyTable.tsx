import { useMemo, useState } from 'react'
import type { AttendanceFilter, DailyAttendanceRecord, NormalizedEmployee, WeeklyAttendanceRecord } from '../types/attendance'
import { INLINE_FIELD_CLASS } from '../constants/attendanceMarks'
import { EMAIL_WORKFLOW_LABELS, emailWorkflowTone } from '../constants/workflowStatus'
import {
  dailyRecordsForCalendarDay,
  dailyRecordCellClass,
  dailyRecordMarkLabel,
  formatStoredClock,
  formatWorkingHoursDisplay,
  attendanceOriginClass,
  attendanceOriginLabel,
  isDailyRecordPresent,
  isDailyRecordWfhUnverified,
  isDailyRecordAbsent,
  lateMarkForRecord,
  matchesDailyRecordSearch,
  tableRowStripBg,
  weeklyRecordForCalendarDay,
} from '../utils/attendance'
import { formatDisplayDate, isoFromYmd } from '../utils/displayDate'
import {
  dailyRowEditDraftFromRecord,
  saveDailyRowEdit,
  type DailyRowEditDraft,
} from '../utils/inlineAttendanceSave'
import {
  emailStatusError,
  lateEmailStatus,
  notificationIndex,
  type NotificationStatusEntry,
} from '../utils/emailWorkflow'
import { AttendanceColorLegend } from './AttendanceColorLegend'
import { BulkSelectCheckbox } from './BulkSelectCheckbox'
import { BulkWeekApprovalBar } from './BulkWeekApprovalBar'
import { EditableMarkSelect } from './EditableMarkSelect'
import { InlineEditActions } from './InlineEditActions'
import { LegendExpandPanel } from './LegendExpandPanel'
import { TeamGroupHeader } from './TeamGroupHeader'
import { confirmWeeklyBulkDecision } from '../utils/confirmAction'
import { WorkflowStatusBadge } from './WorkflowStatus'
import { useBulkWeekApproval } from '../hooks/useBulkWeekApproval'
import { isWeeklyRecordSelectable } from '../utils/weeklyApproval'
import {
  employeeTeamLookup,
  groupRowsByTeam,
  teamMetaFromEmployee,
  UNASSIGNED_TEAM_LABEL,
} from '../utils/teamGroups'

type Props = {
  employees: NormalizedEmployee[]
  dailyRecords: DailyAttendanceRecord[]
  weeklyRecords?: WeeklyAttendanceRecord[]
  search: string
  filter: AttendanceFilter
  reportYear: number
  reportMonth: number
  calendarDay: number
  dateLabelOverride?: string | null
  dailyColumnHint?: string | null
  notificationStatus?: NotificationStatusEntry[]
  onBulkWeeklyAction?: (ids: number[], status: 'approved' | 'rejected') => void | Promise<void>
  allowEdit?: boolean
  /** Bulk approve/reject is monthly-only; keep false on daily view. */
  showBulkApproval?: boolean
  onSaved?: () => void | Promise<void>
  onSaveError?: (message: string) => void
  groupByTeam?: boolean
}

export function DailyTable({
  employees,
  dailyRecords,
  weeklyRecords = [],
  search,
  filter,
  reportYear,
  reportMonth,
  calendarDay,
  dateLabelOverride,
  dailyColumnHint,
  notificationStatus,
  onBulkWeeklyAction,
  allowEdit = true,
  showBulkApproval = false,
  onSaved,
  onSaveError,
  groupByTeam = true,
}: Props) {
  const reportDay = Math.min(Math.max(1, calendarDay), 31)
  const showApproval = allowEdit && showBulkApproval
  const notifyIndex = useMemo(() => notificationIndex(notificationStatus), [notificationStatus])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<DailyRowEditDraft | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const dayRecords = useMemo(
    () =>
      dailyRecordsForCalendarDay(
        dailyRecords,
        employees,
        reportYear,
        reportMonth,
        reportDay,
      ),
    [dailyRecords, employees, reportYear, reportMonth, reportDay],
  )

  const usingStoredRows = useMemo(() => {
    const date = new Date(reportYear, reportMonth - 1, reportDay)
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    return dailyRecords.some((r) => r.attendanceDate.slice(0, 10) === iso)
  }, [dailyRecords, reportYear, reportMonth, reportDay])

  const rows = useMemo(() => {
    return dayRecords.filter((row) => {
      if (!matchesDailyRecordSearch(row, search)) return false
      if (filter === 'all') return true
      const present = isDailyRecordPresent(row)
      if (filter === 'present') return present
      return isDailyRecordAbsent(row)
    })
  }, [dayRecords, search, filter])

  const teamLookup = useMemo(() => employeeTeamLookup(employees), [employees])

  const groupedRows = useMemo(() => {
    if (!groupByTeam) return [{ group: teamMetaFromEmployee({ teamId: null, teamName: '', teamSortOrder: 0 }), items: rows }]
    return groupRowsByTeam(rows, (row) => {
      const meta = teamLookup.get(row.employeeId)
      return (
        meta ??
        teamMetaFromEmployee({
          teamId: null,
          teamName: UNASSIGNED_TEAM_LABEL,
          teamSortOrder: 9999,
        })
      )
    })
  }, [groupByTeam, rows, teamLookup])

  const rowWeeklyIds = useMemo(
    () => {
      if (!showApproval) return rows.map(() => null)
      return rows.map((row) => {
        const rec = weeklyRecordForCalendarDay(
          weeklyRecords,
          row.employeeCode,
          reportYear,
          reportMonth,
          reportDay,
        )
        return rec && isWeeklyRecordSelectable(rec) ? rec.id : null
      })
    },
    [rows, weeklyRecords, reportYear, reportMonth, reportDay, showApproval],
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

  const colCount = 11 + (allowEdit ? 1 : 0) + (showApproval ? 1 : 0)
  const reportDateLabel = useMemo(() => {
    if (dateLabelOverride?.trim()) return dateLabelOverride.trim()
    return formatDisplayDate(isoFromYmd(reportYear, reportMonth, reportDay))
  }, [reportYear, reportMonth, reportDay, dateLabelOverride])

  const thHead =
    'border border-[var(--color-warm-muted)] bg-[color-mix(in_srgb,var(--color-brand-muted)_78%,#fff)] px-2 py-2.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-warm-text)] sm:text-xs'

  const startEdit = (row: DailyAttendanceRecord) => {
    setSaveError(null)
    setEditingId(row.id)
    setDraft(dailyRowEditDraftFromRecord(row))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft(null)
    setSaveError(null)
  }

  const saveEdit = async (row: DailyAttendanceRecord) => {
    if (!draft) return
    setSavingId(row.id)
    setSaveError(null)
    try {
      await saveDailyRowEdit(row, draft)
      setEditingId(null)
      setDraft(null)
      await onSaved?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save changes'
      setSaveError(msg)
      onSaveError?.(msg)
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="card-head">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-brand)]">
              Register
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-[var(--color-ink)]">Daily</h2>
            <LegendExpandPanel>
              <AttendanceColorLegend variant="daily" />
            </LegendExpandPanel>
            <p className="mt-2 text-xs text-[color-mix(in_srgb,var(--color-warm-text)_86%,transparent)]">
              Showing {rows.length} of {dayRecords.length} saved attendance records
            </p>
          </div>
          <div className="text-right text-sm text-[var(--color-warm-text)]">
            <span className="block font-medium text-[var(--color-ink)]">{reportDateLabel}</span>
            <span className="mt-0.5 block text-xs text-[color-mix(in_srgb,var(--color-warm-text)_88%,transparent)]">
              {dailyColumnHint ??
                'Click Edit on a row to correct mark, times, or hours, then Save.'}
            </span>
          </div>
        </div>
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

      <div className="table-scroll">
        <table className="min-w-max w-full border-collapse text-left text-xs sm:text-sm">
          <thead className="sticky top-0 z-30 shadow-[0_1px_0_0_color-mix(in_srgb,var(--color-brand)_12%,var(--color-warm-muted))]">
            <tr>
              {showApproval ? (
                <th className={`sticky left-0 z-40 w-10 min-w-10 whitespace-nowrap px-2 text-center ${thHead}`}>
                  <BulkSelectCheckbox
                    checked={bulk.allSelected}
                    indeterminate={bulk.someSelected}
                    disabled={bulk.busy || selectableIds.length === 0}
                    onChange={bulk.toggleAll}
                    ariaLabel="Select all employees for approval"
                  />
                </th>
              ) : null}
              <th
                className={`sticky ${showApproval ? 'left-10' : 'left-0'} z-40 min-w-[12rem] whitespace-nowrap px-3 text-left ${thHead}`}
              >
                Employee
              </th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Date</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Mark</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>In Time</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Check-in</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Out Time</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Working Hours</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Source</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Late Mark</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Late minutes</th>
              <th className={`whitespace-nowrap text-center ${thHead}`}>Email</th>
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
                  No saved attendance records match this date, search, or filter.
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
                const bodyRows = section.items.map((row, rowIndex) => {
                const stripBg = tableRowStripBg(rowIndex)
                const lateMark = lateMarkForRecord(row)
                const checkIn = formatStoredClock(row.checkInTime ?? row.inTime)
                const present = isDailyRecordPresent(row)
                const markLabel = dailyRecordMarkLabel(row)
                const markClass = dailyRecordCellClass(row, stripBg)
                const wfhUnverified = isDailyRecordWfhUnverified(row)
                const isEditing = editingId === row.id
                const isSaving = savingId === row.id
                const canEdit = allowEdit && usingStoredRows && row.origin !== 'approved'
                const weekRec = weeklyRecordForCalendarDay(
                  weeklyRecords,
                  row.employeeCode,
                  reportYear,
                  reportMonth,
                  reportDay,
                )
                const weeklyId =
                  weekRec && isWeeklyRecordSelectable(weekRec) ? weekRec.id : null
                return (
                  <tr key={`${row.id}-${row.employeeCode}-${row.attendanceDate}`}>
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
                      className={`sticky ${showApproval ? 'left-10' : 'left-0'} z-[5] min-w-[12rem] max-w-[min(240px,45vw)] border border-[var(--color-warm-muted)] px-3 py-2 ${stripBg}`}
                    >
                      <div className="font-medium text-[var(--color-ink)]">{row.employeeName || '-'}</div>
                      <div className="font-mono text-[0.7rem] text-[var(--color-warm-text)]">
                        {row.employeeCode || '-'}
                      </div>
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${stripBg}`}
                    >
                      {formatDisplayDate(row.attendanceDate)}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center text-xs font-semibold ${isEditing ? stripBg : markClass}`}
                      title={
                        wfhUnverified
                          ? 'WFH from leave calendar only - not verified on WFH punch file'
                          : undefined
                      }
                    >
                      {isEditing && draft ? (
                        <EditableMarkSelect
                          value={draft.mark}
                          onChange={(mark) => setDraft({ ...draft, mark })}
                          ariaLabel={`Mark for ${row.employeeName}`}
                        />
                      ) : (
                        markLabel
                      )}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${stripBg}`}
                    >
                      {formatStoredClock(row.shiftStart)}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums ${stripBg}`}
                    >
                      {isEditing && draft ? (
                        <input
                          value={draft.checkIn}
                          onChange={(e) => setDraft({ ...draft, checkIn: e.target.value })}
                          className={`${INLINE_FIELD_CLASS} min-w-[5.5rem] tabular-nums`}
                          aria-label={`Check-in for ${row.employeeName}`}
                        />
                      ) : (
                        checkIn
                      )}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums ${stripBg}`}
                    >
                      {isEditing && draft ? (
                        <input
                          value={draft.outTime}
                          onChange={(e) => setDraft({ ...draft, outTime: e.target.value })}
                          className={`${INLINE_FIELD_CLASS} min-w-[5.5rem] tabular-nums`}
                          aria-label={`Out time for ${row.employeeName}`}
                        />
                      ) : (
                        formatStoredClock(row.outTime)
                      )}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums ${stripBg}`}
                      title={
                        row.rawWorkingHours != null &&
                        row.rawWorkingHours !== row.workingHours
                          ? `Imported hours: ${formatWorkingHoursDisplay(row.rawWorkingHours)}`
                          : undefined
                      }
                    >
                      {isEditing && draft ? (
                        <input
                          value={draft.hoursText}
                          onChange={(e) => setDraft({ ...draft, hoursText: e.target.value })}
                          placeholder="H:MM"
                          className={`${INLINE_FIELD_CLASS} min-w-[4.5rem] tabular-nums`}
                          aria-label={`Working hours for ${row.employeeName}`}
                        />
                      ) : (
                        formatWorkingHoursDisplay(row.workingHours)
                      )}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center ${stripBg}`}
                    >
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${attendanceOriginClass(row.origin)}`}
                      >
                        {attendanceOriginLabel(row.origin)}
                      </span>
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center text-xs font-semibold uppercase ${
                        !present
                          ? `${stripBg} text-[var(--color-warm-text)]`
                          : lateMark === 'Late'
                            ? 'bg-amber-100 text-amber-900'
                            : lateMark === 'On time'
                              ? `${stripBg} text-emerald-700`
                              : `${stripBg} text-[color-mix(in_srgb,var(--color-warm-text)_55%,transparent)]`
                      }`}
                    >
                      {lateMark}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums ${
                        lateMark === 'Late'
                          ? 'bg-amber-100 font-semibold text-amber-900'
                          : `${stripBg} text-[var(--color-warm-text)]`
                      }`}
                    >
                      {lateMark === 'Late' && row.lateMinutes != null && Number.isFinite(row.lateMinutes)
                        ? row.lateMinutes
                        : '-'}
                    </td>
                    <td
                      className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center ${stripBg}`}
                    >
                      {lateMark === 'Late' ? (
                        (() => {
                          const status = lateEmailStatus(
                            notifyIndex,
                            row.employeeId,
                            row.attendanceDate,
                          )
                          const err = emailStatusError(
                            notifyIndex,
                            'late',
                            row.employeeId,
                            row.attendanceDate,
                          )
                          return status === 'none' ? (
                            <WorkflowStatusBadge label={EMAIL_WORKFLOW_LABELS.pending} tone="warning" compact />
                          ) : (
                            <span title={err ?? undefined}>
                              <WorkflowStatusBadge
                                label={EMAIL_WORKFLOW_LABELS[status]}
                                tone={emailWorkflowTone(status)}
                                compact
                              />
                            </span>
                          )
                        })()
                      ) : (
                        '-'
                      )}
                    </td>
                    {allowEdit ? (
                      <td className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center ${stripBg}`}>
                        <InlineEditActions
                          editing={isEditing}
                          saving={isSaving}
                          disabled={!canEdit}
                          onEdit={() => startEdit(row)}
                          onCancel={cancelEdit}
                          onSave={() => void saveEdit(row)}
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
