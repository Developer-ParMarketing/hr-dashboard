import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { listAccessibleReports, loadReport } from '../api/reports'
import type { AuthUser } from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { AppShell } from '../components/AppShell'
import { ReportPanel } from '../components/reports/ReportPanel'
import { REPORT_DEFINITIONS, reportDefinitionForUser } from '../constants/reports'
import { DEFAULT_UPLOAD_COMPANY } from '../constants/companies'
import type { ReportData, ReportType } from '../types/reports'
import { downloadReportExcel } from '../utils/exportReport'
import { isEmployeeDashboardUser } from '../auth/permissions'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function defaultReportType(accessible: ReportType[], user: AuthUser | null | undefined): ReportType | null {
  if (accessible.length === 0) return null
  const prefer: ReportType[] = isEmployeeDashboardUser(user)
    ? ['leave', 'self', 'in-out']
    : ['leave', 'team', 'in-out', 'payroll', 'admin', 'contact', 'email', 'self']
  for (const id of prefer) {
    if (accessible.includes(id)) return id
  }
  return accessible[0]
}

export function ReportsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const params = useParams<{ tab?: string }>()
  const now = new Date()
  const [reportYear, setReportYear] = useState(now.getFullYear())
  const [reportMonth, setReportMonth] = useState(now.getMonth() + 1)
  const company = DEFAULT_UPLOAD_COMPANY
  const [accessible, setAccessible] = useState<ReportType[]>([])
  const [accessLoaded, setAccessLoaded] = useState(false)
  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const paramTab = (params.tab ?? '') as ReportType
  const tabs = useMemo(
    () =>
      REPORT_DEFINITIONS.filter((item) => accessible.includes(item.id)).map((item) =>
        reportDefinitionForUser(item.id, user),
      ),
    [accessible, user],
  )
  const activeDefinition =
    tabs.find((item) => item.id === paramTab) ??
    tabs.find((item) => item.id === defaultReportType(accessible, user)) ??
    tabs[0]

  useEffect(() => {
    if (!user) return
    setAccessLoaded(false)
    void listAccessibleReports()
      .then((types) => {
        setAccessible(types)
        setAccessLoaded(true)
      })
      .catch(() => {
        setAccessible([])
        setAccessLoaded(true)
      })
  }, [user])

  useEffect(() => {
    if (!accessLoaded || accessible.length === 0) return
    const fallback = defaultReportType(accessible, user)
    if (!params.tab && fallback) {
      navigate(`/reports/${fallback}`, { replace: true })
      return
    }
    if (params.tab && !accessible.includes(paramTab) && fallback) {
      navigate(`/reports/${fallback}`, { replace: true })
    }
  }, [accessLoaded, accessible, params.tab, paramTab, navigate, user])

  const refresh = useCallback(async () => {
    if (!activeDefinition) return
    setLoading(true)
    setError(null)
    try {
      const data = await loadReport(activeDefinition.id, reportYear, reportMonth, company)
      setReport(data)
    } catch (e) {
      setReport(null)
      setError(e instanceof Error ? e.message : 'Could not load report')
    } finally {
      setLoading(false)
    }
  }, [activeDefinition, reportYear, reportMonth, company])

  useEffect(() => {
    if (!activeDefinition) return
    void refresh()
  }, [refresh, activeDefinition])

  if (!user) return null

  if (accessLoaded && accessible.length === 0) {
    return (
      <AppShell active="reports">
        <main className="app-page workspace-page">
          <header className="page-header">
            <h1 className="page-title">Reports</h1>
          </header>
          <div className="workspace-card text-sm text-[var(--color-warm-text)]">
            You do not have access to any reports.
          </div>
        </main>
      </AppShell>
    )
  }

  const periodLabel = `${MONTHS[reportMonth - 1] ?? 'Month'} ${reportYear}`

  return (
    <AppShell active="reports" maxWidth="90rem">
      <main className="app-page workspace-page">
        <header className="page-header">
          <p className="page-kicker">Registers</p>
          <h1 className="page-title">Reports</h1>

          {tabs.length > 0 ? (
            <div className="seg mt-4 inline-flex max-w-full flex-wrap" role="tablist" aria-label="Report types">
              {tabs.map((tab) => (
                <Link
                  key={tab.id}
                  to={`/reports/${tab.id}`}
                  role="tab"
                  aria-current={tab.id === activeDefinition?.id ? 'page' : undefined}
                  className={`seg-btn text-sm${tab.id === activeDefinition?.id ? ' seg-btn-active' : ''}`}
                >
                  {tab.label}
                </Link>
              ))}
            </div>
          ) : null}
        </header>

        <div className="page-body">
          {activeDefinition ? (
            <section className="workspace-card p-0">
              <div className="reports-workspace-head">
                <div className="min-w-0 flex-1">
                  <h2 className="workspace-section-title">{report?.title ?? activeDefinition.label}</h2>
                  <p className="workspace-section-desc">{activeDefinition.description}</p>
                </div>

                <div className="reports-workspace-actions">
                  <div className="reports-period" aria-label="Report month">
                    <button
                      type="button"
                      className="reports-period-btn"
                      aria-label="Previous month"
                      onClick={() => {
                        const next = shiftMonth(reportYear, reportMonth, -1)
                        setReportYear(next.year)
                        setReportMonth(next.month)
                      }}
                    >
                      ‹
                    </button>
                    <label className="reports-period-field">
                      <span className="sr-only">Month</span>
                      <select
                        className="field-compact reports-period-select"
                        value={reportMonth}
                        onChange={(e) => setReportMonth(Number(e.target.value))}
                      >
                        {MONTHS.map((name, index) => (
                          <option key={name} value={index + 1}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="reports-period-field">
                      <span className="sr-only">Year</span>
                      <select
                        className="field-compact reports-period-select reports-period-year"
                        value={reportYear}
                        onChange={(e) => setReportYear(Number(e.target.value))}
                      >
                        {Array.from({ length: 7 }, (_, i) => now.getFullYear() - 3 + i).map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="reports-period-btn"
                      aria-label="Next month"
                      onClick={() => {
                        const next = shiftMonth(reportYear, reportMonth, 1)
                        setReportYear(next.year)
                        setReportMonth(next.month)
                      }}
                    >
                      ›
                    </button>
                  </div>

                  {!loading && report ? (
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      onClick={() => downloadReportExcel(report)}
                    >
                      Download Excel
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="reports-workspace-meta">
                <span className="reports-workspace-period">{periodLabel}</span>
              </div>

              {error ? <p className="alert-error mx-4 mt-4 sm:mx-5">{error}</p> : null}

              {loading ? (
                <p className="reports-loading">Loading report…</p>
              ) : report ? (
                <ReportPanel report={report} />
              ) : null}
            </section>
          ) : accessLoaded ? (
            <Navigate to="/" replace />
          ) : null}
        </div>
      </main>
    </AppShell>
  )
}
