import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { applyLeaveWfhFiles, type ApplyLeaveWfhResult } from '../api/attendance'
import { DOCUMENT_UPLOAD_ACCEPT } from '../constants/uploadFormats'
import { formatDisplayDate } from '../utils/displayDate'
import { confirmAction } from '../utils/confirmAction'
import { toastSuccess } from '../utils/toastBridge'

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]

type Props = {
    year: number
    month: number
    company?: string
}

function errorMessage(e: unknown): string {
    if (e && typeof e === 'object' && 'response' in e) {
        const data = (e as { response?: { data?: { error?: string; message?: string } } }).response?.data
        if (data?.error) return data.error
        if (data?.message) return data.message
    }
    return e instanceof Error ? e.message : 'Could not apply the file'
}

function FilePick({
    label,
    file,
    onChange,
    disabled,
}: {
    label: string
    file: File | null
    onChange: (f: File | null) => void
    disabled: boolean
}) {
    const ref = useRef<HTMLInputElement>(null)
    return (
        <div className="min-w-0 flex-1">
            <p className="mb-1.5 text-xs text-[var(--color-warm-text)]">{label}</p>
            <div className="flex items-center gap-2">
                <input
                    ref={ref}
                    type="file"
                    accept={DOCUMENT_UPLOAD_ACCEPT}
                    className="hidden"
                    onChange={(e) => onChange(e.target.files?.[0] ?? null)}
                />
                <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" disabled={disabled} onClick={() => ref.current?.click()}>
                    Browse
                </button>
                <span className="min-w-0 truncate text-xs text-[var(--color-ink)]">{file ? file.name : 'Not added'}</span>
                {file ? (
                    <button
                        type="button"
                        className="text-xs text-[var(--color-warm-text)] underline"
                        disabled={disabled}
                        onClick={() => {
                            onChange(null)
                            if (ref.current) ref.current.value = ''
                        }}
                    >
                        Remove
                    </button>
                ) : null}
            </div>
        </div>
    )
}

