import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { AdminAccessSection } from './AdminAccessSection'
import { AdminNavTabs, type AdminSection } from './AdminNavTabs'
import { AdminPeopleSection, type PeopleDirectoryFilter } from './AdminPeopleSection'
import { listEmployeesForAssignment, listManagers, type AssignableEmployee, type ManagerRecord } from '../api/admin'
import { companySelectionToApiString, type UploadCompanySelection } from '../constants/companies'
import { listTeams, loadTeamMembers, saveTeamManager, saveTeamMembers, type TeamRecord } from '../api/teams'
import { confirmSave } from '../utils/confirmAction'
import { notifyEmployeeRegistryUpdated } from '../utils/employeeRegistryEvents'
import { useWorkspacePeriod } from '../utils/workspacePeriod'

type Props = {
  company: UploadCompanySelection
  currentUserId: number
  embedded?: boolean
  onMessage?: (msg: { error?: string | null; success?: string | null }) => void
}

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

const SECTION_HELP: Record<AdminSection, string> = {
  people:
    'Add or edit employees and managers: code, name, work email, DOJ, base salary, and optional login.',
  access:
    'Login-only accounts (HR/IT not on payroll) and rare fixes. For employees, set role and login under People.',
  teams: 'Pick a team, set its manager, then choose members. Request approvals route to that team manager.',
}

function parseAdminSection(raw: string | null): AdminSection {
  if (raw === 'access' || raw === 'teams' || raw === 'people') return raw
  return 'people'
}

function parsePeopleFilter(raw: string | null): PeopleDirectoryFilter {
  if (
    raw === 'missing-base' ||
    raw === 'unlinked-email' ||
    raw === 'missing-doj' ||
    raw === 'not-in-register'
  ) {
    return raw
  }
  return 'all'
}

