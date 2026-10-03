import { Link } from 'react-router-dom'
import { ModuleIcon } from '../ModuleIcon'
import type { DashboardQuickLink } from '../../modules/dashboardQuickLinks'

type Props = {
  links: DashboardQuickLink[]
}

export function DashboardQuickLinksGrid({ links }: Props) {
  return (
    <div className="par-quick-grid">
      {links.map((link) => (
        <Link key={link.href} to={link.href} className="par-quick-link">
          <span className="par-quick-icon">
            <ModuleIcon id={link.moduleId} className="h-5 w-5" />
          </span>
          <span className="par-quick-text">
            <strong>{link.label}</strong>
            <span>{link.hint}</span>
          </span>
        </Link>
      ))}
    </div>
  )
}
