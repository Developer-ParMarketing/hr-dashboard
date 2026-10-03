import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import {
  canUploadEmployeeDocuments,
  canViewAllEmployeeDocuments,
} from '../auth/permissions'
import {
  deleteEmployeeDocument,
  educationSlotLabel,
  educationSlotsForUpload,
  educationHasRequiredUploads,
  educationCanAddMore,
  fetchEmployeesDocumentStatus,
  fetchMyEmployeeDocuments,
  formatFileSize,
  openEmployeeDocumentFile,
  savePreviousEmployers,
  uploadEmployeeDocument,
  type DocumentTypeSpec,
  type EmployeeDocumentListItem,
  type EmployeeDocumentUpload,
  type MyDocumentsResponse,
} from '../api/employeeDocuments'
import { PreviousEmployerDetailsSection } from '../components/PreviousEmployerDetailsSection'
import { confirmDelete } from '../utils/confirmAction'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

function uploadForSlot(
  uploads: EmployeeDocumentUpload[],
  documentType: string,
  slot: number,
): EmployeeDocumentUpload | undefined {
  return uploads.find((u) => u.documentType === documentType && u.slot === slot)
}

function slotsForSpec(
  spec: DocumentTypeSpec,
  uploads: EmployeeDocumentUpload[],
  educationOptionalRows: number,
): number[] {
  if (spec.id === 'education') {
    return educationSlotsForUpload(spec, uploads, educationOptionalRows)
  }
  if (spec.maxFiles <= 1) return [0]
  if (spec.id === 'salary_slip') return [0, 1, 2]
  const existing = uploads.filter((u) => u.documentType === spec.id).map((u) => u.slot)
  const maxSlot = existing.length ? Math.max(...existing) : -1
  const showThrough = Math.min(spec.maxFiles - 1, Math.max(maxSlot + 1, spec.minFiles - 1))
  const slots: number[] = []
  for (let s = 0; s <= showThrough; s += 1) slots.push(s)
  return slots.length ? slots : [0]
}

function specHasUpload(spec: DocumentTypeSpec, uploads: EmployeeDocumentUpload[]): boolean {
  if (spec.id === 'education') {
    return Boolean(uploadForSlot(uploads, spec.id, 0)) && Boolean(uploadForSlot(uploads, spec.id, 1))
  }
  if (spec.oneOfGroup) {
    return uploads.some((u) => u.documentType === spec.id)
  }
  const count = uploads.filter((u) => u.documentType === spec.id).length
  return count >= spec.minFiles
}

function progressPercent(uploaded: number, required: number): number {
  if (required <= 0) return 100
  return Math.min(100, Math.round((uploaded / required) * 100))
}

