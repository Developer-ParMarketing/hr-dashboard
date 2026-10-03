import { client } from './client'
import { formatDisplayDate } from '../utils/displayDate'

export type ReimbursementCategory = 'travel' | 'client' | 'other'
export type ReimbursementStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export type ReimbursementReceipt = {
  id: number
  fileName: string
  mimeType: string
  fileSize: number
  uploadedAt: string
}

export type ReimbursementRequest = {
  id: number
  employeeId: number
  requesterUserId: number
  expenseDate: string
  category: ReimbursementCategory
  amount: number
  description: string
  status: ReimbursementStatus
  approvalTier: 'manager' | 'leadership_hr'
  assignedApproverUserId: number | null
  assignedApproverName: string | null
  assignedApproverEmail: string | null
  pendingWithLabel: string | null
  decidedByUserId: number | null
  decidedByName: string | null
  decidedByEmail: string | null
  decidedAt: string | null
  decisionNote: string | null
  submissionFlags?: string[]
  requiresSpecialApproval?: boolean
  createdAt: string
  updatedAt: string
  employeeCode: string
  employeeName: string
  requesterName: string
  requesterEmail: string
  receipts: ReimbursementReceipt[]
}

export type ReimbursementCapabilities = {
  canSubmit: boolean
  canViewPendingApproval: boolean
  canViewAll: boolean
  isExecutiveApprover: boolean
  canManageReimbursementPolicy?: boolean
}

export async function fetchReimbursementMeta(): Promise<{
  categories: Array<{ id: ReimbursementCategory; label: string }>
  capabilities: ReimbursementCapabilities
  specialApprovalMinAmount: number
  maxReceiptBytes: number
  maxReceiptsPerClaim: number
  allowedReceiptMime: string[]
}> {
  const { data } = await client.get('/api/reimbursement-requests/meta')
  return data
}

export async function updateReimbursementSpecialApprovalMinAmount(amount: number): Promise<number> {
  const { data } = await client.put<{ specialApprovalMinAmount: number }>(
    '/api/reimbursement-requests/policy/special-approval-min-amount',
    { amount },
  )
  return data.specialApprovalMinAmount
}

export async function submitReimbursementRequest(
  input: {
    expenseDate: string
    category: ReimbursementCategory
    amount: number
    description: string
    acknowledgeFlags?: boolean
  },
  receiptFiles?: File[],
): Promise<ReimbursementRequest> {
  const form = new FormData()
  form.append('expenseDate', input.expenseDate)
  form.append('category', input.category)
  form.append('amount', String(input.amount))
  form.append('description', input.description)
  if (input.acknowledgeFlags) {
    form.append('acknowledgeFlags', 'true')
  }
  for (const file of receiptFiles ?? []) {
    form.append('receipt', file)
  }
  const { data } = await client.post<{ request: ReimbursementRequest }>(
    '/api/reimbursement-requests',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data.request
}

export async function uploadReimbursementReceipts(
  requestId: number,
  files: File[],
): Promise<ReimbursementReceipt[]> {
  const form = new FormData()
  for (const file of files) {
    form.append('receipt', file)
  }
  const { data } = await client.post<{ receipts: ReimbursementReceipt[] }>(
    `/api/reimbursement-requests/${requestId}/receipts`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return data.receipts
}

export function openReimbursementReceipt(receiptId: number, inline = true): void {
  const q = inline ? '?inline=1' : ''
  window.open(
    `/api/reimbursement-requests/receipts/${receiptId}/file${q}`,
    '_blank',
    'noopener,noreferrer',
  )
}

export function downloadReimbursementReceipt(receiptId: number): void {
  window.open(
    `/api/reimbursement-requests/receipts/${receiptId}/file`,
    '_blank',
    'noopener,noreferrer',
  )
}

export function formatReceiptSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function fetchMyReimbursementRequests(): Promise<ReimbursementRequest[]> {
  const { data } = await client.get<{ requests: ReimbursementRequest[] }>(
    '/api/reimbursement-requests/mine',
  )
  return data.requests
}

export async function fetchPendingReimbursementRequests(): Promise<ReimbursementRequest[]> {
  const { data } = await client.get<{ requests: ReimbursementRequest[] }>(
    '/api/reimbursement-requests/pending',
  )
  return data.requests
}

export async function fetchAllReimbursementRequests(): Promise<ReimbursementRequest[]> {
  const { data } = await client.get<{ requests: ReimbursementRequest[] }>(
    '/api/reimbursement-requests/all',
  )
  return data.requests
}

export async function decideReimbursementRequest(
  id: number,
  input: { status: 'approved' | 'rejected'; note?: string },
): Promise<ReimbursementRequest> {
  const { data } = await client.patch<{ request: ReimbursementRequest }>(
    `/api/reimbursement-requests/${id}/decision`,
    input,
  )
  return data.request
}

export async function cancelReimbursementRequest(id: number): Promise<ReimbursementRequest> {
  const { data } = await client.post<{ request: ReimbursementRequest }>(
    `/api/reimbursement-requests/${id}/cancel`,
  )
  return data.request
}

export function categoryLabel(category: ReimbursementCategory): string {
  if (category === 'travel') return 'Travel'
  if (category === 'client') return 'Client visit'
  return 'Other'
}

export function statusLabel(status: ReimbursementStatus): string {
  if (status === 'pending') return 'Pending'
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  return 'Cancelled'
}

export function formatAmountInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatExpenseDateShort(iso: string): string {
  return formatDisplayDate(iso)
}

export function parseAmountInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

export function categoryAccent(category: ReimbursementCategory): {
  badge: string
  ring: string
  soft: string
  hint: string
} {
  if (category === 'travel') {
    return {
      badge: 'TR',
      ring: 'ring-[var(--insight-people)]',
      soft: 'bg-[var(--insight-people-soft)] text-[#1e40af]',
      hint: 'Travel, cab, or commute',
    }
  }
  if (category === 'client') {
    return {
      badge: 'CV',
      ring: 'ring-[var(--insight-attendance)]',
      soft: 'bg-[var(--insight-attendance-soft)] text-emerald-900',
      hint: 'Client meetings & visits',
    }
  }
  return {
    badge: 'OT',
    ring: 'ring-[var(--color-brand)]',
    soft: 'bg-[var(--insight-payroll-soft)] text-[var(--color-brand-deep)]',
    hint: 'Other approved expenses',
  }
}
