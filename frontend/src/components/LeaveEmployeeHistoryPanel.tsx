import { useEffect, useState } from 'react'
import axios from 'axios'
import {
  fetchEmployeeLeaveHistory,
  type LeaveBalance,
  type LeaveRequest,
} from '../api/leaveRequests'
import { LeaveRequestHistoryOverview } from './LeaveRequestHistoryOverview'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

type LeaveEmployeeHistoryPanelProps = {
  employeeId: number
  employeeName: string
  employeeCode: string
  defaultYear?: number
}

export function LeaveEmployeeHistoryPanel({
  employeeId,
  employeeName,
  employeeCode,
  defaultYear,
}: LeaveEmployeeHistoryPanelProps) {
  const [year, setYear] = useState(defaultYear ?? new Date().getFullYear())
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [balance, setBalance] = useState<LeaveBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchEmployeeLeaveHistory(employeeId, year)
      .then((payload) => {
        if (cancelled) return
        setRequests(payload.requests)
        setBalance(payload.balance)
      })
      .catch((e) => {
        if (cancelled) return
        setError(errorMessage(e, 'Could not load leave history'))
        setRequests([])
        setBalance(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [employeeId, year])

  if (loading) {
    return (
      <div className="leave-history-overview workspace-card animate-pulse text-sm text-[var(--color-warm-text)]">
        Loading leave history…
      </div>
    )
  }

  if (error) {
    return <p className="alert-error text-sm">{error}</p>
  }

  return (
    <LeaveRequestHistoryOverview
      requests={requests}
      year={year}
      onYearChange={setYear}
      balance={balance}
      heading={`${employeeName} · ${employeeCode}`}
      subheading="Leave applied, pending, and monthly pattern for this employee (includes manager-submitted requests)."
    />
  )
}
