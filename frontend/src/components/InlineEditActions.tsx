import { APPROVAL_WORKFLOW_LABELS } from '../constants/workflowStatus'
import { WorkflowSpinner } from './WorkflowStatus'

type Props = {
  editing: boolean
  saving: boolean
  disabled?: boolean
  onEdit: () => void
  onSave: () => void
  onCancel: () => void
}

export function InlineEditActions({
  editing,
  saving,
  disabled = false,
  onEdit,
  onSave,
  onCancel,
}: Props) {
  if (disabled) {
    return <span className="text-[0.65rem] text-[color-mix(in_srgb,var(--color-warm-text)_70%,transparent)]">Locked</span>
  }
  if (!editing) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="rounded-md border border-[color-mix(in_srgb,var(--color-brand)_45%,transparent)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--color-brand)] hover:bg-[var(--color-brand-muted)]"
      >
        Edit
      </button>
    )
  }
  return (
    <div className="flex flex-wrap justify-center gap-1">
      <button
        type="button"
        disabled={saving}
        onClick={onSave}
        className="inline-flex items-center rounded-md bg-[var(--color-brand)] px-2 py-0.5 text-[0.65rem] font-semibold text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? (
          <>
            <WorkflowSpinner className="mr-1 h-3 w-3" />
            {APPROVAL_WORKFLOW_LABELS.saving}
          </>
        ) : (
          'Save'
        )}
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={onCancel}
        className="rounded-md border border-[var(--color-warm-muted)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--color-warm-text)] hover:bg-[color-mix(in_srgb,var(--color-warm-page)_50%,#fff)] disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  )
}
