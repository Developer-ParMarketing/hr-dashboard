import { client } from './client'
import { formatDisplayDate } from '../utils/displayDate'
import type { PortalPunchHistorySummary } from '../utils/portalPunchHistory'

export type PortalPunchLegKind = 'in' | 'out'
export type PortalPunchLegStatus = 'pending' | 'approved' | 'rejected'

/** Day-level snapshot for today's punch UI. */
export type PortalPunchDayRecord = {
  id: number
  employeeId: number
  requesterUserId: number
  attendanceDate: string
  shiftStartSnapshot: string | null
  inTime: string | null
  inClientAt: string | null
  inServerAt: string | null
  inStatus: PortalPunchLegStatus | null
  outTime: string | null
  outClientAt: string | null
  outServerAt: string | null
  outStatus: PortalPunchLegStatus | null
  status: string
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
  createdAt: string
  updatedAt: string
  employeeCode: string
  employeeName: string
  requesterName: string
  requesterEmail: string
  shiftStart: string | null
}

/** One approvable row - check-in or check-out for a calendar day. */
export type PortalPunchLegRecord = {
  id: number
  leg: PortalPunchLegKind
  employeeId: number
  requesterUserId: number
  attendanceDate: string
  punchTime: string | null
  inTime: string | null
  outTime: string | null
  status: PortalPunchLegStatus
  approvalTier: 'manager' | 'leadership_hr'
  assignedApproverUserId: number | null
  assignedApproverName: string | null
  assignedApproverEmail: string | null
  pendingWithLabel: string | null
  decidedByUserId: number | null
  decidedByName: string | null
  decidedAt: string | null
  decisionNote: string | null
  createdAt: string
  updatedAt: string
  employeeCode: string
  employeeName: string
  requesterName: string
  requesterEmail: string
  shiftStart: string | null
  shiftStartSnapshot: string | null
}

/** @deprecated Use PortalPunchDayRecord or PortalPunchLegRecord */
export type PortalPunchRecord = PortalPunchLegRecord

export type PortalWindowInfo = {
  shiftStart: string
  shiftEnd: string
  checkInFrom: string
  checkInUntil: string
  checkOutFrom: string
  checkOutUntil: string
  checkInOpen: boolean
  checkOutOpen: boolean
  nowHm: string
  todayIso: string
  expectedCheckOut?: string
  checkInLate?: boolean
  lateMinutes?: number
}

export type PortalPunchCapabilities = {
  canPunch: boolean
  canSubmit: boolean
  canViewPendingApproval: boolean
  canViewAll: boolean
  isExecutiveApprover: boolean
  leaveListScope: 'all' | 'team' | null
}

export type PortalScopeEmployee = {
  employeeId: number
  employeeCode: string
  employeeName: string
}

export type ScopedPortalPunchesPayload = {
  scope: 'all' | 'team'
  punches: PortalPunchLegRecord[]
  teamEmployees?: PortalScopeEmployee[]
}

export async function fetchPortalPunchMeta(): Promise<{
  capabilities: PortalPunchCapabilities
  checkInGraceMinutes: number
  checkOutGraceMinutes: number
  today: PortalWindowInfo | null
  punch: PortalPunchDayRecord | null
}> {
  const { data } = await client.get('/api/portal-punch/meta')
  return data
}

export async function portalCheckIn(clientTime?: string): Promise<{
  punch: PortalPunchDayRecord
  today: PortalWindowInfo
}> {
  const { data } = await client.post('/api/portal-punch/check-in', {
    clientTime: clientTime ?? new Date().toISOString(),
  })
  return data
}

export async function portalCheckOut(clientTime?: string): Promise<{
  punch: PortalPunchDayRecord
  today: PortalWindowInfo
}> {
  const { data } = await client.post('/api/portal-punch/check-out', {
    clientTime: clientTime ?? new Date().toISOString(),
  })
  return data
}

export async function fetchMyPortalPunches(): Promise<PortalPunchLegRecord[]> {
  const { data } = await client.get<{ punches: PortalPunchLegRecord[] }>('/api/portal-punch/mine')
  return data.punches
}

export async function fetchPendingPortalPunches(): Promise<PortalPunchLegRecord[]> {
  const { data } = await client.get<{ punches: PortalPunchLegRecord[] }>('/api/portal-punch/pending')
  return data.punches
}

export async function fetchAllPortalPunches(): Promise<PortalPunchLegRecord[]> {
  const { data } = await client.get<{ punches: PortalPunchLegRecord[] }>('/api/portal-punch/all')
  return data.punches
}

export async function fetchScopedPortalPunches(search?: string): Promise<ScopedPortalPunchesPayload> {
  const q = search?.trim()
  const { data } = await client.get<ScopedPortalPunchesPayload>('/api/portal-punch/scope', {
    params: q ? { q } : undefined,
  })
  return {
    scope: data.scope,
    punches: Array.isArray(data.punches) ? data.punches : [],
    teamEmployees: Array.isArray(data.teamEmployees) ? data.teamEmployees : undefined,
  }
}

export type EmployeePortalPunchHistoryPayload = {
  year: number
  employeeId: number
  employeeCode: string
  employeeName: string
  summary: PortalPunchHistorySummary
  punches: PortalPunchLegRecord[]
}

export async function fetchEmployeePortalPunchHistory(
  employeeId: number,
  year?: number,
): Promise<EmployeePortalPunchHistoryPayload> {
  const { data } = await client.get<EmployeePortalPunchHistoryPayload>(
    `/api/portal-punch/employees/${employeeId}/history`,
    { params: year != null ? { year } : undefined },
  )
  return data
}

