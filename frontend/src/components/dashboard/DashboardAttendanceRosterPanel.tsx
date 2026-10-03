import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardAttendanceEmployeeRow, DashboardRangePreset } from '../../types/dashboard'

type Props = {
  rows: DashboardAttendanceEmployeeRow[] | null
  loading: boolean
  periodLabel: string
  patternCompareLabel: string | null
  periodPreset: DashboardRangePreset
  isSingleCalendarMonth: boolean
  hasRegisterData: boolean
  scopeLabel: string
  href: (path: string) => string
}

type RiskTier = 'high' | 'medium' | 'low' | 'none'

function riskTier(score: number): RiskTier {
  if (score >= 70) return 'high'
  if (score >= 45) return 'medium'
  if (score > 0) return 'low'
  return 'none'
}

function riskLabel(tier: RiskTier): string | null {
  if (tier === 'high') return 'High'
  if (tier === 'medium') return 'Medium'
  if (tier === 'low') return 'Low'
  return null
}

function rowNeedsAttention(row: DashboardAttendanceEmployeeRow): boolean {
  return row.warnings.length > 0 || row.insights.length > 0 || row.anomalyScore > 0
}

function fmtNum(value: number | null | undefined): string {
  if (value == null) return '-'
  return String(value)
}

function firstName(name: string): string {
  const part = name.trim().split(/\s+/)[0]
  return part || name
}

type StatusBucket = 'ok' | 'policy' | 'pattern' | 'both' | 'missing'

function statusBucket(row: DashboardAttendanceEmployeeRow): StatusBucket {
  if (!row.hasAttendance && row.warnings.some((w) => w.toLowerCase().includes('register'))) {
    return 'missing'
  }
  const hasPolicy = row.warnings.length > 0
  const hasPattern = row.insights.length > 0 || row.anomalyScore > 0
  if (hasPolicy && hasPattern) return 'both'
  if (hasPolicy) return 'policy'
  if (hasPattern) return 'pattern'
  return 'ok'
}

const BUCKET_META: Record<
  StatusBucket,
  { label: string; barClass: string; desc: string }
> = {
  ok: { label: 'All clear', barClass: 'attendance-seg-ok', desc: 'No policy or pattern flags' },
  policy: { label: 'Policy', barClass: 'attendance-seg-policy', desc: 'HR rule warnings' },
  pattern: { label: 'Unusual', barClass: 'attendance-seg-pattern', desc: 'Vs prior period' },
  both: { label: 'Both', barClass: 'attendance-seg-both', desc: 'Policy + pattern' },
  missing: { label: 'Not on register', barClass: 'attendance-seg-missing', desc: 'Missing from upload' },
}

