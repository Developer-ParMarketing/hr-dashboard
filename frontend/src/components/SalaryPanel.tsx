import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import {
  calculateSalary,
  downloadSalaryExcel,
  loadSalaryResults,
  loadSalarySheet,
  previewSalarySheet,
  saveSalarySheet,
  saveSalarySheetRow,
} from '../api/salary'
import {
  DEFAULT_UPLOAD_COMPANY,
  UPLOAD_COMPANY_CODES,
  companySelectionToApiString,
  type UploadCompanySelection,
} from '../constants/companies'
import {
  SALARY_TABLE_VIEW_OPTIONS,
  isStickySalaryColumn,
  salaryColumnLabel,
  salaryColumnsForView,
  type SalaryInputFieldKey,
  type SalaryTableView,
} from '../constants/salaryColumns'
import { SALARY_COLUMN_LABELS } from '../constants/salaryColumnLabels'
import type { PmSalaryColumnDef } from '../constants/salaryColumns'
import type { PmSalaryBreakdown, SalaryCalculationResponse, SalarySheetInputRow, SalarySheetRow } from '../types/salary'
import { resolvePayrollIncrement } from '../utils/incrementPayroll'
import { formatDojDdMmYyyy } from '../utils/dojFormat'
import { tableRowStripBg } from '../utils/attendance'
import { subscribeEmployeeRegistryUpdated } from '../utils/employeeRegistryEvents'
import { groupRowsByTeam, teamMetaFromEmployee } from '../utils/teamGroups'
import { confirmAction, confirmSave } from '../utils/confirmAction'
import { TeamGroupHeader } from './TeamGroupHeader'
import { WorkflowSpinner } from './WorkflowStatus'

type Props = {
  reportYear: number
  reportMonth: number
  company: UploadCompanySelection
  allowEdit?: boolean
  showAdminLink?: boolean
  months: readonly string[]
  onYearChange: (year: number) => void
  onMonthChange: (month: number) => void
  onCompanyChange: (company: UploadCompanySelection) => void
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onMessage?: (msg: { error?: string | null; success?: string | null }) => void
}

const CALC_HELP = (
  <>
    Gross CTC = In hand + PT · Per day = CTC ÷ days in month · Gross pay = Pay days × Per day · WFH = 20% of WFH
    days × per day · Increment amount = In hand × Inc. % ÷ 100 (when % is set) · After you save
    increment in a month, it carries forward each month until you change it · Net = Gross − deductions +
    increment and other earning
  </>
)

