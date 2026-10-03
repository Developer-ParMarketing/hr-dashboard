import { useMemo } from 'react'
import {
  categoryLabel,
  formatAmountInr,
  formatExpenseDateShort,
  parseAmountInput,
  type ReimbursementCategory,
  type ReimbursementRequest,
} from '../api/reimbursementRequests'
import { ReimbursementSpecialApprovalNotice } from './ReimbursementSpecialApprovalPolicy'

type CategoryOption = { id: ReimbursementCategory; label: string }

type Props = {
  categories: CategoryOption[]
  category: ReimbursementCategory
  onCategoryChange: (category: ReimbursementCategory) => void
  expenseDate: string
  onExpenseDateChange: (value: string) => void
  amount: string
  onAmountChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
  receiptFiles: File[]
  onReceiptFilesChange: (files: File[]) => void
  maxReceipts?: number
  specialApprovalMinAmount: number
  submitting: boolean
  onSubmit: (e: React.FormEvent) => void
}

function ExpenseVoucher({
  categoryDisplay,
  expenseDate,
  amountValue,
  description,
  complete,
}: {
  categoryDisplay: string
  expenseDate: string
  amountValue: number | null
  description: string
  complete: boolean
}) {
  const rows = [
    { label: 'Expense date', value: expenseDate ? formatExpenseDateShort(expenseDate) : '-' },
    { label: 'Category', value: categoryDisplay },
    {
      label: 'Particulars',
      value: description.trim() || '-',
      multiline: true,
    },
  ]

  return (
    <div className="reimburse-voucher mx-auto w-full max-w-sm" aria-live="polite">
      <div className="reimburse-voucher-notch" aria-hidden />
      <div className="reimburse-voucher-body">
        <div className="flex items-start justify-between gap-3 border-b border-dashed border-[color-mix(in_srgb,var(--color-ink)_12%,transparent)] pb-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-brand-deep)]">
              Expense voucher
            </p>
            <p className="mt-1 text-xs text-[var(--color-warm-text)]">Reimbursement claim</p>
          </div>
          <span
            className={[
              'rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
              complete
                ? 'bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]'
                : 'bg-[color-mix(in_srgb,var(--color-warm-muted)_50%,#fff)] text-[var(--color-warm-text)]',
            ].join(' ')}
          >
            {complete ? 'Ready' : 'Draft'}
          </span>
        </div>

        <dl className="mt-4 space-y-3">
          {rows.map((row) => (
            <div
              key={row.label}
              className={[
                'border-b border-dotted border-[color-mix(in_srgb,var(--color-ink)_8%,transparent)] pb-2 text-sm last:border-0',
                row.multiline ? 'space-y-1' : 'flex gap-3',
              ].join(' ')}
            >
              <dt className="text-xs font-medium text-[var(--color-warm-text)]">{row.label}</dt>
              <dd
                className={[
                  'text-[var(--color-ink)]',
                  row.multiline
                    ? 'whitespace-pre-wrap break-words text-sm leading-snug'
                    : 'font-medium',
                ].join(' ')}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="reimburse-voucher-total mt-5 flex items-baseline justify-between gap-3 rounded-lg bg-[color-mix(in_srgb,var(--color-brand)_8%,#fff)] px-3 py-3 ring-1 ring-[color-mix(in_srgb,var(--color-brand)_18%,transparent)]">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-warm-text)]">
            Total claim
          </span>
          <span className="reimburse-voucher-total-amount tabular-nums text-[var(--color-ink)]">
            {amountValue != null ? formatAmountInr(amountValue) : '₹ 0.00'}
          </span>
        </div>

        <p className="mt-4 text-center text-[10px] leading-relaxed text-[var(--color-warm-text)]">
          Retain original bills · Approver sign-off required
        </p>
      </div>
    </div>
  )
}

export function ReimbursementApplyPanel({
  categories,
  category,
  onCategoryChange,
  expenseDate,
  onExpenseDateChange,
  amount,
  onAmountChange,
  description,
  onDescriptionChange,
  receiptFiles,
  onReceiptFilesChange,
  maxReceipts = 5,
  specialApprovalMinAmount,
  submitting,
  onSubmit,
}: Props) {
  const options =
    categories.length > 0
      ? categories
      : [
          { id: 'travel' as const, label: 'Travel' },
          { id: 'client' as const, label: 'Client visit' },
          { id: 'other' as const, label: 'Other' },
        ]

  const amountValue = parseAmountInput(amount)
  const categoryDisplay =
    options.find((c) => c.id === category)?.label ?? categoryLabel(category)
  const voucherComplete = Boolean(expenseDate && amountValue != null && receiptFiles.length > 0)

  return (
    <form
      className="card max-w-4xl overflow-hidden border p-0"
      onSubmit={onSubmit}
      aria-label="New reimbursement claim"
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_min(19rem,36%)]">
        <div className="border-b border-[color-mix(in_srgb,var(--color-warm-muted)_55%,transparent)] p-6 sm:p-7 lg:border-b-0 lg:border-r">
          <h2 className="text-lg font-semibold text-[var(--color-ink)]">New expense claim</h2>
          <p className="mt-1 text-sm text-[var(--color-warm-text)]">
            Enter the amount and details - the voucher on the right updates as you type.
          </p>

          <label className="feature-field mt-6 block">
            <span>Claim amount</span>
            <div className="reimburse-amount-input mt-1 flex items-center gap-2 rounded-xl border border-[color-mix(in_srgb,var(--color-warm-muted)_90%,#000)] bg-[var(--color-surface)] px-4 py-3 shadow-[inset_0_1px_2px_rgba(26,18,12,0.03)] focus-within:border-[var(--color-brand)] focus-within:ring-[3px] focus-within:ring-[color-mix(in_srgb,var(--color-brand)_18%,transparent)]">
              <span className="text-lg font-semibold text-[var(--color-warm-text)]">₹</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => onAmountChange(e.target.value)}
                placeholder="0.00"
                required
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-2xl font-bold tabular-nums text-[var(--color-ink)] outline-none placeholder:font-normal placeholder:text-[color-mix(in_srgb,var(--color-warm-text)_45%,transparent)]"
                aria-label="Amount in rupees"
              />
            </div>
            <ReimbursementSpecialApprovalNotice
              amountValue={amountValue}
              specialApprovalMinAmount={specialApprovalMinAmount}
            />
          </label>

          <fieldset className="mt-5">
            <legend className="mb-2 block text-sm font-medium text-[var(--color-ink)]">
              Category
            </legend>
            <div className="seg flex-wrap" role="radiogroup" aria-label="Expense category">
              {options.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={category === c.id}
                  className={`seg-btn ${category === c.id ? 'seg-btn-active' : ''}`}
                  onClick={() => onCategoryChange(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="feature-field mt-5 max-w-md">
            <span>Expense date</span>
            <input
              type="date"
              className="w-full"
              value={expenseDate}
              onChange={(e) => onExpenseDateChange(e.target.value)}
              required
            />
          </label>

          <div className="reimburse-particulars-field mt-5">
            <label htmlFor="reimburse-particulars" className="block text-sm font-medium text-[var(--color-ink)]">
              Particulars
            </label>
            <p className="mt-1 text-xs text-[var(--color-warm-text)]">
              Brief description for your approver (cab, meal, toll, etc.)
            </p>
            <textarea
              id="reimburse-particulars"
              rows={4}
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="e.g. Client visit - return cab from Andheri to office"
              className="field mt-2 min-h-[6.75rem] w-full resize-y"
            />
          </div>

          <div className="mt-5">
            <label className="block text-sm font-medium text-[var(--color-ink)]">
              Receipts <span className="text-rose-700">*</span>
            </label>
            <p className="mt-1 text-xs text-[var(--color-warm-text)]">
              Required - PDF or image (up to {maxReceipts} files, 10 MB each). Visible to your approver and HR.
            </p>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              multiple
              className="mt-2 block w-full text-sm text-[var(--color-warm-text)] file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--color-brand-soft)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--color-brand-deep)]"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? [])
                if (!picked.length) return
                const merged = [...receiptFiles, ...picked].slice(0, maxReceipts)
                onReceiptFilesChange(merged)
                e.target.value = ''
              }}
            />
            {receiptFiles.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {receiptFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[color-mix(in_srgb,var(--color-warm-muted)_65%,transparent)] bg-white px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate text-[var(--color-ink)]">{file.name}</span>
                    <button
                      type="button"
                      className="btn-ghost shrink-0 px-2 py-1 text-xs"
                      onClick={() =>
                        onReceiptFilesChange(receiptFiles.filter((_, i) => i !== index))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <button
            type="submit"
            className="btn-primary mt-6"
            disabled={submitting || receiptFiles.length === 0}
          >
            {submitting ? 'Submitting…' : 'Submit for approval'}
          </button>
        </div>

        <div className="bg-[color-mix(in_srgb,var(--color-warm-page)_70%,#fff)] p-6 sm:p-7 lg:py-10">
          <ExpenseVoucher
            categoryDisplay={categoryDisplay}
            expenseDate={expenseDate}
            amountValue={amountValue}
            description={description}
            complete={voucherComplete}
          />
        </div>
      </div>
    </form>
  )
}

export function ReimbursementClaimStats({ rows }: { rows: ReimbursementRequest[] }) {
  const stats = useMemo(() => {
    const pending = rows.filter((r) => r.status === 'pending')
    const approved = rows.filter((r) => r.status === 'approved')
    const rejected = rows.filter((r) => r.status === 'rejected')
    const sum = (list: ReimbursementRequest[]) => list.reduce((acc, r) => acc + r.amount, 0)
    return {
      pendingCount: pending.length,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      pendingTotal: sum(pending),
      approvedTotal: sum(approved),
      total: rows.length,
    }
  }, [rows])

  if (stats.total === 0) return null

  return (
    <div
      className="reimburse-ledger flex flex-col gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--color-brand)_14%,transparent)] bg-[var(--color-surface)] px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-8 sm:gap-y-2"
      aria-label="Your reimbursement summary"
    >
      <p className="text-sm font-semibold text-[var(--color-ink)]">Your claims</p>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <p className="tabular-nums">
          <span className="text-[var(--color-warm-text)]">Pending </span>
          <span className="font-bold text-amber-800">
            {formatAmountInr(stats.pendingTotal)}
          </span>
          <span className="text-[var(--color-warm-text)]"> ({stats.pendingCount})</span>
        </p>
        <p className="tabular-nums">
          <span className="text-[var(--color-warm-text)]">Approved </span>
          <span className="font-bold text-emerald-800">
            {formatAmountInr(stats.approvedTotal)}
          </span>
          <span className="text-[var(--color-warm-text)]"> ({stats.approvedCount})</span>
        </p>
        {stats.rejectedCount > 0 ? (
          <p>
            <span className="text-[var(--color-warm-text)]">Rejected </span>
            <span className="font-semibold text-rose-800">{stats.rejectedCount}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}
