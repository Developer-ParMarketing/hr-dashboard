type AdminSection = 'people' | 'access' | 'teams'

type TabDef = {
  id: AdminSection
  title: string
  description: string
  icon: string
}

const TABS: TabDef[] = [
  {
    id: 'people',
    title: 'People',
    description: 'Profile, salary, email, team',
    icon: 'P',
  },
  {
    id: 'access',
    title: 'Access',
    description: 'Login-only & edge cases',
    icon: 'A',
  },
  {
    id: 'teams',
    title: 'Teams',
    description: 'Assign members to managers',
    icon: 'T',
  },
]

type Props = {
  section: AdminSection
  onChange: (section: AdminSection) => void
}

export function AdminNavTabs({ section, onChange }: Props) {
  return (
    <div className="admin-nav-tabs" role="tablist" aria-label="Admin sections">
      {TABS.map((tab) => {
        const active = section === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`admin-nav-tab${active ? ' admin-nav-tab-active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            <span className="admin-nav-tab-icon" aria-hidden>
              {tab.icon}
            </span>
            <span className="min-w-0">
              <span className="admin-nav-tab-title">{tab.title}</span>
              <span className="admin-nav-tab-desc">{tab.description}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export type { AdminSection }
