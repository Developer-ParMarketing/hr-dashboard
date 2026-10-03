import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { ReportTableShell } from '../components/ReportTableShell'
import {
  ReimbursementApplyPanel,
  ReimbursementClaimStats,
} from '../components/ReimbursementApplyPanel'
import { ReimbursementSpecialApprovalPolicy } from '../components/ReimbursementSpecialApprovalPolicy'
import {
  cancelReimbursementRequest,
  categoryAccent,
  categoryLabel,
  decideReimbursementRequest,
  fetchAllReimbursementRequests,
  fetchMyReimbursementRequests,
  fetchPendingReimbursementRequests,
  fetchReimbursementMeta,
  formatAmountInr,
  formatExpenseDateShort,
  downloadReimbursementReceipt,
  openReimbursementReceipt,
  statusLabel,
  submitReimbursementRequest,
  type ReimbursementReceipt,
  type ReimbursementCapabilities,
  type ReimbursementCategory,
  type ReimbursementRequest,
} from '../api/reimbursementRequests'
import { formatDisplayDateTime } from '../utils/displayDate'
import { toastSuccess } from '../utils/toastBridge'
import { confirmAction, confirmRemove, confirmRequestDecision } from '../utils/confirmAction'
import { formatConfirmLines, readConfirmPayload } from '../utils/submissionConfirm'
import { tabFromSearchParams } from '../utils/requestPageTab'

type TabId = 'apply' | 'mine' | 'pending' | 'all'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

function statusClass(status: ReimbursementRequest['status']): string {
  if (status === 'approved') return 'text-emerald-700'
  if (status === 'rejected') return 'text-red-700'
  if (status === 'cancelled') return 'text-[var(--color-warm-text)]'
  return 'text-amber-700'
}

function ReimbursementReceiptLinks({ receipts }: { receipts: ReimbursementReceipt[] }) {
  const list = receipts ?? []
  if (list.length === 0) {
    return <span className="text-xs text-[var(--color-warm-text)]">-</span>
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {list.map((r) => (
        <li key={r.id} className="flex flex-col gap-0.5 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
          <span className="min-w-0 max-w-[10rem] truncate text-[var(--color-ink)]" title={r.fileName}>
            {r.fileName}
          </span>
          <span className="inline-flex shrink-0 gap-2">
            <button
              type="button"
              className="font-medium text-[var(--color-brand)] hover:underline"
              onClick={() => openReimbursementReceipt(r.id, true)}
            >
              View
            </button>
            <button
              type="button"
              className="font-medium text-[var(--color-warm-text)] hover:underline"
              onClick={() => downloadReimbursementReceipt(r.id)}
            >
              Download
            </button>
          </span>
        </li>
      ))}
    </ul>
  )
}