function sheetRowPayload(row: EditableSheetRow): SalarySheetInputRow {
  const resolved = resolvePayrollIncrement(row)
  return {
    employeeId: row.employeeId,
    employeeCode: row.employeeCode,
    employeeName: row.employeeName,
    inHand: row.inHand,
    pfEmployee: row.pfEmployee,
    esiEmployee: row.esiEmployee,
    pt: row.pt,
    gratuity: row.gratuity,
    employerPf: row.employerPf,
    employerPfArr: row.employerPfArr,
    employerEsi: row.employerEsi,
    otherEarning: row.otherEarning,
    incrementPercent: resolved.incrementPercent,
    increment: resolved.increment,
  }
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type EditableSheetRow = SalarySheetRow

export function SalaryPanel({
  reportYear,
  reportMonth,
  company,
  allowEdit = true,
  showAdminLink = false,
  months,
  onYearChange,
  onMonthChange,
  onCompanyChange,
  onPrevMonth,
  onNextMonth,
  onToday,
  onMessage,
}: Props) {
  const companyApi = companySelectionToApiString(company)
  const periodLabel = `${months[reportMonth - 1]} ${reportYear}`

  const [rows, setRows] = useState<EditableSheetRow[]>([])
  const [results, setResults] = useState<SalaryCalculationResponse['rows']>([])
  const [search, setSearch] = useState('')
  const [tableView, setTableView] = useState<SalaryTableView>('summary')
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [attendanceStale, setAttendanceStale] = useState(false)
  const [staleMessage, setStaleMessage] = useState<string | null>(null)
  const [hasSalaryResults, setHasSalaryResults] = useState(false)
  const [hasAttendanceData, setHasAttendanceData] = useState(false)
  const [periodLoading, setPeriodLoading] = useState(true)
  const [savingRowId, setSavingRowId] = useState<number | null>(null)

  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoCalcAttempted = useRef(false)
  const rowsRef = useRef<EditableSheetRow[]>([])
  rowsRef.current = rows
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const runCalculateRef = useRef<
    (options?: { auto?: boolean; sourceRows?: EditableSheetRow[] }) => Promise<boolean>
  >(async () => false)

  const notify = useCallback((error: string | null, success: string | null) => {
    setLocalError(error)
    onMessageRef.current?.({ error, success })
  }, [])

  const loadSheet = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setBusy(true)
      try {
        const sheet = await loadSalarySheet(reportYear, reportMonth, companyApi)
        setRows(sheet.rows)
        setHasAttendanceData(sheet.summary.hasAttendanceData)
        setHasSalaryResults(sheet.summary.hasSalaryResults)
        setAttendanceStale(sheet.summary.attendanceStale)
        setStaleMessage(sheet.summary.staleMessage)
        return sheet
      } catch (e) {
        notify(
          axios.isAxiosError(e)
            ? ((e.response?.data as { message?: string })?.message ?? e.message)
            : 'Failed to load salary sheet',
          null,
        )
        return null
      } finally {
        if (!options?.silent) setBusy(false)
      }
    },
    [reportYear, reportMonth, companyApi, notify],
  )

  const applyCalcStatus = useCallback(
    (data: {
      hasAttendanceData?: boolean
      hasSalaryResults?: boolean
      attendanceStale?: boolean
      staleMessage?: string | null
    }) => {
      if (data.hasAttendanceData != null) setHasAttendanceData(data.hasAttendanceData)
      if (data.hasSalaryResults != null) setHasSalaryResults(data.hasSalaryResults)
      if (data.attendanceStale != null) setAttendanceStale(data.attendanceStale)
      if (data.staleMessage !== undefined) setStaleMessage(data.staleMessage)
    },
    [],
  )

  const loadSaved = useCallback(async () => {
    try {
      const data = await loadSalaryResults(reportYear, reportMonth, companyApi)
      applyCalcStatus(data)
      if (data.rows.length === 0) return false
      setResults(
        data.rows.map((r) => ({
          employeeId: r.employeeId,
          employeeCode: r.employeeCode,
          employeeName: r.employeeName,
          grossSalary: r.grossSalary ?? 0,
          workingDays: r.workingDays ?? 0,
          deficitHours: 0,
          attendanceDeduction: r.attendanceDeduction ?? 0,
          adjustment: r.adjustment ?? 0,
          finalSalary: r.finalSalary ?? 0,
          salaryRecordId: r.salaryRecordId,
          status: r.status,
          warnings: [],
          pm: r.pm,
        })),
      )
      return true
    } catch {
      return false
    }
  }, [reportYear, reportMonth, companyApi, applyCalcStatus])

  const eligibleRows = useMemo(
    () => rows.filter((r) => r.matched && r.errors.length === 0),
    [rows],
  )

  const runCalculate = useCallback(
    async (options?: { auto?: boolean; sourceRows?: EditableSheetRow[] }) => {
      const currentRows = options?.sourceRows ?? rowsRef.current
      const eligible = currentRows.filter((r) => r.matched && r.errors.length === 0)
      if (!allowEdit || eligible.length === 0) return false
      if (!options?.auto) {
        if (
          !(await confirmAction(
            `Calculate payroll for ${periodLabel}?\n\nThis saves the sheet and runs salary calculation for ${eligible.length} employee${eligible.length === 1 ? '' : 's'}.`,
          ))
        ) {
          return false
        }
        setBusy(true)
        notify(null, null)
      }
      try {
        const payload = currentRows.map((r) => sheetRowPayload(r))
        const saved = await saveSalarySheet(reportYear, reportMonth, companyApi, payload)
        setRows(saved.rows)
        applyCalcStatus(saved.summary)
        const result = await calculateSalary({
          year: reportYear,
          month: reportMonth,
          company: companyApi,
        })
        setResults(result.rows)
        setHasSalaryResults(true)
        setAttendanceStale(false)
        setStaleMessage(null)
        notify(
          null,
          options?.auto
            ? `Salary calculated for ${result.summary.calculated} employee${result.summary.calculated === 1 ? '' : 's'}.`
            : `Payroll complete - ${result.summary.calculated} employee${result.summary.calculated === 1 ? '' : 's'}, total ₹${money(result.summary.totalFinal)}.`,
        )
        return true
      } catch (e) {
        if (!options?.auto) {
          notify(
            axios.isAxiosError(e)
              ? ((e.response?.data as { message?: string })?.message ?? e.message)
              : 'Salary calculation failed',
            null,
          )
        }
        return false
      } finally {
        if (!options?.auto) setBusy(false)
      }
    },
    [allowEdit, reportYear, reportMonth, companyApi, notify, applyCalcStatus],
  )
  runCalculateRef.current = runCalculate

  useEffect(() => {
    let cancelled = false
    setPeriodLoading(true)
    setSearch('')
    setLocalError(null)
    setResults([])
    autoCalcAttempted.current = false

    void (async () => {
      const sheet = await loadSheet({ silent: true })
      if (cancelled) return

      const hadResults = await loadSaved()
      if (cancelled) {
        setPeriodLoading(false)
        return
      }

      if (
        !hadResults &&
        allowEdit &&
        !autoCalcAttempted.current &&
        sheet &&
        sheet.summary.hasAttendanceData &&
        sheet.summary.matchedRows > 0 &&
        !sheet.summary.hasSalaryResults
      ) {
        autoCalcAttempted.current = true
        await runCalculateRef.current({ auto: true, sourceRows: sheet.rows })
      }

      if (!cancelled) setPeriodLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [reportYear, reportMonth, companyApi, allowEdit, loadSheet, loadSaved])

  useEffect(() => {
    return subscribeEmployeeRegistryUpdated(() => {
      void loadSheet({ silent: true })
    })
  }, [loadSheet])

  const schedulePreview = useCallback(
    (nextRows: EditableSheetRow[]) => {
      if (previewTimer.current) clearTimeout(previewTimer.current)
      previewTimer.current = setTimeout(() => {
        setPreviewBusy(true)
        void previewSalarySheet(
          reportYear,
          reportMonth,
          companyApi,
          nextRows.map((r) => sheetRowPayload(r)),
        )
          .then((sheet) => setRows(sheet.rows))
          .catch(() => {})
          .finally(() => setPreviewBusy(false))
      }, 450)
    },
    [reportYear, reportMonth, companyApi],
  )

  const updateRow = useCallback(
    (employeeId: number, key: SalaryInputFieldKey, raw: string) => {
      setRows((prev) => {
        const next = prev.map((r) => {
          if (r.employeeId !== employeeId) return r
          if (key === 'incrementPercent') {
            const pctRaw = raw.trim()
            const incrementPercent =
              pctRaw === '' ? null : Number.parseFloat(pctRaw)
            const pct =
              incrementPercent != null && Number.isFinite(incrementPercent) && incrementPercent > 0
                ? incrementPercent
                : null
            return { ...r, ...resolvePayrollIncrement({ ...r, incrementPercent: pct, increment: r.increment }) }
          }
          if (key === 'increment') {
            const value = raw === '' ? 0 : Number.parseFloat(raw)
            const increment = Number.isFinite(value) ? value : 0
            return { ...r, incrementPercent: null, increment }
          }
          const value = raw === '' ? 0 : Number.parseFloat(raw)
          const patch = { [key]: Number.isFinite(value) ? value : 0 } as Partial<EditableSheetRow>
          const merged = { ...r, ...patch }
          if (key === 'inHand' && r.incrementPercent != null && r.incrementPercent > 0) {
            return { ...merged, ...resolvePayrollIncrement(merged) }
          }
          return merged
        })
        schedulePreview(next)
        return next
      })
    },
    [schedulePreview],
  )

  const onSaveRow = useCallback(
    async (employeeId: number) => {
      if (!allowEdit) return
      const row = rowsRef.current.find((r) => r.employeeId === employeeId)
      if (!row || !row.matched || row.errors.length > 0) return
      setSavingRowId(employeeId)
      notify(null, null)
      try {
        const saved = await saveSalarySheetRow(
          reportYear,
          reportMonth,
          companyApi,
          sheetRowPayload(row),
        )
        setRows((prev) =>
          prev.map((r) => (r.employeeId === employeeId ? { ...r, ...saved } : r)),
        )
        notify(
          null,
          `Saved increment for ${saved.employeeName || saved.employeeCode} (applies for 12 months; saved rows in that window were updated).`,
        )
      } catch (e) {
        notify(
          axios.isAxiosError(e)
            ? ((e.response?.data as { message?: string })?.message ?? e.message)
            : 'Failed to save row',
          null,
        )
      } finally {
        setSavingRowId(null)
      }
    },
    [allowEdit, reportYear, reportMonth, companyApi, notify],
  )

  const visibleColumns = useMemo(() => salaryColumnsForView(tableView), [tableView])
  const showFullTableChrome = tableView === 'full'

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.employeeCode.toLowerCase().includes(q) ||
        r.employeeName.toLowerCase().includes(q),
    )
  }, [rows, search])

  const previewNetTotal = useMemo(
    () => eligibleRows.reduce((sum, r) => sum + (r.preview?.netPay ?? 0), 0),
    [eligibleRows],
  )

  const resultsTotal = useMemo(
    () => results.reduce((sum, r) => sum + r.finalSalary, 0),
    [results],
  )

  const onSaveSheet = useCallback(async () => {
    if (!allowEdit || eligibleRows.length === 0) return
    if (!(await confirmSave(`salary sheet for ${periodLabel}`))) return
    setBusy(true)
    notify(null, null)
    try {
      const payload = rows.map((r) => sheetRowPayload(r))
      const saved = await saveSalarySheet(reportYear, reportMonth, companyApi, payload)
      setRows(saved.rows)
      applyCalcStatus(saved.summary)
      notify(null, `Sheet saved for ${periodLabel}.`)
    } catch (e) {
      notify(
        axios.isAxiosError(e)
          ? ((e.response?.data as { message?: string })?.message ?? e.message)
          : 'Failed to save sheet',
        null,
      )
    } finally {
      setBusy(false)
    }
  }, [allowEdit, eligibleRows.length, rows, reportYear, reportMonth, companyApi, notify, periodLabel])

  const canCalculate = allowEdit && eligibleRows.length > 0 && hasAttendanceData && !busy

  const onExportExcel = useCallback(async () => {
    setBusy(true)
    notify(null, null)
    try {
      await downloadSalaryExcel(reportYear, reportMonth, companyApi, hasSalaryResults)
      notify(null, `Downloaded ${periodLabel} salary Excel.`)
    } catch (e) {
      notify(
        axios.isAxiosError(e)
          ? ((e.response?.data as { message?: string })?.message ?? e.message)
          : 'Export failed',
        null,
      )
    } finally {
      setBusy(false)
    }
  }, [reportYear, reportMonth, companyApi, hasSalaryResults, periodLabel, notify])

  const displayNet = hasSalaryResults && !attendanceStale ? resultsTotal : previewNetTotal
  const netIsPreview = !(hasSalaryResults && !attendanceStale)

  return (
    <section className="salary-module">
      <header className="salary-module-head">
        <div className="salary-module-head-main">
          <div className="salary-period-nav" aria-label="Payroll period">
            <button
              type="button"
              className="salary-period-nav-btn"
              onClick={onPrevMonth}
              aria-label="Previous month"
            >
              ‹
            </button>
            <div className="salary-period-title">
              <p className="salary-period-title-text">{periodLabel}</p>
              <button
                type="button"
                className="text-[0.6875rem] font-medium text-[var(--color-brand)] hover:underline"
                onClick={onToday}
              >
                Jump to current month
              </button>
            </div>
            <button
              type="button"
              className="salary-period-nav-btn"
              onClick={onNextMonth}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
          <div className="salary-period-filters">
            <select
              className="field field-compact w-[4.25rem]"
              aria-label="Company"
              value={company === '' ? DEFAULT_UPLOAD_COMPANY : company}
              onChange={(e) => onCompanyChange(e.target.value as UploadCompanySelection)}
            >
              {UPLOAD_COMPANY_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <select
              className="field field-compact w-[7.5rem]"
              aria-label="Month"
              value={reportMonth}
              onChange={(e) => onMonthChange(Number.parseInt(e.target.value, 10))}
            >
              {months.map((label, idx) => (
                <option key={label} value={idx + 1}>
                  {label}
                </option>
              ))}
            </select>
            <input
              type="number"
              className="field field-compact w-[4.5rem]"
              aria-label="Year"
              min={2000}
              max={2100}
              value={reportYear}
              onChange={(e) => onYearChange(Number.parseInt(e.target.value, 10) || reportYear)}
            />
          </div>
        </div>
        {!periodLoading ? (
          <div className="salary-module-kpi">
            <p className="salary-kpi-label">Total net</p>
            <p className="salary-kpi-value">₹{money(displayNet)}</p>
            {netIsPreview ? <span className="salary-kpi-note">Preview</span> : null}
          </div>
        ) : null}
      </header>

      {!periodLoading ? (
        <div className="salary-module-bar">
          <div className="salary-chips">
            <span className="salary-chip">
              <strong className="font-semibold">{eligibleRows.length}</strong>
              {rows.length !== eligibleRows.length ? ` / ${rows.length}` : ''} ready
            </span>
            <span
              className={`salary-chip${hasAttendanceData ? ' salary-chip-ok' : ' salary-chip-warn'}`}
            >
              Attendance {hasAttendanceData ? 'uploaded' : 'missing'}
            </span>
            {previewBusy ? <span className="salary-chip salary-chip-muted">Updating…</span> : null}
          </div>
          {allowEdit ? (
            <div className="salary-module-actions">
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={!canCalculate}
                onClick={() => void runCalculate()}
              >
                {busy ? (
                  <>
                    <WorkflowSpinner className="mr-1.5 h-3.5 w-3.5" />
                    Working…
                  </>
                ) : hasSalaryResults ? (
                  'Recalculate'
                ) : (
                  'Calculate'
                )}
              </button>
              <span className="salary-module-actions-divider" aria-hidden />
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={busy || rows.length === 0}
                onClick={() => void onSaveSheet()}
              >
                Save
              </button>
              <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void loadSheet()}>
                Reload
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={busy || eligibleRows.length === 0}
                onClick={() => void onExportExcel()}
              >
                Excel
              </button>
              <details className="salary-toolbar-help">
                <summary className="cursor-pointer text-xs text-[var(--color-warm-text)] hover:text-[var(--color-ink)]">
                  Formulas
                </summary>
                <p className="salary-toolbar-help-body">{CALC_HELP}</p>
              </details>
            </div>
          ) : null}
        </div>
      ) : null}

      {attendanceStale && staleMessage ? (
        <div className="salary-module-alert border-amber-300/80 bg-amber-50">
          <p className="text-sm text-amber-950">{staleMessage}</p>
          {allowEdit ? (
            <button
              type="button"
              className="btn-primary shrink-0 text-xs"
              disabled={busy}
              onClick={() => void runCalculate()}
            >
              Recalculate
            </button>
          ) : null}
        </div>
      ) : null}

      {!allowEdit ? (
        <p className="px-7 pt-4 text-sm text-[var(--color-warm-text)]">
          View-only access. Payroll processing requires an HR account.
        </p>
      ) : null}

      {localError ? <p className="alert-error mx-5 mt-4 sm:mx-7">{localError}</p> : null}

      {periodLoading ? (
        <div className="salary-module-body-loading">
          <WorkflowSpinner className="h-4 w-4" />
          Loading {periodLabel}…
        </div>
      ) : (
        <div className="salary-table-panel">
          <div className="salary-table-toolbar">
            <div className="seg inline-flex flex-wrap" role="tablist" aria-label="Column layout">
              {SALARY_TABLE_VIEW_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  title={opt.hint}
                  className={`seg-btn${tableView === opt.id ? ' seg-btn-active' : ''}`}
                  onClick={() => setTableView(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <input
              type="search"
              className="field field-compact w-full sm:max-w-[13rem]"
              placeholder="Search name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {rows.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-[var(--color-ink)]">No people for this month</p>
              <p className="mt-1 text-sm text-[var(--color-warm-text)]">
                Add employees and upload attendance for {periodLabel}.
              </p>
              {showAdminLink ? (
                <Link to="/admin" className="btn-secondary mt-4 inline-flex text-xs">
                  Open Admin
                </Link>
              ) : null}
            </div>
          ) : (
            <SalarySheetTable
              rows={filteredRows}
              columns={visibleColumns}
              view={tableView}
              showFullChrome={showFullTableChrome}
              allowEdit={allowEdit}
              onUpdate={updateRow}
              onSaveRow={onSaveRow}
              savingRowId={savingRowId}
            />
          )}
        </div>
      )}
    </section>
  )
}

