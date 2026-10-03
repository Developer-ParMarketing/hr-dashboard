import type { EmailWorkflowStep } from '../constants/workflowStatus'

export type NotificationStatusEntry = {
  kind: 'late' | 'weekly_hours' | 'weekly_data_review'
  employeeId: number
  employeeCode: string
  periodKey: string
  status: EmailWorkflowStep
  error?: string | null
}

export function notificationIndex(entries: NotificationStatusEntry[] | undefined): Map<string, NotificationStatusEntry> {
  const map = new Map<string, NotificationStatusEntry>()
  for (const entry of entries ?? []) {
    map.set(`${entry.kind}:${entry.employeeId}:${entry.periodKey}`, entry)
  }
  return map
}

export function lateEmailStatus(
  index: Map<string, NotificationStatusEntry>,
  employeeId: number,
  attendanceDate: string,
): EmailWorkflowStep {
  const hit = index.get(`late:${employeeId}:${attendanceDate.slice(0, 10)}`)
  return hit?.status ?? 'none'
}

export function weeklyEmailStatus(
  index: Map<string, NotificationStatusEntry>,
  employeeId: number,
  weekStart: string,
): EmailWorkflowStep {
  const key = weekStart.slice(0, 10);
  const shortfall = index.get(`weekly_hours:${employeeId}:${key}`);
  const review = index.get(`weekly_data_review:${employeeId}:${key}`);
  const hit =
    shortfall?.status === 'sent' || shortfall?.status === 'failed'
      ? shortfall
      : review?.status === 'sent' || review?.status === 'failed'
        ? review
        : shortfall ?? review;
  return hit?.status ?? 'none';
}

export function emailStatusError(
  index: Map<string, NotificationStatusEntry>,
  kind: NotificationStatusEntry['kind'],
  employeeId: number,
  periodKey: string,
): string | null {
  const hit = index.get(`${kind}:${employeeId}:${periodKey.slice(0, 10)}`)
  return hit?.error ?? null
}
