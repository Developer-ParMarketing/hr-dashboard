import { useCallback, useEffect, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { PolicyDocumentPanel } from '../components/PolicyDocumentPanel'
import { PolicyManager } from '../components/PolicyManager'
import { POLICY_TABS, type PolicyDocument } from '../constants/policies'
import { fetchPolicies } from '../api/policies'
import { useAuth } from '../auth/AuthContext'
import { canEditAttendance } from '../auth/permissions'

type PolicyTabId = (typeof POLICY_TABS)[number]['id']

export function PoliciesPage() {
  const { user } = useAuth()
  const canManage = canEditAttendance(user)
  const [tab, setTab] = useState<PolicyTabId>('attendance')
  const [manage, setManage] = useState(false)
  /** Starts with the built-in text; replaced by the live policies from the server (HR edits). */
  const [documents, setDocuments] = useState<PolicyDocument[]>(() => POLICY_TABS.map((t) => t.document))

  const load = useCallback(async () => {
    try {
      const docs = await fetchPolicies()
      if (docs.length > 0) setDocuments(docs)
    } catch {
      /* keep the built-in text if the server can't be reached */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const active = documents.find((d) => d.id === tab) ?? documents[0]!

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
          <div className="flex flex-wrap items-center gap-2">
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
            {canManage ? (
              <button
                type="button"
                className={manage ? 'btn-primary px-3 py-1.5 text-xs' : 'btn-secondary px-3 py-1.5 text-xs'}
                onClick={() => setManage((m) => !m)}
              >
                {manage ? 'Done' : 'Manage policies'}
              </button>
            ) : null}
          </div>
        </header>

        {manage && canManage ? (
          <PolicyManager docId={tab} onChanged={() => void load()} />
        ) : (
          <PolicyDocumentPanel document={active} />
        )}
      </main>
    </AppShell>
  )
}