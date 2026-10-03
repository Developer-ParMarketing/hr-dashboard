import { useCallback, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { canEditAttendance, isAdminUser } from '../auth/permissions'
import { AppShell } from '../components/AppShell'
import { SalaryPanel } from '../components/SalaryPanel'
import type { UploadCompanyCode } from '../constants/companies'
import { useWorkspacePeriod } from '../utils/workspacePeriod'
import { toastSuccess } from '../utils/toastBridge'

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

export function SalaryPage() {
  const { user } = useAuth()
  const { year: reportYear, month: reportMonth, company, setPeriod } = useWorkspacePeriod()
  const now = new Date()
  const [error, setError] = useState<string | null>(null)

  const allowEdit = canEditAttendance(user)
  const isAdmin = isAdminUser(user)

  const clearMessages = useCallback(() => {
    setError(null)
  }, [])

  const handleSalaryMessage = useCallback(
    ({ error: salaryError, success: salarySuccess }: { error?: string | null; success?: string | null }) => {
      if (salaryError !== undefined) setError(salaryError)
      if (salarySuccess) toastSuccess(salarySuccess)
    },
    [],
  )

  if (!user) return null

  return (
    <AppShell active="salary" maxWidth="90rem">
      <main className="app-page">
        <header className="page-header">
          <p className="page-kicker">Payroll</p>
          <h1 className="page-title">Monthly salary</h1>
        </header>

        <div className="page-body">
          {error ? <p className="alert-error">{error}</p> : null}

          <SalaryPanel
            reportYear={reportYear}
            reportMonth={reportMonth}
            company={company}
            allowEdit={allowEdit}
            showAdminLink={isAdmin}
            months={MONTHS}
            onYearChange={(year) => {
              setPeriod({ year })
              clearMessages()
            }}
            onMonthChange={(month) => {
              setPeriod({ month })
              clearMessages()
            }}
            onCompanyChange={(next) => {
              setPeriod({ company: next as UploadCompanyCode })
              clearMessages()
            }}
            onPrevMonth={() => {
              const next = shiftMonth(reportYear, reportMonth, -1)
              setPeriod({ year: next.year, month: next.month })
              clearMessages()
            }}
            onNextMonth={() => {
              const next = shiftMonth(reportYear, reportMonth, 1)
              setPeriod({ year: next.year, month: next.month })
              clearMessages()
            }}
            onToday={() => {
              setPeriod({ year: now.getFullYear(), month: now.getMonth() + 1 })
              clearMessages()
            }}
            onMessage={handleSalaryMessage}
          />
        </div>
      </main>
    </AppShell>
  )
}
