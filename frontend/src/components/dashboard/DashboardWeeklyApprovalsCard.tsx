import { useState } from 'react'
import type { DashboardWeeklyWeekSummary, DashboardSummary } from '../../types/dashboard'
import type { MetricStatus } from './DonutMetricCard'
import { DonutMetricCard } from './DonutMetricCard'
import { formatDisplayDateRange } from '../../utils/displayDate'

type Props = {
  attendance: DashboardSummary['attendance'] | undefined
  loading: boolean
  payrollMonthOnly: boolean
  periodLabel: string
  cardTitle: string
}

function weekStatusLabel(week: DashboardWeeklyWeekSummary): string {
  if (week.complete) return 'Locked'
  if (week.peopleApproved === 0) return 'Pending'
  return `${week.peopleApproved}/${week.peopleTotal} approved`
}

export function buildWeeklyApprovalView(
  attendance: DashboardSummary['attendance'] | undefined,
  opts: { payrollMonthOnly: boolean },
): {
  cardTitle: string
  value: string
  percent: number | null
  status: MetricStatus
  progressLabel: string
  caption: string
  weeks: DashboardWeeklyWeekSummary[]
} {
  const cardTitle = opts.payrollMonthOnly ? 'Weekly approvals' : 'Weekly approvals in period'
  const weeks = attendance?.weeklyWeeks ?? []
  const calTotal = attendance?.weeklyCalendarWeeksTotal ?? weeks.length
  const calComplete = attendance?.weeklyCalendarWeeksComplete ?? weeks.filter((w) => w.complete).length
  const calPending = Math.max(0, calTotal - calComplete)

  if (!attendance) {
    return {
      cardTitle,
      value: '-',
      percent: null,
      status: 'not_started',
      progressLabel: 'Loading…',
      caption: 'Loading…',
      weeks: [],
    }
  }

  if (weeks.length > 0 || calTotal > 0) {
    const total = calTotal || weeks.length
    const complete = calComplete || weeks.filter((w) => w.complete).length
    const percent = total > 0 ? Math.round((complete / total) * 100) : null
    const done = complete === total && total > 0 && attendance.weeklyPending === 0
    return {
      cardTitle,
      value: `${complete}/${total}`,
      percent,
      status: done ? 'done' : 'in_progress',
      progressLabel: done
        ? 'Every week locked for all people'
        : `${calPending} week${calPending === 1 ? '' : 's'} still need full approval`,
      caption: `${attendance.employeeCount} people on register · expand week breakdown for each calendar week`,
      weeks,
    }
  }

  if (attendance.hasData) {
    return {
      cardTitle,
      value: '0/0',
      percent: null,
      status: 'not_started',
      progressLabel: 'No weekly register rows yet',
      caption: 'Daily attendance is loaded - open or upload the weekly register.',
      weeks: [],
    }
  }

  return {
    cardTitle,
    value: '-',
    percent: null,
    status: 'not_started',
    progressLabel: 'Not started',
    caption: 'Upload attendance for this period first.',
    weeks: [],
  }
}

export function DashboardWeeklyApprovalsCard({
  attendance,
  loading,
  payrollMonthOnly,
  cardTitle: titleOverride,
}: Props) {
  const [weeksOpen, setWeeksOpen] = useState(false)
  const view = buildWeeklyApprovalView(attendance, { payrollMonthOnly })
  const title = titleOverride || view.cardTitle

  return (
    <div className="dashboard-weekly-approvals">
      <DonutMetricCard
        title={title}
        value={loading ? '…' : view.value}
        caption={loading ? 'Loading…' : view.caption}
        percent={loading ? null : view.percent}
        status={loading ? 'not_started' : view.status}
        insight="attendance"
        progressLabel={loading ? 'Loading…' : view.progressLabel}
      />
      {!loading && view.weeks.length > 0 ? (
        <div className="dashboard-weekly-approvals-weeks">
          <button
            type="button"
            className="dashboard-weekly-approvals-toggle"
            onClick={() => setWeeksOpen((v) => !v)}
            aria-expanded={weeksOpen}
            aria-controls="dashboard-weekly-approvals-panel"
          >
            {weeksOpen ? 'Hide' : 'Show'} week breakdown ({view.weeks.length})
            <span className="dashboard-weekly-approvals-chevron" aria-hidden>
              {weeksOpen ? '▴' : '▾'}
            </span>
          </button>
          {weeksOpen ? (
            <ul
              id="dashboard-weekly-approvals-panel"
              className="dashboard-weekly-approvals-list"
              aria-label="Approval status by calendar week"
            >
              {view.weeks.map((week) => {
                const label = formatDisplayDateRange(week.weekStart, week.weekEnd)
                const pct =
                  week.peopleTotal > 0
                    ? Math.round((week.peopleApproved / week.peopleTotal) * 100)
                    : 0
                return (
                  <li key={week.weekStart} className="dashboard-weekly-approvals-row">
                    <span className="dashboard-weekly-approvals-week" title={label}>
                      {label}
                    </span>
                    <div className="dashboard-weekly-approvals-track">
                      <div
                        className="dashboard-weekly-approvals-fill"
                        data-complete={week.complete ? 'true' : undefined}
                        style={{ width: `${week.complete ? 100 : pct}%` }}
                      />
                    </div>
                    <span className="dashboard-weekly-approvals-status tabular-nums">
                      {weekStatusLabel(week)}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
