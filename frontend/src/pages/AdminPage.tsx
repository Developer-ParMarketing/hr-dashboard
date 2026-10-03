import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { AppShell } from '../components/AppShell'
import { AdminPanel } from '../components/AdminPanel'
import { DEFAULT_UPLOAD_COMPANY } from '../constants/companies'
import { toastSuccess } from '../utils/toastBridge'

export function AdminPage() {
  const { user } = useAuth()
  const [error, setError] = useState<string | null>(null)

  if (!user) return null

  return (
    <AppShell active="admin">
      <main className="app-page">
        <header className="page-header">
          <p className="page-kicker">Administration</p>
          <h1 className="page-title">People, access & teams</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-warm-text)]">
            Onboard employees, set base salary and work email, manage dashboard logins, and assign teams
            for attendance and payroll.
          </p>
        </header>

        <div className="page-body space-y-4">
          {error ? <p className="alert-error">{error}</p> : null}

          <AdminPanel
            company={DEFAULT_UPLOAD_COMPANY}
            currentUserId={user.id}
            onMessage={({ error: panelError, success: panelSuccess }) => {
              if (panelError !== undefined) setError(panelError)
              if (panelSuccess) toastSuccess(panelSuccess)
            }}
          />
        </div>
      </main>
    </AppShell>
  )
}
