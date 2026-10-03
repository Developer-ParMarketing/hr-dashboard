import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { listRecentUploads, listSavedPeriods } from '../api/attendance'
import {
  companyFromStored,
  DEFAULT_UPLOAD_COMPANY,
  type UploadCompanySelection,
} from '../constants/companies'
import type { GroupedRecentUpload, SavedPeriod, UploadHistoryRun } from '../types/attendance'
import { formatDisplayDate } from '../utils/displayDate'

type PanelTab = 'months' | 'history'

const HISTORY_PAGE_SIZE = 12

type Props = {
  selectedYear: number
  selectedMonth: number
  selectedCompany: UploadCompanySelection
  refreshToken: number
  loading: boolean
  layout?: 'sidebar' | 'page'
  onSelectPeriod: (year: number, month: number, company: UploadCompanySelection) => void
  onOpenRegister?: (upload: GroupedRecentUpload) => void
}

function companySelectionFromRow(company: string | null): UploadCompanySelection {
  return companyFromStored(company)
}

function periodMatchesSelection(
  period: SavedPeriod,
  year: number,
  month: number,
  company: UploadCompanySelection,
): boolean {
  if (period.year !== year || period.month !== month) return false
  const rowCompany = companySelectionFromRow(period.company)
  const selected = company === '' ? DEFAULT_UPLOAD_COMPANY : company
  return rowCompany === selected
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'Unknown'
  const diffMs = Date.now() - then.getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 14) return `${days}d ago`
  return formatDisplayDate(
    `${then.getFullYear()}-${String(then.getMonth() + 1).padStart(2, '0')}-${String(then.getDate()).padStart(2, '0')}`,
  )
}

