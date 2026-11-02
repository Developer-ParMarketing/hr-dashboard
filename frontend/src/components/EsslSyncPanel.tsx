import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getEsslStatus, syncEsslMonth, type EsslStatus, type EsslSyncResult } from '../api/attendance'
import { toastSuccess } from '../utils/toastBridge'

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
]

type Props = {
    year: number
    month: number
    /** Reload the register after a sync saved changes. */
    onSynced?: (year: number, month: number) => void
}

/** Group machine codes by their letter prefix (CCM179 → CCM). */
function groupCodes(codes: string[]): { prefix: string; codes: string[] }[] {
    const map = new Map<string, string[]>()
    for (const code of codes) {
        const prefix = code.match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || 'Other'
        const list = map.get(prefix) ?? []
        list.push(code)
        map.set(prefix, list)
    }
    return [...map.entries()]
        .map(([prefix, list]) => ({
            prefix,
            codes: list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
        }))
        .sort((a, b) => b.codes.length - a.codes.length)
}

function SkippedCodes({ codes }: { codes: string[] }) {
    const groups = groupCodes(codes)
    return (
        <details className="group mt-3 rounded-lg border border-[color-mix(in_srgb,var(--color-ink)_12%,transparent)] bg-[color-mix(in_srgb,var(--color-ink)_3%,transparent)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-xs">
                <span className="text-[var(--color-ink)]">
                    <span className="font-semibold">{codes.length} machine codes skipped</span>
                    <span className="text-[var(--color-warm-text)]"> · not in Admin → People</span>
                </span>
                <span className="flex flex-wrap items-center justify-end gap-1.5">
                    {groups.map((g) => (
                        <span
                            key={g.prefix}
                            className="rounded-full border border-[color-mix(in_srgb,var(--color-ink)_12%,transparent)] bg-white/70 px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink)]"
                        >
                            {g.prefix} {g.codes.length}
                        </span>
                    ))}
                    <span className="ml-1 text-[var(--color-warm-text)] transition-transform group-open:rotate-180" aria-hidden>
                        ▾
                    </span>
                </span>
            </summary>
            <div className="space-y-3 border-t border-[color-mix(in_srgb,var(--color-ink)_10%,transparent)] px-3 py-3">
                <p className="text-xs leading-relaxed text-[var(--color-warm-text)]">
                    These people punch on the machine but have no matching employee code in Admin → People, so their
                    punches are ignored. Add them with the same code to include them.
                </p>
                {groups.map((g) => (
                    <div key={g.prefix}>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
                            {g.prefix} · {g.codes.length}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {g.codes.map((code) => (
                                <span
                                    key={code}
                                    className="rounded-md border border-[color-mix(in_srgb,var(--color-ink)_10%,transparent)] bg-white px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-ink)]"
                                >
                                    {code}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </details>
    )
}

function errorMessage(e: unknown): string {
    if (e && typeof e === 'object' && 'response' in e) {
        const data = (e as { response?: { data?: { error?: string; message?: string } } }).response?.data
        if (data?.error) return data.error
        if (data?.message) return data.message
    }
    return e instanceof Error ? e.message : 'Sync failed'
}

function localDateTime(iso: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function summaryLine(r: EsslSyncResult): string {
    const period = `${MONTHS[r.month - 1] ?? r.month} ${r.year}`
    const punches = `${r.punches} punch${r.punches === 1 ? '' : 'es'} read`
    if (r.punches === 0) return `${period}: the machine returned no punches, nothing was changed.`
    if (r.daysChanged === 0) return `${period}: ${punches}, register already up to date.`
    return `${period}: ${punches}, ${r.daysChanged} day${r.daysChanged === 1 ? '' : 's'} updated for ${r.employeesUpdated} employee${r.employeesUpdated === 1 ? '' : 's'}.`
}

export function EsslSyncPanel({ year, month, onSynced }: Props) {
    const [status, setStatus] = useState<EsslStatus | null>(null)
    const [syncing, setSyncing] = useState(false)
    const [result, setResult] = useState<EsslSyncResult | null>(null)
    const [error, setError] = useState<string | null>(null)

    const loadStatus = useCallback(async () => {
        try {
            const s = await getEsslStatus()
            setStatus(s)
            if (s.last) setResult((prev) => prev ?? s.last)
        } catch {
            setStatus(null)
        }
    }, [])

    useEffect(() => {
        void loadStatus()
    }, [loadStatus])

    const runSync = useCallback(async () => {
        setSyncing(true)
        setError(null)
        try {
            const r = await syncEsslMonth(year, month)
            setResult(r)
            if (r.error) setError(r.error)
            else toastSuccess(summaryLine(r), 5000)
            if (r.daysChanged > 0) onSynced?.(r.year, r.month)
            void loadStatus()
        } catch (e) {
            setError(errorMessage(e))
        } finally {
            setSyncing(false)
        }
    }, [year, month, onSynced, loadStatus])

    const configured = status?.configured ?? false
    const last = result

    return (
        <div className="card border p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-[var(--color-ink)]">Biometric machine (eSSL)</h3>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--color-warm-text)]">
                        Pulls punch in/out straight from the attendance machine into this register. First punch is In, last
                        punch is Out. HR edits, leave/WFH and approved weeks are kept.
                    </p>
                    <p className="mt-2 text-xs text-[var(--color-warm-text)]">
                        {status == null
                            ? 'Checking machine settings…'
                            : !configured
                                ? 'Not configured on the server yet (ESSL_* settings in backend/.env).'
                                : status.autoSync
                                    ? `Auto-sync is on: every ${status.intervalMinutes} min.`
                                    : 'Auto-sync is off: use the button to pull punches.'}
                    </p>
                </div>
                <button
                    type="button"
                    className="btn-primary shrink-0 disabled:opacity-50"
                    disabled={syncing || !configured}
                    onClick={() => void runSync()}
                >
                    {syncing ? 'Syncing…' : `Sync ${MONTHS[month - 1] ?? ''} ${year} from machine`}
                </button>
            </div>

            {error ? <p className="alert-error mt-4 whitespace-pre-line">{error}</p> : null}

            {last && !error ? (
                <div className="mt-4 space-y-1 text-xs text-[var(--color-warm-text)]">
                    <p className="text-[var(--color-ink)]">{summaryLine(last)}</p>
                    <p>
                        Last sync {localDateTime(last.finishedAt)}
                        {last.trigger === 'schedule' ? ' (automatic)' : ''}
                    </p>
                    <p>
                        <Link
                            to={`/attendance-detail?year=${last.year}&month=${last.month}&company=PM`}
                            className="font-medium text-[var(--color-accent,#ea580c)] underline"
                        >
                            View {MONTHS[last.month - 1]} {last.year} register →
                        </Link>
                    </p>
                    {last.unmatchedCodes.length > 0 ? <SkippedCodes codes={last.unmatchedCodes} /> : null}
                </div>
            ) : null}
        </div>
    )
}