function metaCell(row: SalarySheetRow, key: string): string {
  switch (key) {
    case 'fileList':
      return row.employeeId ? String(row.employeeId) : '-'
    case 'employeeCode':
      return row.employeeCode || '-'
    case 'employeeName':
      return row.employeeName || '-'
    case 'doj':
      return formatDojDdMmYyyy(row.dateOfJoining) || '-'
    case 'process':
      return row.process || 'PM'
    case 'department':
      return row.department || '-'
    case 'gender':
      return row.gender || '-'
    case 'status':
      return row.status ? row.status.charAt(0).toUpperCase() + row.status.slice(1) : 'Active'
    default:
      return '-'
  }
}

function calcCell(p: PmSalaryBreakdown | undefined, field: string): string {
  if (!p) return '-'
  if (field === 'payDays' || field === 'wfhDays' || field === 'lateMarkCount') {
    const n = p[field as 'payDays' | 'wfhDays' | 'lateMarkCount']
    return typeof n === 'number' && Number.isFinite(n) ? String(n) : '-'
  }
  const val = p[field as keyof PmSalaryBreakdown]
  return typeof val === 'number' ? money(val) : '-'
}

function teamMetaFromSalaryRow(row: Pick<SalarySheetRow, 'teamId' | 'teamName' | 'teamSortOrder' | 'teamManagerName'>) {
  return teamMetaFromEmployee({
    teamId: row.teamId ?? null,
    teamName: row.teamName ?? '',
    teamSortOrder: row.teamSortOrder ?? 9999,
    teamManagerName: row.teamManagerName ?? undefined,
  })
}

