import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { PortalPunchHero } from '../components/PortalPunchHero'
import { PortalApproverRequestGroups } from '../components/PortalApproverRequestGroups'
import { PortalPunchTable } from '../components/PortalPunchTableShared'
import { useAuth } from '../auth/AuthContext'
import {
  fetchMyPortalPunches,
  fetchPendingPortalPunches,
  fetchPortalPunchMeta,
  fetchScopedPortalPunches,
  portalCheckIn,
  portalCheckOut,
  portalLegLabel,
  istClockSnapshot,
  livePortalWindowFlags,
  type PortalPunchCapabilities,
  type PortalPunchDayRecord,
  type PortalPunchLegRecord,
  type PortalScopeEmployee,
  type PortalWindowInfo,
} from '../api/portalPunch'
import { canDecidePortalPunch } from '../utils/portalPunchApproverSearch'
import { toastSuccess } from '../utils/toastBridge'
import { confirmAction } from '../utils/confirmAction'
import { tabFromSearchParams } from '../utils/requestPageTab'

type TabId = 'punch' | 'mine' | 'pending' | 'all'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

export function InOutRequestPage() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const urlTab = tabFromSearchParams(searchParams)
  const [capabilities, setCapabilities] = useState<PortalPunchCapabilities | null>(null)
  const [today, setToday] = useState<PortalWindowInfo | null>(null)
  const [todayPunch, setTodayPunch] = useState<PortalPunchDayRecord | null>(null)
  const [tab, setTab] = useState<TabId>('punch')
  const [mine, setMine] = useState<PortalPunchLegRecord[]>([])
  const [approvalInbox, setApprovalInbox] = useState<PortalPunchLegRecord[]>([])
  const [scopedRows, setScopedRows] = useState<PortalPunchLegRecord[]>([])
  const [leaveListScope, setLeaveListScope] = useState<'all' | 'team' | null>(null)
  const [teamEmployees, setTeamEmployees] = useState<PortalScopeEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [punchBusy, setPunchBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liveClock, setLiveClock] = useState(() => istClockSnapshot())
  const initialTabSetRef = useRef(false)
  const capabilityFlagsRef = useRef<PortalPunchCapabilities | null>(null)

  const tabs = useMemo(() => {
    if (!capabilities) return []
    const list: Array<{ id: TabId; label: string }> = []
    if (capabilities.canPunch) {
      list.push({ id: 'punch', label: 'Check in / out' }, { id: 'mine', label: 'My history' })
    }
    if (capabilities.canViewPendingApproval) {
      list.push({ id: 'pending', label: 'Approvals' })
    }
    if (capabilities.canViewAll) {
      list.push({ id: 'all', label: 'All records' })
    }
    return list
  }, [capabilities])

  const pendingActionCount = useMemo(() => {
    if (!user || !capabilities) return 0
    return approvalInbox.filter(
      (r) =>
        r.status === 'pending' &&
        canDecidePortalPunch(r, user.id, capabilities.isExecutiveApprover),
    ).length
  }, [approvalInbox, user, capabilities])

  const applyMeta = useCallback((meta: Awaited<ReturnType<typeof fetchPortalPunchMeta>>) => {
    setCapabilities(meta.capabilities)
    capabilityFlagsRef.current = meta.capabilities
    setToday(meta.today)
    setTodayPunch(meta.punch)
    if (!initialTabSetRef.current) {
      initialTabSetRef.current = true
      const tabIds = new Set<TabId>(['punch', 'mine', 'pending', 'all'])
      if (urlTab && tabIds.has(urlTab as TabId)) {
        setTab(urlTab as TabId)
      } else if (!meta.capabilities.canPunch) {
        setTab(
          meta.capabilities.canViewPendingApproval
            ? 'pending'
            : meta.capabilities.canViewAll
              ? 'all'
              : 'mine',
        )
      }
    }
  }, [urlTab])

  useEffect(() => {
    if (!urlTab) return
    const tabIds = new Set<TabId>(['punch', 'mine', 'pending', 'all'])
    if (tabIds.has(urlTab as TabId)) setTab(urlTab as TabId)
  }, [urlTab])

  useEffect(() => {
    const id = window.setInterval(() => setLiveClock(istClockSnapshot()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const liveToday = useMemo(() => {
    if (!today) return null
    return { ...today, ...livePortalWindowFlags(today, liveClock.hm) }
  }, [today, liveClock.hm])

  const reload = useCallback(async () => {
    const caps = capabilityFlagsRef.current
    if (!caps) return
    setLoading(true)
    setError(null)
    try {
      const meta = await fetchPortalPunchMeta()
      setToday(meta.today)
      setTodayPunch(meta.punch)
      const inboxPromise = caps.canViewPendingApproval
        ? fetchPendingPortalPunches()
        : Promise.resolve([])
      const scopePromise =
        caps.canViewAll && caps.leaveListScope === 'all'
          ? fetchScopedPortalPunches()
          : Promise.resolve(null)
      const [mineRows, inboxRows, scopePayload] = await Promise.all([
        caps.canPunch ? fetchMyPortalPunches() : Promise.resolve([]),
        inboxPromise,
        scopePromise,
      ])
      setMine(mineRows)
      setApprovalInbox(inboxRows)
      setScopedRows(scopePayload?.punches ?? [])
      setLeaveListScope(scopePayload?.scope ?? caps.leaveListScope ?? null)
      setTeamEmployees(scopePayload?.teamEmployees ?? [])
    } catch (e) {
      setError(errorMessage(e, 'Could not load portal punch data'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchPortalPunchMeta()
      .then((meta) => {
        if (cancelled) return
        applyMeta(meta)
        const caps = meta.capabilities
        const inboxPromise = caps.canViewPendingApproval
          ? fetchPendingPortalPunches()
          : Promise.resolve([])
        const scopePromise =
          caps.canViewAll && caps.leaveListScope === 'all'
            ? fetchScopedPortalPunches()
            : Promise.resolve(null)
        return Promise.all([
          caps.canPunch ? fetchMyPortalPunches() : Promise.resolve([]),
          inboxPromise,
          scopePromise,
        ]).then(([mineRows, inboxRows, scopePayload]) => {
          if (cancelled) return
          setMine(mineRows)
          setApprovalInbox(inboxRows)
          setScopedRows(scopePayload?.punches ?? [])
          setLeaveListScope(scopePayload?.scope ?? caps.leaveListScope ?? null)
          setTeamEmployees(scopePayload?.teamEmployees ?? [])
        })
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, 'Could not load settings'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [applyMeta])

  useEffect(() => {
    const id = window.setInterval(() => {
      void fetchPortalPunchMeta()
        .then((meta) => {
          setToday(meta.today)
          setTodayPunch(meta.punch)
        })
        .catch(() => {})
    }, 60_000)
    return () => window.clearInterval(id)
  }, [])

  async function handleCheckIn() {
    if (!(await confirmAction('Record check-in for today using your device time?'))) return
    setPunchBusy(true)
    setError(null)
    try {
      const result = await portalCheckIn()
      setToday(result.today)
      setTodayPunch(result.punch)
      toastSuccess(
        `Check-in at ${result.punch.inTime} submitted for approval. You can check out after it is approved or while it is still pending.`,
      )
      await reload()
    } catch (e) {
      setError(errorMessage(e, 'Check-in failed'))
    } finally {
      setPunchBusy(false)
    }
  }

  async function handleCheckOut() {
    if (!(await confirmAction('Record check-out and send this day to your approver?'))) return
    setPunchBusy(true)
    setError(null)
    try {
      const result = await portalCheckOut()
      setToday(result.today)
      setTodayPunch(result.punch)
      toastSuccess(
        `Check-out at ${result.punch.outTime} submitted for approval (${portalLegLabel('out')}).`,
      )
      await reload()
      setTab('mine')
    } catch (e) {
      setError(errorMessage(e, 'Check-out failed'))
    } finally {
      setPunchBusy(false)
    }
  }

  const checkedInToday = Boolean(todayPunch?.inTime && todayPunch.inStatus !== 'rejected')
  const awaitingCheckOut =
    checkedInToday &&
    !todayPunch?.outTime &&
    todayPunch?.outStatus !== 'pending' &&
    todayPunch?.outStatus !== 'approved'
  const canCheckIn =
    liveToday?.checkInOpen && (!todayPunch?.inTime || todayPunch.inStatus === 'rejected')
  const canCheckOut =
    liveToday?.checkOutOpen &&
    checkedInToday &&
    (!todayPunch?.outTime || todayPunch.outStatus === 'rejected') &&
    todayPunch?.outStatus !== 'pending' &&
    todayPunch?.outStatus !== 'approved'

  return (
    <AppShell active="inOutRequest">
      <main className="app-page">
        <header className="page-header">
          <p className="page-kicker">Requests</p>
          <h1 className="page-title">In / out request</h1>
          <p className="feature-intro">
            Submit check-in and check-out separately. Each is sent to your approver for its own
            approval.
          </p>
          <div className="feature-actions mt-3">
            <Link to="/reports/in-out" className="btn-ghost">
              View in/out report
            </Link>
          </div>

          {tabs.length > 1 ? (
            <div className="seg mt-5 inline-flex" role="tablist" aria-label="Portal punch views">
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
                  {t.id === 'pending' ? ` (${pendingActionCount})` : ''}
                </button>
              ))}
            </div>
          ) : null}
        </header>

        <div className="page-body gap-5">
          {error ? <p className="alert-error">{error}</p> : null}

          {tab === 'punch' && capabilities?.canPunch ? (
            loading && !today ? (
              <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
            ) : (
              <div className="card border max-w-3xl overflow-hidden p-0">
                {!today ? (
                  <p className="p-6 text-sm text-[var(--color-warm-text)]">
                    Your login is not linked to an employee profile, or you cannot punch from this
                    account. Contact HR.
                  </p>
                ) : (
                  <div className="p-6 sm:p-7">
                    <PortalPunchHero
                      clock={liveClock}
                      today={liveToday ?? today}
                      checkedIn={checkedInToday}
                      awaitingCheckOut={awaitingCheckOut}
                      inTime={todayPunch?.inTime ?? null}
                      outTime={todayPunch?.outTime ?? null}
                      checkInLate={today.checkInLate}
                      lateMinutes={today.lateMinutes}
                    />
                    <div className="mt-6 flex flex-wrap gap-3 border-t border-[color-mix(in_srgb,var(--color-warm-muted)_55%,transparent)] pt-6">
                      {canCheckIn ? (
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={punchBusy}
                          onClick={() => void handleCheckIn()}
                        >
                          {punchBusy ? 'Saving…' : 'Check in'}
                        </button>
                      ) : null}
                      {todayPunch?.inStatus === 'pending' && !todayPunch.outTime ? (
                        <p className="text-sm text-[var(--color-warm-text)]">
                          Check-in pending approval - you can still check out when your window opens.
                        </p>
                      ) : null}
                      {awaitingCheckOut || canCheckOut ? (
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={punchBusy || !canCheckOut}
                          onClick={() => void handleCheckOut()}
                        >
                          {punchBusy ? 'Saving…' : canCheckOut ? 'Check out' : 'Check out (not open yet)'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            )
          ) : null}

          {tab === 'mine' && capabilities?.canPunch ? (
            loading ? (
              <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
            ) : (
              <PortalPunchTable rows={mine} showPendingWith showDecidedBy />
            )
          ) : null}

          {tab === 'pending' && capabilities?.canViewPendingApproval && user ? (
            loading ? (
              <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
            ) : (
              <PortalApproverRequestGroups
                rows={approvalInbox}
                scope={capabilities.leaveListScope === 'all' ? 'all' : 'team'}
                mode="pending"
                viewerUserId={user.id}
                isExecutiveApprover={capabilities.isExecutiveApprover}
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

          {tab === 'all' && capabilities?.canViewAll && leaveListScope === 'all' && user ? (
            loading ? (
              <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
            ) : (
              <PortalApproverRequestGroups
                rows={scopedRows}
                scope="all"
                teamEmployees={teamEmployees}
                mode="all"
                viewerUserId={user.id}
                isExecutiveApprover={capabilities.isExecutiveApprover}
              />
            )
          ) : null}
        </div>
      </main>
    </AppShell>
  )
}
