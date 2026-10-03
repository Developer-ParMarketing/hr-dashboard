import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useSearchParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { PerformanceAppraisalForm } from '../components/PerformanceAppraisalForm'
import { PerformanceAppraisalDirectory } from '../components/PerformanceAppraisalDirectory'
import { PerformanceRatingScale } from '../components/PerformanceRatingScale'
import { useAuth } from '../auth/AuthContext'
import { canEditAttendance, isAdminUser, isManagerUser } from '../auth/permissions'
import {
  fetchAdminGoalSheets,
  fetchLeadershipGoalSheets,
  fetchMyGoalSheet,
  fetchGoalSheetMeta,
  fetchTeamGoalSheets,
  canActAsManagementReviewer,
  saveGoalSheet,
  type GoalSheetSubmission,
} from '../api/goalSheet'
import { toastSuccess } from '../utils/toastBridge'
import type { RatingScaleEntry } from '../api/performance'
import { openGoalSheetEmployee } from '../utils/goalSheetNavigation'
import { confirmAction } from '../utils/confirmAction'
import { activeCycleYear, parseCycleYearParam } from '../utils/cycleYear'
import { CycleYearSelect } from '../components/CycleYearSelect'

type TabId = 'mine' | 'team' | 'management' | 'admin'

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

function parseTab(raw: string | null): TabId | null {
  if (raw === 'mine' || raw === 'team' || raw === 'management' || raw === 'admin') return raw
  return null
}

