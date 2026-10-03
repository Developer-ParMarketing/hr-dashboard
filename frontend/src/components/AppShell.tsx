import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { roleLabel } from '../auth/permissions'
import type { ModuleId } from '../modules/types'
import { ModuleNav } from './ModuleNav'
import { PageWayfinding } from './PageWayfinding'
import { DashboardNotificationsBell } from './dashboard/DashboardNotificationsBell'

export type AppShellWayfinding = {
  title: string
  backTo?: string
  backLabel?: string
}

type AppShellProps = {
  active: ModuleId
  children: ReactNode
  maxWidth?: '6xl' | '90rem' | 'full'
  wayfinding?: AppShellWayfinding
}

export function AppShell({ active, children, maxWidth = '6xl', wayfinding }: AppShellProps) {
  const { user, logout } = useAuth()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)

  if (!user) return null

  const maxClass =
    maxWidth === '90rem' ? 'max-w-[90rem]' : maxWidth === 'full' ? 'max-w-none' : 'max-w-6xl'

  return (
    <div className="app-shell">
      {mobileNavOpen ? (
        <button
          type="button"
          className="app-sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <ModuleNav
        user={user}
        active={active}
        mobileOpen={mobileNavOpen}
        onNavigate={() => setMobileNavOpen(false)}
        onClose={() => setMobileNavOpen(false)}
      />

      <div className="app-shell-main">
        <header className="app-topbar">
          <div className="app-topbar-inner">
            <button
              type="button"
              className="app-menu-btn lg:hidden"
              aria-label="Open modules menu"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((open) => !open)}
            >
              ☰
            </button>

            {wayfinding ? (
              <PageWayfinding
                className="min-w-0 lg:max-w-[min(100%,28rem)]"
                title={wayfinding.title}
                backTo={wayfinding.backTo}
                backLabel={wayfinding.backLabel}
              />
            ) : null}

            <div className="app-topbar-spacer" />

            <div className="app-topbar-tools">
              <DashboardNotificationsBell
                open={notifOpen}
                onOpenChange={(next) => {
                  setNotifOpen(next)
                  if (next) setUserMenuOpen(false)
                }}
              />
              <button
                type="button"
                className="app-icon-btn"
                aria-label="User menu"
                aria-expanded={userMenuOpen}
                onClick={() => {
                  setUserMenuOpen((open) => !open)
                  setNotifOpen(false)
                }}
              >
                <span className="app-avatar">{(user.name || user.email || 'H').slice(0, 1).toUpperCase()}</span>
              </button>
              {userMenuOpen ? (
                <div className="app-user-menu card border">
                  <p className="app-user-menu-name">{user.name || 'Signed in'}</p>
                  {user.email ? <p className="app-user-menu-email">{user.email}</p> : null}
                  <p className="app-user-menu-role">{roleLabel(user)}</p>
                  <Link
                    to="/settings"
                    className="app-notif-text-btn mt-2 block w-full text-center"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    Settings
                  </Link>
                  <button
                    type="button"
                    onClick={() => void logout()}
                    className="app-notif-text-btn mt-1 block w-full text-center text-[var(--color-ink)]"
                  >
                    Log out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className={`app-content ${maxClass}`}>{children}</div>
      </div>
    </div>
  )
}

export type { ModuleId }