export async function decidePortalPunch(
  id: number,
  input: { leg: PortalPunchLegKind; status: 'approved' | 'rejected'; note?: string },
): Promise<PortalPunchLegRecord> {
  const { data } = await client.patch<{ punch: PortalPunchLegRecord }>(
    `/api/portal-punch/${id}/decision`,
    input,
  )
  return data.punch
}

export function portalLegLabel(leg: PortalPunchLegKind): string {
  return leg === 'in' ? 'Check-in' : 'Check-out'
}

export function portalStatusLabel(status: PortalPunchLegStatus): string {
  if (status === 'pending') return 'Pending approval'
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  return status
}

export function portalPunchDayLabel(row: PortalPunchDayRecord | null | undefined): string {
  if (!row) return 'Not started'
  const inPending = row.inStatus === 'pending'
  const inRejected = row.inStatus === 'rejected'
  const inApproved = row.inStatus === 'approved'
  const outPending = row.outStatus === 'pending'
  const outApproved = row.outStatus === 'approved'
  if (inApproved && outApproved) return 'Approved'
  if (inRejected) return 'Check-in rejected'
  if (row.outStatus === 'rejected') return 'Check-out rejected'
  if (inPending && !row.outTime) return 'Check-in pending approval'
  if (inPending && outPending) return 'Check-in & check-out pending approval'
  if (inApproved && outPending) return 'Check-out pending approval'
  if (inApproved && !row.outTime) return 'Check-in approved - check out when window opens'
  if (row.inTime && !row.outTime) return 'Checked in'
  return portalStatusLabel(row.inStatus ?? 'pending')
}

export function portalLegRowLabel(row: PortalPunchLegRecord): string {
  return `${portalLegLabel(row.leg)} · ${portalStatusLabel(row.status)}`
}

function hmToMinutes(hm: string): number | null {
  const m = hm.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return Number.parseInt(m[1], 10) * 60 + Number.parseInt(m[2], 10)
}

const INDIA_TZ = 'Asia/Kolkata'

export type IstClockSnapshot = {
  hm: string
  hmWithSeconds: string
  hours: number
  minutes: number
  seconds: number
  isoDate: string
  dateLabel: string
  time12WithSeconds: string
}

export function istClockSnapshot(now = new Date()): IstClockSnapshot {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: INDIA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const second = parts.find((p) => p.type === 'second')?.value ?? '00'
  const hm = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
  const hmWithSeconds = `${hm}:${second.padStart(2, '0')}`
  const hours = Number.parseInt(hour, 10)
  const minutes = Number.parseInt(minute, 10)
  const seconds = Number.parseInt(second, 10)

  const isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: INDIA_TZ }).format(now)
  const dateLabel = formatDisplayDate(isoDate)

  let h12 = hours % 12
  if (h12 === 0) h12 = 12
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const time12WithSeconds = `${h12}:${minute}:${second} ${ampm}`

  return { hm, hmWithSeconds, hours, minutes, seconds, isoDate, dateLabel, time12WithSeconds }
}

export function livePortalWindowFlags(
  today: PortalWindowInfo,
  nowHm: string,
): Pick<PortalWindowInfo, 'checkInOpen' | 'checkOutOpen' | 'nowHm'> {
  const nowMin = hmToMinutes(nowHm)
  const checkInFrom = hmToMinutes(today.checkInFrom)
  const checkInUntil = hmToMinutes(today.checkInUntil)
  const checkOutFrom = hmToMinutes(today.checkOutFrom)
  const checkOutUntil = hmToMinutes(today.checkOutUntil)
  const checkInOpen =
    nowMin != null && checkInFrom != null && checkInUntil != null
      ? nowMin >= checkInFrom && nowMin <= checkInUntil
      : today.checkInOpen
  const checkOutOpen =
    nowMin != null && checkOutFrom != null && checkOutUntil != null
      ? nowMin >= checkOutFrom && nowMin <= checkOutUntil
      : today.checkOutOpen
  return { nowHm, checkInOpen, checkOutOpen }
}

export function formatHm12(hm: string): string {
  const m = hm.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return hm
  let h = Number.parseInt(m[1], 10)
  const min = m[2]
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return `${h}:${min} ${ampm}`
}

export function checkOutPrompt(today: PortalWindowInfo, checkedIn: boolean): string | null {
  if (!checkedIn) return null
  const target = today.expectedCheckOut ?? today.shiftEnd
  const target12 = formatHm12(target)
  if (today.checkOutOpen) {
    return `Check out now (window open until ${formatHm12(today.checkOutUntil)})`
  }
  const now = hmToMinutes(today.nowHm)
  const from = hmToMinutes(today.checkOutFrom)
  if (now != null && from != null && now < from) {
    return `Expected logout at ${target12} (9 hours from check-in). Check out from ${formatHm12(today.checkOutFrom)} to ${formatHm12(today.checkOutUntil)}`
  }
  return `Expected logout was ${target12}. Check-out window was ${formatHm12(today.checkOutFrom)} - ${formatHm12(today.checkOutUntil)}`
}

export function formatPunchTimes(row: PortalPunchLegRecord | PortalPunchDayRecord): string {
  if ('leg' in row && row.leg) {
    return row.punchTime ?? '-'
  }
  const day = row as PortalPunchDayRecord
  const inT = day.inTime ?? '-'
  const outT = day.outTime ?? '-'
  return `${inT} → ${outT}`
}

export function legRowKey(row: PortalPunchLegRecord): string {
  return `${row.id}-${row.leg}`
}
