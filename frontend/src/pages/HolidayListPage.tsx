import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { AppShell } from '../components/AppShell'
import { HolidayYearBoard } from '../components/HolidayYearBoard'
import { useAuth } from '../auth/AuthContext'
import {
  canManageCompanyHolidays,
  employeeHolidayCalendarYear,
  visibleHolidayYearOptions,
} from '../auth/permissions'
import {
  fetchHolidays,
  previewCopyHolidaysFromEarlierYear,
  saveHolidays,
  type HolidayEntry,
} from '../api/holidays'
import { toastSuccess } from '../utils/toastBridge'
import { confirmAction, confirmRemove, confirmSave } from '../utils/confirmAction'
import { draftFromCopyPreview, draftFromHoliday, type HolidayDraftRow } from '../utils/holidayUi'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

const CALENDAR_YEAR = employeeHolidayCalendarYear()

export function HolidayListPage() {
  const { user } = useAuth()
  const canEdit = canManageCompanyHolidays(user)
  const yearOptions = useMemo(() => visibleHolidayYearOptions(user), [user])
  const [year, setYear] = useState(CALENDAR_YEAR)
  const [rows, setRows] = useState<HolidayEntry[]>([])
  const [draftRows, setDraftRows] = useState<HolidayDraftRow[]>([])
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copySourceYear, setCopySourceYear] = useState<number | null>(null)

  useEffect(() => {
    if (!canEdit) setYear(employeeHolidayCalendarYear())
  }, [canEdit])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchHolidays(year)
      setRows(result.holidays)
      setCopySourceYear(result.meta?.copySourceYear ?? null)
      if (!editing) {
        setDraftRows(result.holidays.map(draftFromHoliday))
      }
    } catch (e) {
      setError(errorMessage(e, 'Could not load holiday list'))
      setRows([])
      if (!editing) setDraftRows([])
    } finally {
      setLoading(false)
    }
  }, [year, editing])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setEditing(false)
  }, [year])

  const displayRows = useMemo(
    () => (editing ? draftRows : rows.map(draftFromHoliday)),
    [draftRows, editing, rows],
  )

  const startEdit = () => {
    setDraftRows(
      rows.length > 0
        ? rows.map(draftFromHoliday)
        : [{ key: 'new-1', holidayDate: `${year}-01-01`, name: '', dayType: 'full' }],
    )
    setEditing(true)
    setError(null)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraftRows(rows.map(draftFromHoliday))
    setError(null)
  }

  const addRow = () => {
    setDraftRows((prev) => [
      ...prev,
      { key: `new-${Date.now()}`, holidayDate: `${year}-01-01`, name: '', dayType: 'full' },
    ])
  }

  const removeRow = (key: string) => {
    void (async () => {
      const row = draftRows.find((r) => r.key === key)
      if (row?.name.trim() || row?.holidayDate) {
        const label = row.name.trim() || row.holidayDate
        if (!(await confirmRemove(`holiday “${label}” from the draft list`))) return
      }
      setDraftRows((prev) => prev.filter((row) => row.key !== key))
    })()
  }

  const updateRow = (key: string, patch: Partial<HolidayDraftRow>) => {
    setDraftRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  const onSave = async () => {
    if (!(await confirmSave(`${draftRows.length} holiday${draftRows.length === 1 ? '' : 's'} for ${year}`))) return
    setSaving(true)
    setError(null)
    try {
      const result = await saveHolidays(
        year,
        draftRows.map((row) => ({
          holidayDate: row.holidayDate,
          name: row.name.trim(),
          dayType: row.dayType,
        })),
      )
      setRows(result.holidays)
      setDraftRows(result.holidays.map(draftFromHoliday))
      setEditing(false)
      toastSuccess(`Saved ${result.holidays.length} holiday${result.holidays.length === 1 ? '' : 's'} for ${year}.`)
    } catch (e) {
      setError(errorMessage(e, 'Could not save holiday list'))
    } finally {
      setSaving(false)
    }
  }

  const onCopyPrevious = async () => {
    const sourceYear = copySourceYear
    if (sourceYear == null) {
      setError('No earlier holiday list is available to copy.')
      return
    }
    const replaceNote =
      rows.length > 0
        ? ` This replaces the current ${year} list when you save.`
        : ' Adjust dates and names, then save.'
    if (
      !(await confirmAction(
        `Copy ${sourceYear} holidays into ${year}? Same month/day, updated year.${replaceNote}`,
      ))
    ) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      const result = await previewCopyHolidaysFromEarlierYear(year)
      setDraftRows(result.holidays.map((row, index) => draftFromCopyPreview(row, index)))
      setEditing(true)
      toastSuccess(
        `Loaded ${result.holidays.length} holidays from ${result.sourceYear}. Edit as needed, then save.`,
      )
    } catch (e) {
      setError(errorMessage(e, 'Could not copy from earlier year'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <AppShell active="holidayList">
      <main className="app-page">
        <header className="page-header">
          <p className="page-kicker">Time & attendance</p>
          <h1 className="page-title">Holiday list</h1>
          <p className="feature-intro">
            Official company holidays by year - used for expected hours in weekly attendance.
          </p>
        </header>

        <div className="page-body">
          {error ? <p className="alert-error mb-4">{error}</p> : null}

          <HolidayYearBoard
            year={year}
            yearOptions={yearOptions}
            onYearChange={setYear}
            rows={rows}
            displayRows={displayRows}
            editing={editing}
            loading={loading}
            canEdit={canEdit}
            saving={saving}
            onStartEdit={startEdit}
            onCancelEdit={cancelEdit}
            onSave={() => void onSave()}
            copySourceYear={copySourceYear}
            onCopyPrevious={() => void onCopyPrevious()}
            onAddRow={addRow}
            onRemoveRow={removeRow}
            onUpdateRow={updateRow}
          />

          {canEdit ? (
            <p className="mt-6 text-xs text-[var(--color-warm-text)]">
              HR can publish or update each year&apos;s list (including the next
              calendar year). A December email reminder is sent when SMTP is configured.
            </p>
          ) : null}
        </div>
      </main>
    </AppShell>
  )
}