function salaryTableClass(showFullChrome: boolean): string {
  return `salary-sheet-table min-w-max w-full text-left text-xs sm:text-sm${showFullChrome ? '' : ' salary-sheet-table--readable'}`
}

function salaryThClass(col: PmSalaryColumnDef, showFullChrome: boolean): string {
  const sticky = isStickySalaryColumn(col.key)
    ? col.key === 'employeeCode'
      ? 'salary-cell-sticky salary-cell-sticky-code salary-cell-sticky-head'
      : 'salary-cell-sticky salary-cell-sticky-name salary-cell-sticky-head'
    : ''
  const align = col.kind === 'meta' ? 'text-left' : 'text-right'
  const accent =
    col.kind === 'input' &&
    (col.inputKey === 'increment' ||
      col.inputKey === 'incrementPercent' ||
      col.inputKey === 'otherEarning')
      ? 'text-[var(--color-brand)]'
      : ''
  const calc = showFullChrome && col.kind === 'calc' ? 'salary-th-calc' : ''
  return `salary-th ${align} ${sticky} ${accent} ${calc}`.trim()
}

function salaryTdClass(col: PmSalaryColumnDef, stripBg: string, showFullChrome: boolean): string {
  if (isStickySalaryColumn(col.key)) {
    const variant =
      col.key === 'employeeCode'
        ? 'salary-cell-sticky salary-cell-sticky-code font-mono'
        : 'salary-cell-sticky salary-cell-sticky-name truncate font-medium'
    return `${variant} ${stripBg}${showFullChrome ? ' border border-[var(--color-warm-muted)] px-3 py-2' : ' salary-td salary-td-meta'}`
  }
  if (showFullChrome) {
    return `border border-[var(--color-warm-muted)] px-2 py-2 text-right tabular-nums ${stripBg}`
  }
  return `salary-td ${stripBg}${col.kind === 'meta' ? ' salary-td-meta' : ''}`
}

