import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { downloadAdminSalaryWorkbookHistory } from '../api/admin'
import {
  loadSalaryWorkbookHistory,
  loadSalaryWorkbookPreview,
  type SalaryWorkbookHistoryEntry,
  type SalaryWorkbookHistoryPreview,
} from '../api/salary'
import type { SalaryUploadRow } from '../types/salary'
import { SALARY_COLUMN_LABELS } from '../constants/salaryColumnLabels'

const HISTORY_PAGE_SIZE = 10

type Props = {
  year: number
  month: number
  company: string
  refreshToken?: number
  allowDownload?: boolean
  compact?: boolean
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Unknown'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function truncateFileName(name: string, max = 34): string {
  const trimmed = name.trim() || 'Salary Excel'
  if (trimmed.length <= max) return trimmed
  const ext = trimmed.includes('.') ? trimmed.slice(trimmed.lastIndexOf('.')) : ''
  const baseMax = Math.max(max - ext.length - 1, 8)
  return `${trimmed.slice(0, baseMax)}…${ext}`
}

function PreviewTable({ rows }: { rows: SalaryUploadRow[] }) {
  if (rows.length === 0) {
    return <p className="px-3 py-4 text-sm text-[var(--color-warm-text)]">No rows in this file.</p>
  }

  return (
    <div className="table-scroll">
      <table className="min-w-max w-full border-collapse text-left text-xs sm:text-sm">
        <thead>
          <tr className="border-b border-[var(--color-warm-muted)] text-[0.65rem] uppercase tracking-wide text-[var(--color-warm-text)]">
            <th className="px-3 py-2">Code</th>
            <th className="px-3 py-2">Employee</th>
            <th className="px-3 py-2 text-right">{SALARY_COLUMN_LABELS.inHand}</th>
            <th className="px-3 py-2 text-right">{SALARY_COLUMN_LABELS.otherEarning}</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const ok = row.matched && row.errors.length === 0
            return (
              <tr
                key={row.rowNumber}
                className="border-b border-[color-mix(in_srgb,var(--color-warm-muted)_55%,transparent)]"
              >
                <td className="px-3 py-2 font-medium text-[var(--color-ink)]">{row.employeeCode || '-'}</td>
                <td className="px-3 py-2 text-[var(--color-warm-text)]">
                  {row.dbEmployeeName || row.employeeName || '-'}
                </td>
                <td className="px-3 py-2 text-right">{money(row.grossSalary)}</td>
                <td className="px-3 py-2 text-right">{money(row.adjustment)}</td>
                <td className="max-w-xs px-3 py-2 text-xs text-[var(--color-warm-text)]">
                  {row.errors.length ? (
                    <span className="text-red-700">{row.errors.join(' · ')}</span>
                  ) : ok ? (
                    'OK'
                  ) : (
                    'Not in register'
                  )}
                  {row.warnings.length ? ` · ${row.warnings.join(' · ')}` : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function SalaryWorkbookHistoryPanel({
  year,
  month,
  company,
  refreshToken = 0,
  allowDownload = false,
  compact = false,
}: Props) {
  const [entries, setEntries] = useState<SalaryWorkbookHistoryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [preview, setPreview] = useState<SalaryWorkbookHistoryPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [downloadId, setDownloadId] = useState<number | null>(null)

  const pageCount = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE))
  const pageSafe = Math.min(page, Math.max(0, pageCount - 1))

  const loadHistory = useCallback(async (pageToLoad: number) => {
    setLoading(true)
    setError(null)
    try {
      const offset = pageToLoad * HISTORY_PAGE_SIZE
      const data = await loadSalaryWorkbookHistory(year, month, company, HISTORY_PAGE_SIZE, offset)
      setEntries(data.entries)
      setTotal(data.total)
      const maxPage = Math.max(0, Math.ceil(data.total / HISTORY_PAGE_SIZE) - 1)
      if (pageToLoad > maxPage) setPage(maxPage)
      setExpandedId((current) =>
        current != null && data.entries.some((entry) => entry.id === current) ? current : null,
      )
    } catch (e) {
      setEntries([])
      setTotal(0)
      setError(
        axios.isAxiosError(e)
          ? ((e.response?.data as { message?: string })?.message ?? e.message)
          : 'Could not load upload history',
      )
    } finally {
      setLoading(false)
    }
  }, [year, month, company])

  useEffect(() => {
    setPage(0)
    setExpandedId(null)
  }, [year, month, company, refreshToken])

  useEffect(() => {
    void loadHistory(pageSafe)
  }, [loadHistory, pageSafe, refreshToken])

  useEffect(() => {
    if (expandedId == null) {
      setPreview(null)
      return
    }
    let cancelled = false
    setPreviewLoading(true)
    void loadSalaryWorkbookPreview(expandedId)
      .then((data) => {
        if (!cancelled) setPreview(data)
      })
      .catch(() => {
        if (!cancelled) setPreview(null)
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [expandedId])

  const onDownload = async (id: number) => {
    setDownloadId(id)
    try {
      await downloadAdminSalaryWorkbookHistory(id)
    } finally {
      setDownloadId(null)
    }
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4 rounded-xl border border-[var(--color-warm-muted)] p-4 sm:p-5'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className={`font-semibold text-[var(--color-ink)] ${compact ? 'text-sm' : 'text-base'}`}>
            Upload history
          </h3>
          <p className="mt-0.5 text-xs text-[var(--color-warm-text)]">
            Previously registered salary Excel files for this month. The current file is used for salary calculation.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={loading}
          onClick={() => void loadHistory(pageSafe)}
        >
          Refresh
        </button>
      </div>

      {error ? <p className="alert-error text-sm">{error}</p> : null}

      {loading ? (
        <p className="text-sm text-[var(--color-warm-text)]">Loading upload history…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-[var(--color-warm-text)]">No salary Excel uploads yet for this period.</p>
      ) : (
        <ul className="divide-y divide-[color-mix(in_srgb,var(--color-warm-muted)_65%,transparent)] rounded-xl border border-[var(--color-warm-muted)]">
          {entries.map((entry) => {
            const expanded = expandedId === entry.id
            return (
              <li key={entry.id}>
                <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-3 sm:px-4">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-[var(--color-ink)]">{truncateFileName(entry.fileName)}</span>
                      {entry.isCurrent ? (
                        <span className="rounded-full bg-[var(--color-brand-muted)] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--color-brand)]">
                          Current
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs text-[var(--color-warm-text)]">
                      {formatWhen(entry.uploadedAt)}
                      {entry.uploadedBy ? ` · ${entry.uploadedBy}` : ''} · {entry.summary.matchedRows} matched ·{' '}
                      {entry.summary.errorRows} with errors
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    {allowDownload ? (
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        disabled={downloadId === entry.id}
                        onClick={() => void onDownload(entry.id)}
                      >
                        {downloadId === entry.id ? 'Downloading…' : 'Download'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => setExpandedId(expanded ? null : entry.id)}
                    >
                      {expanded ? 'Hide preview' : 'Preview'}
                    </button>
                  </div>
                </div>
                {expanded ? (
                  <div className="border-t border-[color-mix(in_srgb,var(--color-warm-muted)_65%,transparent)] bg-[color-mix(in_srgb,var(--color-warm-muted)_12%,#fff)] pb-3">
                    {previewLoading || preview?.entry.id !== entry.id ? (
                      <p className="px-3 py-4 text-sm text-[var(--color-warm-text)]">Loading preview…</p>
                    ) : (
                      <PreviewTable rows={preview.rows} />
                    )}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {total > HISTORY_PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-2 border-t border-[color-mix(in_srgb,var(--color-warm-muted)_80%,transparent)] pt-3">
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs disabled:opacity-40"
            disabled={loading || pageSafe <= 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            ← Newer
          </button>
          <span className="text-center text-[0.6875rem] tabular-nums text-[var(--color-warm-text)]">
            Page {pageSafe + 1} of {pageCount}
            <span className="block text-[color-mix(in_srgb,var(--color-warm-text)_75%,transparent)]">
              {total} upload{total === 1 ? '' : 's'}
            </span>
          </span>
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs disabled:opacity-40"
            disabled={loading || pageSafe >= pageCount - 1}
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
          >
            Older →
          </button>
        </div>
      ) : total > 0 ? (
        <p className="text-xs text-[var(--color-warm-text)]">
          {total} upload{total === 1 ? '' : 's'}
        </p>
      ) : null}
    </div>
  )
}
