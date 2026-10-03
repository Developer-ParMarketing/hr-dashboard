import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { canUseDashboardDateFilters } from '../auth/permissions'
import { loadDashboardNotifications } from '../api/dashboardNotifications'
import type { DashboardNotification, DashboardNotificationsMeta } from '../types/dashboard'
import { parseDashboardFilterFromSearch } from '../utils/dashboardFilter'
import { parseWorkspacePeriodParams } from '../utils/workspacePeriod'
import { subscribeEmployeeRegistryUpdated } from '../utils/employeeRegistryEvents'

type NotificationsContextValue = {
  notifications: DashboardNotification[]
  meta: DashboardNotificationsMeta | null
  loading: boolean
  badgeCount: number
  refresh: () => Promise<void>
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [notifications, setNotifications] = useState<DashboardNotification[]>([])
  const [meta, setMeta] = useState<DashboardNotificationsMeta | null>(null)
  const [loading, setLoading] = useState(false)

  const queryKey = useMemo(() => searchParams.toString(), [searchParams])

  const refresh = useCallback(async () => {
    if (!user) {
      setNotifications([])
      setMeta(null)
      return
    }
    const period = parseWorkspacePeriodParams(searchParams)
    const advanced = canUseDashboardDateFilters(user)
    const filter = advanced
      ? parseDashboardFilterFromSearch(searchParams, period.year, period.month)
      : null

    setLoading(true)
    try {
      const data = await loadDashboardNotifications({
        year: filter?.year ?? period.year,
        month: filter?.month ?? period.month,
        company: period.company,
        preset: filter?.preset,
        quarter: filter?.preset === 'quarterly' ? filter.quarter : undefined,
        dateFrom: filter?.preset === 'custom' ? filter.dateFrom : undefined,
        dateTo: filter?.preset === 'custom' ? filter.dateTo : undefined,
        employeeIds:
          filter && filter.employeeIds.length > 0 ? filter.employeeIds : undefined,
      })
      setNotifications(data.notifications)
      setMeta(data.notificationsMeta)
    } catch {
      setNotifications([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [user, searchParams])

  useEffect(() => {
    void refresh()
  }, [refresh, queryKey])

  useEffect(() => {
    return subscribeEmployeeRegistryUpdated(() => {
      void refresh()
    })
  }, [refresh])

  useEffect(() => {
    const onFocus = () => {
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const badgeCount = meta?.urgentCount ?? notifications.filter((n) => n.source !== 'shortcut').length

  const value = useMemo(
    () => ({
      notifications,
      meta,
      loading,
      badgeCount,
      refresh,
    }),
    [notifications, meta, loading, badgeCount, refresh],
  )

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext)
  if (!ctx) {
    throw new Error('useNotifications must be used within NotificationsProvider')
  }
  return ctx
}