export function GoalSheetPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const isAdmin = isAdminUser(user)
  const isManager = isManagerUser(user)
  const isHr = canEditAttendance(user)
  const isManagementReviewer = canActAsManagementReviewer(user)

  const cycleYearFromUrl = parseCycleYearParam(searchParams.get('year'))
  const [cycleYear, setCycleYear] = useState(() => cycleYearFromUrl ?? activeCycleYear())
  const [tab, setTab] = useState<TabId>(() => parseTab(searchParams.get('tab')) ?? 'mine')
  const [linkedEmployee, setLinkedEmployee] = useState(true)
  const [ratingScale, setRatingScale] = useState<RatingScaleEntry[]>([])
  const [mySubmission, setMySubmission] = useState<GoalSheetSubmission | null>(null)
  const [teamMembers, setTeamMembers] = useState<
    Awaited<ReturnType<typeof fetchTeamGoalSheets>>['members']
  >([])
  const [managementMembers, setManagementMembers] = useState<
    Awaited<ReturnType<typeof fetchLeadershipGoalSheets>>['members']
  >([])
  const [adminRows, setAdminRows] = useState<
    Awaited<ReturnType<typeof fetchAdminGoalSheets>>['rows']
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mineFormDirty, setMineFormDirty] = useState(false)
  const [hasTeamAssignments, setHasTeamAssignments] = useState(false)

  const syncCycleYearInUrl = useCallback(
    (year: number) => {
      setCycleYear(year)
      const next = new URLSearchParams(searchParams)
      next.set('year', String(year))
      if (searchParams.get('tab')) next.set('tab', searchParams.get('tab')!)
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const openEmployeeForCycle = useCallback(
    (employeeId: number, mode: Parameters<typeof openGoalSheetEmployee>[1]) => {
      openGoalSheetEmployee(employeeId, mode, cycleYear)
    },
    [cycleYear],
  )

  useEffect(() => {
    if (cycleYearFromUrl != null && cycleYearFromUrl !== cycleYear) {
      setCycleYear(cycleYearFromUrl)
    }
  }, [cycleYearFromUrl, cycleYear])

  useEffect(() => {
    if (mySubmission?.activeCycleYear != null && cycleYearFromUrl == null) {
      setCycleYear(mySubmission.activeCycleYear)
    }
  }, [mySubmission?.activeCycleYear, cycleYearFromUrl])

  const staffOverview = isAdmin || isHr

  useEffect(() => {
    void fetchGoalSheetMeta()
      .then((meta) => setRatingScale(meta.ratingScale))
      .catch(() => {})
  }, [])

  const syncUrl = useCallback(
    (nextTab: TabId) => {
      const next = new URLSearchParams(searchParams)
      next.set('tab', nextTab)
      if (searchParams.get('year')) next.set('year', searchParams.get('year')!)
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const loadMine = useCallback(async () => {
    const result = await fetchMyGoalSheet(cycleYear)
    setLinkedEmployee(result.linked)
    setMySubmission(result.submission)
  }, [cycleYear])

  const loadTeam = useCallback(async () => {
    const result = await fetchTeamGoalSheets(cycleYear)
    setTeamMembers(result.members)
    setHasTeamAssignments(result.members.length > 0)
  }, [cycleYear])

  const loadManagement = useCallback(async () => {
    const result = await fetchLeadershipGoalSheets(cycleYear)
    setManagementMembers(result.members)
  }, [cycleYear])

  const loadAdmin = useCallback(async () => {
    const result = await fetchAdminGoalSheets(cycleYear)
    setAdminRows(result.rows)
  }, [cycleYear])

  useEffect(() => {
    setLoading(true)
    setError(null)
    const run = async () => {
      try {
        const tasks: Promise<void>[] = [loadMine(), loadTeam()]
        if (isManagementReviewer) tasks.push(loadManagement())
        if (staffOverview) tasks.push(loadAdmin())
        await Promise.all(tasks)
      } catch (e) {
        setError(errorMessage(e, 'Could not load goal sheet'))
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [cycleYear, isManagementReviewer, staffOverview, loadMine, loadTeam, loadManagement, loadAdmin])

  useEffect(() => {
    if (!linkedEmployee && staffOverview) {
      setTab('admin')
      syncUrl('admin')
    }
  }, [linkedEmployee, staffOverview, syncUrl])

  const tabs = useMemo(() => {
    const items: Array<{ id: TabId; label: string }> = []
    if (linkedEmployee) {
      items.push({ id: 'mine', label: 'My goal sheet' })
    }
    if (isManager || hasTeamAssignments) {
      items.push({ id: 'team', label: 'Team reviews' })
    }
    if (isManagementReviewer) {
      items.push({ id: 'management', label: 'Management review' })
    }
    if (staffOverview) {
      items.push({ id: 'admin', label: 'All goal sheets' })
    }
    return items
  }, [linkedEmployee, isManager, hasTeamAssignments, isManagementReviewer, staffOverview])

  useEffect(() => {
    if (tabs.length === 0) return
    if (!tabs.some((t) => t.id === tab)) {
      const next = tabs[0].id
      setTab(next)
      syncUrl(next)
    }
  }, [tabs, tab, syncUrl])

  const adminDirectoryRows = useMemo(
    () =>
      adminRows.map((row) => ({
        employeeId: row.employeeId,
        employeeCode: row.employeeCode,
        employeeName: row.employeeName,
        teamName: row.teamName,
        canFill: row.canFill,
        employeeSubmittedAt: row.employeeSubmittedAt,
        overallEmployeeRating: row.overallEmployeeRating,
        overallManagerRating: row.overallManagerRating,
        managerSubmittedAt: row.managerSubmittedAt,
        employeeUpdatedAt: row.employeeUpdatedAt,
        managerUpdatedAt: row.managerUpdatedAt,
      })),
    [adminRows],
  )

  const teamDirectoryRows = useMemo(
    () =>
      teamMembers.map((m) => ({
        employeeId: m.employeeId,
        employeeCode: m.employeeCode,
        employeeName: m.employeeName,
        teamName: m.teamName,
        canFill: m.canFill,
        employeeSubmittedAt: m.employeeSubmittedAt,
        overallEmployeeRating: m.overallEmployeeRating,
        overallManagerRating: m.overallManagerRating,
        managerSubmittedAt: m.managerSubmittedAt,
        employeeUpdatedAt: m.employeeUpdatedAt,
        managerUpdatedAt: m.managerUpdatedAt,
      })),
    [teamMembers],
  )

  const managementDirectoryRows = useMemo(
    () =>
      managementMembers.map((m) => ({
        employeeId: m.employeeId,
        employeeCode: m.employeeCode,
        employeeName: m.employeeName,
        teamName: m.teamName,
        employeeSubmittedAt: m.employeeSubmittedAt,
        overallEmployeeRating: m.overallEmployeeRating,
        overallManagerRating: m.overallManagerRating,
        managerSubmittedAt: m.managerSubmittedAt,
      })),
    [managementMembers],
  )

  async function selectTab(next: TabId) {
    if (tab === 'mine' && mineFormDirty && next !== 'mine') {
      if (
        !(await confirmAction(
          'You have unsaved changes on your goal sheet. Switch tabs without saving?',
        ))
      ) {
        return
      }
    }
    setTab(next)
    syncUrl(next)
  }

  return (
    <AppShell active="goalSheet" maxWidth="full">
      <main className="app-page workspace-page">
        <header className="page-header">
          <div>
            <p className="page-kicker">People</p>
            <h1 className="page-title">Goal sheet</h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--color-warm-text)]">
                {tab === 'admin' && staffOverview
                  ? 'Browse by team and open each employee in a new tab to review their goal sheet.'
                  : tab === 'team'
                    ? 'Your direct reports grouped by team. Open a name to review or submit manager ratings in a new tab.'
                    : tab === 'management'
                      ? 'Goal sheets ready for leadership review, grouped by team. Open in a new tab to add management ratings.'
                      : 'Team-specific annual goals. New joiners cannot edit during probation (3 months); after probation you have one month to submit. Everyone else fills each January.'}
            </p>
          </div>

          <div className="flex flex-col items-start gap-3 sm:items-end">
            <CycleYearSelect
              cycleYear={cycleYear}
              activeCycleYear={mySubmission?.activeCycleYear ?? cycleYear}
              historyCycleYears={mySubmission?.historyCycleYears ?? []}
              onChange={syncCycleYearInUrl}
            />
          {tabs.length > 1 ? (
            <div className="seg mt-5 inline-flex" role="tablist" aria-label="Goal sheet views">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`seg-btn ${tab === t.id ? 'seg-btn-active' : ''}`}
                  onClick={() => selectTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ) : null}
          </div>
        </header>

        <div className="page-body mt-6 gap-5">
          {error ? <p className="alert-error">{error}</p> : null}

          {tab !== 'admin' ? <PerformanceRatingScale ratingScale={ratingScale} /> : null}

          {loading ? (
            <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
          ) : tab === 'mine' && mySubmission ? (
            <PerformanceAppraisalForm
              submission={mySubmission}
              ratingScale={ratingScale}
              mode="employee"
              saveSubmission={saveGoalSheet}
              formLabel="goal sheet"
              onDirtyChange={setMineFormDirty}
              onSaved={(sub) => {
                setMySubmission(sub)
                toastSuccess(
                  sub.employeeSubmittedAt
                    ? 'Goal sheet submitted.'
                    : 'Progress saved. You can leave and continue your goal sheet later.',
                )
                setError(null)
              }}
              onError={setError}
            />
          ) : null}

          {tab === 'team' && (isManager || hasTeamAssignments) && !loading ? (
            <PerformanceAppraisalDirectory
              rows={teamDirectoryRows}
              mode="manager"
              actionLabel="Review"
              openEmployee={openEmployeeForCycle}
              cycleYear={cycleYear}
              emptyMessage="No team members are assigned to you for goal sheet review."
            />
          ) : null}

          {tab === 'management' && isManagementReviewer && !loading ? (
            <PerformanceAppraisalDirectory
              rows={managementDirectoryRows}
              mode="management"
              actionLabel="Review"
              openEmployee={openEmployeeForCycle}
              cycleYear={cycleYear}
              emptyMessage="No goal sheets are waiting for management review yet. They appear after managers submit their reviews."
            />
          ) : null}

          {tab === 'admin' && staffOverview && !loading ? (
            <PerformanceAppraisalDirectory
              rows={adminDirectoryRows}
              mode="view"
              actionLabel="View goal sheet"
              openEmployee={openEmployeeForCycle}
              cycleYear={cycleYear}
              emptyMessage="No employees with goal sheet templates yet. Assign teams and add criteria in goal sheet templates."
            />
          ) : null}
        </div>
      </main>
    </AppShell>
  )
}
