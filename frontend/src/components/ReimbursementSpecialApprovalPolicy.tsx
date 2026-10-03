import { useEffect, useState } from 'react'
import axios from 'axios'
import {
  formatAmountInr,
  updateReimbursementSpecialApprovalMinAmount,
} from '../api/reimbursementRequests'
import { confirmAction } from '../utils/confirmAction'
import { toastSuccess } from '../utils/toastBridge'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    const msg =
      typeof e.response?.data === 'string'
        ? e.response.data
        : (e.response?.data as { message?: string } | undefined)?.message
    return msg || fallback
  }
  return e instanceof Error ? e.message : fallback
}

type Props = {
  specialApprovalMinAmount: number
  onUpdated: (amount: number) => void
}

export function ReimbursementSpecialApprovalPolicy({ specialApprovalMinAmount, onUpdated }: Props) {
  const [draft, setDraft] = useState(String(specialApprovalMinAmount))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(String(specialApprovalMinAmount))
  }, [specialApprovalMinAmount])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const parsed = Number.parseFloat(draft.trim())
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a positive amount.')
      return
    }
    if (
      !(await confirmAction(
        `Set the special-approval threshold to ${formatAmountInr(parsed)} for everyone?\n\nClaims above this amount will need HR approval.`,
      ))
    ) {
      return
    }
    setSaving(true)
    try {
      const amount = await updateReimbursementSpecialApprovalMinAmount(parsed)
      setDraft(String(amount))
      onUpdated(amount)
      toastSuccess('Special approval threshold updated.')
    } catch (err) {
      setError(errorMessage(err, 'Could not save threshold'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card border p-5" aria-labelledby="reimburse-policy-title">
      <h2 id="reimburse-policy-title" className="text-base font-semibold text-[var(--color-ink)]">
        Special approval threshold
      </h2>
      <p className="mt-1 text-sm text-[var(--color-warm-text)]">
        Claims with an amount <strong>above</strong> this limit are flagged and routed to HR
        instead of the employee&apos;s manager. This applies to all employees.
      </p>
      <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end" onSubmit={(e) => void save(e)}>
        <label className="feature-field min-w-[10rem] flex-1 sm:max-w-xs">
          <span>Threshold (₹)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className="w-full"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="btn-primary shrink-0" disabled={saving}>
          {saving ? 'Saving…' : 'Save for everyone'}
        </button>
      </form>
      {error ? <p className="alert-error mt-3">{error}</p> : null}
    </section>
  )
}

export function ReimbursementSpecialApprovalNotice({
  amountValue,
  specialApprovalMinAmount,
}: {
  amountValue: number | null
  specialApprovalMinAmount: number
}) {
  if (amountValue == null || amountValue <= specialApprovalMinAmount) return null
  return (
    <div
      className="mt-3 rounded-xl border border-amber-300/80 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      role="status"
    >
      <p className="font-semibold">Needs special approval</p>
      <p className="mt-1 leading-snug">
        {formatAmountInr(amountValue)} is above the {formatAmountInr(specialApprovalMinAmount)} limit. This claim
        will be flagged and sent to HR for approval.
      </p>
    </div>
  )
}
