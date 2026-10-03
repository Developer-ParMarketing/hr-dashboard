import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useNotifications } from '../../notifications/NotificationsContext'
import { DashboardNotificationsList } from './DashboardNotificationsList'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden className="text-[var(--color-ink)]">
      <path
        d="M12 2a5 5 0 0 0-5 5v2.1c0 .5-.2 1-.5 1.4L5.1 13.2A1 1 0 0 0 6 15h12a1 1 0 0 0 .9-1.5l-1.4-2.7c-.3-.4-.5-.9-.5-1.4V7a5 5 0 0 0-5-5Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  )
}

export function DashboardNotificationsBell({ open, onOpenChange }: Props) {
  const { notifications, meta, loading, badgeCount, refresh } = useNotifications()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current && !panelRef.current.contains(t)) {
        onOpenChange(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, onOpenChange])

  return (
    <div className="app-notif-bell-wrap" ref={panelRef}>
      <button
        type="button"
        className="app-icon-btn app-notif-bell-btn"
        aria-label={
          badgeCount > 0
            ? `Notifications, ${badgeCount} priority item${badgeCount === 1 ? '' : 's'}`
            : 'Notifications'
        }
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <BellIcon />
        {badgeCount > 0 ? (
          <span className="app-notif-badge tabular-nums">{badgeCount > 9 ? '9+' : badgeCount}</span>
        ) : null}
      </button>

      {open ? (
        <div className="app-notif-panel card border">
          <header className="app-notif-panel-head">
            <div>
              <h2 className="app-notif-panel-title">Notifications</h2>
              {badgeCount > 0 ? (
                <p className="app-notif-panel-sub">{badgeCount} need attention</p>
              ) : null}
            </div>
            <button type="button" className="app-notif-text-btn" onClick={() => void refresh()}>
              Refresh
            </button>
          </header>
          <div className="app-notif-panel-body">
            <DashboardNotificationsList
              notifications={notifications}
              loginReminder={meta?.loginReminder ?? null}
              loading={loading}
              onNavigate={() => onOpenChange(false)}
            />
          </div>
          <footer className="app-notif-panel-foot">
            <Link to="/" className="app-notif-foot-link" onClick={() => onOpenChange(false)}>
              Dashboard
            </Link>
          </footer>
        </div>
      ) : null}
    </div>
  )
}