function formatDateTime(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'Unknown'
  return then.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function actorLabel(actor: string | null | undefined): string {
  const trimmed = (actor ?? '').trim()
  return trimmed || 'System'
}

function runSummary(run: UploadHistoryRun): string {
  const parts = [actorLabel(run.actor), formatDateTime(run.processedAt)]
  if (run.employeeCount != null) {
    parts.push(`${run.employeeCount} emp.`)
  }
  return parts.join(' · ')
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

function shortMonthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleString(undefined, {
    month: 'short',
    year: 'numeric',
  })
}

function reportTypeLabel(type: string): string {
  if (type === 'daily') return 'Daily'
  if (type === 'weekly') return 'Weekly'
  if (type === 'monthly') return 'Monthly'
  return type
}

function truncateFileName(name: string, max = 26): string {
  const trimmed = name.trim() || 'Register file'
  if (trimmed.length <= max) return trimmed
  const ext = trimmed.includes('.') ? trimmed.slice(trimmed.lastIndexOf('.')) : ''
  const baseMax = Math.max(max - ext.length - 1, 8)
  return `${trimmed.slice(0, baseMax)}…${ext}`
}

export function SavedPeriodsPanel({
  selectedYear,
  selectedMonth,
  selectedCompany,
  refreshToken,
  loading,
  layout = 'sidebar',
  onSelectPeriod,
  onOpenRegister,
}: Props) {
  const isPage = layout === 'page'
  const [periods, setPeriods] = useState<SavedPeriod[]>([])
  const [uploads, setUploads] = useState<GroupedRecentUpload[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [fetchingMonths, setFetchingMonths] = useState(true)
  const [fetchingHistory, setFetchingHistory] = useState(false)
  const [monthsError, setMonthsError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [tab, setTab] = useState<PanelTab>('months')
  const [expandedRunKeys, setExpandedRunKeys] = useState<Set<string>>(() => new Set())

  const toggleRunHistory = (key: string) => {
    setExpandedRunKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const historyPageCount = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE))
  const historyPageSafe = Math.min(historyPage, Math.max(0, historyPageCount - 1))

  const loadMonths = useCallback(async () => {
    setFetchingMonths(true)
    setMonthsError(null)
    try {
      const periodRows = await listSavedPeriods(200)
      setPeriods(periodRows)
    } catch (e) {
      if (axios.isAxiosError(e)) {
        const msg =
          typeof e.response?.data === 'string'
            ? e.response.data
            : (e.response?.data as { message?: string } | undefined)?.message
        setMonthsError(msg || e.message || 'Could not load months')
      } else {
        setMonthsError(e instanceof Error ? e.message : 'Could not load months')
      }
      setPeriods([])
    } finally {
      setFetchingMonths(false)
    }
  }, [])

  const loadHistoryPage = useCallback(async (page: number) => {
    setFetchingHistory(true)
    setHistoryError(null)
    try {
      const offset = page * HISTORY_PAGE_SIZE
      const result = await listRecentUploads({ limit: HISTORY_PAGE_SIZE, offset })
      setUploads(result.uploads)
      setHistoryTotal(result.total)
      const maxPage = Math.max(0, Math.ceil(result.total / HISTORY_PAGE_SIZE) - 1)
      if (page > maxPage) setHistoryPage(maxPage)
    } catch (e) {
      if (axios.isAxiosError(e)) {
        const msg =
          typeof e.response?.data === 'string'
            ? e.response.data
            : (e.response?.data as { message?: string } | undefined)?.message
        setHistoryError(msg || e.message || 'Could not load history')
      } else {
        setHistoryError(e instanceof Error ? e.message : 'Could not load history')
      }
      setUploads([])
      setHistoryTotal(0)
    } finally {
      setFetchingHistory(false)
    }
  }, [])

  useEffect(() => {
    setHistoryPage(0)
    void loadMonths()
    void listRecentUploads({ limit: 1, offset: 0 })
      .then((result) => setHistoryTotal(result.total))
      .catch(() => {})
  }, [loadMonths, refreshToken])

  useEffect(() => {
    if (tab !== 'history') return
    void loadHistoryPage(historyPageSafe)
  }, [tab, historyPageSafe, loadHistoryPage, refreshToken])

  const panelBusy = tab === 'months' ? fetchingMonths : fetchingHistory

  const rootClass = isPage
    ? 'card flex min-h-[24rem] flex-col overflow-hidden'
    : 'card flex h-full min-h-[18rem] flex-col overflow-hidden lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100dvh-6rem)]'

  return (
    <section className={rootClass} aria-label="Saved register history">
      <div className="card-head shrink-0 py-4">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-brand)]">
          Saved registers
        </p>
        <h2 className="mt-1 text-base font-semibold tracking-tight text-[var(--color-ink)]">
          History
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-[var(--color-warm-text)]">
          <strong className="font-medium text-[var(--color-ink)]">Months</strong> - open a processed
          month. <strong className="font-medium text-[var(--color-ink)]">Files</strong> - each register
          once, with every time it was processed.
        </p>

        <div className="seg mt-3 w-full" role="tablist" aria-label="History view">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'months'}
            onClick={() => setTab('months')}
            className={`seg-btn flex-1 text-center text-xs ${tab === 'months' ? 'seg-btn-active' : ''}`}
          >
            Months{periods.length > 0 ? ` (${periods.length})` : ''}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'history'}
            onClick={() => setTab('history')}
            className={`seg-btn flex-1 text-center text-xs ${tab === 'history' ? 'seg-btn-active' : ''}`}
          >
            Files{historyTotal > 0 ? ` (${historyTotal})` : ''}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'months' ? (
          fetchingMonths ? (
            <LoadingState />
          ) : monthsError ? (
            <ErrorState message={monthsError} onRetry={() => void loadMonths()} />
          ) : periods.length === 0 ? (
            <EmptyState
              title="No months yet"
              hint={
                isPage
                  ? 'Process a register from Attendance - saved months will appear here.'
                  : 'Process a register on the left - saved months will appear here.'
              }
            />
          ) : (
            <ul className="space-y-2">
              {periods.map((period) => {
                const company = companySelectionFromRow(period.company)
                const active = periodMatchesSelection(
                  period,
                  selectedYear,
                  selectedMonth,
                  selectedCompany,
                )
                const key = `${period.year}-${period.month}-${period.company ?? 'all'}`
                return (
                  <li key={key}>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => onSelectPeriod(period.year, period.month, company)}
                      className={`saved-period-btn group w-full text-left ${active ? 'saved-period-btn-active' : ''}`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="block text-sm font-semibold text-[var(--color-ink)]">
                          {monthLabel(period.year, period.month)}
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-[var(--color-brand)] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                          Open →
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-[var(--color-warm-text)]">
                        {period.employeeCount} employee{period.employeeCount === 1 ? '' : 's'}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.6875rem] text-[color-mix(in_srgb,var(--color-warm-text)_88%,transparent)]">
                        <span>Updated {formatRelativeTime(period.lastUpdated)}</span>
                        {period.approvedWeeks > 0 ? (
                          <span className="rounded-full bg-[var(--color-brand-muted)] px-2 py-0.5 font-medium text-[var(--color-brand)]">
                            {period.approvedWeeks} approved week
                            {period.approvedWeeks === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        ) : fetchingHistory && uploads.length === 0 ? (
          <LoadingState />
        ) : historyError ? (
          <ErrorState message={historyError} onRetry={() => void loadHistoryPage(historyPageSafe)} />
        ) : historyTotal === 0 ? (
          <EmptyState
            title="No files yet"
            hint="Each processed register appears here once, with a timeline of who processed it and when."
          />
        ) : (
          <ul className="space-y-2">
            {uploads.map((upload) => {
              const company = companySelectionFromRow(upload.company)
              const groupKey = `${upload.reportYear}-${upload.reportMonth}-${upload.company ?? 'all'}-${upload.reportType}-${upload.fileName}`
              const runs = upload.runs ?? []
              const hasMultipleRuns = upload.runCount > 1
              const runsExpanded = expandedRunKeys.has(groupKey)
              return (
                <li key={groupKey}>
                  <div className="saved-period-btn w-full text-left">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() =>
                        onOpenRegister
                          ? onOpenRegister(upload)
                          : onSelectPeriod(upload.reportYear, upload.reportMonth, company)
                      }
                      className="group w-full text-left"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span
                          className="min-w-0 truncate text-sm font-semibold text-[var(--color-ink)]"
                          title={upload.fileName}
                        >
                          {truncateFileName(upload.fileName)}
                        </span>
                        <span className="upload-type-badge">{reportTypeLabel(upload.reportType)}</span>
                      </span>
                      <span className="mt-1 block text-xs text-[var(--color-warm-text)]">
                        {shortMonthLabel(upload.reportYear, upload.reportMonth)}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-[0.6875rem] text-[color-mix(in_srgb,var(--color-warm-text)_88%,transparent)]">
                        <span>
                          {hasMultipleRuns
                            ? `Processed ${upload.runCount} times · Last ${formatRelativeTime(upload.lastProcessedAt)}`
                            : `${actorLabel(runs[0]?.actor)} · ${formatRelativeTime(upload.lastProcessedAt)}${
                                runs[0]?.employeeCount != null
                                  ? ` · ${runs[0].employeeCount} emp.`
                                  : ''
                              }`}
                        </span>
                        <span className="font-semibold text-[var(--color-brand)] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                          Open →
                        </span>
                      </span>
                    </button>
                    {hasMultipleRuns ? (
                      <div className="mt-2 border-t border-[color-mix(in_srgb,var(--color-warm-muted)_65%,transparent)] pt-2">
                        <button
                          type="button"
                          aria-expanded={runsExpanded}
                          onClick={() => toggleRunHistory(groupKey)}
                          className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[0.6875rem] font-medium text-[var(--color-brand)] hover:bg-[color-mix(in_srgb,var(--color-brand-muted)_45%,transparent)]"
                        >
                          <span className="tabular-nums" aria-hidden>
                            {runsExpanded ? '▲' : '▼'}
                          </span>
                          {runsExpanded
                            ? 'Hide processing history'
                            : `Show ${upload.runCount} processing runs`}
                        </button>
                        {runsExpanded ? (
                          <ul className="mt-1.5 space-y-1 pl-1">
                            {runs.map((run) => (
                              <li
                                key={run.id}
                                className="text-[0.6875rem] leading-snug text-[color-mix(in_srgb,var(--color-warm-text)_92%,transparent)]"
                                title={runSummary(run)}
                              >
                                <span className="font-medium text-[var(--color-ink)]">
                                  {actorLabel(run.actor)}
                                </span>
                                <span className="text-[var(--color-warm-text)]">
                                  {' '}
                                  · {formatDateTime(run.processedAt)}
                                  {run.employeeCount != null
                                    ? ` · ${run.employeeCount} emp.`
                                    : ''}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {tab === 'history' && historyTotal > HISTORY_PAGE_SIZE ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[color-mix(in_srgb,var(--color-warm-muted)_80%,transparent)] px-3 py-2.5">
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs disabled:opacity-40"
            disabled={panelBusy || historyPageSafe <= 0}
            onClick={() => setHistoryPage((p) => Math.max(0, p - 1))}
          >
            ← Newer
          </button>
          <span className="text-center text-[0.6875rem] tabular-nums text-[var(--color-warm-text)]">
            Page {historyPageSafe + 1} of {historyPageCount}
            <span className="block text-[color-mix(in_srgb,var(--color-warm-text)_75%,transparent)]">
              {historyTotal} register{historyTotal === 1 ? '' : 's'}
            </span>
          </span>
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs disabled:opacity-40"
            disabled={panelBusy || historyPageSafe >= historyPageCount - 1}
            onClick={() => setHistoryPage((p) => Math.min(historyPageCount - 1, p + 1))}
          >
            Older →
          </button>
        </div>
      ) : null}
    </section>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-[var(--color-warm-text)]">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-brand-muted)] border-t-[var(--color-brand)]"
        aria-hidden
      />
      Loading…
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-3 p-2">
      <p className="alert-error text-xs">{message}</p>
      <button type="button" onClick={onRetry} className="btn-ghost w-full text-xs">
        Retry
      </button>
    </div>
  )
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="px-2 py-6 text-center">
      <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--color-warm-text)]">{hint}</p>
    </div>
  )
}
