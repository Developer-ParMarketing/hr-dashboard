import { Link } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { ModuleIcon } from '../ModuleIcon'
import type { ModuleId } from '../../modules/types'
import type { DashboardNotification } from '../../types/dashboard'
import { withWorkspacePeriod, parseWorkspacePeriodParams } from '../../utils/workspacePeriod'

const TIER_LABEL: Record<DashboardNotification['tier'], string> = {
  critical: 'Critical',
  important: 'Important',
  normal: 'To do',
  shortcut: 'Shortcut',
}

type Props = {
  notifications: DashboardNotification[]
  loginReminder: string | null
  loading: boolean
  onNavigate?: () => void
}

export function DashboardNotificationsList({
  notifications,
  loginReminder,
  loading,
  onNavigate,
}: Props) {
  const [searchParams] = useSearchParams()
  const period = parseWorkspacePeriodParams(searchParams)
  const href = (path: string) => withWorkspacePeriod(path, period)

  const reminders = notifications.filter((n) => n.source !== 'shortcut')
  const shortcuts = notifications.filter((n) => n.source === 'shortcut')

  if (loading) {
    return <p className="app-notif-empty">Loading…</p>
  }

  if (notifications.length === 0) {
    return <p className="app-notif-empty">You&apos;re all caught up.</p>
  }

  return (
    <div className="app-notif-list-wrap">
      {loginReminder ? <p className="app-notif-reminder">{loginReminder}</p> : null}

      {reminders.length > 0 ? (
        <ol className="app-notif-list">
          {reminders.map((item) => (
            <li key={item.id}>
              <Link
                to={href(item.href)}
                className={`app-notif-item app-notif-item-${item.tier}`}
                onClick={onNavigate}
              >
                <span className="app-notif-rank tabular-nums" aria-hidden>
                  {item.rank}
                </span>
                <span className="app-notif-item-body">
                  <span className="app-notif-item-title-row">
                    {item.moduleId ? (
                      <ModuleIcon
                        id={item.moduleId as ModuleId}
                        className="app-notif-item-icon"
                        aria-hidden
                      />
                    ) : null}
                    <span className="app-notif-item-title">{item.title}</span>
                    <span className={`app-notif-tier app-notif-tier-${item.tier}`}>
                      {TIER_LABEL[item.tier]}
                    </span>
                  </span>
                  <span className="app-notif-item-msg">{item.message}</span>
                </span>
                <span className="app-notif-chevron" aria-hidden>
                  →
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}

      {shortcuts.length > 0 ? (
        <>
          <p className="app-notif-shortcuts-label">Quick actions</p>
          <ul className="app-notif-shortcuts">
            {shortcuts.map((item) => (
              <li key={item.id}>
                <Link to={href(item.href)} className="app-notif-shortcut" onClick={onNavigate}>
                  {item.moduleId ? (
                    <ModuleIcon id={item.moduleId as ModuleId} className="h-3.5 w-3.5 shrink-0 opacity-80" />
                  ) : null}
                  <span className="app-notif-shortcut-text">
                    <span className="app-notif-shortcut-title">{item.title}</span>
                    <span className="app-notif-shortcut-hint">{item.message}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  )
}
