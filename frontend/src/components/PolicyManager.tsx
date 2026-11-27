import { useCallback, useEffect, useRef, useState } from 'react'
import {
    addPolicySection,
    deletePolicySection,
    deletePolicyFile,
    fetchManagePolicies,
    importPolicyDocument,
    movePolicySection,
    setPolicySectionHidden,
    updatePolicySection,
    uploadPolicyFile,
    type DraftPolicySection,
    type PolicyChange,
    type PolicySectionInput,
    type StoredPolicyDocument,
    type StoredPolicySection,
} from '../api/policies'
import { confirmDelete } from '../utils/confirmAction'
import { showToast, toastSuccess } from '../utils/toastBridge'

type Props = {
    docId: 'attendance' | 'company'
    /** called after any change so the page can reload the read-only view */
    onChanged: () => void
}

type Draft = PolicySectionInput & { dbId: number | null }

const EMPTY: Draft = { dbId: null, title: '', summary: '', rules: '', note: '' }

const ACTION_LABEL: Record<string, string> = {
    added: 'added',
    updated: 'updated',
    hidden: 'hid',
    shown: 'showed again',
    deleted: 'deleted',
    moved: 'moved',
    pdf: 'uploaded',
    pdf_removed: 'removed',
}

function fmtWhen(iso: string): string {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function PolicyManager({ docId, onChanged }: Props) {
    const [docs, setDocs] = useState<StoredPolicyDocument[]>([])
    const [changes, setChanges] = useState<PolicyChange[]>([])
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [draft, setDraft] = useState<Draft | null>(null)
    // Import from a document: drafts read from the file, ticked ones get added.
    const [importOpen, setImportOpen] = useState(false)
    const [pasteText, setPasteText] = useState('')
    const [drafts, setDrafts] = useState<(DraftPolicySection & { pick: boolean })[]>([])
    const fileRef = useRef<HTMLInputElement | null>(null)
    const pdfRef = useRef<HTMLInputElement | null>(null)

    const load = useCallback(async () => {
        try {
            const data = await fetchManagePolicies()
            setDocs(data.documents)
            setChanges(data.changes)
            setError(null)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load policies')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void load()
    }, [load])

    useEffect(() => {
        setDraft(null)
        setImportOpen(false)
        setDrafts([])
    }, [docId])

    const doc = docs.find((d) => d.id === docId)
    const sections = doc?.sections ?? []

    async function run(action: () => Promise<void>, done?: string) {
        setBusy(true)
        try {
            await action()
            await load()
            onChanged()
            if (done) toastSuccess(done)
        } catch (e) {
            showToast(e instanceof Error ? e.message : 'Something went wrong', { variant: 'error' })
        } finally {
            setBusy(false)
        }
    }

    function startEdit(s: StoredPolicySection) {
        setDraft({ dbId: s.dbId, title: s.title, summary: s.summary, rules: s.rules.join('\n'), note: s.note ?? '' })
    }

    async function saveDraft() {
        if (!draft) return
        const input: PolicySectionInput = {
            docId,
            title: draft.title,
            summary: draft.summary,
            rules: draft.rules,
            note: draft.note,
        }
        await run(async () => {
            if (draft.dbId == null) await addPolicySection(input)
            else await updatePolicySection(draft.dbId, input)
            setDraft(null)
        }, draft.dbId == null ? 'Policy added - everyone can see it now.' : 'Policy saved - everyone can see it now.')
    }

    async function readDocument(file?: File) {
        setBusy(true)
        try {
            const found = await importPolicyDocument(file ? { file } : { text: pasteText })
            setDrafts(found.map((d) => ({ ...d, pick: true })))
            if (!found.length) showToast('No sections found in this document.', { variant: 'error' })
        } catch (e) {
            showToast(e instanceof Error ? e.message : 'Could not read the document', { variant: 'error' })
        } finally {
            setBusy(false)
            if (fileRef.current) fileRef.current.value = ''
        }
    }

    async function addDrafts() {
        const picked = drafts.filter((d) => d.pick && d.title.trim())
        if (!picked.length) return
        const byTitle = new Map(sections.map((s) => [s.title.trim().toLowerCase(), s.dbId]))
        let added = 0
        let replaced = 0
        await run(async () => {
            for (const d of picked) {
                const input: PolicySectionInput = { docId, title: d.title.trim(), summary: d.summary, rules: d.rules.join('\n'), note: '' }
                // Same title already exists -> update it (re-uploading a newer version of the document).
                const existing = byTitle.get(input.title.toLowerCase())
                if (existing != null) {
                    await updatePolicySection(existing, input)
                    replaced++
                } else {
                    await addPolicySection(input)
                    added++
                }
            }
            setDrafts([])
            setPasteText('')
            setImportOpen(false)
        })
        toastSuccess(
            `${added ? `${added} section${added === 1 ? '' : 's'} added` : ''}${added && replaced ? ', ' : ''}${replaced ? `${replaced} updated` : ''
            } - live on the Policies page and in the chatbot.`,
        )
    }

    async function replacePdf(file: File) {
        if (!/\.pdf$/i.test(file.name)) {
            showToast('Please choose a PDF file.', { variant: 'error' })
            return
        }
        await run(async () => {
            await uploadPolicyFile(docId, file)
        }, `New PDF uploaded - everyone now downloads "${file.name}".`)
        if (pdfRef.current) pdfRef.current.value = ''
    }

    async function removePdf() {
        if (!window.confirm('Remove the uploaded PDF? Download will go back to the built-in copy.')) return
        await run(async () => {
            await deletePolicyFile(docId)
        }, 'Uploaded PDF removed.')
    }

    if (loading) return <p className="text-sm text-[var(--color-warm-text)]">Loading policies…</p>
    if (error) return <p className="alert-error">{error}</p>

    const ruleCount = draft ? draft.rules.split('\n').filter((l) => l.trim()).length : 0

    return (
        <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-brand)_25%,var(--color-warm-muted))] bg-[color-mix(in_srgb,var(--color-brand-muted)_35%,#fff)] px-4 py-3 text-sm text-[var(--color-ink)]">
                <p className="font-semibold">Manage {doc?.title.toLowerCase() ?? 'policy'}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-warm-text)]">
                    Changes are live straight away on the Policies page and in the HR chatbot. Employees see a
                    &ldquo;Policy updated&rdquo; notice in their bell for 14 days. Use <strong>Hide</strong> to take a section
                    down without losing it.
                </p>
            </div>

            <div className="card border flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-ink)]">Downloadable PDF</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-warm-text)]">
                        {doc?.uploadedPdf ? (
                            <>
                                Employees download <strong>{doc.uploadedPdf.fileName}</strong> (
                                {Math.max(1, Math.round(doc.uploadedPdf.sizeBytes / 1024))} KB), uploaded{' '}
                                {new Date(doc.uploadedPdf.uploadedAt).toLocaleDateString('en-GB', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                })}
                                {doc.uploadedPdf.uploadedBy ? ` by ${doc.uploadedPdf.uploadedBy}` : ''}.
                            </>
                        ) : doc?.staticPdfPath ? (
                            <>
                                Employees download the built-in <strong>{doc.pdfFileName}</strong>. Upload a new PDF to
                                replace it.
                            </>
                        ) : (
                            <>No PDF uploaded - Download makes a PDF from the sections below. Upload the official PDF here.</>
                        )}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-warm-text)]">
                        Tip: after uploading, use <strong>Import from document</strong> with the same PDF so the
                        sections and the chatbot match it too.
                    </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                    <input
                        ref={pdfRef}
                        type="file"
                        accept=".pdf,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0]
                            if (f) void replacePdf(f)
                        }}
                    />
                    <button type="button" className="btn-primary" disabled={busy} onClick={() => pdfRef.current?.click()}>
                        {busy ? 'Uploading…' : doc?.uploadedPdf || doc?.staticPdfPath ? 'Upload new PDF' : 'Upload PDF'}
                    </button>
                    {doc?.uploadedPdf ? (
                        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void removePdf()}>
                            Remove
                        </button>
                    ) : null}
                </div>
            </div>

            {draft ? (
                <div className="card border p-4 sm:p-5">
                    <p className="text-sm font-semibold text-[var(--color-ink)]">
                        {draft.dbId == null ? 'Add a new policy section' : 'Edit policy section'}
                    </p>
                    <div className="mt-3 grid gap-3">
                        <label className="block text-sm">
                            <span className="font-medium text-[var(--color-ink)]">Title *</span>
                            <input
                                className="field mt-1.5 w-full"
                                value={draft.title}
                                maxLength={120}
                                placeholder="e.g. POSH - Prevention of Sexual Harassment"
                                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                            />
                        </label>
                        <label className="block text-sm">
                            <span className="font-medium text-[var(--color-ink)]">Short summary</span>
                            <input
                                className="field mt-1.5 w-full"
                                value={draft.summary}
                                maxLength={1000}
                                placeholder="One line that explains the policy"
                                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                            />
                        </label>
                        <label className="block text-sm">
                            <span className="font-medium text-[var(--color-ink)]">Rules - one per line ({ruleCount})</span>
                            <textarea
                                className="field mt-1.5 min-h-[180px] w-full"
                                value={draft.rules}
                                placeholder={'Each line becomes one bullet point.\nExample: Complaints go to the Internal Committee (IC) within 3 months.'}
                                onChange={(e) => setDraft({ ...draft, rules: e.target.value })}
                            />
                        </label>
                        <label className="block text-sm">
                            <span className="font-medium text-[var(--color-ink)]">Note (optional)</span>
                            <input
                                className="field mt-1.5 w-full"
                                value={draft.note}
                                maxLength={1000}
                                placeholder="Shown in small text under the rules"
                                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                            />
                        </label>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" className="btn-primary" disabled={busy || !draft.title.trim()} onClick={() => void saveDraft()}>
                            {busy ? 'Saving…' : draft.dbId == null ? 'Add policy' : 'Save changes'}
                        </button>
                        <button type="button" className="btn-secondary" disabled={busy} onClick={() => setDraft(null)}>
                            Cancel
                        </button>
                    </div>
                </div>
            ) : importOpen ? (
                <div className="card border p-4 sm:p-5">
                    <p className="text-sm font-semibold text-[var(--color-ink)]">Import from a document</p>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--color-warm-text)]">
                        Upload a PDF, Word (.docx) or .txt file, or paste the text. Each heading becomes a section; you can
                        check and change them before adding. A section with the same title as an existing one replaces it.
                        Scanned PDFs (photos of paper) have no text - use the Word file or paste the text instead.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".pdf,.docx,.txt,.md"
                            className="hidden"
                            onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f) void readDocument(f)
                            }}
                        />
                        <button type="button" className="btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
                            {busy ? 'Reading…' : 'Upload PDF / Word / .txt'}
                        </button>
                        <span className="text-xs text-[var(--color-warm-text)]">or paste below</span>
                    </div>
                    <textarea
                        className="field mt-3 min-h-[120px] w-full"
                        value={pasteText}
                        placeholder={'POSH POLICY\nPar Marketing is committed to a safe workplace...\n- Complaints go to the Internal Committee within 3 months.'}
                        onChange={(e) => setPasteText(e.target.value)}
                    />
                    <div className="mt-2">
                        <button type="button" className="btn-secondary" disabled={busy || !pasteText.trim()} onClick={() => void readDocument()}>
                            Read pasted text
                        </button>
                    </div>

                    {drafts.length > 0 ? (
                        <div className="mt-4 flex flex-col gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
                                Found {drafts.length} section{drafts.length === 1 ? '' : 's'} - untick any you don&rsquo;t want
                            </p>
                            {drafts.map((d, i) => {
                                const exists = sections.some((s) => s.title.trim().toLowerCase() === d.title.trim().toLowerCase())
                                return (
                                    <div key={i} className="rounded-lg border border-[var(--color-warm-muted)] bg-white p-3">
                                        <label className="flex items-center gap-2 text-sm">
                                            <input
                                                type="checkbox"
                                                checked={d.pick}
                                                onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, pick: e.target.checked } : x)))}
                                            />
                                            <input
                                                className="field w-full py-1 text-sm font-semibold"
                                                value={d.title}
                                                maxLength={120}
                                                onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                                            />
                                            {exists ? (
                                                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[0.65rem] font-semibold uppercase text-amber-800">
                                                    Replaces
                                                </span>
                                            ) : null}
                                        </label>
                                        {d.summary ? <p className="mt-1.5 text-xs text-[var(--color-ink)]">{d.summary}</p> : null}
                                        {d.rules.length ? (
                                            <ul className="mt-1 list-disc pl-5 text-xs text-[var(--color-warm-text)]">
                                                {d.rules.slice(0, 4).map((r, k) => (
                                                    <li key={k}>{r}</li>
                                                ))}
                                                {d.rules.length > 4 ? <li>+ {d.rules.length - 4} more</li> : null}
                                            </ul>
                                        ) : null}
                                    </div>
                                )
                            })}
                        </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-2">
                        <button
                            type="button"
                            className="btn-primary"
                            disabled={busy || !drafts.some((d) => d.pick)}
                            onClick={() => void addDrafts()}
                        >
                            Add {drafts.filter((d) => d.pick).length || ''} to {doc?.title ?? 'policy'}
                        </button>
                        <button
                            type="button"
                            className="btn-secondary"
                            disabled={busy}
                            onClick={() => {
                                setImportOpen(false)
                                setDrafts([])
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-primary" onClick={() => setDraft({ ...EMPTY })}>
                        + Add policy section
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => setImportOpen(true)}>
                        Import from document
                    </button>
                </div>
            )}

            <div className="flex flex-col gap-2">
                {sections.map((s, i) => (
                    <div
                        key={s.dbId}
                        className={`card border flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between ${s.hidden ? 'opacity-60' : ''}`}
                    >
                        <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
                                <span className="text-xs tabular-nums text-[var(--color-brand)]">{String(i + 1).padStart(2, '0')}</span>
                                {s.title}
                                {s.hidden ? (
                                    <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[0.65rem] font-semibold uppercase text-stone-700">
                                        Hidden
                                    </span>
                                ) : null}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-[var(--color-warm-text)]">
                                {s.rules.length} rule{s.rules.length === 1 ? '' : 's'}
                                {s.edited && s.updatedBy ? ` · last edited by ${s.updatedBy}, ${fmtWhen(s.updatedAt)}` : ' · original text'}
                            </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-1.5">
                            <button
                                type="button"
                                className="btn-secondary px-2 py-1 text-xs"
                                disabled={busy || i === 0}
                                title="Move up"
                                onClick={() => void run(() => movePolicySection(s.dbId, 'up'))}
                            >
                                ↑
                            </button>
                            <button
                                type="button"
                                className="btn-secondary px-2 py-1 text-xs"
                                disabled={busy || i === sections.length - 1}
                                title="Move down"
                                onClick={() => void run(() => movePolicySection(s.dbId, 'down'))}
                            >
                                ↓
                            </button>
                            <button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={busy} onClick={() => startEdit(s)}>
                                Edit
                            </button>
                            <button
                                type="button"
                                className="btn-secondary px-2.5 py-1 text-xs"
                                disabled={busy}
                                onClick={() =>
                                    void run(() => setPolicySectionHidden(s.dbId, !s.hidden), s.hidden ? 'Section is visible again.' : 'Section hidden.')
                                }
                            >
                                {s.hidden ? 'Show' : 'Hide'}
                            </button>
                            <button
                                type="button"
                                className="btn-secondary px-2.5 py-1 text-xs text-red-700"
                                disabled={busy}
                                onClick={async () => {
                                    if (!(await confirmDelete(`the "${s.title}" policy section`))) return
                                    void run(() => deletePolicySection(s.dbId), 'Section deleted.')
                                }}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                ))}
                {sections.length === 0 ? (
                    <p className="text-sm text-[var(--color-warm-text)]">No sections yet - add the first one.</p>
                ) : null}
            </div>

            {changes.length > 0 ? (
                <div className="card border p-4">
                    <p className="text-sm font-semibold text-[var(--color-ink)]">Recent changes</p>
                    <ul className="mt-2 space-y-1 text-xs text-[var(--color-warm-text)]">
                        {changes.slice(0, 12).map((c) => (
                            <li key={c.id}>
                                <span className="tabular-nums">{fmtWhen(c.changedAt)}</span> · {c.changedBy ?? 'HR'}{' '}
                                {ACTION_LABEL[c.action] ?? c.action} &ldquo;{c.title}&rdquo; ({c.docId === 'company' ? 'Company' : 'Attendance'})
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    )
}