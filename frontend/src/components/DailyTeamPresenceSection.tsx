import { useMemo } from 'react'
import type { DailyAttendanceRecord, NormalizedEmployee } from '../types/attendance'
import { computeDailyTeamPresenceSummary, teamPresencePresentDenominator } from '../utils/dailyTeamPresence'

type Props = {
  employees: NormalizedEmployee[]
  dailyRecords: DailyAttendanceRecord[]
  reportYear: number
  reportMonth: number
  calendarDay: number
  dateLabelOverride?: string | null
}

function presenceTone(present: number, total: number): string {
  if (total === 0) return 'text-[var(--color-warm-text)]'
  if (present === total) return 'text-emerald-800'
  if (present === 0) return 'text-red-800'
  return 'text-amber-900'
}

export function DailyTeamPresenceSection({
  employees,
  dailyRecords,
  reportYear,
  reportMonth,
  calendarDay,
  dateLabelOverride,
}: Props) {
  const summary = useMemo(
    () =>
      computeDailyTeamPresenceSummary(
        employees,
        dailyRecords,
        reportYear,
        reportMonth,
        calendarDay,
        dateLabelOverride,
      ),
    [
      employees,
      dailyRecords,
      reportYear,
      reportMonth,
      calendarDay,
      dateLabelOverride,
    ],
  )

  if (summary.rows.length === 0) return null

  return (
    <section className="card border p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-[var(--color-brand)]">
            Team presence
          </p>
          <h2 className="mt-1 text-base font-semibold text-[var(--color-ink)] sm:text-lg">
            {summary.dateLabel}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-warm-text)]">
            Headcount present by team for this register day. Weekly off and leave are listed separately.
          </p>
        </div>
        <p className="text-sm font-medium tabular-nums text-[var(--color-ink)] sm:text-right">
          All teams:{' '}
          <span
            className={presenceTone(
              summary.totalPresent,
              teamPresencePresentDenominator({
                total: summary.totalHeadcount,
                weeklyOff: summary.totalWeeklyOff,
                leave: summary.totalLeave,
              }) || 1,
            )}
          >
            {summary.totalPresent}/
            {teamPresencePresentDenominator({
              total: summary.totalHeadcount,
              weeklyOff: summary.totalWeeklyOff,
              leave: summary.totalLeave,
            })}{' '}
            present
          </span>
        </p>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {summary.rows.map((row) => {
          const denom = teamPresencePresentDenominator(row)
          const label = `${row.present}/${denom} present`
          return (
            <li
              key={row.group.teamId ?? `unassigned-${row.group.teamName}`}
              className="rounded-lg border border-[color-mix(in_srgb,var(--color-warm-muted)_80%,transparent)] bg-[color-mix(in_srgb,var(--color-brand-muted)_35%,#fff)] px-3 py-2.5"
            >
              <p className="text-sm font-semibold text-[var(--color-ink)]">{row.group.teamName}</p>
              {row.group.teamManagerName ? (
                <p className="mt-0.5 text-xs text-[var(--color-warm-text)]">
                  Manager: {row.group.teamManagerName}
                </p>
              ) : null}
              <p
                className={`mt-1.5 text-sm font-semibold tabular-nums ${presenceTone(row.present, denom || 1)}`}
              >
                {label}
              </p>
              {row.weeklyOff > 0 ? (
                <p className="mt-0.5 text-xs text-[var(--color-warm-text)]">
                  {row.weeklyOff} weekly off
                </p>
              ) : null}
              {row.leave > 0 ? (
                <p className="mt-0.5 text-xs text-[var(--color-warm-text)]">
                  {row.leave} on leave
                </p>
              ) : null}
              {row.absent > 0 ? (
                <p className="mt-0.5 text-xs text-[var(--color-warm-text)]">
                  {row.absent} absent
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
