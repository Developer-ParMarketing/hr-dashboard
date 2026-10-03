import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { isAttendanceOpenIntent } from '../utils/attendanceNavigation'
import { AppShell } from '../components/AppShell'
import { SavedPeriodsPanel } from '../components/SavedPeriodsPanel'
import { AttendancePage } from './AttendancePage'
import { useAuth } from '../auth/AuthContext'
import { canEditAttendance } from '../auth/permissions'
import { DEFAULT_UPLOAD_COMPANY } from '../constants/companies'
import type { AttendanceOpenIntent } from '../utils/attendanceNavigation'

export function AttendanceDetailPage() {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const allowEdit = canEditAttendance(user)
  const now = new Date()
  const [reportYear] = useState(now.getFullYear())
  const [reportMonth] = useState(now.getMonth() + 1)
  const [selectedCompany] = useState(DEFAULT_UPLOAD_COMPANY)
  const [openIntent, setOpenIntent] = useState<AttendanceOpenIntent | null>(null)

  useEffect(() => {
    if (!isAttendanceOpenIntent(location.state)) return
    setOpenIntent(location.state)
    navigate('/attendance-detail', { replace: true, state: null })
  }, [location.state, navigate])

  if (allowEdit && openIntent) {
    return (
      <AttendancePage
        key={JSON.stringify(openIntent)}
        shellActive="attendanceDetail"
        browseContext="attendanceDetail"
        initialOpenIntent={openIntent}
        onBackToBrowse={() => setOpenIntent(null)}
        backToBrowseLabel="← Back to attendance history"
      />
    )
  }

  return (
    <AppShell active="attendanceDetail">
      <main className="app-page">
        <header className="page-header">
          <p className="page-kicker">Time & attendance</p>
          <h1 className="page-title">Attendance history</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-warm-text)]">
            History &amp; saved months - browse uploaded registers and open a month or file in the
            daily, weekly, or monthly view.
          </p>
          {allowEdit ? (
            <div className="mt-4">
              <Link to="/attendance" className="btn-ghost text-sm">
                Upload &amp; edit register →
              </Link>
            </div>
          ) : null}
        </header>

        <div className="page-body">
          {allowEdit ? (
            <SavedPeriodsPanel
              layout="page"
              selectedYear={reportYear}
              selectedMonth={reportMonth}
              selectedCompany={selectedCompany}
              refreshToken={0}
              loading={false}
              onSelectPeriod={(year, month, company) =>
                setOpenIntent({ kind: 'period', year, month, company })
              }
              onOpenRegister={(upload) => setOpenIntent({ kind: 'register', upload })}
            />
          ) : (
            <div className="card border p-6 text-center sm:p-8">
              <p className="text-sm font-medium text-[var(--color-ink)]">
                Saved register history is managed by HR
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-warm-text)]">
                Open attendance, choose daily, weekly, or monthly, then pick a register HR uploaded to
                view your in/out times and summaries.
              </p>
              <Link to="/attendance" className="btn-primary mt-5 inline-flex">
                Open attendance register
              </Link>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}
