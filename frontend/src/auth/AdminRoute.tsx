import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { isAdminUser } from './permissions'
import type { ReactNode } from 'react'
import { NotificationsProvider } from '../notifications/NotificationsContext'

export function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-brand-muted)] border-t-[var(--color-brand)]"
          aria-hidden
        />
        <p className="text-sm text-[var(--color-warm-text)]">Checking session…</p>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (!isAdminUser(user)) {
    return <Navigate to="/" replace />
  }

  return <NotificationsProvider>{children}</NotificationsProvider>
}
