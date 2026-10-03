import { useMemo, useState } from 'react'
import {
  openPerformanceEmployeeAppraisal,
  type PerformanceAppraisalMode,
} from '../utils/performanceNavigation'
import { appraisalDirectoryStatus, appraisalDirectoryRatingCell, appraisalStatusBadgeClass } from '../utils/appraisalStatus'

export type AppraisalDirectoryRow = {
  employeeId: number
  employeeCode: string
  employeeName: string
  teamName: string | null
  canFill?: boolean
  overallEmployeeRating: number | null
  overallManagerRating: number | null
  employeeSubmittedAt?: string | null
  managerSubmittedAt?: string | null
  employeeUpdatedAt?: string | null
  managerUpdatedAt?: string | null
}

type TeamGroup = {
  teamName: string
  rows: AppraisalDirectoryRow[]
}

function groupByTeam(rows: AppraisalDirectoryRow[]): TeamGroup[] {
  const map = new Map<string, AppraisalDirectoryRow[]>()
  for (const row of rows) {
    const team = row.teamName?.trim() || 'Unassigned'
    const list = map.get(team) ?? []
    list.push(row)
    map.set(team, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([teamName, teamRows]) => ({
      teamName,
      rows: teamRows.sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
    }))
}

type Props = {
  rows: AppraisalDirectoryRow[]
  mode: PerformanceAppraisalMode
  emptyMessage: string
  actionLabel?: string
  openEmployee?: (employeeId: number, mode: PerformanceAppraisalMode, cycleYear?: number) => void
  cycleYear?: number
}

export function PerformanceAppraisalDirectory({
  rows,
  mode,
  emptyMessage,
  actionLabel = 'Open appraisal',
  openEmployee = openPerformanceEmployeeAppraisal,
  cycleYear,
}: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.employeeName.toLowerCase().includes(q) ||
        r.employeeCode.toLowerCase().includes(q) ||
        (r.teamName?.toLowerCase().includes(q) ?? false),
    )
  }, [rows, query])

  const groups = useMemo(() => groupByTeam(filtered), [filtered])

  if (rows.length === 0) {
    return (
      <div className="card border p-8 text-sm leading-relaxed text-[var(--color-warm-text)] sm:p-10">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[var(--color-warm-text)]">
          {rows.length} employee{rows.length === 1 ? '' : 's'} · grouped by team · opens in a new tab
        </p>
        <input
          type="search"
          className="doc-search max-w-md"
          placeholder="Search name, code, or team…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search appraisals"
        />
      </div>

      {groups.length === 0 ? (
        <div className="card border p-6 text-sm text-[var(--color-warm-text)]">No matches for your search.</div>
      ) : (
        groups.map((group) => (
          <section key={group.teamName} className="workspace-card p-0 overflow-hidden">
            <div className="border-b px-4 py-3 sm:px-5 border-[color-mix(in_srgb,var(--color-warm-muted)_55%,transparent)] bg-[color-mix(in_srgb,var(--color-warm-page)_40%,#fff)]">
              <h2 className="workspace-section-title">{group.teamName}</h2>
              <p className="workspace-section-desc">
                {group.rows.length} {group.rows.length === 1 ? 'person' : 'people'}
              </p>
            </div>
            <div className="report-table-wrap min-w-0">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Self</th>
                    <th>Manager</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => {
                    const status = appraisalDirectoryStatus(row)
                    return (
                      <tr key={row.employeeId}>
                        <td>
                          <button
                            type="button"
                            className="text-left font-medium text-[var(--color-ink)] hover:text-[var(--color-brand)]"
                            onClick={() => openEmployee(row.employeeId, mode, cycleYear)}
                          >
                            {row.employeeName}
                          </button>
                          <span className="block text-xs text-[var(--color-warm-text)]">{row.employeeCode}</span>
                        </td>
                        <td className="tabular-nums text-[var(--color-warm-text)]">
                          {appraisalDirectoryRatingCell(
                            row.overallEmployeeRating,
                            row.employeeSubmittedAt != null,
                          )}
                        </td>
                        <td className="tabular-nums text-[var(--color-warm-text)]">
                          {appraisalDirectoryRatingCell(
                            row.overallManagerRating,
                            row.managerSubmittedAt != null,
                          )}
                        </td>
                        <td>
                          <span className={appraisalStatusBadgeClass(status.tone)}>{status.label}</span>
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="btn btn-secondary text-sm py-1.5 px-3 whitespace-nowrap"
                            onClick={() => openEmployee(row.employeeId, mode, cycleYear)}
                          >
                            {actionLabel}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  )
}
