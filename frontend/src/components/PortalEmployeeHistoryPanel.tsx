import { useEffect, useState } from 'react'
import axios from 'axios'
import {
  fetchEmployeePortalPunchHistory,
  type PortalPunchLegRecord,
} from '../api/portalPunch'
import { PortalPunchHistoryOverview } from './PortalPunchHistoryOverview'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

type PortalEmployeeHistoryPanelProps = {
  employeeId: number
  employeeName: string
  employeeCode: string
}

export function PortalEmployeeHistoryPanel({
  employeeId,
  employeeName,
  employeeCode,
}: PortalEmployeeHistoryPanelProps) {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [punches, setPunches] = useState<PortalPunchLegRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchEmployeePortalPunchHistory(employeeId, year)
      .then((payload) => {
        if (cancelled) return
        setPunches(payload.punches)
      })
      .catch((e) => {
        if (cancelled) return
        setError(errorMessage(e, 'Could not load in/out history'))
        setPunches([])
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
        Loading in/out history…
      </div>
    )
  }

  if (error) {
    return <p className="alert-error text-sm">{error}</p>
  }

  return (
    <PortalPunchHistoryOverview
      punches={punches}
      year={year}
      onYearChange={setYear}
      heading={`${employeeName} · ${employeeCode}`}
      subheading="Check-in and check-out requests for the selected year."
    />
  )
}
