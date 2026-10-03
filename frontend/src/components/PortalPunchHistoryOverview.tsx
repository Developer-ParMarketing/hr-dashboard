import { useMemo } from 'react'
import type { PortalPunchHistorySummary } from '../utils/portalPunchHistory'
import type { PortalPunchLegRecord } from '../api/portalPunch'
import { summarizePortalPunchesForYear } from '../utils/portalPunchHistory'

type PortalPunchHistoryOverviewProps = {
  punches: PortalPunchLegRecord[]
  year: number
  onYearChange?: (year: number) => void
  heading?: string
  subheading?: string
}

function yearOptions(anchor: number): number[] {
  const out: number[] = []
  for (let y = anchor - 2; y <= anchor + 1; y += 1) out.push(y)
  return out
}

function SummaryTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="report-summary-item">
      <span className="report-summary-value">{value}</span>
      <span className="report-summary-label">{label}</span>
      {hint ? <span className="mt-0.5 text-[0.65rem] text-[var(--color-warm-text)]">{hint}</span> : null}
    </div>
  )
}

function MonthlyPunchChart({ summary }: { summary: PortalPunchHistorySummary }) {
  const maxCount = useMemo(
    () => Math.max(1, ...summary.monthly.map((m) => m.requestCount)),
    [summary.monthly],
  )

  return (
    <div className="leave-history-monthly">
      <p className="report-block-title mb-3">In/out requests by month ({summary.year})</p>
      <div className="leave-history-monthly-grid" role="img" aria-label="Monthly in/out requests">
        {summary.monthly.map((bucket) => {
          const heightPct =
            bucket.requestCount > 0 ? Math.round((bucket.requestCount / maxCount) * 100) : 0
          const title = `${bucket.label}: ${bucket.requestCount} request${bucket.requestCount === 1 ? '' : 's'} (${bucket.inCount} in, ${bucket.outCount} out)`
          return (
            <div key={bucket.month} className="leave-history-monthly-cell" title={title}>
              <div className="leave-history-monthly-bar-wrap">
                <div
                  className="leave-history-monthly-bar"
                  style={{ height: `${heightPct}%` }}
                  aria-hidden
                />
              </div>
              <span className="leave-history-monthly-value tabular-nums">
                {bucket.requestCount || '·'}
              </span>
              <span className="leave-history-monthly-label">{bucket.label}</span>
              {bucket.requestCount > 0 ? (
                <span className="leave-history-monthly-meta">
                  {bucket.inCount} in · {bucket.outCount} out
                  {bucket.pendingCount > 0 ? ` · ${bucket.pendingCount} pending` : ''}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PortalPunchHistoryOverview({
  punches,
  year,
  onYearChange,
  heading,
  subheading,
}: PortalPunchHistoryOverviewProps) {
  const summary = useMemo(() => summarizePortalPunchesForYear(punches, year), [punches, year])

  if (summary.requestCounts.total === 0 && !onYearChange) {
    return (
      <div className="workspace-card text-sm text-[var(--color-warm-text)]">
        No in/out requests in {year}.
      </div>
    )
  }

  const { requestCounts, legCounts, pendingLegCounts } = summary

  return (
    <section className="leave-history-overview workspace-card" aria-label={heading ?? 'In/out history'}>
      <div className="leave-history-overview-head">
        <div>
          {heading ? <h2 className="report-block-title text-base">{heading}</h2> : null}
          {subheading ? <p className="mt-1 text-sm text-[var(--color-warm-text)]">{subheading}</p> : null}
        </div>
        {onYearChange ? (
          <label className="feature-field leave-history-year-field">
            <span className="sr-only">Year</span>
            <select
              className="field field-compact"
              value={year}
              onChange={(e) => onYearChange(Number.parseInt(e.target.value, 10))}
            >
              {yearOptions(new Date().getFullYear()).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="report-summary mt-4">
        <SummaryTile label="Requests" value={requestCounts.total} hint="Check-in + check-out" />
        <SummaryTile
          label="Pending"
          value={requestCounts.pending}
          hint={`${pendingLegCounts.in} in · ${pendingLegCounts.out} out`}
        />
        <SummaryTile label="Approved" value={requestCounts.approved} />
        <SummaryTile label="Rejected" value={requestCounts.rejected} />
        <SummaryTile label="Check-ins" value={legCounts.in} />
        <SummaryTile label="Check-outs" value={legCounts.out} />
      </div>

      {requestCounts.total === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-warm-text)]">No in/out requests in {year}.</p>
      ) : (
        <div className="leave-history-overview-body mt-6">
          <MonthlyPunchChart summary={summary} />
        </div>
      )}
    </section>
  )
}
