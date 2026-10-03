import { useState } from 'react'
import { AppShell } from '../components/AppShell'
import { PolicyDocumentPanel } from '../components/PolicyDocumentPanel'
import { POLICY_TABS } from '../constants/policies'

type PolicyTabId = (typeof POLICY_TABS)[number]['id']

export function PoliciesPage() {
  const [tab, setTab] = useState<PolicyTabId>('attendance')
  const active = POLICY_TABS.find((t) => t.id === tab) ?? POLICY_TABS[0]

  return (
    <AppShell active="policies">
      <main className="app-page policies-page">
        <header className="page-header policies-page-header">
          <div>
            <p className="page-kicker">Reference</p>
            <h1 className="page-title">Policies</h1>
            <p className="policies-intro">
              Official attendance and company guidelines for all employees.
            </p>
          </div>
          <div className="policy-tabs seg" role="tablist" aria-label="Policy sections">
            {POLICY_TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-label={`${label} policy`}
                className={`policy-tab seg-btn ${tab === id ? 'seg-btn-active' : ''}`}
                onClick={() => setTab(id)}
              >
                {id === 'attendance' ? 'Attendance' : 'Company'}
              </button>
            ))}
          </div>
        </header>

        <PolicyDocumentPanel document={active.document} />
      </main>
    </AppShell>
  )
}
