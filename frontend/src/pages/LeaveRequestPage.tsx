import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { Link, useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { LeaveApplyPanel, LeaveBalancePanel } from '../components/LeaveApplyPanel'
import { LeaveApproverRequestGroups } from '../components/LeaveApproverRequestGroups'
import { LeaveRequestHistoryOverview } from '../components/LeaveRequestHistoryOverview'
import { LeaveRequestTable } from '../components/LeaveRequestTableShared'
import { useAuth } from '../auth/AuthContext'
import {
  cancelLeaveRequest,
  fetchLeaveBalance,
  fetchLeaveRequestMeta,
  fetchMyLeaveRequests,
  fetchPendingLeaveRequests,
  fetchScopedLeaveRequests,
  formatDateRange,
  leaveTypeLabel,
  submitLeaveRequest,
  type LeaveRequest,
  type LeaveRequestCapabilities,
  type LeaveBalance,
  type LeaveScopeEmployee,
  type LeaveType,
} from '../api/leaveRequests'
import { canDecideLeaveRequest } from '../utils/leaveApproverSearch'
import { confirmAction, confirmRemove } from '../utils/confirmAction'
import { formatConfirmLines, readConfirmPayload } from '../utils/submissionConfirm'
import { tabFromSearchParams } from '../utils/requestPageTab'
import { toastSuccess } from '../utils/toastBridge'

type TabId = 'apply' | 'mine' | 'balance' | 'pending' | 'all'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

function normalizeEmployeeTab(urlTab: string | null): TabId | null {
  if (!urlTab) return null
  if (urlTab === 'calendar') return 'apply'
  const tabIds = new Set<TabId>(['apply', 'mine', 'balance', 'pending', 'all'])
  if (tabIds.has(urlTab as TabId)) return urlTab as TabId
  return null
}

export function LeaveRequestPage() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const urlTab = tabFromSearchParams(searchParams)
  const [capabilities, setCapabilities] = useState<LeaveRequestCapabilities | null>(null)
  const [leaveTypes, setLeaveTypes] = useState<Array<{ id: LeaveType; label: string }>>([])
  const [tab, setTab] = useState<TabId>('apply')
  const [mine, setMine] = useState<LeaveRequest[]>([])
  const [approvalInbox, setApprovalInbox] = useState<LeaveRequest[]>([])
  const [scopedRows, setScopedRows] = useState<LeaveRequest[]>([])
  const [leaveListScope, setLeaveListScope] = useState<'all' | 'team' | null>(null)
  const [teamEmployees, setTeamEmployees] = useState<LeaveScopeEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [leaveType, setLeaveType] = useState<LeaveType>('pl')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [balance, setBalance] = useState<LeaveBalance | null>(null)
  const [historyYear, setHistoryYear] = useState(() => new Date().getFullYear())

  const tabs = useMemo(() => {
    if (!capabilities) return []
    const list: Array<{ id: TabId; label: string }> = []
    if (capabilities.canSubmit) {
      list.push(
        { id: 'apply', label: 'Request' },
        { id: 'mine', label: 'Your requests' },
        { id: 'balance', label: 'Balance' },
      )
    }
    if (capabilities?.canViewPendingApproval) {
      list.push({ id: 'pending', label: 'Approvals' })
    }
    if (capabilities?.canViewAll) {
      list.push({ id: 'all', label: 'All requests' })
    }
    return list
  }, [capabilities])

  useEffect(() => {
    void fetchLeaveRequestMeta()
      .then((meta) => {
        setCapabilities(meta.capabilities)
        setLeaveTypes(meta.leaveTypes)
        if (meta.leaveTypes[0]) setLeaveType(meta.leaveTypes[0].id)
        const resolved = normalizeEmployeeTab(urlTab)
        if (resolved) {
          setTab(resolved)
        } else if (!meta.capabilities.canSubmit) {
          setTab(
            meta.capabilities.canViewPendingApproval
              ? 'pending'
              : meta.capabilities.canViewAll
                ? 'all'
                : 'apply',
          )
        }
      })
      .catch((e) => {
        setError(errorMessage(e, 'Could not load leave request settings'))
      })
  }, [urlTab])

  useEffect(() => {
    const resolved = normalizeEmployeeTab(urlTab)
    if (resolved) setTab(resolved)
  }, [urlTab])

  const pendingActionCount = useMemo(() => {
    if (!user || !capabilities) return 0
    return approvalInbox.filter(
      (r) =>
        r.status === 'pending' &&
        canDecideLeaveRequest(r, user.id, capabilities.isExecutiveApprover),
    ).length
  }, [approvalInbox, user, capabilities])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const inboxPromise = capabilities?.canViewPendingApproval
        ? fetchPendingLeaveRequests()
        : Promise.resolve([])
      const scopePromise =
        capabilities?.canViewAll && capabilities.leaveListScope === 'all'
          ? fetchScopedLeaveRequests()
          : Promise.resolve(null)
      const [mineRows, inboxRows, scopePayload, balanceRow] = await Promise.all([
        capabilities?.canSubmit ? fetchMyLeaveRequests() : Promise.resolve([]),
        inboxPromise,
        scopePromise,
        capabilities?.canSubmit
          ? fetchLeaveBalance().catch(() => null)
          : Promise.resolve(null),
      ])
      setMine(mineRows)
      setApprovalInbox(inboxRows)
      setScopedRows(scopePayload?.requests ?? [])
      setLeaveListScope(scopePayload?.scope ?? capabilities?.leaveListScope ?? null)
      setTeamEmployees(scopePayload?.teamEmployees ?? [])
      setBalance(balanceRow)
    } catch (e) {
      setError(errorMessage(e, 'Could not load leave requests'))
    } finally {
      setLoading(false)
    }
  }, [
    capabilities?.canSubmit,
    capabilities?.canViewPendingApproval,
    capabilities?.canViewAll,
    capabilities?.leaveListScope,
  ])

  useEffect(() => {
    if (capabilities == null) return
    void reload()
  }, [capabilities, reload])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (
      !(await confirmAction(
        `Submit this leave request?\n\n${leaveTypeLabel(leaveType)} · ${formatDateRange(startDate, endDate)}`,
      ))
    ) {
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const ok = await submitLeaveWithOptionalConfirm()
      if (!ok) return
      toastSuccess('Leave request submitted for approval.')
      setReason('')
      setStartDate('')
      setEndDate('')
      await reload()
      setTab('mine')
    } catch (err) {
      setError(errorMessage(err, 'Could not submit leave request'))
    } finally {
      setSubmitting(false)
    }
  }

  async function submitLeaveWithOptionalConfirm(): Promise<boolean> {
    try {
      await submitLeaveRequest({
        leaveType,
        startDate,
        endDate,
        reason,
        acknowledgeWarnings: false,
      })
      return true
    } catch (err) {
      const payload = readConfirmPayload(err)
      if (payload?.warnings?.length) {
        if (
          !(await confirmAction(
            `Please review:\n\n${formatConfirmLines(payload.warnings)}\n\nSubmit anyway?`,
          ))
        ) {
          return false
        }
        await submitLeaveRequest({
          leaveType,
          startDate,
          endDate,
          reason,
          acknowledgeWarnings: true,
        })
        return true
      }
      throw err
    }
  }

  async function handleCancel(id: number) {
    if (!(await confirmRemove('this pending leave request'))) return
    setError(null)
    try {
      await cancelLeaveRequest(id)
      toastSuccess('Request cancelled.')
      await reload()
    } catch (e) {
      setError(errorMessage(e, 'Could not cancel request'))
    }
  }

  return (
    <AppShell active="leaveRequest">
      <main className="app-page">
        <header className="page-header">
          <p className="page-kicker">Requests</p>
          <h1 className="page-title">Leave request</h1>
          <p className="feature-intro">
            Submit leave on the calendar, check balance, and manage your requests from separate tabs.
          </p>
          <div className="feature-actions mt-3">
            <Link to="/policies" className="btn-ghost">
              View leave policy
            </Link>
          </div>

          {tabs.length > 1 ? (
            <div className="seg mt-5 inline-flex" role="tablist" aria-label="Leave request views">
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

          {tab === 'balance' && capabilities?.canSubmit ? (
            loading ? (
              <div className="leave-balance-skeleton workspace-card animate-pulse">
                <div className="h-24 rounded-xl bg-[color-mix(in_srgb,var(--color-warm-muted)_40%,#fff)]" />
                <div className="mt-4 grid gap-4 lg:grid-cols-3">
                  <div className="h-52 rounded-2xl bg-[color-mix(in_srgb,var(--color-warm-muted)_35%,#fff)]" />
                  <div className="h-52 rounded-2xl bg-[color-mix(in_srgb,var(--color-warm-muted)_35%,#fff)]" />
                  <div className="h-52 rounded-2xl bg-[color-mix(in_srgb,var(--color-warm-muted)_35%,#fff)]" />
                </div>
              </div>
            ) : balance ? (
              <LeaveBalancePanel balance={balance} />
            ) : (
              <div className="workspace-card text-sm text-[var(--color-warm-text)]">
                We could not load your leave balance. Ask HR to link your login to your employee record.
              </div>
            )
          ) : null}

          {tab === 'apply' && capabilities?.canSubmit ? (
            <LeaveApplyPanel
              leaveTypes={leaveTypes}
              leaveType={leaveType}
              onLeaveTypeChange={setLeaveType}
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              reason={reason}
              onReasonChange={setReason}
              submitting={submitting}
              onSubmit={(e) => void handleSubmit(e)}
              myRequests={mine}
            />
          ) : null}

          {tab === 'mine' && capabilities?.canSubmit ? (
            loading ? (
              <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
            ) : (
              <div className="flex flex-col gap-4">
                <LeaveRequestHistoryOverview
                  requests={mine}
                  year={historyYear}
                  onYearChange={setHistoryYear}
                  balance={balance?.year === historyYear ? balance : null}
                  heading="Your leave history"
                  subheading="Requests and leave days by type and month for the selected year."
                />
                <LeaveRequestTable
                  rows={mine}
                  showPendingWith
                  showDecidedBy
                  allowCancel
                  onCancel={(id) => void handleCancel(id)}
                />
              </div>
            )
          ) : null}

          {tab === 'pending' && capabilities?.canViewPendingApproval && user ? (
            loading ? (
              <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
            ) : (
              <LeaveApproverRequestGroups
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
              <LeaveApproverRequestGroups
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