function ProgressBlock({
  uploaded,
  required,
  complete,
}: {
  uploaded: number
  required: number
  complete: boolean
}) {
  const pct = progressPercent(uploaded, required)
  return (
    <div className="doc-progress">
      <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-warm-text)]">
        <span>
          {uploaded} of {required} required items uploaded
        </span>
        <span className="font-semibold tabular-nums text-[var(--color-ink)]">{pct}%</span>
      </div>
      <div className="doc-progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`doc-progress-fill ${complete ? 'doc-progress-fill-complete' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function UploadSection({
  spec,
  uploads,
  busyKey,
  onUpload,
  onDelete,
  onView,
}: {
  spec: DocumentTypeSpec
  uploads: EmployeeDocumentUpload[]
  busyKey: string | null
  onUpload: (spec: DocumentTypeSpec, slot: number, file: File) => void
  onDelete: (id: number) => void
  onView: (id: number) => void
}) {
  const [educationOptionalRows, setEducationOptionalRows] = useState(0)

  useEffect(() => {
    if (spec.id !== 'education') return
    const existing = uploads.filter((u) => u.documentType === spec.id).map((u) => u.slot)
    const max = existing.length ? Math.max(...existing) : -1
    if (max >= 2) {
      setEducationOptionalRows((prev) => Math.max(prev, max - 1))
    }
  }, [spec.id, uploads])

  const slots = slotsForSpec(spec, uploads, educationOptionalRows)
  const done = specHasUpload(spec, uploads)
  const educationRequiredDone =
    spec.id === 'education' ? educationHasRequiredUploads(uploads, spec.id) : false
  const showEducationAddMore = spec.id === 'education'
  const educationAddEnabled =
    spec.id === 'education' &&
    educationCanAddMore(spec, uploads, educationOptionalRows)

  return (
    <div className={`doc-upload-card ${done ? 'doc-upload-card--done' : ''}`}>
      <div className="doc-upload-card-head">
        <div className={`doc-upload-icon ${done ? 'doc-upload-icon--done' : ''}`} aria-hidden>
          {done ? '✓' : '↑'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[var(--color-ink)]">{spec.label}</p>
          {spec.helpText ? (
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-warm-text)]">{spec.helpText}</p>
          ) : null}
          {spec.oneOfGroup ? (
            <p className="mt-0.5 text-xs text-[var(--color-warm-text)]">Either this or the alternate in this section.</p>
          ) : null}
        </div>
        {done ? <span className="doc-status-badge doc-status-badge--ok shrink-0">Done</span> : null}
      </div>

      <div className="mt-3 space-y-2">
        {slots.map((slot) => {
          const row = uploadForSlot(uploads, spec.id, slot)
          const key = `${spec.id}:${slot}`
          const busy = busyKey === key
          const slotLabel = educationSlotLabel(spec, slot)

          if (row) {
            return (
              <div key={key} className="doc-file-row">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[var(--color-warm-text)]">{slotLabel}</p>
                  <p className="truncate text-sm font-medium text-[var(--color-ink)]" title={row.fileName}>
                    {row.fileName}
                  </p>
                  <p className="text-xs text-[var(--color-warm-text)]">{formatFileSize(row.fileSize)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-ghost text-sm py-1 px-2.5" onClick={() => onView(row.id)}>
                    View
                  </button>
                  <label className="btn btn-secondary text-sm py-1 px-2.5 cursor-pointer">
                    {busy ? '…' : 'Replace'}
                    <input
                      type="file"
                      accept=".pdf,image/*"
                      className="sr-only"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) onUpload(spec, slot, file)
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost text-sm py-1 px-2.5 text-red-700"
                    disabled={busy}
                    onClick={() => onDelete(row.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          }

          return (
            <label key={key} className={`doc-dropzone ${busy ? 'opacity-60' : ''}`}>
              <span className="text-sm font-medium text-[var(--color-ink)]">
                {busy ? 'Uploading…' : slotLabel}
              </span>
              <span className="mt-1 text-xs text-[var(--color-warm-text)]">PDF or image · max 10 MB</span>
              <span className="mt-3 btn btn-primary text-sm py-1.5 px-4 pointer-events-none">
                Choose file
              </span>
              <input
                type="file"
                accept=".pdf,image/*"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) onUpload(spec, slot, file)
                }}
              />
            </label>
          )
        })}
        {showEducationAddMore ? (
          <div className="mt-3 pt-2 border-t border-[color-mix(in_srgb,var(--color-warm-muted)_55%,transparent)]">
            <button
              type="button"
              className="btn btn-secondary text-sm w-full sm:w-auto"
              disabled={!educationAddEnabled}
              title={
                !educationRequiredDone
                  ? 'Upload 10th and 12th certificates first'
                  : !educationAddEnabled
                    ? 'Upload the open additional certificate slot first'
                    : undefined
              }
              onClick={() => setEducationOptionalRows((n) => n + 1)}
            >
              + Add more certificate
            </button>
            {!educationRequiredDone ? (
              <p className="mt-2 text-xs text-[var(--color-warm-text)]">
                Upload 10th and 12th above, then you can add graduation or other degrees here.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function HrEmployeeTable({ rows }: { rows: EmployeeDocumentListItem[] }) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'complete' | 'incomplete'>('all')

  const stats = useMemo(() => {
    const complete = rows.filter((r) => r.complete).length
    return { total: rows.length, complete, incomplete: rows.length - complete }
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (statusFilter === 'complete' && !row.complete) return false
      if (statusFilter === 'incomplete' && row.complete) return false
      if (!q) return true
      return (
        row.name.toLowerCase().includes(q) ||
        row.employeeCode.toLowerCase().includes(q) ||
        (row.email?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [rows, query, statusFilter])

  if (rows.length === 0) {
    return (
      <div className="doc-empty-state">
        <div className="doc-empty-state-icon">◈</div>
        <p className="text-sm font-medium text-[var(--color-ink)]">No active employees</p>
        <p className="mt-1 text-sm text-[var(--color-warm-text)]">Employee records will appear here for document review.</p>
      </div>
    )
  }

  return (
    <div className="workspace-card p-0 overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-[color-mix(in_srgb,var(--color-warm-muted)_55%,transparent)]">
        <div className="workspace-section-head border-0 pb-0">
          <div>
            <h2 className="workspace-section-title">All employees</h2>
            <p className="workspace-section-desc">Open a profile in a new tab to view files and previous employer details.</p>
          </div>
          <div className="offer-stat-row mt-0 sm:mt-0">
            <span className="offer-stat-pill">{stats.total} employees</span>
            <span className="offer-stat-pill offer-stat-pill-ok">{stats.complete} complete</span>
            {stats.incomplete > 0 ? (
              <span className="offer-stat-pill offer-stat-pill-warn">{stats.incomplete} pending</span>
            ) : null}
          </div>
        </div>
        <div className="doc-toolbar mt-4">
          <input
            type="search"
            className="doc-search"
            placeholder="Search name, code, or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search employees"
          />
          <div className="seg inline-flex shrink-0">
            {(
              [
                ['all', 'All'],
                ['incomplete', 'Incomplete'],
                ['complete', 'Complete'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`seg-btn ${statusFilter === id ? 'seg-btn-active' : ''}`}
                onClick={() => setStatusFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="workspace-table-scroll max-h-[min(32rem,60vh)]">
        <table className="report-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Files</th>
              <th>Status</th>
              <th>Still needed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-[var(--color-warm-text)]">
                  No employees match your search.
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.employeeId}>
                  <td>
                    <span className="font-medium text-[var(--color-ink)]">{row.name}</span>
                    <span className="block text-xs text-[var(--color-warm-text)]">
                      {row.employeeCode}
                      {row.email ? ` · ${row.email}` : ''}
                    </span>
                  </td>
                  <td className="tabular-nums">{row.uploadCount}</td>
                  <td>
                    <span
                      className={`doc-status-badge ${row.complete ? 'doc-status-badge--ok' : 'doc-status-badge--pending'}`}
                    >
                      {row.complete ? 'Complete' : 'Incomplete'}
                    </span>
                  </td>
                  <td className="max-w-[16rem] text-xs text-[var(--color-warm-text)]">
                    {row.missingLabels.length ? (
                      <span className="line-clamp-2" title={row.missingLabels.join('; ')}>
                        {row.missingLabels.join(' · ')}
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn btn-secondary text-sm py-1.5 px-3 whitespace-nowrap"
                      onClick={() =>
                        window.open(`/documents/employee/${row.employeeId}`, '_blank', 'noopener,noreferrer')
                      }
                    >
                      View documents
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function DocumentsPage() {
  const { user } = useAuth()
  const canViewAll = canViewAllEmployeeDocuments(user)
  const canUpload = canUploadEmployeeDocuments(user)

  const [tab, setTab] = useState<'mine' | 'team'>(canViewAll && canUpload ? 'mine' : canViewAll ? 'team' : 'mine')
  const [mine, setMine] = useState<MyDocumentsResponse | null>(null)
  const [employees, setEmployees] = useState<EmployeeDocumentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [savingEmployers, setSavingEmployers] = useState(false)
  const loadGen = useRef(0)

  const load = useCallback(async () => {
    const gen = ++loadGen.current
    setLoading(true)
    setError(null)
    try {
      const tasks: Promise<void>[] = []
      if (canUpload) {
        tasks.push(
          fetchMyEmployeeDocuments().then((data) => {
            if (gen === loadGen.current) setMine(data)
          }),
        )
      }
      if (canViewAll) {
        tasks.push(
          fetchEmployeesDocumentStatus().then((data) => {
            if (gen === loadGen.current) setEmployees(data)
          }),
        )
      }
      await Promise.all(tasks)
    } catch (e) {
      if (gen === loadGen.current) setError(errorMessage(e, 'Could not load documents'))
    } finally {
      if (gen === loadGen.current) setLoading(false)
    }
  }, [canUpload, canViewAll])

  useEffect(() => {
    void load()
  }, [load])

  const sections = useMemo(() => {
    const specs = mine?.specs ?? []
    const order = ['identity', 'education', 'address', 'previous_employer', 'bank']
    const labels = mine?.sectionLabels ?? {}
    return order
      .map((section) => ({
        id: section,
        label: labels[section] ?? section,
        specs: specs.filter((s) => s.section === section),
      }))
      .filter((s) => s.specs.length > 0)
  }, [mine])

  const hrStats = useMemo(() => {
    const complete = employees.filter((e) => e.complete).length
    return { total: employees.length, complete, incomplete: employees.length - complete }
  }, [employees])

  async function handleUpload(spec: DocumentTypeSpec, slot: number, file: File) {
    const key = `${spec.id}:${slot}`
    setBusyKey(key)
    setError(null)
    try {
      const result = await uploadEmployeeDocument(spec.id, slot, file)
      setMine((prev) =>
        prev ? { ...prev, uploads: result.uploads, completion: result.completion } : prev,
      )
    } catch (e) {
      setError(errorMessage(e, 'Upload failed'))
    } finally {
      setBusyKey(null)
    }
  }

  async function handleDelete(id: number) {
    const upload = mine?.uploads.find((u) => u.id === id)
    const label = upload?.fileName?.trim() || 'this uploaded file'
    if (!(await confirmDelete(label))) return
    setError(null)
    try {
      await deleteEmployeeDocument(id)
      const data = await fetchMyEmployeeDocuments()
      setMine(data)
    } catch (e) {
      setError(errorMessage(e, 'Could not remove file'))
    }
  }

  const showHr = !loading && canViewAll && (!canUpload || tab === 'team') && !error
  const showMine = !loading && canUpload && (!canViewAll || tab === 'mine') && mine

  return (
    <AppShell active="documents" maxWidth="90rem">
      <main className="app-page workspace-page space-y-6">
        <div className="offer-hero">
          <p className="page-kicker">People</p>
          <h1 className="offer-hero-title">Employee documents</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-warm-text)]">
            Upload mandatory onboarding files - ID, 10th and 12th certificates (then add more degrees), address proof,
            previous employer letters, salary slips, and bank details. For earlier jobs without documents, add employer
            details in the Previous company section. Managers and employees upload their own files; HR reviews
            reviews everyone from the directory below.
          </p>
          {!loading && canViewAll && (!canUpload || tab === 'team') && employees.length > 0 ? (
            <div className="offer-stat-row">
              <span className="offer-stat-pill">{hrStats.total} employees</span>
              <span className="offer-stat-pill offer-stat-pill-ok">{hrStats.complete} complete</span>
              {hrStats.incomplete > 0 ? (
                <span className="offer-stat-pill offer-stat-pill-warn">{hrStats.incomplete} need files</span>
              ) : null}
            </div>
          ) : null}
          {!loading && showMine && mine ? (
            <>
              <div className="offer-stat-row">
                <span
                  className={`offer-stat-pill ${mine.completion.complete ? 'offer-stat-pill-ok' : 'offer-stat-pill-warn'}`}
                >
                  {mine.completion.complete ? 'Onboarding docs complete' : 'Action required'}
                </span>
                <span className="offer-stat-pill">PDF & images · 10 MB max</span>
              </div>
              <ProgressBlock
                uploaded={mine.completion.uploadedCount}
                required={mine.completion.requiredCount}
                complete={mine.completion.complete}
              />
              {!mine.completion.complete ? (
                <div className="doc-missing-list">
                  {mine.completion.missingLabels.map((label) => (
                    <span key={label} className="doc-missing-chip">
                      {label}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {error ? (
          <div className="card border border-red-200 bg-red-50 text-red-800 text-sm p-4 rounded-xl" role="alert">
            {error}
          </div>
        ) : null}

        {canViewAll && canUpload ? (
          <div className="seg inline-flex" role="tablist" aria-label="Document views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'mine'}
              className={`seg-btn ${tab === 'mine' ? 'seg-btn-active' : ''}`}
              onClick={() => setTab('mine')}
            >
              My uploads
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'team'}
              className={`seg-btn ${tab === 'team' ? 'seg-btn-active' : ''}`}
              onClick={() => setTab('team')}
            >
              All employees
            </button>
          </div>
        ) : null}

        {loading ? (
          <div className="workspace-card animate-pulse space-y-3 py-8">
            <div className="h-4 w-48 rounded bg-[var(--color-warm-muted)]/30" />
            <div className="h-3 w-full max-w-xl rounded bg-[var(--color-warm-muted)]/20" />
            <div className="h-3 w-full max-w-lg rounded bg-[var(--color-warm-muted)]/20" />
          </div>
        ) : null}

        {showHr ? <HrEmployeeTable rows={employees} /> : null}

        {showMine ? (
          <div className="space-y-6">
            {sections.map((section, index) => (
              <section key={section.id} className="doc-section-card">
                <div className="workspace-section-head">
                  <div className="flex items-start gap-3">
                    <span className="offer-step-num">{index + 1}</span>
                    <div>
                      <h2 className="workspace-section-title">{section.label}</h2>
                      <p className="workspace-section-desc">
                        {section.specs.length} document type{section.specs.length === 1 ? '' : 's'} in this group
                      </p>
                    </div>
                  </div>
                </div>
                <div className={`grid gap-4 lg:grid-cols-2 ${section.id === 'education' ? '' : ''}`}>
                  {section.specs.map((spec) => (
                    <div key={spec.id} className={spec.id === 'education' ? 'lg:col-span-2' : undefined}>
                    <UploadSection
                      key={spec.id}
                      spec={spec}
                      uploads={mine.uploads}
                      busyKey={busyKey}
                      onUpload={handleUpload}
                      onDelete={handleDelete}
                      onView={openEmployeeDocumentFile}
                    />
                    </div>
                  ))}
                  {section.id === 'previous_employer' ? (
                    <PreviousEmployerDetailsSection
                      saved={mine.previousEmployers ?? []}
                      saving={savingEmployers}
                      onSave={async (employers) => {
                        setSavingEmployers(true)
                        setError(null)
                        try {
                          const updated = await savePreviousEmployers(employers)
                          setMine((prev) => (prev ? { ...prev, previousEmployers: updated } : prev))
                        } catch (e) {
                          setError(errorMessage(e, 'Could not save previous employer details'))
                          throw e
                        } finally {
                          setSavingEmployers(false)
                        }
                      }}
                    />
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {!loading && canUpload && !mine && !error ? (
          <div className="doc-empty-state">
            <div className="doc-empty-state-icon">!</div>
            <p className="text-sm font-medium text-[var(--color-ink)]">Account not linked</p>
            <p className="mt-1 text-sm text-[var(--color-warm-text)]">
              Your login is not tied to an employee record. Contact HR to upload documents.
            </p>
          </div>
        ) : null}
      </main>
    </AppShell>
  )
}
