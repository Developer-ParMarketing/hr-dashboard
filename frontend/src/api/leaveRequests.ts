import { client } from './client'
import {
  formatDisplayDate,
  formatDisplayDateRange,
} from '../utils/displayDate'

export type LeaveType = 'pl' | 'sl' | 'cl'
export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export type LeaveRequest = {
  id: number
  employeeId: number
  requesterUserId: number
  leaveType: LeaveType
  startDate: string
  endDate: string
  reason: string
  status: LeaveRequestStatus
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
  applyWarnings?: string[]
  createdAt: string
  updatedAt: string
  employeeCode: string
  employeeName: string
  requesterName: string
  requesterEmail: string
}

export type LeaveRequestCapabilities = {
  canSubmit: boolean
  canViewPendingApproval: boolean
  canViewAll: boolean
  isExecutiveApprover: boolean
  leaveListScope: 'all' | 'team' | null
}

export type LeaveScopeEmployee = {
  employeeId: number
  employeeCode: string
  employeeName: string
}

export type ScopedLeaveRequestsPayload = {
  scope: 'all' | 'team'
  requests: LeaveRequest[]
  teamEmployees?: LeaveScopeEmployee[]
}

export type LeaveUsageBreakdown = {
  pl: number
  sl: number
  cl: number
}

export type LeaveBalance = {
  year: number
  allowance: LeaveUsageBreakdown
  halfAllowance: LeaveUsageBreakdown
  used: LeaveUsageBreakdown
  requested: LeaveUsageBreakdown
  remaining: LeaveUsageBreakdown
  halfUsed: { janJun: LeaveUsageBreakdown; julDec: LeaveUsageBreakdown }
  halfRequested: { janJun: LeaveUsageBreakdown; julDec: LeaveUsageBreakdown }
  carryToSecondHalf: LeaveUsageBreakdown
  janJunRemaining: LeaveUsageBreakdown
  julDecPoolRemaining: LeaveUsageBreakdown | null
  secondHalfCredited: boolean
}

export async function fetchLeaveRequestMeta(): Promise<{
  leaveTypes: Array<{ id: LeaveType; label: string }>
  capabilities: LeaveRequestCapabilities
}> {
  const { data } = await client.get('/api/leave-requests/meta')
  return data
}

export async function fetchLeaveBalance(year?: number): Promise<LeaveBalance> {
  const { data } = await client.get<{ balance: LeaveBalance }>('/api/leave-requests/balance', {
    params: year != null ? { year } : undefined,
  })
  return data.balance
}

export async function previewLeaveApply(input: {
  startDate: string
  endDate: string
}): Promise<string[]> {
  const { data } = await client.post<{ warnings: string[] }>('/api/leave-requests/preview', input)
  return Array.isArray(data.warnings) ? data.warnings : []
}

export async function submitLeaveRequest(input: {
  leaveType: LeaveType
  startDate: string
  endDate: string
  reason: string
  acknowledgeWarnings?: boolean
}): Promise<LeaveRequest> {
  const { data } = await client.post<{ request: LeaveRequest }>('/api/leave-requests', input)
  return data.request
}

export async function fetchMyLeaveRequests(): Promise<LeaveRequest[]> {
  const { data } = await client.get<{ requests: LeaveRequest[] }>('/api/leave-requests/mine')
  return data.requests
}

export async function fetchPendingLeaveRequests(): Promise<LeaveRequest[]> {
  const { data } = await client.get<{ requests: LeaveRequest[] }>('/api/leave-requests/pending')
  return data.requests
}

export async function fetchAllLeaveRequests(): Promise<LeaveRequest[]> {
  const { data } = await client.get<{ requests: LeaveRequest[] }>('/api/leave-requests/all')
  return data.requests
}

export async function fetchScopedLeaveRequests(search?: string): Promise<ScopedLeaveRequestsPayload> {
  const q = search?.trim()
  const { data } = await client.get<ScopedLeaveRequestsPayload>('/api/leave-requests/scope', {
    params: q ? { q } : undefined,
  })
  return {
    scope: data.scope,
    requests: Array.isArray(data.requests) ? data.requests : [],
    teamEmployees: Array.isArray(data.teamEmployees) ? data.teamEmployees : undefined,
  }
}

import type { LeaveHistorySummary } from '../utils/leaveRequestHistory'

export type EmployeeLeaveHistoryPayload = {
  year: number
  employeeId: number
  employeeCode: string
  employeeName: string
  summary: LeaveHistorySummary
  requests: LeaveRequest[]
  balance: LeaveBalance
}

export async function fetchEmployeeLeaveHistory(
  employeeId: number,
  year?: number,
): Promise<EmployeeLeaveHistoryPayload> {
  const { data } = await client.get<EmployeeLeaveHistoryPayload>(
    `/api/leave-requests/employees/${employeeId}/history`,
    { params: year != null ? { year } : undefined },
  )
  return data
}

export async function decideLeaveRequest(
  id: number,
  input: { status: 'approved' | 'rejected'; note?: string },
): Promise<LeaveRequest> {
  const { data } = await client.patch<{ request: LeaveRequest }>(
    `/api/leave-requests/${id}/decision`,
    input,
  )
  return data.request
}

export async function cancelLeaveRequest(id: number): Promise<LeaveRequest> {
  const { data } = await client.post<{ request: LeaveRequest }>(`/api/leave-requests/${id}/cancel`)
  return data.request
}

export function leaveTypeLabel(type: LeaveType): string {
  if (type === 'pl') return 'Personal (PL)'
  if (type === 'sl') return 'SL'
  return 'CL'
}

export function statusLabel(status: LeaveRequestStatus): string {
  if (status === 'pending') return 'Pending'
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  return 'Cancelled'
}

export function formatDateRange(start: string, end: string): string {
  return formatDisplayDateRange(start, end)
}

function parseIsoDateLocal(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number.parseInt(m[2], 10) - 1, Number.parseInt(m[3], 10))
}

export function toIsoDateLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function countInclusiveDays(start: string, end: string): number | null {
  const s = parseIsoDateLocal(start)
  const e = parseIsoDateLocal(end)
  if (!s || !e || e < s) return null
  const ms = e.getTime() - s.getTime()
  return Math.floor(ms / 86_400_000) + 1
}

export function formatLeaveDateShort(iso: string): string {
  return formatDisplayDate(iso)
}

export function leaveTypeAccent(type: LeaveType): {
  badge: string
  ring: string
  soft: string
  hint: string
} {
  if (type === 'pl') {
    return {
      badge: 'PL',
      ring: 'ring-[var(--insight-people)]',
      soft: 'bg-[var(--insight-people-soft)] text-[#1e40af]',
      hint: 'Personal time off',
    }
  }
  if (type === 'sl') {
    return {
      badge: 'SL',
      ring: 'ring-rose-500',
      soft: 'bg-rose-50 text-rose-900',
      hint: 'Medical or sick leave',
    }
  }
  return {
    badge: 'CL',
    ring: 'ring-[var(--insight-actions)]',
    soft: 'bg-[var(--insight-actions-soft)] text-violet-900',
    hint: 'Short casual leave',
  }
}
