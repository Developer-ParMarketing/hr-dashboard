import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { canViewAllEmployeeDocuments } from '../auth/permissions'
import {
  downloadEmployeeDocumentFile,
  fetchEmployeeDocumentsForAdmin,
  formatFileSize,
  openEmployeeDocumentFile,
  specLabel,
  type AdminEmployeeDocumentsResponse,
} from '../api/employeeDocuments'
import { PreviousEmployerDetailsSection } from '../components/PreviousEmployerDetailsSection'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

function progressPercent(uploaded: number, required: number): number {
  if (required <= 0) return 100
  return Math.min(100, Math.round((uploaded / required) * 100))
}

export function EmployeeDocumentsViewPage() {
  const { user } = useAuth()
  const canReview = canViewAllEmployeeDocuments(user)
  const { employeeId: rawId } = useParams()
  const employeeId = Number.parseInt(String(rawId ?? ''), 10)
  const [data, setData] = useState<AdminEmployeeDocumentsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canReview) {
      setError('You do not have access to review employee documents.')
      setLoading(false)
      return
    }
    if (!Number.isFinite(employeeId) || employeeId <= 0) {
      setError('Invalid employee')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchEmployeeDocumentsForAdmin(employeeId)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, 'Could not load documents'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [canReview, employeeId])

  const grouped = useMemo(() => {
    if (!data) return []
    const order = ['identity', 'education', 'address', 'previous_employer', 'bank']
    return order
      .map((section) => ({
        id: section,
        label: data.sectionLabels[section] ?? section,
        uploads: data.uploads.filter((u) => {
          const spec = data.specs.find((s) => s.id === u.documentType)
          return spec?.section === section
        }),
      }))
      .filter((s) => s.uploads.length > 0)
  }, [data])

  const pct = data
    ? progressPercent(data.completion.uploadedCount, data.completion.requiredCount)
    : 0

  return (
    <AppShell active="documents" maxWidth="90rem">
      <main className="app-page workspace-page space-y-6">
        {loading ? (
          <div className="offer-hero animate-pulse space-y-3">
            <div className="h-3 w-24 rounded bg-white/40" />
            <div className="h-8 w-64 rounded bg-white/50" />
            <div className="h-4 w-full max-w-md rounded bg-white/30" />
          </div>
        ) : null}

        {error ? (
          <div className="card border border-red-200 bg-red-50 text-red-800 text-sm p-4 rounded-xl">{error}</div>
        ) : null}

        {data ? (
          <>
            <div className="offer-hero">
              <p className="page-kicker">Employee file review</p>
              <h1 className="offer-hero-title">{data.employee.name}</h1>
              <p className="mt-1 text-sm text-[var(--color-warm-text)]">
                {data.employee.employeeCode}
                {data.employee.email ? ` · ${data.employee.email}` : ''}
              </p>
              <div className="offer-stat-row">
                <span className="offer-stat-pill">{data.uploads.length} file(s) on record</span>
                <span
                  className={`offer-stat-pill ${data.completion.complete ? 'offer-stat-pill-ok' : 'offer-stat-pill-warn'}`}
                >
                  {data.completion.complete ? 'Mandatory set complete' : 'Mandatory set incomplete'}
                </span>
              </div>
              <div className="doc-progress">
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-warm-text)]">
                  <span>
                    {data.completion.uploadedCount} of {data.completion.requiredCount} required items
                  </span>
                  <span className="font-semibold tabular-nums text-[var(--color-ink)]">{pct}%</span>
                </div>
                <div className="doc-progress-track">
                  <div
                    className={`doc-progress-fill ${data.completion.complete ? 'doc-progress-fill-complete' : ''}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              {!data.completion.complete ? (
                <div className="doc-missing-list">
                  {data.completion.missingLabels.map((label) => (
                    <span key={label} className="doc-missing-chip">
                      {label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {data.uploads.length === 0 ? (
              <div className="doc-empty-state">
                <div className="doc-empty-state-icon">◈</div>
                <p className="text-sm font-medium text-[var(--color-ink)]">No uploads yet</p>
                <p className="mt-1 text-sm text-[var(--color-warm-text)]">
                  This employee has not uploaded any documents.
                </p>
              </div>
            ) : (
              grouped.map((section) => (
                <section key={section.id} className="workspace-card p-0 overflow-hidden">
                  <div className="border-b px-4 py-3 sm:px-5 border-[color-mix(in_srgb,var(--color-warm-muted)_55%,transparent)] bg-[color-mix(in_srgb,var(--color-warm-page)_40%,#fff)]">
                    <h2 className="workspace-section-title">{section.label}</h2>
                    <p className="workspace-section-desc">{section.uploads.length} file(s)</p>
                  </div>
                  <ul className="divide-y divide-[color-mix(in_srgb,var(--color-warm-muted)_50%,transparent)]">
                    {section.uploads.map((u) => (
                      <li key={u.id} className="doc-file-list-item">
                        <div className="doc-upload-icon doc-upload-icon--done shrink-0 text-xs font-bold" aria-hidden>
                          OK
                        </div>
                        <div className="doc-file-meta">
                          <div className="min-w-[10rem] sm:w-48 shrink-0">
                            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
                              Type
                            </p>
                            <p className="text-sm font-medium text-[var(--color-ink)]">
                              {specLabel(data.specs, u.documentType, u.slot)}
                            </p>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
                              File
                            </p>
                            <p className="truncate text-sm text-[var(--color-ink)]" title={u.fileName}>
                              {u.fileName}
                            </p>
                            <p className="text-xs text-[var(--color-warm-text)]">{formatFileSize(u.fileSize)}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2 sm:ml-auto">
                          <button
                            type="button"
                            className="btn btn-secondary text-sm py-1.5 px-3"
                            onClick={() => openEmployeeDocumentFile(u.id, true)}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost text-sm py-1.5 px-3"
                            onClick={() => downloadEmployeeDocumentFile(u.id)}
                          >
                            Download
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}

            <PreviousEmployerDetailsSection saved={data.previousEmployers ?? []} readOnly />
          </>
        ) : null}
      </main>
    </AppShell>
  )
}
