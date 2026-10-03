import { APPROVAL_WORKFLOW_LABELS } from '../constants/workflowStatus'
import { BulkSelectCheckbox } from './BulkSelectCheckbox'
import { WorkflowSpinner } from './WorkflowStatus'

type Props = {
  selectableCount: number
  /** e.g. "employees" → Select all (23 employees). Omit for a plain number. */
  countLabel?: string
  selectedCount: number
  /** Override default "{n} selected" (e.g. monthly bulk selects week records per employee). */
  selectedSummary?: string
  allSelected: boolean
  someSelected: boolean
  busy?: boolean
  onToggleAll: () => void
  onApprove: () => void
  onReject: () => void
  /** Monthly attendance approval (default labels reference weekly rows). */
  variant?: 'weekly' | 'monthly'
}

export function BulkWeekApprovalBar({
  selectableCount,
  countLabel,
  selectedCount,
  selectedSummary,
  allSelected,
  someSelected,
  busy = false,
  onToggleAll,
  onApprove,
  onReject,
  variant = 'weekly',
}: Props) {
  if (selectableCount === 0) return null

  const approveLabel = variant === 'monthly' ? 'Approve monthly' : 'Approve selected'
  const rejectLabel = variant === 'monthly' ? 'Reject monthly' : 'Reject selected'
  const selectAllAria =
    variant === 'monthly' ? 'Select all employees for monthly approval' : 'Select all rows for approval'

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[color-mix(in_srgb,var(--color-brand)_18%,var(--color-warm-muted))] bg-[color-mix(in_srgb,var(--color-brand-muted)_35%,#fff)] px-3 py-2.5">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-ink)]">
        <BulkSelectCheckbox
          checked={allSelected}
          indeterminate={someSelected}
          disabled={busy}
          onChange={onToggleAll}
          ariaLabel={selectAllAria}
        />
        <span>
          Select all{' '}
          <span className="text-[var(--color-warm-text)]">
            ({selectableCount}
            {countLabel ? ` ${countLabel}` : ''})
          </span>
        </span>
      </label>
      <span className="text-sm text-[var(--color-warm-text)]">
        {selectedSummary ?? `${selectedCount} selected`}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={selectedCount === 0 || busy}
          onClick={onApprove}
          className="inline-flex items-center rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {busy ? (
            <>
              <WorkflowSpinner className="mr-1.5 h-3.5 w-3.5" />
              {APPROVAL_WORKFLOW_LABELS.approving}
            </>
          ) : (
            approveLabel
          )}
        </button>
        <button
          type="button"
          disabled={selectedCount === 0 || busy}
          onClick={onReject}
          className="inline-flex items-center rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50"
        >
          {rejectLabel}
        </button>
      </div>
    </div>
  )
}
