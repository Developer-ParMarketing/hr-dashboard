import { useMemo } from 'react'
import {
  leaveTypeAccent,
  leaveTypeLabel,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveType,
} from '../api/leaveRequests'
import {
  filterLeaveRequestsForYear,
  summarizeLeaveRequestsForYear,
  type LeaveHistorySummary,
} from '../utils/leaveRequestHistory'

type LeaveRequestHistoryOverviewProps = {
  requests: LeaveRequest[]
  year: number
  onYearChange?: (year: number) => void
  balance?: LeaveBalance | null
  heading?: string
  subheading?: string
}

const LEAVE_TYPES: LeaveType[] = ['pl', 'sl', 'cl']

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

function MonthlyLeaveChart({ summary }: { summary: LeaveHistorySummary }) {
  const maxDays = useMemo(
    () => Math.max(1, ...summary.monthly.map((m) => m.days)),
    [summary.monthly],
  )

  return (
    <div className="leave-history-monthly">
      <p className="report-block-title mb-3">Leave days by month ({summary.year})</p>
      <div className="leave-history-monthly-grid" role="img" aria-label="Monthly leave days">
        {summary.monthly.map((bucket) => {
          const heightPct = bucket.days > 0 ? Math.round((bucket.days / maxDays) * 100) : 0
          const title = `${bucket.label}: ${bucket.days} day${bucket.days === 1 ? '' : 's'}`
          return (
            <div key={bucket.month} className="leave-history-monthly-cell" title={title}>
              <div className="leave-history-monthly-bar-wrap">
                <div
                  className="leave-history-monthly-bar"
                  style={{ height: `${heightPct}%` }}
                  aria-hidden
                />
              </div>
              <span className="leave-history-monthly-value tabular-nums">{bucket.days || '·'}</span>
              <span className="leave-history-monthly-label">{bucket.label}</span>
              {bucket.requestCount > 0 ? (
                <span className="leave-history-monthly-meta">
                  {bucket.requestCount} req
                  {bucket.pendingDays > 0 ? ` · ${bucket.pendingDays} pending` : ''}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
      <p className="report-summary-note mt-2">
        Bars show total leave days in each month (PL, SL, CL combined). Pending days are noted under the month when
        applicable.
      </p>
    </div>
  )
}

function TypeBreakdown({ summary }: { summary: LeaveHistorySummary }) {
  return (
    <div className="leave-history-types">
      <p className="report-block-title mb-2">By leave type (days in {summary.year})</p>
      <ul className="leave-history-type-list">
        {LEAVE_TYPES.map((type) => {
          const accent = leaveTypeAccent(type)
          const days = summary.daysApplied[type]
          const pending = summary.pendingDaysByType[type]
          return (
            <li key={type} className="leave-history-type-row">
              <span className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold ${accent.soft}`}>
                {leaveTypeLabel(type)}
              </span>
              <span className="tabular-nums font-medium text-[var(--color-ink)]">
                {days} day{days === 1 ? '' : 's'}
              </span>
              {pending > 0 ? (
                <span className="text-xs text-amber-800">{pending} pending</span>
              ) : (
                <span className="text-xs text-[var(--color-warm-text)]">-</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function LeaveRequestHistoryOverview({
  requests,
  year,
  onYearChange,
  balance,
  heading,
  subheading,
}: LeaveRequestHistoryOverviewProps) {
  const yearRequests = useMemo(() => filterLeaveRequestsForYear(requests, year), [requests, year])
  const summary = useMemo(() => summarizeLeaveRequestsForYear(requests, year), [requests, year])

  if (summary.requestCounts.total === 0 && !onYearChange) {
    return (
      <div className="workspace-card text-sm text-[var(--color-warm-text)]">
        No leave requests in {year}.
      </div>
    )
  }

  const { requestCounts, pendingDays } = summary

  return (
    <section className="leave-history-overview workspace-card" aria-label={heading ?? 'Leave history'}>
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
        <SummaryTile label="Requests" value={requestCounts.total} hint="In this year" />
        <SummaryTile label="Pending" value={requestCounts.pending} hint={`${pendingDays} day${pendingDays === 1 ? '' : 's'}`} />
        <SummaryTile label="Approved" value={requestCounts.approved} />
        <SummaryTile label="Rejected" value={requestCounts.rejected} />
        {balance ? (
          <SummaryTile
            label="Balance left"
            value={`${balance.remaining.pl + balance.remaining.sl + balance.remaining.cl}`}
            hint="PL+SL+CL remaining"
          />
        ) : null}
      </div>

      {requestCounts.total === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-warm-text)]">No leave requests in {year}.</p>
      ) : (
        <div className="leave-history-overview-body">
          <TypeBreakdown summary={summary} />
          <MonthlyLeaveChart summary={summary} />
        </div>
      )}

      {yearRequests.length > 0 ? (
        <p className="report-summary-note mt-4">
          {yearRequests.length} request{yearRequests.length === 1 ? '' : 's'} overlap {year}. Details are in the table
          below.
        </p>
      ) : null}
    </section>
  )
}
