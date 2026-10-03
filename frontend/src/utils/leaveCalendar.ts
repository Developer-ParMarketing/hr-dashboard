import {
  leaveTypeAccent,
  toIsoDateLocal,
  type LeaveRequest,
  type LeaveRequestStatus,
  type LeaveType,
} from '../api/leaveRequests'

function parseIsoDateLocal(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number.parseInt(m[2], 10) - 1, Number.parseInt(m[3], 10))
}

export function eachDayIso(start: string, end: string): string[] {
  const from = parseIsoDateLocal(start.slice(0, 10))
  const to = parseIsoDateLocal(end.slice(0, 10))
  if (!from || !to || to < from) return []
  const out: string[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate())
  while (cursor <= last) {
    out.push(toIsoDateLocal(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

export type DayLeaveEntry = {
  requestId: number
  leaveType: LeaveType
  status: LeaveRequestStatus
}

const STATUS_RANK: Record<LeaveRequestStatus, number> = {
  approved: 4,
  pending: 3,
  rejected: 2,
  cancelled: 1,
}

export function buildDayLeaveMap(requests: LeaveRequest[]): Map<string, DayLeaveEntry[]> {
  const map = new Map<string, DayLeaveEntry[]>()
  for (const request of requests) {
    for (const iso of eachDayIso(request.startDate, request.endDate)) {
      const list = map.get(iso) ?? []
      list.push({
        requestId: request.id,
        leaveType: request.leaveType,
        status: request.status,
      })
      map.set(iso, list)
    }
  }
  return map
}

export function primaryDayLeaveEntry(entries: DayLeaveEntry[]): DayLeaveEntry {
  return [...entries].sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status])[0]
}

export function existingLeaveDayClasses(
  entry: DayLeaveEntry | null,
  inSelectionRange: boolean,
): string {
  if (!entry || inSelectionRange) return ''
  const accent = leaveTypeAccent(entry.leaveType)
  const parts = ['leave-overview-day--marked']
  if (entry.status === 'approved') parts.push(accent.soft)
  if (entry.status === 'pending') parts.push('leave-overview-day--pending')
  if (entry.status === 'rejected') parts.push('leave-overview-day--rejected')
  if (entry.status === 'cancelled') parts.push('leave-overview-day--cancelled')
  return parts.join(' ')
}