function AttendanceStatusBar({ rows }: { rows: DashboardAttendanceEmployeeRow[] }) {
  const counts = useMemo(() => {
    const c: Record<StatusBucket, number> = {
      ok: 0,
      policy: 0,
      pattern: 0,
      both: 0,
      missing: 0,
    }
    for (const row of rows) c[statusBucket(row)] += 1
    return c
  }, [rows])

  const total = rows.length || 1
  const order: StatusBucket[] = ['ok', 'policy', 'pattern', 'both', 'missing']

  return (
    <figure className="attendance-viz-block" aria-label="Team attendance status breakdown">
      <figcaption className="attendance-viz-caption">Who needs attention</figcaption>
      <div className="attendance-stacked-bar" role="img" aria-hidden={false}>
        {order.map((key) => {
          const n = counts[key]
          if (n === 0) return null
          const pct = (n / total) * 100
          const meta = BUCKET_META[key]
          return (
            <div
              key={key}
              className={`attendance-stacked-seg ${meta.barClass}`}
              style={{ width: `${pct}%` }}
              title={`${meta.label}: ${n}`}
            >
              {pct >= 12 ? <span className="attendance-stacked-seg-label">{n}</span> : null}
            </div>
          )
        })}
      </div>
      <ul className="attendance-legend">
        {order.map((key) => {
          const n = counts[key]
          if (n === 0) return null
          return (
            <li key={key}>
              <span className={`attendance-legend-swatch ${BUCKET_META[key].barClass}`} aria-hidden />
              <span>
                {BUCKET_META[key].label}{' '}
                <strong className="tabular-nums">{n}</strong>
                <span className="text-[var(--color-warm-text)]"> · {BUCKET_META[key].desc}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </figure>
  )
}

function LateMarksChart({ rows }: { rows: DashboardAttendanceEmployeeRow[] }) {
  const items = useMemo(() => {
    return rows
      .filter((r) => (r.lateMarks ?? 0) > 0)
      .sort((a, b) => (b.lateMarks ?? 0) - (a.lateMarks ?? 0))
      .slice(0, 8)
  }, [rows])

  const max = Math.max(1, ...items.map((r) => r.lateMarks ?? 0))

  if (items.length === 0) {
    return (
      <figure className="attendance-viz-block">
        <figcaption className="attendance-viz-caption">Late marks</figcaption>
        <p className="text-sm text-emerald-800">No late marks on register this month.</p>
      </figure>
    )
  }

  return (
    <figure className="attendance-viz-block" aria-label="Employees with the most late marks">
      <figcaption className="attendance-viz-caption">Late marks (top {items.length})</figcaption>
      <ul className="attendance-hbar-list">
        {items.map((row) => {
          const late = row.lateMarks ?? 0
          const w = (late / max) * 100
          return (
            <li key={row.employeeId} className="attendance-hbar-row">
              <span className="attendance-hbar-name" title={row.employeeName}>
                {firstName(row.employeeName)}
              </span>
              <div className="attendance-hbar-track">
                <div
                  className="attendance-hbar-fill"
                  style={{ width: `${w}%` }}
                  data-high={late >= 4 ? 'true' : undefined}
                />
              </div>
              <span className="attendance-hbar-value tabular-nums">{late}</span>
            </li>
          )
        })}
      </ul>
    </figure>
  )
}

function patternRiskCaption(
  periodLabel: string,
  compareLabel: string,
  preset: DashboardRangePreset,
  isSingleCalendarMonth: boolean,
): string {
  if (isSingleCalendarMonth) {
    return `Policy totals use ${periodLabel}. Pattern scores compare each person to the previous calendar month (${compareLabel}).`
  }
  if (preset === 'quarterly') {
    return `Policy totals use ${periodLabel}. Pattern scores compare to the prior quarter-length window (${compareLabel}).`
  }
  if (preset === 'yearly') {
    return `Policy totals use ${periodLabel}. Pattern scores compare to the prior year-length window (${compareLabel}).`
  }
  return `Policy totals use ${periodLabel}. Pattern scores compare to the immediately preceding span of the same length (${compareLabel}).`
}

function RiskChart({
  rows,
  periodLabel,
  patternCompareLabel,
  periodPreset,
  isSingleCalendarMonth,
}: {
  rows: DashboardAttendanceEmployeeRow[]
  periodLabel: string
  patternCompareLabel: string | null
  periodPreset: DashboardRangePreset
  isSingleCalendarMonth: boolean
}) {
  const compareLabel = patternCompareLabel?.trim() || 'prior period'
  const counts = useMemo(() => {
    let high = 0
    let medium = 0
    let low = 0
    for (const row of rows) {
      if (!row.hasAttendance || (row.patternHistoryMonths ?? 0) < 1) continue
      const t = riskTier(row.anomalyScore)
      if (t === 'high') high += 1
      else if (t === 'medium') medium += 1
      else if (t === 'low') low += 1
    }
    return { high, medium, low }
  }, [rows])

  const max = Math.max(1, counts.high, counts.medium, counts.low)
  const tiers: Array<{ key: string; label: string; n: number; className: string }> = [
    { key: 'high', label: 'High risk', n: counts.high, className: 'attendance-risk-high' },
    { key: 'medium', label: 'Medium', n: counts.medium, className: 'attendance-risk-medium' },
    { key: 'low', label: 'Low', n: counts.low, className: 'attendance-risk-low' },
  ]

  return (
    <figure className="attendance-viz-block" aria-label="Pattern risk levels">
      <figcaption className="attendance-viz-caption">
        Pattern risk · {periodLabel} vs {compareLabel}
      </figcaption>
      <p className="attendance-viz-note">
        {patternRiskCaption(periodLabel, compareLabel, periodPreset, isSingleCalendarMonth)}
      </p>
      <ul className="attendance-hbar-list">
        {tiers.map((t) => (
          <li key={t.key} className="attendance-hbar-row">
            <span className="attendance-hbar-name">{t.label}</span>
            <div className="attendance-hbar-track">
              <div
                className={`attendance-hbar-fill ${t.className}`}
                style={{ width: `${(t.n / max) * 100}%` }}
              />
            </div>
            <span className="attendance-hbar-value tabular-nums">{t.n}</span>
          </li>
        ))}
      </ul>
    </figure>
  )
}

function EmployeeAttendanceCard({ row }: { row: DashboardAttendanceEmployeeRow }) {
  const tier = riskTier(row.anomalyScore)
  const risk = riskLabel(tier)
  const attention = rowNeedsAttention(row)

  return (
    <article
      className={`attendance-emp-card${attention ? ' attendance-emp-card-flagged' : ''}`}
      aria-label={`${row.employeeName} attendance summary`}
    >
      <header className="attendance-emp-card-head">
        <div className="min-w-0">
          <h4 className="truncate font-semibold text-[var(--color-ink)]">{row.employeeName}</h4>
          <p className="truncate text-xs text-[var(--color-warm-text)]">
            {row.employeeCode}
            {row.teamName ? ` · ${row.teamName}` : ''}
          </p>
        </div>
        {risk ? (
          <span className={`attendance-risk-pill attendance-risk-pill-${tier}`}>{risk}</span>
        ) : (
          <span className="attendance-risk-pill attendance-risk-pill-none">OK</span>
        )}
      </header>

      <dl className="attendance-emp-metrics">
        <div>
          <dt>Pay days</dt>
          <dd>{row.hasAttendance ? fmtNum(row.payDays) : '-'}</dd>
        </div>
        <div>
          <dt>WFH</dt>
          <dd>{row.hasAttendance ? fmtNum(row.wfhDays) : '-'}</dd>
        </div>
        <div>
          <dt>Late</dt>
          <dd>{row.hasAttendance ? fmtNum(row.lateMarks) : '-'}</dd>
        </div>
        <div>
          <dt>Absent</dt>
          <dd>{row.hasAttendance ? fmtNum(row.absentDays) : '-'}</dd>
        </div>
      </dl>

      {row.warnings.length > 0 ? (
        <div className="attendance-emp-notes-block">
          <p className="attendance-emp-notes-heading">Policy &amp; register</p>
          <ul className="attendance-emp-notes attendance-emp-notes-policy">
            {row.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {row.insights.length > 0 ? (
        <div className="attendance-emp-notes-block">
          <p className="attendance-emp-notes-heading">Compared to prior period</p>
          <ul className="attendance-emp-notes attendance-emp-notes-pattern">
            {row.insights.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {!attention && row.hasAttendance ? (
        <p className="attendance-emp-ok text-xs text-emerald-800">No warnings this month.</p>
      ) : null}
    </article>
  )
}

export function DashboardAttendanceRosterPanel({
  rows,
  loading,
  periodLabel,
  patternCompareLabel,
  periodPreset,
  isSingleCalendarMonth,
  hasRegisterData,
  scopeLabel,
  href,
}: Props) {
  const [filter, setFilter] = useState<'attention' | 'all'>('attention')
  const safeRows = rows ?? []

  const stats = useMemo(() => {
    if (!safeRows.length) {
      return { total: 0, attention: 0, policy: 0, pattern: 0, onRegister: 0 }
    }
    let attention = 0
    let policy = 0
    let pattern = 0
    let onRegister = 0
    for (const row of safeRows) {
      if (row.hasAttendance) onRegister += 1
      if (row.warnings.length > 0) policy += 1
      if (row.insights.length > 0) pattern += 1
      if (rowNeedsAttention(row)) attention += 1
    }
    return { total: safeRows.length, attention, policy, pattern, onRegister }
  }, [safeRows])

  const visibleRows = useMemo(() => {
    if (filter === 'all') return safeRows
    return safeRows.filter((r) => rowNeedsAttention(r))
  }, [safeRows, filter])

  if (rows == null) return null

  return (
    <section className="card dashboard-attendance-roster border" aria-labelledby="dashboard-attendance-roster-title">
      <header className="dashboard-attendance-roster-head">
        <div>
          <h2 id="dashboard-attendance-roster-title" className="text-lg font-semibold text-[var(--color-ink)]">
            Attendance summary &amp; warnings
          </h2>
          <p className="mt-1 text-sm text-[var(--color-warm-text)]">
            {scopeLabel} · {periodLabel}
            {!loading && hasRegisterData ? (
              <>
                {' '}
                · {stats.onRegister}/{stats.total} on register · {stats.attention} need attention
              </>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-[var(--color-warm-text)]">
            Management team members are not included in this analysis.
          </p>
        </div>
        <Link to={href('/attendance?tab=monthly')} className="btn-secondary shrink-0 text-sm">
          Open attendance
        </Link>
      </header>

      {loading ? (
        <p className="dashboard-attendance-roster-body text-sm text-[var(--color-warm-text)]">Loading…</p>
      ) : !hasRegisterData ? (
        <p className="dashboard-attendance-roster-body text-sm text-[var(--color-warm-text)]">
          No attendance register uploaded for this period yet. Upload the monthly register to see summaries and
          warnings here.
        </p>
      ) : rows.length === 0 ? (
        <p className="dashboard-attendance-roster-body text-sm text-[var(--color-warm-text)]">
          No employees in this scope.
        </p>
      ) : (
        <div className="dashboard-attendance-roster-body attendance-viz-layout">
          <div className="attendance-kpi-row">
            <div className="attendance-kpi">
              <span className="attendance-kpi-value tabular-nums">{stats.onRegister}</span>
              <span className="attendance-kpi-label">On register</span>
            </div>
            <div className="attendance-kpi attendance-kpi-ok">
              <span className="attendance-kpi-value tabular-nums">{stats.total - stats.attention}</span>
              <span className="attendance-kpi-label">All clear</span>
            </div>
            <div className="attendance-kpi attendance-kpi-warn">
              <span className="attendance-kpi-value tabular-nums">{stats.policy}</span>
              <span className="attendance-kpi-label">Policy flags</span>
            </div>
            <div className="attendance-kpi attendance-kpi-pattern">
              <span className="attendance-kpi-value tabular-nums">{stats.pattern}</span>
              <span className="attendance-kpi-label">Unusual vs prior period</span>
            </div>
          </div>

          <div className="attendance-charts-grid">
            <AttendanceStatusBar rows={rows} />
            <LateMarksChart rows={rows} />
            <RiskChart
              rows={rows}
              periodLabel={periodLabel}
              patternCompareLabel={patternCompareLabel}
              periodPreset={periodPreset}
              isSingleCalendarMonth={isSingleCalendarMonth}
            />
          </div>

          <div className="attendance-emp-section-head">
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">People</h3>
            <div className="seg text-xs" role="tablist" aria-label="Filter people list">
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'attention'}
                className={`seg-btn ${filter === 'attention' ? 'seg-btn-active' : ''}`}
                onClick={() => setFilter('attention')}
              >
                Needs attention ({stats.attention})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'all'}
                className={`seg-btn ${filter === 'all' ? 'seg-btn-active' : ''}`}
                onClick={() => setFilter('all')}
              >
                Everyone ({stats.total})
              </button>
            </div>
          </div>

          <div className="dashboard-attendance-roster-scroll attendance-emp-card-grid">
            {visibleRows.length === 0 ? (
              <p className="col-span-full py-6 text-center text-sm text-emerald-800">
                No one flagged for this filter - switch to Everyone to browse all records.
              </p>
            ) : (
              visibleRows.map((row) => <EmployeeAttendanceCard key={row.employeeId} row={row} />)
            )}
          </div>
        </div>
      )}
    </section>
  )
}