export function LeaveWfhApplyPanel({ year, month, company = 'PM' }: Props) {
    const [period, setPeriod] = useState(`${year}-${String(month).padStart(2, '0')}`)
    const [wfhFile, setWfhFile] = useState<File | null>(null)
    const [leaveFile, setLeaveFile] = useState<File | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [result, setResult] = useState<ApplyLeaveWfhResult | null>(null)

    const [py, pm] = period.split('-').map((v) => Number.parseInt(v, 10))
    const periodLabel = `${MONTHS[(pm || 1) - 1]} ${py}`

    const apply = async () => {
        if (!wfhFile && !leaveFile) return
        const names = [wfhFile?.name, leaveFile?.name].filter(Boolean).join(' + ')
        if (
            !(await confirmAction(
                `Apply ${names} to ${periodLabel}?\n\nAbsent days that match the file become WFH / leave. Days already marked WFH or leave are not changed.`,
            ))
        ) {
            return
        }
        setBusy(true)
        setError(null)
        setResult(null)
        try {
            const r = await applyLeaveWfhFiles({ year: py, month: pm, company, wfhFile, leaveFile })
            setResult(r)
            const failed = r.persisted.filter((p) => p.error)
            if (failed.length) setError(failed.map((p) => `${p.company}: ${p.error}`).join('\n'))
            else {
                toastSuccess(
                    r.daysChanged === 0
                        ? `${periodLabel}: nothing to change.`
                        : `${periodLabel}: ${r.wfhDays} WFH and ${r.leaveDays} leave day${r.leaveDays === 1 ? '' : 's'} applied.`,
                    5000,
                )
                setWfhFile(null)
                setLeaveFile(null)
            }
        } catch (e) {
            setError(errorMessage(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="card border p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-[var(--color-ink)]">Apply WFH / leave file</h3>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--color-warm-text)]">
                        Upload only the Computex WFH and/or leave export. It is matched to the attendance already saved for the
                        month (from the machine), no register file needed. Absent days for the same employee and date become WFH or
                        leave; days with an office punch stay present.
                    </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-warm-text)]">
                    Month
                    <input
                        type="month"
                        className="field field-compact"
                        value={period}
                        disabled={busy}
                        onChange={(e) => e.target.value && setPeriod(e.target.value)}
                    />
                </label>
            </div>

            <div className="mt-4 flex flex-col gap-4 rounded-lg border border-[color-mix(in_srgb,var(--color-ink)_10%,transparent)] p-4 sm:flex-row">
                <FilePick label="WFH file" file={wfhFile} onChange={setWfhFile} disabled={busy} />
                <FilePick label="Leave file (optional)" file={leaveFile} onChange={setLeaveFile} disabled={busy} />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    className="btn-primary disabled:opacity-50"
                    disabled={busy || (!wfhFile && !leaveFile)}
                    onClick={() => void apply()}
                >
                    {busy ? 'Applying…' : `Apply to ${periodLabel}`}
                </button>
            </div>

            {error ? <p className="alert-error mt-4 whitespace-pre-line">{error}</p> : null}

            {result && !error ? (
                <div className="mt-4 space-y-2 text-xs text-[var(--color-warm-text)]">
                    <p className="text-[var(--color-ink)]">
                        {result.daysChanged === 0
                            ? `${periodLabel}: no absent days matched the file, nothing changed.`
                            : `${periodLabel}: ${result.wfhDays} WFH day${result.wfhDays === 1 ? '' : 's'} and ${result.leaveDays} leave day${result.leaveDays === 1 ? '' : 's'} applied for ${result.employeesUpdated} employee${result.employeesUpdated === 1 ? '' : 's'}.`}
                    </p>
                    <p>
                        <Link
                            to={`/attendance-detail?year=${result.year}&month=${result.month}&company=${company}`}
                            className="font-medium text-[var(--color-accent,#ea580c)] underline"
                        >
                            View {MONTHS[result.month - 1]} {result.year} register →
                        </Link>
                    </p>
                    {result.skippedPresent.length > 0 ? (
                        <p>
                            {result.skippedPresent.length} day{result.skippedPresent.length === 1 ? '' : 's'} kept as present - the
                            machine shows an office punch:{' '}
                            {result.skippedPresent
                                .slice(0, 6)
                                .map((c) => `${c.code} ${formatDisplayDate(c.date)}`)
                                .join(', ')}
                            {result.skippedPresent.length > 6 ? ` and ${result.skippedPresent.length - 6} more` : ''}.
                        </p>
                    ) : null}
                    {result.changes.length > 0 ? (
                        <details className="rounded-lg border border-[color-mix(in_srgb,var(--color-ink)_12%,transparent)]">
                            <summary className="cursor-pointer px-3 py-2 font-medium text-[var(--color-ink)]">
                                {result.changes.length} day{result.changes.length === 1 ? '' : 's'} changed
                            </summary>
                            <div className="max-h-72 overflow-auto border-t border-[color-mix(in_srgb,var(--color-ink)_10%,transparent)]">
                                <table className="w-full text-left text-xs">
                                    <thead className="sticky top-0 bg-[var(--color-surface,#fff)]">
                                        <tr>
                                            <th className="px-3 py-1.5 font-semibold">Date</th>
                                            <th className="px-3 py-1.5 font-semibold">Employee</th>
                                            <th className="px-3 py-1.5 font-semibold">Was</th>
                                            <th className="px-3 py-1.5 font-semibold">Now</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {result.changes.map((c) => (
                                            <tr key={`${c.code}-${c.date}`} className="border-t border-[color-mix(in_srgb,var(--color-ink)_6%,transparent)]">
                                                <td className="px-3 py-1.5 whitespace-nowrap">{formatDisplayDate(c.date)}</td>
                                                <td className="px-3 py-1.5">
                                                    <span className="font-mono">{c.code}</span> {c.name}
                                                </td>
                                                <td className="px-3 py-1.5 font-mono">{c.from}</td>
                                                <td className="px-3 py-1.5 font-mono text-[var(--color-ink)]">{c.to}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </details>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}