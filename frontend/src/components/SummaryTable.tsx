import { useMemo, useState } from 'react'
import type { AttendanceFilter, NormalizedEmployee } from '../types/attendance'
import { matchesSearch, rowMatchesFilter } from '../utils/attendance'

type Props = {
  employees: NormalizedEmployee[]
  search: string
  filter: AttendanceFilter
}

function fmtHours(n: number | null): string {
  if (n === null) return '-'
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

export function SummaryTable({ employees, search, filter }: Props) {
  const [sortDesc, setSortDesc] = useState(true)

  const rows = useMemo(() => {
    const filtered = employees.filter(
      (e) => matchesSearch(e, search) && rowMatchesFilter(e, filter),
    )
    const sorted = [...filtered].sort((a, b) => {
      const ta = a.totalHours ?? -Infinity
      const tb = b.totalHours ?? -Infinity
      return sortDesc ? tb - ta : ta - tb
    })
    return sorted
  }, [employees, search, filter, sortDesc])

  return (
    <section className="card overflow-hidden">
      <div className="card-head flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">Summary</h2>
          <p className="mt-1 text-sm text-[color-mix(in_srgb,var(--color-warm-text)_88%,transparent)]">
            Hours by week and month total
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSortDesc((s) => !s)}
          className="btn-secondary self-start"
        >
          Sort: {sortDesc ? 'high first' : 'low first'}
        </button>
      </div>

        <div className="table-scroll">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--color-teal-table)] text-[var(--color-surface)]">
            <tr>
              <th className="whitespace-nowrap border border-[var(--color-teal-table-border)] px-4 py-3 font-semibold">
                EmpName
              </th>
              <th className="whitespace-nowrap border border-[var(--color-teal-table-border)] px-3 py-3 text-right font-semibold">
                Week1
              </th>
              <th className="whitespace-nowrap border border-[var(--color-teal-table-border)] px-3 py-3 text-right font-semibold">
                Week2
              </th>
              <th className="whitespace-nowrap border border-[var(--color-teal-table-border)] px-3 py-3 text-right font-semibold">
                Week3
              </th>
              <th className="whitespace-nowrap border border-[var(--color-teal-table-border)] px-3 py-3 text-right font-semibold">
                Week4
              </th>
              <th className="whitespace-nowrap border border-[var(--color-teal-table-border)] px-3 py-3 text-right font-semibold">
                Week5
              </th>
              <th className="whitespace-nowrap border border-[var(--color-teal-table-border)] px-4 py-3 text-right font-semibold">
                Total hours
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="border border-[var(--color-warm-muted)] px-4 py-8 text-center text-[color-mix(in_srgb,var(--color-ink)_45%,transparent)]">
                  No rows match your search or filter.
                </td>
              </tr>
            ) : (
              rows.map((emp) => (
                <tr
                  key={`${emp.employeeCode}-${emp.employeeName}-sum`}
                  className="bg-[var(--color-surface)]"
                >
                  <td className="border border-[var(--color-warm-muted)] px-4 py-2.5 font-medium text-[var(--color-ink)]">
                    {emp.employeeName}
                  </td>
                  <td className="border border-[var(--color-warm-muted)] px-3 py-2.5 text-right tabular-nums text-[var(--color-warm-text)]">
                    {fmtHours(emp.week1)}
                  </td>
                  <td className="border border-[var(--color-warm-muted)] px-3 py-2.5 text-right tabular-nums text-[var(--color-warm-text)]">
                    {fmtHours(emp.week2)}
                  </td>
                  <td className="border border-[var(--color-warm-muted)] px-3 py-2.5 text-right tabular-nums text-[var(--color-warm-text)]">
                    {fmtHours(emp.week3)}
                  </td>
                  <td className="border border-[var(--color-warm-muted)] px-3 py-2.5 text-right tabular-nums text-[var(--color-warm-text)]">
                    {fmtHours(emp.week4)}
                  </td>
                  <td className="border border-[var(--color-warm-muted)] px-3 py-2.5 text-right tabular-nums text-[var(--color-warm-text)]">
                    {fmtHours(emp.week5)}
                  </td>
                  <td className="border border-[var(--color-warm-muted)] px-4 py-2.5 text-right text-base font-semibold tabular-nums text-[var(--color-teal-deep)]">
                    {fmtHours(emp.totalHours)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
