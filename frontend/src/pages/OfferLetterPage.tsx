import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../auth/AuthContext'
import { canUseOfferLetters } from '../auth/permissions'
import {
  emptyOfferRow,
  fetchOfferLetterMeta,
  parseOfferLetterExcel,
  previewOfferEmail,
  previewOfferPdf,
  sendOfferLetters,
  type EmailDraft,
  type OfferLetterMeta,
  type OfferLetterRow,
} from '../api/offerLetters'
import { toastSuccess } from '../utils/toastBridge'
import { DOJ_INPUT_PLACEHOLDER, formatDojDdMmYyyy } from '../utils/dojFormat'
import { confirmAction, confirmRemove } from '../utils/confirmAction'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

function rowKey(row: OfferLetterRow, index: number): string {
  return `${index}-${row.email}-${row.name}`
}

function rowComplete(row: OfferLetterRow): boolean {
  return Boolean(
    row.email.trim() &&
      row.name.trim() &&
      row.dateOfJoining &&
      row.position.trim() &&
      row.salary.trim(),
  )
}

function offerDojDisplay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return formatDojDdMmYyyy(value)
  return value
}

export function OfferLetterPage() {
  const { user } = useAuth()
  const allowed = canUseOfferLetters(user)

  const [meta, setMeta] = useState<OfferLetterMeta | null>(null)
  const [rows, setRows] = useState<OfferLetterRow[]>([emptyOfferRow()])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [subjectTemplate, setSubjectTemplate] = useState('')
  const [bodyTemplate, setBodyTemplate] = useState('')
  const [draft, setDraft] = useState<EmailDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [draftLoading, setDraftLoading] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sendResults, setSendResults] = useState<
    Array<{ email: string; name: string; ok: boolean; message: string }> | null
  >(null)

  const selectedRow = rows[selectedIndex] ?? rows[0]
  const readyCount = useMemo(() => rows.filter(rowComplete).length, [rows])

  useEffect(() => {
    if (!allowed) return
    void fetchOfferLetterMeta()
      .then((m) => {
        setMeta(m)
        setSubjectTemplate(m.defaultSubject)
        setBodyTemplate(m.defaultBody)
      })
      .catch((e) => setError(errorMessage(e, 'Could not load offer letter settings')))
      .finally(() => setLoading(false))
  }, [allowed])

  const refreshDraft = useCallback(async () => {
    if (!selectedRow?.email || !selectedRow.name) {
      setDraft(null)
      return
    }
    setDraftLoading(true)
    try {
      const d = await previewOfferEmail({
        candidate: selectedRow,
        subject: subjectTemplate,
        body: bodyTemplate,
      })
      setDraft(d)
    } catch {
      setDraft(null)
    } finally {
      setDraftLoading(false)
    }
  }, [selectedRow, subjectTemplate, bodyTemplate])

  useEffect(() => {
    if (!allowed || loading) return
    const t = window.setTimeout(() => void refreshDraft(), 400)
    return () => window.clearTimeout(t)
  }, [allowed, loading, refreshDraft])

  const placeholders = meta?.placeholders ?? []

  function updateRow(index: number, patch: Partial<OfferLetterRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function addRow() {
    setRows((prev) => [...prev, emptyOfferRow()])
    setSelectedIndex(rows.length)
  }

  function removeRow(index: number) {
    void (async () => {
      const row = rows[index]
      if (row && (row.name.trim() || row.email.trim())) {
        const label = row.name.trim() || row.email.trim()
        if (!(await confirmRemove(`offer row for ${label}`))) return
      }
      setRows((prev) => {
        if (prev.length <= 1) return [emptyOfferRow()]
        return prev.filter((_, i) => i !== index)
      })
      setSelectedIndex((i) => Math.max(0, i >= index ? i - 1 : i))
    })()
  }

  async function onExcelFile(file: File | null) {
    if (!file) return
    setError(null)
    try {
      const parsed = await parseOfferLetterExcel(file)
      setRows(parsed)
      setSelectedIndex(0)
      toastSuccess(`Loaded ${parsed.length} candidate(s) from Excel.`)
    } catch (e) {
      setError(errorMessage(e, 'Could not read Excel file'))
    }
  }

  async function openPdfPreview() {
    if (!selectedRow?.name || !selectedRow.email) {
      setError('Select a complete row to preview the PDF.')
      return
    }
    setPdfLoading(true)
    setError(null)
    try {
      const { pdfBase64 } = await previewOfferPdf(selectedRow)
      const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      setError(errorMessage(e, 'Could not generate PDF preview'))
    } finally {
      setPdfLoading(false)
    }
  }

  async function handleSend() {
    if (readyCount === 0) {
      setError('Fill in all columns for at least one candidate before sending.')
      return
    }
    if (
      !(await confirmAction(
        `Send ${readyCount} offer letter email${readyCount === 1 ? '' : 's'}?\n\nCandidates will receive PDFs and joining forms.`,
      ))
    ) {
      return
    }
    setSending(true)
    setError(null)
    setSendResults(null)
    try {
      const result = await sendOfferLetters({
        candidates: rows.filter(rowComplete),
        subject: subjectTemplate,
        body: bodyTemplate,
      })
      setSendResults(result.results)
      toastSuccess(`Sent ${result.sent} email(s).${result.skipped ? ` ${result.skipped} skipped.` : ''}`)
    } catch (e) {
      setError(errorMessage(e, 'Failed to send offer letters'))
    } finally {
      setSending(false)
    }
  }

  if (!allowed) {
    return <Navigate to="/" replace />
  }

  return (
    <AppShell active="offerLetter" maxWidth="90rem">
      <main className="app-page workspace-page">
        <div className="offer-hero">
          <p className="page-kicker">People</p>
          <h1 className="offer-hero-title">Offer letter</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--color-warm-text)]">
            Build offer PDFs, preview emails, and send to candidates in one flow. Management is
            always CC&apos;d; each email includes the joining forms workbook.
          </p>
          {!loading && meta ? (
            <div className="offer-stat-row">
              <span className="offer-stat-pill">
                {rows.length} candidate{rows.length === 1 ? '' : 's'}
              </span>
              <span className={`offer-stat-pill ${readyCount === rows.length ? 'offer-stat-pill-ok' : ''}`}>
                {readyCount} ready to send
              </span>
              <span className={`offer-stat-pill ${meta.smtpConfigured ? 'offer-stat-pill-ok' : 'offer-stat-pill-warn'}`}>
                {meta.smtpConfigured ? 'Email ready' : 'SMTP not configured'}
              </span>
              <span className="offer-stat-pill">{meta.joiningFormsAttachment}</span>
            </div>
          ) : null}
          <div className="offer-steps mt-5">
            <span className="offer-step">
              <span className="offer-step-num">1</span> Add candidates
            </span>
            <span className="offer-step">
              <span className="offer-step-num">2</span> Edit message
            </span>
            <span className="offer-step">
              <span className="offer-step-num">3</span> Preview &amp; send
            </span>
          </div>
        </div>

        <div className="page-body">
          {error ? <p className="alert-error">{error}</p> : null}

          {loading ? (
            <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
          ) : (
            <>
              <section className="workspace-card offer-table">
                <div className="workspace-section-head">
                  <div>
                    <h2 className="workspace-section-title">Candidates</h2>
                    <p className="workspace-section-desc">
                      Click a row to preview email · Excel: Email, Date of joining, Name, Designation,
                      CTC (optional: Department, Reporting to, Salutation)
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 pt-1 sm:pt-0">
                    <label className="offer-import-btn">
                      Import Excel
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        className="hidden"
                        onChange={(e) => void onExcelFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <button type="button" className="btn-ghost text-sm" onClick={addRow}>
                      + Add row
                    </button>
                  </div>
                </div>

                <div className="workspace-table-scroll">
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th className="w-10">#</th>
                        <th>Email</th>
                        <th>Joining</th>
                        <th>Name</th>
                        <th>Company</th>
                        <th>Designation</th>
                        <th>Annual CTC</th>
                        <th>Dept</th>
                        <th className="w-12" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr
                          key={rowKey(row, index)}
                          className={selectedIndex === index ? 'offer-row-selected' : undefined}
                          onClick={() => setSelectedIndex(index)}
                        >
                          <td className="text-center text-xs text-[var(--color-warm-text)]">{index + 1}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              className="field field-compact w-full"
                              value={row.email}
                              placeholder="name@company.com"
                              onChange={(e) => updateRow(index, { email: e.target.value })}
                            />
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              inputMode="numeric"
                              className="field field-compact w-[9.25rem] max-w-full"
                              value={offerDojDisplay(row.dateOfJoining)}
                              placeholder={DOJ_INPUT_PLACEHOLDER}
                              onChange={(e) => updateRow(index, { dateOfJoining: e.target.value })}
                            />
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              className="field field-compact w-full"
                              value={row.name}
                              placeholder="Full name"
                              onChange={(e) => updateRow(index, { name: e.target.value })}
                            />
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              className="field field-compact w-full"
                              value={row.companyName}
                              onChange={(e) => updateRow(index, { companyName: e.target.value })}
                            />
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              className="field field-compact w-full"
                              value={row.position}
                              onChange={(e) => updateRow(index, { position: e.target.value })}
                            />
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              className="field field-compact w-full"
                              value={row.salary}
                              placeholder="e.g. ₹8,00,000"
                              onChange={(e) => updateRow(index, { salary: e.target.value })}
                            />
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              className="field field-compact w-full min-w-[8rem]"
                              value={row.department ?? ''}
                              placeholder="Department"
                              onChange={(e) => updateRow(index, { department: e.target.value })}
                            />
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="btn-ghost px-1.5 text-xs text-[var(--color-warm-text)]"
                              aria-label="Remove row"
                              onClick={() => removeRow(index)}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selectedRow ? (
                  <div className="mt-4 grid gap-3 border-t border-[color-mix(in_srgb,var(--color-warm-muted)_55%,transparent)] pt-4 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block min-w-0">
                      <span className="field-label">Salutation (PDF)</span>
                      <input
                        className="field field-compact mt-1 w-full"
                        value={selectedRow.salutation ?? ''}
                        placeholder="Mr. / Ms. / Mx."
                        onChange={(e) => updateRow(selectedIndex, { salutation: e.target.value })}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="field-label">Reporting to (PDF)</span>
                      <input
                        className="field field-compact mt-1 w-full"
                        value={selectedRow.reportingTo ?? ''}
                        placeholder="Manager name / designation"
                        onChange={(e) => updateRow(selectedIndex, { reportingTo: e.target.value })}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="field-label">Accept by (optional)</span>
                      <input
                        className="field field-compact mt-1 w-full"
                        value={selectedRow.acceptByDate ?? ''}
                        placeholder={DOJ_INPUT_PLACEHOLDER}
                        onChange={(e) => updateRow(selectedIndex, { acceptByDate: e.target.value })}
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="field-label">Offer valid until (optional)</span>
                      <input
                        className="field field-compact mt-1 w-full"
                        value={selectedRow.offerValidUntil ?? ''}
                        placeholder={DOJ_INPUT_PLACEHOLDER}
                        onChange={(e) => updateRow(selectedIndex, { offerValidUntil: e.target.value })}
                      />
                    </label>
                  </div>
                ) : null}
              </section>

              <section className="workspace-split">
                <div className="workspace-split-panel">
                  <div className="workspace-section-head border-0 pb-0">
                    <div>
                      <h2 className="workspace-section-title">Email template</h2>
                      <p className="workspace-section-desc">Same template for every candidate</p>
                    </div>
                  </div>
                  <div className="offer-placeholder-chips">
                    {placeholders.map((p) => (
                      <code key={p} className="offer-placeholder-chip">
                        {p}
                      </code>
                    ))}
                  </div>
                  <label className="feature-field mt-4 block min-w-0">
                    <span className="field-label">Subject</span>
                    <input
                      className="field mt-1.5 w-full"
                      value={subjectTemplate}
                      onChange={(e) => setSubjectTemplate(e.target.value)}
                    />
                  </label>
                  <label className="feature-field mt-3 block min-h-0 flex-1">
                    <span className="field-label">Body</span>
                    <textarea
                      className="field mt-1.5 min-h-[11rem] w-full flex-1 text-sm leading-relaxed"
                      rows={9}
                      value={bodyTemplate}
                      onChange={(e) => setBodyTemplate(e.target.value)}
                    />
                  </label>
                </div>

                <div className="workspace-split-panel">
                  <div className="workspace-section-head border-0 pb-0">
                    <div>
                      <h2 className="workspace-section-title">Email preview</h2>
                      <p className="workspace-section-desc">
                        {selectedRow?.name
                          ? `Showing mail for ${selectedRow.name}`
                          : 'Select a candidate row'}
                      </p>
                    </div>
                  </div>
                  {draftLoading ? (
                    <p className="mt-6 text-sm text-[var(--color-warm-text)]">Updating preview…</p>
                  ) : draft ? (
                    <div className="offer-mail-preview">
                      <div className="offer-mail-header">
                        <div className="offer-mail-field">
                          <span className="offer-mail-label">To</span>
                          <span className="offer-mail-value truncate">{draft.to}</span>
                        </div>
                        <div className="offer-mail-field">
                          <span className="offer-mail-label">CC</span>
                          <span className="offer-mail-value text-xs leading-snug">{draft.cc.join(', ')}</span>
                        </div>
                        <div className="offer-mail-field">
                          <span className="offer-mail-label">Subject</span>
                          <span className="offer-mail-value font-medium">{draft.subject}</span>
                        </div>
                      </div>
                      <div className="offer-mail-body">{draft.body}</div>
                      <div className="offer-mail-footer">
                        Attachments: Offer letter PDF · {meta?.joiningFormsAttachment ?? 'Joining forms'}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-6 rounded-xl border border-dashed p-8 text-center text-sm text-[var(--color-warm-text)]">
                      Complete the selected row to see how the email will look.
                    </div>
                  )}
                </div>
              </section>

              <div className="offer-send-bar">
                <div className="text-sm text-[var(--color-warm-text)]">
                  <span className="font-medium text-[var(--color-ink)]">
                    {readyCount} of {rows.length}
                  </span>{' '}
                  candidate{rows.length === 1 ? '' : 's'} will receive email
                  {selectedRow?.name ? (
                    <>
                      {' '}
                      · previewing{' '}
                      <span className="font-medium text-[var(--color-ink)]">{selectedRow.name}</span>
                    </>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={pdfLoading}
                    onClick={() => void openPdfPreview()}
                  >
                    {pdfLoading ? 'Generating…' : 'Preview PDF'}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={sending || readyCount === 0}
                    onClick={() => void handleSend()}
                  >
                    {sending ? 'Sending…' : `Send ${readyCount} email${readyCount === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>

              {sendResults ? (
                <section className="workspace-card">
                  <h2 className="workspace-section-title">Send results</h2>
                  <div className="workspace-table-scroll mt-3" style={{ maxHeight: '14rem' }}>
                    <table className="report-table w-full min-w-0">
                      <thead>
                        <tr>
                          <th>Candidate</th>
                          <th>Email</th>
                          <th>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sendResults.map((r) => (
                          <tr key={`${r.email}-${r.name}`}>
                            <td>{r.name}</td>
                            <td>{r.email}</td>
                            <td className={r.ok ? 'text-emerald-700' : 'text-red-700'}>{r.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      </main>
    </AppShell>
  )
}
