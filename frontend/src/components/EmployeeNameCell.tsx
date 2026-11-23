import type { NormalizedEmployee } from '../types/attendance'

/** Name + team / manager line + Details button (opens the employee month view). */
export function EmployeeNameCell({
    emp,
    onDetails,
}: {
    emp: NormalizedEmployee
    onDetails?: () => void
}) {
    const team = emp.teamName || emp.department || ''
    return (
        <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
                {onDetails ? (
                    <button
                        type="button"
                        onClick={onDetails}
                        className="block max-w-full truncate text-left font-medium text-[var(--color-ink)] hover:text-[var(--color-brand)] hover:underline"
                        title="View full month"
                    >
                        {emp.employeeName}
                    </button>
                ) : (
                    <span className="block truncate font-medium text-[var(--color-ink)]">{emp.employeeName}</span>
                )}
                {team || emp.teamManagerName ? (
                    <span className="mt-0.5 block truncate text-[0.7rem] font-normal leading-tight text-[var(--color-warm-text)]">
                        {team}
                        {team && emp.teamManagerName ? ' · ' : ''}
                        {emp.teamManagerName ? <span className="text-emerald-700">Mgr: {emp.teamManagerName}</span> : null}
                    </span>
                ) : null}
            </div>
            {onDetails ? (
                <button
                    type="button"
                    onClick={onDetails}
                    className="shrink-0 rounded-md border border-[var(--color-warm-muted)] bg-[var(--color-surface)] px-2 py-0.5 text-[0.7rem] font-medium text-[var(--color-warm-text)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
                >
                    Details
                </button>
            ) : null}
        </div>
    )
}