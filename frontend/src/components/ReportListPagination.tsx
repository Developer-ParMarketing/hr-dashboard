import { useEffect, useMemo, useState } from 'react'

export type ReportPageSize = 5 | 10 | 20

const PAGE_SIZE_OPTIONS: ReportPageSize[] = [5, 10, 20]

export function useReportListPagination<T>(
  items: T[],
  enabled: boolean,
  resetKey = '',
): {
  page: number
  setPage: (page: number) => void
  pageSize: ReportPageSize
  setPageSize: (size: ReportPageSize) => void
  pageItems: T[]
  totalPages: number
  rangeLabel: string
} {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<ReportPageSize>(5)

  useEffect(() => {
    setPage(1)
  }, [items.length, pageSize, resetKey])

  const totalPages = useMemo(
    () => (enabled ? Math.max(1, Math.ceil(items.length / pageSize)) : 1),
    [enabled, items.length, pageSize],
  )

  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const pageItems = useMemo(() => {
    if (!enabled) return items
    const start = (page - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [enabled, items, page, pageSize])

  const rangeLabel = useMemo(() => {
    if (!enabled || items.length === 0) return '0 records'
    const from = (page - 1) * pageSize + 1
    const to = Math.min(page * pageSize, items.length)
    return `${from}-${to} of ${items.length}`
  }, [enabled, items.length, page, pageSize])

  return { page, setPage, pageSize, setPageSize, pageItems, totalPages, rangeLabel }
}

type ReportListPaginationBarProps = {
  page: number
  totalPages: number
  pageSize: ReportPageSize
  rangeLabel: string
  onPageChange: (page: number) => void
  onPageSizeChange: (size: ReportPageSize) => void
}

export function ReportListPaginationBar({
  page,
  totalPages,
  pageSize,
  rangeLabel,
  onPageChange,
  onPageSizeChange,
}: ReportListPaginationBarProps) {
  return (
    <div className="report-list-pagination">
      <p className="report-list-pagination-range">{rangeLabel}</p>
      <div className="report-list-pagination-controls">
        <label className="feature-field report-list-pagination-size">
          <span className="sr-only">Rows per page</span>
          <select
            className="field field-compact"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number.parseInt(e.target.value, 10) as ReportPageSize)}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} per page
              </option>
            ))}
          </select>
        </label>
        <div className="report-list-pagination-nav">
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </button>
          <span className="text-xs tabular-nums text-[var(--color-warm-text)]">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="btn-ghost px-2 py-1 text-xs"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}
