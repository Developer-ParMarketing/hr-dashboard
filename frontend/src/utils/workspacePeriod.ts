import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  DEFAULT_UPLOAD_COMPANY,
  isUploadCompanyCode,
  type UploadCompanyCode,
} from '../constants/companies'

export type WorkspacePeriod = {
  year: number
  month: number
  company: UploadCompanyCode
}

function currentCalendarPeriod(): Pick<WorkspacePeriod, 'year' | 'month'> {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() + 1 }
}

/** Read year/month/company from URL (shared by Dashboard, Attendance, Salary). */
export function parseWorkspacePeriodParams(
  searchParams: URLSearchParams,
  fallback?: Partial<WorkspacePeriod>,
): WorkspacePeriod {
  const cal = currentCalendarPeriod()
  const yearRaw = Number.parseInt(searchParams.get('year') ?? '', 10)
  const monthRaw = Number.parseInt(searchParams.get('month') ?? '', 10)
  const companyRaw = (searchParams.get('company') ?? '').trim().toUpperCase()

  const year =
    Number.isFinite(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100
      ? yearRaw
      : (fallback?.year ?? cal.year)
  const month =
    Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12
      ? monthRaw
      : (fallback?.month ?? cal.month)
  const company = isUploadCompanyCode(companyRaw)
    ? companyRaw
    : (fallback?.company ?? DEFAULT_UPLOAD_COMPANY)

  return { year, month, company }
}

export function withWorkspacePeriod(path: string, period: WorkspacePeriod): string {
  const hashIndex = path.indexOf('#')
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : ''
  const withoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path
  const qIndex = withoutHash.indexOf('?')
  const pathname = qIndex >= 0 ? withoutHash.slice(0, qIndex) : withoutHash
  const existing = qIndex >= 0 ? withoutHash.slice(qIndex + 1) : ''
  const params = new URLSearchParams(existing)
  params.set('year', String(period.year))
  params.set('month', String(period.month))
  params.set('company', period.company)
  return `${pathname}?${params.toString()}${hash}`
}

export function useWorkspacePeriod() {
  const [searchParams, setSearchParams] = useSearchParams()
  const period = useMemo(() => parseWorkspacePeriodParams(searchParams), [searchParams])

  const setPeriod = useCallback(
    (next: Partial<WorkspacePeriod>) => {
      setSearchParams(
        (prev) => {
          const current = parseWorkspacePeriodParams(prev)
          const merged: WorkspacePeriod = { ...current, ...next }
          if (
            merged.year === current.year &&
            merged.month === current.month &&
            merged.company === current.company
          ) {
            return prev
          }
          const params = new URLSearchParams(prev)
          params.set('year', String(merged.year))
          params.set('month', String(merged.month))
          params.set('company', merged.company)
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const href = useCallback((path: string) => withWorkspacePeriod(path, period), [period])

  return {
    year: period.year,
    month: period.month,
    company: period.company,
    period,
    setPeriod,
    href,
  }
}
