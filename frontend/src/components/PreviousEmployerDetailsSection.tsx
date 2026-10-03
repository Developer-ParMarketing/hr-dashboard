import { useEffect, useState, type ReactNode } from 'react'
import type { PreviousEmployerDetail, PreviousEmployerInput } from '../api/employeeDocuments'

export type PreviousEmployerDraftRow = PreviousEmployerInput & { key: string }

function emptyRow(): PreviousEmployerDraftRow {
  return {
    key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    companyName: '',
    dateOfJoining: '',
    dateOfLeaving: '',
    position: '',
    location: '',
    reasonForLeaving: '',
    referenceContactName: '',
    referenceContactInfo: '',
  }
}

function draftFromSaved(row: PreviousEmployerDetail): PreviousEmployerDraftRow {
  return {
    key: `saved-${row.id}`,
    companyName: row.companyName,
    dateOfJoining: row.dateOfJoining ?? '',
    dateOfLeaving: row.dateOfLeaving ?? '',
    position: row.position ?? '',
    location: row.location ?? '',
    reasonForLeaving: row.reasonForLeaving ?? '',
    referenceContactName: row.referenceContactName ?? '',
    referenceContactInfo: row.referenceContactInfo ?? '',
  }
}

function toPayload(rows: PreviousEmployerDraftRow[]): PreviousEmployerInput[] {
  return rows.map((row) => ({
    companyName: row.companyName.trim(),
    dateOfJoining: row.dateOfJoining?.trim() || null,
    dateOfLeaving: row.dateOfLeaving?.trim() || null,
    position: row.position?.trim() || null,
    location: row.location?.trim() || null,
    reasonForLeaving: row.reasonForLeaving?.trim() || null,
    referenceContactName: row.referenceContactName?.trim() || null,
    referenceContactInfo: row.referenceContactInfo?.trim() || null,
  }))
}

type Props = {
  saved: PreviousEmployerDetail[]
  readOnly?: boolean
  saving?: boolean
  onSave?: (employers: PreviousEmployerInput[]) => Promise<void>
  /** Expand by default when the employee already has saved rows. */
  defaultOpen?: boolean
}

function CollapsiblePanel({
  readOnly,
  savedCount,
  defaultOpen,
  children,
}: {
  readOnly?: boolean
  savedCount: number
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? savedCount > 0)

  useEffect(() => {
    setOpen(defaultOpen ?? savedCount > 0)
  }, [defaultOpen, savedCount])

  const countLabel =
    savedCount === 0
      ? 'None on file'
      : `${savedCount} employer${savedCount === 1 ? '' : 's'} on file`

  return (
    <details
      className={`doc-collapsible-panel group ${readOnly ? 'doc-collapsible-panel--readonly' : ''}`}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <div className="min-w-0 flex-1 pl-1">
          <p className="font-medium text-[var(--color-ink)]">Other previous employers</p>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-warm-text)]">
            {readOnly
              ? 'Expand to review earlier roles the employee listed (no documents required).'
              : 'Optional - list earlier companies if you only have documents for your last employer.'}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--color-warm-muted)_40%,#fff)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
          {countLabel}
        </span>
      </summary>
      <div className="doc-collapsible-panel-body">{children}</div>
    </details>
  )
}