function salaryRowHint(
  row: SalarySheetRow,
  ok: boolean,
  preview: PmSalaryBreakdown | undefined,
): string | undefined {
  if (row.errors.length) return row.errors.join(' · ')
  const payWarn = row.warnings.find((w) => w.includes('Pay days') || w.includes('No attendance'))
  if (ok && preview && preview.payDays === 0) {
    return payWarn ?? 'No pay days for this month'
  }
  if (row.warnings.length) return row.warnings.join(' · ')
  return undefined
}

function renderSalaryColumnCell(
  col: PmSalaryColumnDef,
  ctx: {
    row: SalarySheetRow
    preview: PmSalaryBreakdown | undefined
    stripBg: string
    showFullChrome: boolean
    allowEdit?: boolean
    ok?: boolean
    onUpdate?: (employeeId: number, key: SalaryInputFieldKey, raw: string) => void
    onSaveRow?: (employeeId: number) => void
    savingRowId?: number | null
  },
): ReactNode {
  const tdClass = salaryTdClass(col, ctx.stripBg, ctx.showFullChrome)
  const netAccent = col.field === 'netPay' ? ' font-semibold text-[var(--color-brand)]' : ''

  if (col.kind === 'meta') {
    const hint = salaryRowHint(ctx.row, ctx.ok ?? true, ctx.preview)
    const title =
      col.key === 'employeeName'
        ? hint
          ? `${ctx.row.employeeName} - ${hint}`
          : ctx.row.employeeName
        : col.key === 'employeeCode' && hint
          ? hint
          : undefined
    const issueBorder =
      col.key === 'employeeName'
        ? ctx.row.errors.length
          ? ' border-l-2 border-l-red-400'
          : hint
            ? ' border-l-2 border-l-amber-400'
            : ''
        : ''
    return (
      <td
        key={col.key}
        className={`${tdClass} text-[var(--color-ink)]${issueBorder}`}
        title={title}
      >
        {metaCell(ctx.row, col.key)}
      </td>
    )
  }

  if (col.kind === 'input' && col.inputKey) {
    const monthlyField =
      col.inputKey === 'increment' ||
      col.inputKey === 'incrementPercent' ||
      col.inputKey === 'otherEarning'
    const percentActive =
      ctx.row.incrementPercent != null && ctx.row.incrementPercent > 0
    const incrementFromPercent = col.inputKey === 'increment' && percentActive
    const inputCellClass = ctx.showFullChrome
      ? `salary-cell-input border border-[var(--color-warm-muted)] px-1.5 py-1 text-right ${ctx.stripBg}`
      : `salary-td salary-cell-input ${ctx.stripBg}`

    if (col.inputKey === 'incrementPercent') {
      const pctVal = ctx.row.incrementPercent
      return (
        <td key={col.key} className={inputCellClass}>
          {ctx.allowEdit && ctx.ok && ctx.onUpdate ? (
            <div className="flex flex-col items-stretch gap-1">
              <input
                type="number"
                step={0.01}
                min={0}
                className="salary-input salary-input-highlight"
                value={pctVal != null && pctVal > 0 ? pctVal : ''}
                placeholder="%"
                onChange={(e) => ctx.onUpdate!(ctx.row.employeeId, 'incrementPercent', e.target.value)}
                aria-label={`Increment percent for ${ctx.row.employeeName || ctx.row.employeeCode}`}
              />
              {ctx.onSaveRow ? (
                <button
                  type="button"
                  disabled={ctx.savingRowId === ctx.row.employeeId}
                  className="rounded border border-[color-mix(in_srgb,var(--color-brand)_45%,transparent)] px-1 py-0.5 text-[0.625rem] font-semibold text-[var(--color-brand)] hover:bg-[var(--color-brand-muted)] disabled:opacity-50"
                  onClick={() => ctx.onSaveRow!(ctx.row.employeeId)}
                >
                  {ctx.savingRowId === ctx.row.employeeId ? 'Saving…' : 'Save row'}
                </button>
              ) : null}
            </div>
          ) : (
            <span className="tabular-nums">{pctVal != null && pctVal > 0 ? `${pctVal}%` : '-'}</span>
          )}
        </td>
      )
    }

    return (
      <td key={col.key} className={inputCellClass}>
        {ctx.allowEdit && ctx.ok && monthlyField && ctx.onUpdate && !incrementFromPercent ? (
          <input
            type="number"
            step={0.01}
            className={`salary-input${col.inputKey === 'increment' ? ' salary-input-highlight' : ''}`}
            value={Number.isFinite(ctx.row[col.inputKey]) ? ctx.row[col.inputKey] : ''}
            onChange={(e) => ctx.onUpdate!(ctx.row.employeeId, col.inputKey!, e.target.value)}
            aria-label={`${col.label} for ${ctx.row.employeeName || ctx.row.employeeCode}`}
          />
        ) : (
          <span
            className={`tabular-nums${monthlyField ? '' : ' text-[var(--color-warm-text)]'}`}
            title={incrementFromPercent ? `From ${SALARY_COLUMN_LABELS.inHand} × Inc. %` : undefined}
          >
            {col.inputKey === 'increment' || col.inputKey === 'otherEarning'
              ? money(ctx.row[col.inputKey])
              : money(Number(ctx.row[col.inputKey]))}
          </span>
        )}
      </td>
    )
  }

  return (
    <td key={col.key} className={`${tdClass}${ctx.showFullChrome ? ' salary-cell-calc' : ''}${netAccent}`}>
      {calcCell(ctx.preview, col.field ?? '')}
    </td>
  )
}