export function AdminPanel({
  company,
  currentUserId: _currentUserId,
  embedded = false,
  onMessage,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams()
  const companyApi = companySelectionToApiString(company)
  const { year: registerYear, month: registerMonth } = useWorkspacePeriod()
  const [section, setSectionState] = useState<AdminSection>(() =>
    parseAdminSection(searchParams.get('section')),
  )
  const peopleFilter = parsePeopleFilter(searchParams.get('filter'))

  const setSection = useCallback(
    (next: AdminSection) => {
      setSectionState(next)
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          params.set('section', next)
          if (next !== 'people') params.delete('filter')
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  useEffect(() => {
    setSectionState(parseAdminSection(searchParams.get('section')))
  }, [searchParams])

  const [teams, setTeams] = useState<TeamRecord[]>([])
  const [teamsLoading, setTeamsLoading] = useState(false)
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [allEmployees, setAllEmployees] = useState<AssignableEmployee[]>([])
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([])
  const [employeeSearch, setEmployeeSearch] = useState('')
  const [assignmentsLoading, setAssignmentsLoading] = useState(false)
  const [assignmentsSaving, setAssignmentsSaving] = useState(false)
  const [managers, setManagers] = useState<ManagerRecord[]>([])
  const [draftManagerUserId, setDraftManagerUserId] = useState<number | ''>('')
  const [managerSaving, setManagerSaving] = useState(false)

  const notify = useCallback(
    (error: string | null, success: string | null) => {
      onMessage?.({ error, success })
    },
    [onMessage],
  )

  const loadTeams = useCallback(async () => {
    setTeamsLoading(true)
    try {
      const rows = await listTeams()
      setTeams(rows)
      setSelectedTeamId((current) => current ?? rows[0]?.id ?? null)
    } catch (e) {
      notify(errorMessage(e, 'Could not load teams'), null)
    } finally {
      setTeamsLoading(false)
    }
  }, [notify])

  const loadAssignmentData = useCallback(async () => {
    if (selectedTeamId == null) return
    setAssignmentsLoading(true)
    try {
      const [employees, assignment] = await Promise.all([
        listEmployeesForAssignment(companyApi),
        loadTeamMembers(selectedTeamId),
      ])
      setAllEmployees(employees)
      const ids = new Set(assignment.employeeIds)
      const team = teams.find((t) => t.id === selectedTeamId)
      if (team?.managerName) {
        const target = team.managerName.trim().toLowerCase()
        const mgr = employees.find((e) => e.name.trim().toLowerCase() === target)
        if (mgr) ids.add(mgr.id)
      }
      setSelectedEmployeeIds([...ids])
    } catch (e) {
      notify(errorMessage(e, 'Could not load team assignments'), null)
    } finally {
      setAssignmentsLoading(false)
    }
  }, [selectedTeamId, companyApi, notify, teams])

  useEffect(() => {
    if (section === 'teams') {
      void loadTeams()
      void listManagers()
        .then(setManagers)
        .catch(() => setManagers([]))
    }
  }, [section, loadTeams])

  useEffect(() => {
    if (section === 'teams' && selectedTeamId != null) void loadAssignmentData()
  }, [section, selectedTeamId, loadAssignmentData])

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase()
    if (!q) return allEmployees
    return allEmployees.filter(
      (e) =>
        e.employeeCode.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        (e.teamName ?? '').toLowerCase().includes(q),
    )
  }, [allEmployees, employeeSearch])

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [teams, selectedTeamId],
  )

  useEffect(() => {
    setDraftManagerUserId(selectedTeam?.managerUserId ?? '')
  }, [selectedTeam?.id, selectedTeam?.managerUserId])

  const teamManagerEmployeeId = useMemo(() => {
    if (!selectedTeam?.managerName) return null
    const target = selectedTeam.managerName.trim().toLowerCase()
    return allEmployees.find((e) => e.name.trim().toLowerCase() === target)?.id ?? null
  }, [selectedTeam, allEmployees])

  const toggleEmployee = (id: number) => {
    if (id === teamManagerEmployeeId && selectedEmployeeIds.includes(id)) {
      return
    }
    setSelectedEmployeeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const onSaveManager = async () => {
    if (selectedTeamId == null) return
    const managerUserId = draftManagerUserId === '' ? null : draftManagerUserId
    if (!(await confirmSave(`Team manager for ${selectedTeam?.name ?? 'team'}`))) return
    setManagerSaving(true)
    notify(null, null)
    try {
      const team = await saveTeamManager(selectedTeamId, managerUserId)
      notify(null, `Updated manager for ${team.name}. Leave, reimbursement, and in/out approvals route to them.`)
      notifyEmployeeRegistryUpdated({ source: 'teams' })
      await loadTeams()
      await loadAssignmentData()
    } catch (e) {
      notify(errorMessage(e, 'Could not save team manager'), null)
    } finally {
      setManagerSaving(false)
    }
  }

  const onSaveAssignments = async () => {
    if (selectedTeamId == null) return
    const teamName = selectedTeam?.name ?? 'this team'
    if (!(await confirmSave(`${selectedEmployeeIds.length} member assignment(s) for ${teamName}`))) return
    setAssignmentsSaving(true)
    notify(null, null)
    try {
      const result = await saveTeamMembers(selectedTeamId, selectedEmployeeIds)
      notify(
        null,
        `Assigned ${result.memberCount} employee${result.memberCount === 1 ? '' : 's'} to ${selectedTeam?.name ?? 'team'}. Manager access updated automatically.`,
      )
      notifyEmployeeRegistryUpdated({ source: 'teams' })
      await loadTeams()
    } catch (e) {
      notify(errorMessage(e, 'Could not save team'), null)
    } finally {
      setAssignmentsSaving(false)
    }
  }

  return (
    <section className={`admin-shell${embedded ? '' : ''}`}>
      <div className="admin-shell-head">
        <AdminNavTabs section={section} onChange={setSection} />
      </div>

      <p className="admin-section-banner">{SECTION_HELP[section]}</p>

      {section === 'people' ? (
        <AdminPeopleSection
          companyApi={companyApi}
          directoryFilter={peopleFilter}
          registerYear={registerYear}
          registerMonth={registerMonth}
          onMessage={onMessage}
        />
      ) : section === 'access' ? (
        <AdminAccessSection
          currentUserId={_currentUserId}
          onGoToPeople={() => setSection('people')}
          onMessage={onMessage}
        />
      ) : (
        <div className="space-y-5 px-4 pb-6 pt-2 sm:px-6 lg:px-8">
          <div className="admin-teams-layout">
            <div>
              <p className="field-label mb-2">Teams</p>
              {teamsLoading ? (
                <p className="text-sm text-[var(--color-warm-text)]">Loading…</p>
              ) : teams.length === 0 ? (
                <p className="text-sm text-[var(--color-warm-text)]">No teams configured yet.</p>
              ) : (
                <ul className="space-y-2">
                  {teams.map((team) => {
                    const active = team.id === selectedTeamId
                    return (
                      <li key={team.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedTeamId(team.id)}
                          className={`admin-team-pick${active ? ' admin-team-pick-active' : ''}`}
                        >
                          <span className="block text-sm font-semibold text-[var(--color-ink)]">{team.name}</span>
                          <span className="mt-0.5 block text-xs text-[var(--color-warm-text)]">
                            {team.managerName ?? 'Manager not linked'}
                          </span>
                          <span className="mt-1.5 inline-flex rounded-full bg-[var(--color-brand-muted)] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--color-brand)]">
                            {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="admin-directory min-w-0">
              {selectedTeam ? (
                <>
                  <div className="admin-directory-head">
                    <div>
                      <h3 className="text-base font-semibold text-[var(--color-ink)]">{selectedTeam.name}</h3>
                      <p className="mt-0.5 text-xs text-[var(--color-warm-text)]">
                        {selectedEmployeeIds.length} selected · {companyApi}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-primary shrink-0 text-xs"
                      disabled={assignmentsSaving || assignmentsLoading}
                      onClick={() => void onSaveAssignments()}
                    >
                      {assignmentsSaving ? 'Saving…' : 'Save team'}
                    </button>
                  </div>

                  <div className="border-b border-[color-mix(in_srgb,var(--color-warm-muted)_70%,transparent)] px-4 py-3 sm:px-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                      <label className="block min-w-[12rem] flex-1">
                        <span className="field-label">Team manager (approvals)</span>
                        <select
                          className="field field-compact mt-1.5 w-full max-w-md"
                          value={draftManagerUserId === '' ? '' : String(draftManagerUserId)}
                          onChange={(e) => {
                            const v = e.target.value
                            setDraftManagerUserId(v === '' ? '' : Number.parseInt(v, 10))
                          }}
                        >
                          <option value="">Not assigned</option>
                          {managers.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.email})
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        disabled={managerSaving || assignmentsLoading}
                        onClick={() => void onSaveManager()}
                      >
                        {managerSaving ? 'Saving…' : 'Save manager'}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-[var(--color-warm-text)]">
                      Employee leave, reimbursement, and in/out requests go to this manager unless the
                      submitter is a manager (then HR/leadership approves).
                    </p>
                  </div>
                  <div className="border-b border-[color-mix(in_srgb,var(--color-warm-muted)_70%,transparent)] px-4 py-3 sm:px-5">
                    <label className="block">
                      <span className="field-label">Search people</span>
                      <input
                        type="search"
                        className="field field-compact mt-1.5 w-full max-w-md"
                        value={employeeSearch}
                        onChange={(e) => setEmployeeSearch(e.target.value)}
                        placeholder="Code, name, or current team"
                      />
                    </label>
                  </div>

                  <div className="admin-table-scroll max-h-[min(480px,55vh)]">
                    {assignmentsLoading ? (
                      <p className="p-6 text-center text-sm text-[var(--color-warm-text)]">Loading…</p>
                    ) : filteredEmployees.length === 0 ? (
                      <p className="p-6 text-center text-sm text-[var(--color-warm-text)]">No people found.</p>
                    ) : (
                      <ul className="divide-y divide-[color-mix(in_srgb,var(--color-warm-muted)_65%,transparent)]">
                        {filteredEmployees.map((employee) => {
                          const checked = selectedEmployeeIds.includes(employee.id)
                          const isTeamManager = teamManagerEmployeeId === employee.id
                          const onOtherTeam =
                            employee.teamId != null &&
                            employee.teamId !== selectedTeamId &&
                            !checked
                          return (
                            <li key={employee.id}>
                              <label className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm transition hover:bg-[color-mix(in_srgb,var(--color-brand-muted)_35%,#fff)]">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded border-[var(--color-warm-muted)]"
                                  checked={checked}
                                  disabled={isTeamManager && checked}
                                  title={
                                    isTeamManager && checked
                                      ? 'Team manager stays on this team'
                                      : undefined
                                  }
                                  onChange={() => toggleEmployee(employee.id)}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block font-medium text-[var(--color-ink)]">{employee.name}</span>
                                  <span className="mt-0.5 block font-mono text-[0.6875rem] text-[var(--color-warm-text)]">
                                    {employee.employeeCode}
                                    {employee.teamName
                                      ? ` · ${employee.teamName}${onOtherTeam ? ' → will move' : ''}`
                                      : ''}
                                  </span>
                                </span>
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </>
              ) : (
                <p className="p-8 text-center text-sm text-[var(--color-warm-text)]">
                  Select a team to assign members.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