export function PreviousEmployerDetailsSection({
  saved,
  readOnly,
  saving,
  onSave,
  defaultOpen,
}: Props) {
  const [rows, setRows] = useState<PreviousEmployerDraftRow[]>(() =>
    saved.length > 0 ? saved.map(draftFromSaved) : [emptyRow()],
  )
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setRows(saved.length > 0 ? saved.map(draftFromSaved) : [emptyRow()])
    setDirty(false)
  }, [saved])

  const updateRow = (key: string, patch: Partial<PreviousEmployerDraftRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    setDirty(true)
    setMessage(null)
  }

  const addRow = () => {
    setRows((prev) => [...prev, emptyRow()])
    setDirty(true)
  }

  const removeRow = (key: string) => {
    setRows((prev) => (prev.length <= 1 ? [emptyRow()] : prev.filter((r) => r.key !== key)))
    setDirty(true)
  }

  async function handleSave() {
    if (!onSave) return
    setMessage(null)
    try {
      await onSave(toPayload(rows))
      setDirty(false)
      setMessage('Previous employer details saved.')
    } catch {
      setMessage('Could not save. Check company name and dates.')
    }
  }

  if (readOnly) {
    const body =
      saved.length === 0 ? (
        <p className="text-sm text-[var(--color-warm-text)]">No other previous employer details on file.</p>
      ) : (
        <ul className="space-y-3">
          {saved.map((row) => (
            <li
              key={row.id}
              className="rounded-xl border border-[color-mix(in_srgb,var(--color-warm-muted)_55%,transparent)] bg-[var(--color-surface)] p-4 text-sm"
            >
              <p className="font-semibold text-[var(--color-ink)]">{row.companyName}</p>
              <dl className="mt-2 grid gap-1 text-[var(--color-warm-text)] sm:grid-cols-2">
                {row.position ? (
                  <>
                    <dt className="font-medium text-[var(--color-ink)]">Position</dt>
                    <dd>{row.position}</dd>
                  </>
                ) : null}
                {row.location ? (
                  <>
                    <dt className="font-medium text-[var(--color-ink)]">Location</dt>
                    <dd>{row.location}</dd>
                  </>
                ) : null}
                {row.dateOfJoining ? (
                  <>
                    <dt className="font-medium text-[var(--color-ink)]">Date of joining</dt>
                    <dd>{row.dateOfJoining}</dd>
                  </>
                ) : null}
                {row.dateOfLeaving ? (
                  <>
                    <dt className="font-medium text-[var(--color-ink)]">Date of leaving</dt>
                    <dd>{row.dateOfLeaving}</dd>
                  </>
                ) : null}
                {row.reasonForLeaving ? (
                  <>
                    <dt className="font-medium text-[var(--color-ink)] sm:col-span-2">Reason for leaving</dt>
                    <dd className="sm:col-span-2">{row.reasonForLeaving}</dd>
                  </>
                ) : null}
              </dl>
              {row.referenceContactName || row.referenceContactInfo ? (
                <div className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--color-warm-muted)_50%,transparent)] bg-[color-mix(in_srgb,var(--color-warm-page)_35%,#fff)] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
                    Reference contact
                  </p>
                  {row.referenceContactName ? (
                    <p className="mt-1 font-medium text-[var(--color-ink)]">{row.referenceContactName}</p>
                  ) : null}
                  {row.referenceContactInfo ? (
                    <p className="mt-0.5 text-[var(--color-warm-text)]">{row.referenceContactInfo}</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )

    return (
      <CollapsiblePanel readOnly savedCount={saved.length} defaultOpen={defaultOpen}>
        {body}
      </CollapsiblePanel>
    )
  }

  return (
    <CollapsiblePanel savedCount={saved.length} defaultOpen={defaultOpen}>
      <div className="space-y-4">
        {rows.map((row, index) => (
          <div
            key={row.key}
            className="rounded-xl border border-[color-mix(in_srgb,var(--color-warm-muted)_60%,transparent)] bg-[var(--color-surface)] p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
                Employer {index + 1}
              </p>
              <button
                type="button"
                className="btn btn-ghost text-xs py-1 px-2 text-red-700"
                onClick={() => removeRow(row.key)}
              >
                Remove
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="feature-field sm:col-span-2">
                <span>Company name</span>
                <input
                  type="text"
                  className="field w-full"
                  value={row.companyName}
                  placeholder="Previous company name"
                  onChange={(e) => updateRow(row.key, { companyName: e.target.value })}
                />
              </label>
              <label className="feature-field">
                <span>Date of joining</span>
                <input
                  type="date"
                  className="field w-full"
                  value={row.dateOfJoining ?? ''}
                  onChange={(e) => updateRow(row.key, { dateOfJoining: e.target.value })}
                />
              </label>
              <label className="feature-field">
                <span>Date of leaving</span>
                <input
                  type="date"
                  className="field w-full"
                  value={row.dateOfLeaving ?? ''}
                  onChange={(e) => updateRow(row.key, { dateOfLeaving: e.target.value })}
                />
              </label>
              <label className="feature-field sm:col-span-2">
                <span>Position / designation</span>
                <input
                  type="text"
                  className="field w-full"
                  value={row.position ?? ''}
                  placeholder="e.g. Senior Executive"
                  onChange={(e) => updateRow(row.key, { position: e.target.value })}
                />
              </label>
              <label className="feature-field sm:col-span-2">
                <span>Location</span>
                <input
                  type="text"
                  className="field w-full"
                  value={row.location ?? ''}
                  placeholder="e.g. Mumbai, India"
                  onChange={(e) => updateRow(row.key, { location: e.target.value })}
                />
              </label>
              <label className="feature-field sm:col-span-2">
                <span>Reason for leaving</span>
                <input
                  type="text"
                  className="field w-full"
                  value={row.reasonForLeaving ?? ''}
                  placeholder="e.g. Better opportunity, relocation"
                  onChange={(e) => updateRow(row.key, { reasonForLeaving: e.target.value })}
                />
              </label>
              <div className="sm:col-span-2 rounded-xl border border-[color-mix(in_srgb,var(--insight-attendance)_12%,var(--color-warm-muted))] bg-[color-mix(in_srgb,var(--color-warm-page)_30%,#fff)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
                  Reference contact
                </p>
                <p className="mt-0.5 mb-3 text-xs text-[var(--color-warm-text)]">
                  Optional - manager or HR contact at this company (phone or email).
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="feature-field sm:col-span-2">
                    <span>Contact name</span>
                    <input
                      type="text"
                      className="field w-full"
                      value={row.referenceContactName ?? ''}
                      placeholder="e.g. Rajesh Kumar (Reporting manager)"
                      onChange={(e) => updateRow(row.key, { referenceContactName: e.target.value })}
                    />
                  </label>
                  <label className="feature-field sm:col-span-2">
                    <span>Phone or email</span>
                    <input
                      type="text"
                      className="field w-full"
                      value={row.referenceContactInfo ?? ''}
                      placeholder="e.g. +91 98765 43210 or name@company.com"
                      onChange={(e) => updateRow(row.key, { referenceContactInfo: e.target.value })}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary text-sm" onClick={addRow}>
          Add another employer
        </button>
        <button
          type="button"
          className="btn btn-primary text-sm"
          disabled={!dirty || saving}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving…' : 'Save employer details'}
        </button>
      </div>
      {message ? <p className="mt-3 text-sm text-[var(--color-warm-text)]">{message}</p> : null}
    </CollapsiblePanel>
  )
}