function ReimbursementTable({
  rows,
  showEmployee,
  showDecidedBy,
  showPendingWith,
  allowCancel,
  allowDecide,
  onCancel,
  onDecided,
  onDecideError,
}: {
  rows: ReimbursementRequest[]
  showEmployee?: boolean
  showDecidedBy?: boolean
  showPendingWith?: boolean
  allowCancel?: boolean
  allowDecide?: boolean
  onCancel?: (id: number) => void
  onDecided?: () => void
  onDecideError?: (message: string) => void
}) {
  const [decisionNote, setDecisionNote] = useState<Record<number, string>>({})
  const [busyId, setBusyId] = useState<number | null>(null)

  if (rows.length === 0) {
    return (
      <div className="card border p-8 text-sm text-[var(--color-warm-text)]">
        No reimbursement requests in this view.
      </div>
    )
  }

  async function decide(id: number, status: 'approved' | 'rejected') {
    const row = rows.find((r) => r.id === id)
    const summary = row
      ? `${row.employeeName} · ${categoryLabel(row.category)} · ${formatAmountInr(row.amount)}`
      : `Request #${id}`
    if (!(await confirmRequestDecision(status, summary))) return
    setBusyId(id)
    try {
      await decideReimbursementRequest(id, { status, note: decisionNote[id] ?? '' })
      onDecided?.()
    } catch (e) {
      onDecideError?.(errorMessage(e, 'Could not save decision'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <ReportTableShell minTableWidth="52rem">
      <table className="report-table">
        <thead>
          <tr>
            {showEmployee ? <th>Employee</th> : null}
            <th>Date</th>
            <th>Category</th>
            <th>Amount</th>
            <th>Description</th>
            <th>Receipts</th>
            <th>Status</th>
            {showPendingWith ? <th>Pending with</th> : null}
            {showDecidedBy ? <th>Decided by</th> : null}
            <th>Submitted</th>
            {(allowCancel || allowDecide) && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {showEmployee ? (
                <td>
                  <span className="font-medium">{row.employeeName}</span>
                  <span className="block text-xs text-[var(--color-warm-text)]">{row.employeeCode}</span>
                </td>
              ) : null}
              <td className="whitespace-nowrap">{formatExpenseDateShort(row.expenseDate)}</td>
              <td>
                <span
                  className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold ${categoryAccent(row.category).soft}`}
                >
                  {categoryLabel(row.category)}
                </span>
              </td>
              <td className="whitespace-nowrap">{formatAmountInr(row.amount)}</td>
              <td className="report-cell-wrap" title={row.description}>
                {row.description || '-'}
                {row.submissionFlags && row.submissionFlags.length > 0 ? (
                  <ul className="mt-1 list-inside list-disc text-xs text-amber-800">
                    {row.submissionFlags.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                ) : null}
              </td>
              <td className="report-cell-receipts">
                <ReimbursementReceiptLinks receipts={row.receipts ?? []} />
              </td>
              <td className={statusClass(row.status)}>
                <span>{statusLabel(row.status)}</span>
                {row.requiresSpecialApproval ? (
                  <span className="mt-1 block text-xs font-semibold text-amber-800">Special approval</span>
                ) : null}
              </td>
              {showPendingWith ? (
                <td>{row.status === 'pending' ? row.pendingWithLabel ?? '-' : '-'}</td>
              ) : null}
              {showDecidedBy ? (
                <td>
                  {row.decidedByName ? (
                    <>
                      <span className="block">{row.decidedByName}</span>
                      {row.decisionNote ? (
                        <span className="block text-xs text-[var(--color-warm-text)]" title={row.decisionNote}>
                          {row.decisionNote}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    '-'
                  )}
                </td>
              ) : null}
              <td className="whitespace-nowrap text-xs text-[var(--color-warm-text)]">
                {formatDisplayDateTime(row.createdAt)}
              </td>
              {(allowCancel || allowDecide) && (
                <td className="report-cell-actions">
                  {allowDecide && row.status === 'pending' ? (
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        className="field field-compact w-full"
                        placeholder="Note (optional)"
                        value={decisionNote[row.id] ?? ''}
                        onChange={(e) =>
                          setDecisionNote((prev) => ({ ...prev, [row.id]: e.target.value }))
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          disabled={busyId === row.id}
                          onClick={() => void decide(row.id, 'approved')}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          disabled={busyId === row.id}
                          onClick={() => void decide(row.id, 'rejected')}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {allowCancel && row.status === 'pending' && onCancel ? (
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      disabled={busyId === row.id}
                      onClick={() => onCancel(row.id)}
                    >
                      Cancel
                    </button>
                  ) : null}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </ReportTableShell>
  )
}

export function ReimbursementPage() {
  const [searchParams] = useSearchParams()
  const urlTab = tabFromSearchParams(searchParams)
  const [capabilities, setCapabilities] = useState<ReimbursementCapabilities | null>(null)
  const [categories, setCategories] = useState<Array<{ id: ReimbursementCategory; label: string }>>(
    [],
  )
  const [tab, setTab] = useState<TabId>('apply')
  const [mine, setMine] = useState<ReimbursementRequest[]>([])
  const [pending, setPending] = useState<ReimbursementRequest[]>([])
  const [allRows, setAllRows] = useState<ReimbursementRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [category, setCategory] = useState<ReimbursementCategory>('travel')
  const [expenseDate, setExpenseDate] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [receiptFiles, setReceiptFiles] = useState<File[]>([])
  const [maxReceipts, setMaxReceipts] = useState(5)
  const [specialApprovalMinAmount, setSpecialApprovalMinAmount] = useState(2000)

  const tabs = useMemo(() => {
    if (!capabilities) return []
    const list: Array<{ id: TabId; label: string }> = []
    if (capabilities.canSubmit) {
      list.push({ id: 'apply', label: 'New claim' }, { id: 'mine', label: 'My claims' })
    }
    if (capabilities?.canViewPendingApproval) {
      list.push({ id: 'pending', label: 'Pending approval' })
    }
    if (capabilities?.canViewAll) {
      list.push({ id: 'all', label: 'All claims' })
    }
    return list
  }, [capabilities])

  useEffect(() => {
    void fetchReimbursementMeta()
      .then((meta) => {
        setCapabilities(meta.capabilities)
        setCategories(meta.categories)
        setMaxReceipts(meta.maxReceiptsPerClaim ?? 5)
        setSpecialApprovalMinAmount(meta.specialApprovalMinAmount ?? 2000)
        if (meta.categories[0]) setCategory(meta.categories[0].id)
        const tabIds = new Set<TabId>(['apply', 'mine', 'pending', 'all'])
        if (urlTab && tabIds.has(urlTab as TabId)) {
          setTab(urlTab as TabId)
        } else if (!meta.capabilities.canSubmit) {
          setTab(
            meta.capabilities.canViewPendingApproval
              ? 'pending'
              : meta.capabilities.canViewAll
                ? 'all'
                : 'mine',
          )
        }
      })
      .catch((e) => {
        setError(errorMessage(e, 'Could not load reimbursement settings'))
      })
  }, [urlTab])

  useEffect(() => {
    if (!urlTab) return
    const tabIds = new Set<TabId>(['apply', 'mine', 'pending', 'all'])
    if (tabIds.has(urlTab as TabId)) setTab(urlTab as TabId)
  }, [urlTab])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [mineRows, pendingRows, all] = await Promise.all([
        capabilities?.canSubmit ? fetchMyReimbursementRequests() : Promise.resolve([]),
        capabilities?.canViewPendingApproval ? fetchPendingReimbursementRequests() : Promise.resolve([]),
        capabilities?.canViewAll ? fetchAllReimbursementRequests() : Promise.resolve([]),
      ])
      setMine(mineRows)
      setPending(pendingRows)
      setAllRows(all)
    } catch (e) {
      setError(errorMessage(e, 'Could not load reimbursement requests'))
    } finally {
      setLoading(false)
    }
  }, [capabilities?.canSubmit, capabilities?.canViewAll, capabilities?.canViewPendingApproval])

  useEffect(() => {
    if (capabilities == null) return
    void reload()
  }, [capabilities, reload])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const parsed = Number.parseFloat(amount)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a valid amount greater than zero.')
      setSubmitting(false)
      return
    }
    if (receiptFiles.length === 0) {
      setError('Upload at least one receipt (PDF or image).')
      setSubmitting(false)
      return
    }
    if (
      !(await confirmAction(
        `Submit this reimbursement claim?\n\n${categoryLabel(category)} · ${formatAmountInr(parsed)} · ${formatExpenseDateShort(expenseDate)}`,
      ))
    ) {
      setSubmitting(false)
      return
    }
    try {
      const ok = await submitReimbursementWithOptionalConfirm({
        expenseDate,
        category,
        amount: parsed,
        description,
      })
      if (!ok) return
      toastSuccess('Reimbursement claim submitted for approval.')
      setAmount('')
      setDescription('')
      setExpenseDate('')
      setReceiptFiles([])
      await reload()
      setTab('mine')
    } catch (err) {
      setError(errorMessage(err, 'Could not submit claim'))
    } finally {
      setSubmitting(false)
    }
  }

  async function submitReimbursementWithOptionalConfirm(input: {
    expenseDate: string
    category: ReimbursementCategory
    amount: number
    description: string
  }): Promise<boolean> {
    try {
      await submitReimbursementRequest({ ...input, acknowledgeFlags: false }, receiptFiles)
      return true
    } catch (err) {
      const payload = readConfirmPayload(err)
      if (payload?.flags?.length) {
        if (
          !(await confirmAction(
            `Please review:\n\n${formatConfirmLines(payload.flags)}\n\nSubmit anyway?`,
          ))
        ) {
          return false
        }
        await submitReimbursementRequest({ ...input, acknowledgeFlags: true }, receiptFiles)
        return true
      }
      throw err
    }
  }

  async function handleCancel(id: number) {
    if (!(await confirmRemove('this pending reimbursement claim'))) return
    setError(null)
    try {
      await cancelReimbursementRequest(id)
      toastSuccess('Claim cancelled.')
      await reload()
    } catch (e) {
      setError(errorMessage(e, 'Could not cancel claim'))
    }
  }

  return (
    <AppShell active="reimbursement">
      <main className="app-page">
        <header className="page-header">
          <p className="page-kicker">Requests</p>
          <h1 className="page-title">Reimbursement request</h1>
          <p className="feature-intro">
            Submit travel, client, and other expense claims for approver review.
          </p>

          {tabs.length > 1 ? (
            <div className="seg mt-5 inline-flex" role="tablist" aria-label="Reimbursement views">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`seg-btn ${tab === t.id ? 'seg-btn-active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  {t.id === 'pending' && pending.length > 0 ? ` (${pending.length})` : ''}
                </button>
              ))}
            </div>
          ) : null}
        </header>

        <div className="page-body min-w-0 gap-5">
          {error ? <p className="alert-error">{error}</p> : null}

          {capabilities?.canManageReimbursementPolicy ? (
            <ReimbursementSpecialApprovalPolicy
              specialApprovalMinAmount={specialApprovalMinAmount}
              onUpdated={setSpecialApprovalMinAmount}
            />
          ) : null}

          {tab === 'apply' && capabilities?.canSubmit ? (
            <ReimbursementApplyPanel
              categories={categories}
              category={category}
              onCategoryChange={setCategory}
              expenseDate={expenseDate}
              onExpenseDateChange={setExpenseDate}
              amount={amount}
              onAmountChange={setAmount}
              description={description}
              onDescriptionChange={setDescription}
              receiptFiles={receiptFiles}
              onReceiptFilesChange={setReceiptFiles}
              maxReceipts={maxReceipts}
              specialApprovalMinAmount={specialApprovalMinAmount}
              submitting={submitting}
              onSubmit={(e) => void handleSubmit(e)}
            />
          ) : null}

          {tab === 'mine' && capabilities?.canSubmit ? (
            loading ? (
              <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
            ) : (
              <div className="flex flex-col gap-4">
                <ReimbursementClaimStats rows={mine} />
                <ReimbursementTable
                rows={mine}
                showPendingWith
                showDecidedBy
                allowCancel
                onCancel={(id) => void handleCancel(id)}
              />
              </div>
            )
          ) : null}

          {tab === 'pending' ? (
            loading ? (
              <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
            ) : (
              <ReimbursementTable
                rows={pending}
                showEmployee
                allowDecide
                onDecided={() => {
                  toastSuccess('Decision saved.')
                  setError(null)
                  void reload()
                }}
                onDecideError={(msg) => {
                  setError(msg)
                }}
              />
            )
          ) : null}

          {tab === 'all' ? (
            loading ? (
              <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
            ) : (
              <ReimbursementTable rows={allRows} showEmployee showPendingWith showDecidedBy />
            )
          ) : null}
        </div>
      </main>
    </AppShell>
  )
}