function SalarySheetTable({
  rows,
  columns,
  view,
  showFullChrome,
  allowEdit,
  onUpdate,
  onSaveRow,
  savingRowId,
}: {
  rows: EditableSheetRow[]
  columns: PmSalaryColumnDef[]
  view: SalaryTableView
  showFullChrome: boolean
  allowEdit: boolean
  onUpdate: (employeeId: number, key: SalaryInputFieldKey, raw: string) => void
  onSaveRow?: (employeeId: number) => void
  savingRowId?: number | null
}) {
  const colCount = columns.length
  const metaCols = columns.filter((c) => c.kind === 'meta')
  const inputCols = columns.filter((c) => c.kind === 'input')
  const calcCols = columns.filter((c) => c.kind === 'calc')

  const groupedRows = useMemo(
    () => groupRowsByTeam(rows, (r) => teamMetaFromSalaryRow(r)),
    [rows],
  )

  const renderRow = (r: EditableSheetRow, rowIdx: number) => {
    const ok = r.matched && r.errors.length === 0
    const p = r.preview
    const stripBg = tableRowStripBg(rowIdx)
    return (
      <tr key={r.employeeId} className={!ok ? 'opacity-60' : undefined}>
        {columns.map((col) =>
          renderSalaryColumnCell(col, {
            row: r,
            preview: p,
            stripBg,
            showFullChrome,
            allowEdit,
            ok,
            onUpdate,
            onSaveRow,
            savingRowId,
          }),
        )}
      </tr>
    )
  }

  return (
    <div className="salary-table-scroll">
      <table className={salaryTableClass(showFullChrome)}>
        <thead className="sticky top-0 z-20 shadow-[0_1px_0_0_color-mix(in_srgb,var(--color-brand)_12%,var(--color-warm-muted))]">
          {showFullChrome ? (
            <>
              <tr>
                <th
                  colSpan={metaCols.length}
                  className="salary-th-group salary-cell-sticky salary-cell-sticky-panel salary-cell-sticky-group-head"
                >
                  Employee
                </th>
                <th colSpan={inputCols.length} className="salary-th-group">
                  Base & monthly inputs
                </th>
                <th colSpan={calcCols.length} className="salary-th-group">
                  Calculated from attendance
                </th>
              </tr>
              <tr>
                {columns.map((col) => (
                  <th key={col.key} className={salaryThClass(col, showFullChrome)}>
                    {salaryColumnLabel(col, view)}
                  </th>
                ))}
              </tr>
            </>
          ) : (
            <tr>
              {columns.map((col) => (
                <th key={col.key} className={salaryThClass(col, showFullChrome)}>
                  {salaryColumnLabel(col, view)}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {(() => {
            let rowIdx = 0
            return groupedRows.flatMap((section) => {
              const header =
                view === 'summary' ? null : (
                  <TeamGroupHeader
                    key={`team-${section.group.teamId ?? 'unassigned'}`}
                    group={section.group}
                    memberCount={section.items.length}
                    colSpan={colCount}
                  />
                )
              const body = section.items.map((r) => renderRow(r, rowIdx++))
              return header ? [header, ...body] : body
            })
          })()}
        </tbody>
      </table>
    </div>
  )
}
