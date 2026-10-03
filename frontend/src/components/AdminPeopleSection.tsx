import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import {
  checkAdminWorkEmailSimilarity,
  createAdminEmployee,
  createAdminUser,
  listAdminEmployees,
  listAdminUsers,
  updateAdminEmployee,
  updateAdminUser,
  type AdminEmployeeDetail,
  type AdminEmployeeSalaryBase,
  type AdminUserRecord,
  type SimilarWorkEmailMatch,
} from '../api/admin'
import {
  DEFAULT_UPLOAD_COMPANY,
  UPLOAD_COMPANY_CODES,
  type UploadCompanyCode,
} from '../constants/companies'
import { DEFAULT_PM_PT, DEFAULT_PM_STATUTORY_FORM } from '../constants/salaryDefaults'
import { SALARY_COLUMN_LABELS } from '../constants/salaryColumnLabels'
import { SALARY_BASE_PROFILE_COLUMNS } from '../constants/salaryColumns'
import { listTeams, type TeamRecord } from '../api/teams'
import { tableRowStripBg } from '../utils/attendance'
import { DOJ_INPUT_PLACEHOLDER, formatDojDdMmYyyy, parseDojInput } from '../utils/dojFormat'
import { groupRowsByTeam, teamMetaFromEmployee } from '../utils/teamGroups'
import { TeamGroupHeader } from './TeamGroupHeader'
import { PageWayfinding } from './PageWayfinding'
import { AccountLinkBanner } from './AccountLinkBanner'
import { PasswordInput } from './PasswordInput'
import { DASHBOARD_ROLE_OPTIONS } from '../auth/permissions'
import {
  confirmAction,
  confirmUpdate,
  showFormAlert,
} from '../utils/confirmAction'
import { notifyEmployeeRegistryUpdated } from '../utils/employeeRegistryEvents'

const GENDER_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Other', label: 'Other' },
]

type Props = {
  companyApi: string
  /** Deep-link filter from dashboard checklist (`?filter=`). */
  directoryFilter?: PeopleDirectoryFilter
  registerYear?: number
  registerMonth?: number
  onMessage?: (msg: { error?: string | null; success?: string | null }) => void
}

export type PeopleDirectoryFilter =
  | 'all'
  | 'missing-base'
  | 'unlinked-email'
  | 'missing-doj'
  | 'not-in-register'

type PersonFormState = {
  employeeCode: string
  name: string
  email: string
  company: UploadCompanyCode
  teamId: number | ''
  department: string
  gender: string
  dateOfJoining: string
  dateOfLeaving: string
  shiftStart: string
  status: 'active' | 'inactive'
  inHand: string
  pfEmployee: string
  esiEmployee: string
  pt: string
  gratuity: string
  employerPf: string
  employerPfArr: string
  employerEsi: string
  incrementPercent: string
  grantAccess: boolean
  loginEmail: string
  loginRole: string
  loginPassword: string
  linkedUserId: number | null
}

const EMPTY_FORM: PersonFormState = {
  employeeCode: '',
  name: '',
  email: '',
  company: DEFAULT_UPLOAD_COMPANY,
  teamId: '',
  department: '',
  gender: '',
  dateOfJoining: '',
  dateOfLeaving: '',
  shiftStart: '',
  status: 'active',
  inHand: '',
  ...DEFAULT_PM_STATUTORY_FORM,
  incrementPercent: '',
  grantAccess: false,
  loginEmail: '',
  loginRole: 'viewer',
  loginPassword: '',
  linkedUserId: null,
}

const EMPLOYEE_SALARY_KEYS = [
  'inHand',
  'pfEmployee',
  'esiEmployee',
  'pt',
  'gratuity',
] as const satisfies readonly (keyof PersonFormState)[]

const EMPLOYER_SALARY_KEYS = [
  'employerPf',
  'employerPfArr',
  'employerEsi',
] as const satisfies readonly (keyof PersonFormState)[]

type SalaryFormKey = (typeof EMPLOYEE_SALARY_KEYS)[number] | (typeof EMPLOYER_SALARY_KEYS)[number]

const SALARY_LABELS = Object.fromEntries(
  SALARY_BASE_PROFILE_COLUMNS.map((col) => [col.key, col]),
) as Record<SalaryFormKey, (typeof SALARY_BASE_PROFILE_COLUMNS)[number]>

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function parseAmount(raw: string): number {
  if (raw.trim() === '') return 0
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

function formToSalaryBase(form: PersonFormState): AdminEmployeeSalaryBase | null {
  const inHand = parseAmount(form.inHand)
  if (inHand <= 0) return null
  return {
    inHand,
    pfEmployee: parseAmount(form.pfEmployee),
    esiEmployee: parseAmount(form.esiEmployee),
    pt: parseAmount(form.pt) || DEFAULT_PM_PT,
    gratuity: parseAmount(form.gratuity),
    employerPf: parseAmount(form.employerPf),
    employerPfArr: parseAmount(form.employerPfArr),
    employerEsi: parseAmount(form.employerEsi),
    incrementPercent: (() => {
      const raw = form.incrementPercent.trim()
      if (!raw) return null
      const n = Number.parseFloat(raw)
      return Number.isFinite(n) && n > 0 ? n : null
    })(),
  }
}

function findUserForEmployee(
  users: AdminUserRecord[],
  employee: AdminEmployeeDetail,
): AdminUserRecord | null {
  const email = (employee.email ?? '').trim().toLowerCase()
  if (email) {
    const byEmail = users.find((u) => u.email.trim().toLowerCase() === email)
    if (byEmail) return byEmail
  }
  const name = employee.name.trim().toLowerCase()
  return users.find((u) => u.name.trim().toLowerCase() === name) ?? null
}

function teamMetaFromAdminEmployee(employee: AdminEmployeeDetail) {
  return teamMetaFromEmployee({
    teamId: employee.teamId ?? null,
    teamName: employee.teamName ?? '',
    teamSortOrder: employee.teamSortOrder ?? 9999,
    teamManagerName: employee.teamManagerName ?? undefined,
  })
}

function isPeopleActive(employee: AdminEmployeeDetail): boolean {
  return employee.effectiveStatus === 'active'
}

function employeeToForm(employee: AdminEmployeeDetail, linkedUser: AdminUserRecord | null): PersonFormState {
  const base = employee.salaryBase
  return {
    employeeCode: employee.employeeCode,
    name: employee.name,
    email: employee.email ?? '',
    company:
      employee.company && UPLOAD_COMPANY_CODES.includes(employee.company as UploadCompanyCode)
        ? (employee.company as UploadCompanyCode)
        : DEFAULT_UPLOAD_COMPANY,
    department: employee.department ?? '',
    gender: employee.gender ?? '',
    dateOfJoining: formatDojDdMmYyyy(employee.dateOfJoining),
    dateOfLeaving: formatDojDdMmYyyy(employee.dateOfLeaving),
    teamId: employee.teamId ?? '',
    shiftStart: employee.shiftStart ?? '',
    status:
      employee.effectiveStatus === 'inactive' ? 'inactive' : employee.status === 'inactive' ? 'inactive' : 'active',
    inHand: base ? String(base.inHand) : '',
    pfEmployee: base ? String(base.pfEmployee) : DEFAULT_PM_STATUTORY_FORM.pfEmployee,
    esiEmployee: base ? String(base.esiEmployee) : DEFAULT_PM_STATUTORY_FORM.esiEmployee,
    pt: base ? String(base.pt) : DEFAULT_PM_STATUTORY_FORM.pt,
    gratuity: base ? String(base.gratuity) : DEFAULT_PM_STATUTORY_FORM.gratuity,
    employerPf: base ? String(base.employerPf) : DEFAULT_PM_STATUTORY_FORM.employerPf,
    employerPfArr: base ? String(base.employerPfArr) : DEFAULT_PM_STATUTORY_FORM.employerPfArr,
    employerEsi: base ? String(base.employerEsi) : DEFAULT_PM_STATUTORY_FORM.employerEsi,
    incrementPercent:
      base?.incrementPercent != null && base.incrementPercent > 0
        ? String(base.incrementPercent)
        : '',
    grantAccess: linkedUser != null,
    loginEmail: linkedUser?.email ?? employee.email ?? '',
    loginRole: linkedUser?.role.trim().toLowerCase() ?? 'viewer',
    loginPassword: '',
    linkedUserId: linkedUser?.id ?? null,
  }
}

function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    return (e.response?.data as { message?: string })?.message ?? e.message ?? fallback
  }
  return e instanceof Error ? e.message : fallback
}

function isValidWorkEmail(raw: string): boolean {
  const email = raw.trim().toLowerCase()
  return email.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function describeSimilarWorkEmailMatches(matches: SimilarWorkEmailMatch[]): string {
  return matches
    .slice(0, 4)
    .map((m) =>
      m.kind === 'duplicate'
        ? `• Already used by ${m.employeeCode} - ${m.name} (${m.email})`
        : `• Similar to ${m.employeeCode} - ${m.name} (${m.email}, ${m.score}% match)`,
    )
    .join('\n')
}

function SalaryFieldGrid({
  keys,
  form,
  onChange,
}: {
  keys: readonly SalaryFormKey[]
  form: PersonFormState
  onChange: (key: SalaryFormKey, value: string) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {keys.map((key) => {
        const col = SALARY_LABELS[key]
        return (
          <label key={key} className="block">
            <span className="field-label">{col.label}</span>
            <input
              type="number"
              step="0.01"
              min={col.min ?? undefined}
              className="field field-compact mt-1 w-full tabular-nums"
              value={form[key]}
              onChange={(e) => onChange(key, e.target.value)}
            />
          </label>
        )
      })}
    </div>
  )
}

export function AdminPeopleSection({
  companyApi,
  directoryFilter = 'all',
  registerYear,
  registerMonth,
  onMessage,
}: Props) {
  const formRef = useRef<HTMLDivElement>(null)
  const [employees, setEmployees] = useState<AdminEmployeeDetail[]>([])
  const [users, setUsers] = useState<AdminUserRecord[]>([])
  const [teams, setTeams] = useState<TeamRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PeopleDirectoryFilter>(directoryFilter)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formPanelOpen, setFormPanelOpen] = useState(false)
  const [form, setForm] = useState<PersonFormState>(EMPTY_FORM)
  const [emailSimilarityMatches, setEmailSimilarityMatches] = useState<SimilarWorkEmailMatch[]>(
    [],
  )

  useEffect(() => {
    const email = form.email.trim().toLowerCase()
    if (!isValidWorkEmail(email)) {
      setEmailSimilarityMatches([])
      return
    }
    const timer = window.setTimeout(() => {
      void checkAdminWorkEmailSimilarity(email, editingId ?? undefined)
        .then(setEmailSimilarityMatches)
        .catch(() => setEmailSimilarityMatches([]))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [form.email, editingId])

  const notify = useCallback(
    (error: string | null, success: string | null) => {
      onMessage?.({ error, success })
    },
    [onMessage],
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [employeeRows, userRows, teamRows] = await Promise.all([
        listAdminEmployees(companyApi, {
          registerYear,
          registerMonth,
        }),
        listAdminUsers(),
        listTeams(),
      ])
      setEmployees(employeeRows)
      setUsers(userRows)
      setTeams(teamRows)
    } catch (e) {
      notify(null, null)
      await showFormAlert('Could not load people', errorMessage(e, 'Could not load people'))
    } finally {
      setLoading(false)
    }
  }, [companyApi, notify, registerMonth, registerYear])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    setFilter(directoryFilter)
  }, [directoryFilter])

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase()
    return employees.filter((e) => {
      if (filter === 'missing-base' && e.salaryBase != null) return false
      if (filter === 'unlinked-email') {
        const email = (e.email ?? '').trim()
        const linked = findUserForEmployee(users, e) != null
        if (email && linked) return false
      }
      if (filter === 'missing-doj') {
        if (!isPeopleActive(e)) return false
        if (e.dateOfJoining) return false
      }
      if (filter === 'not-in-register') {
        if (!isPeopleActive(e)) return false
        if (e.inPeriodRegister !== false) return false
      }
      if (!q) return true
      return (
        e.employeeCode.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        (e.department ?? '').toLowerCase().includes(q) ||
        (e.teamName ?? '').toLowerCase().includes(q) ||
        (e.email ?? '').toLowerCase().includes(q)
      )
    })
  }, [employees, users, search, filter])

  const groupedEmployees = useMemo(
    () => groupRowsByTeam(filteredEmployees, teamMetaFromAdminEmployee),
    [filteredEmployees],
  )

  const registerCheckActive = employees.some((e) => e.inPeriodRegister !== undefined)
  const peopleTableColSpan = 7

  const stats = useMemo(() => {
    const withBase = employees.filter((e) => e.salaryBase != null).length
    const withLogin = employees.filter((e) => findUserForEmployee(users, e) != null).length
    const missingDoj = employees.filter((e) => isPeopleActive(e) && !e.dateOfJoining).length
    const notInRegister = employees.filter(
      (e) => isPeopleActive(e) && e.inPeriodRegister === false,
    ).length
    return {
      total: employees.length,
      withBase,
      missingBase: employees.length - withBase,
      active: employees.filter((e) => isPeopleActive(e)).length,
      withLogin,
      missingDoj,
      notInRegister,
    }
  }, [employees, users])

  const editingEmployee = useMemo(
    () => (editingId != null ? employees.find((e) => e.id === editingId) : null),
    [editingId, employees],
  )

  const resetForm = () => {
    setEditingId(null)
    setFormPanelOpen(false)
    setForm({ ...EMPTY_FORM, company: DEFAULT_UPLOAD_COMPANY })
    setEmailSimilarityMatches([])
  }

  const startEdit = (employee: AdminEmployeeDetail) => {
    const linkedUser = findUserForEmployee(users, employee)
    setEditingId(employee.id)
    setFormPanelOpen(true)
    setForm(employeeToForm(employee, linkedUser))
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }

  const updateSalaryField = (key: SalaryFormKey, value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
  }

  const syncLoginEmailFromProfile = (email: string) => {
    setForm((f) => ({
      ...f,
      email,
      loginEmail: f.grantAccess && !f.linkedUserId ? email : f.loginEmail || email,
    }))
  }

  const onSave = async () => {
    notify(null, null)
    const salaryBase = formToSalaryBase(form)
    if (!form.employeeCode.trim() || !form.name.trim()) {
      await showFormAlert('Missing details', 'Employee code and name are required.')
      return
    }
    const profileEmail = form.email.trim().toLowerCase()
    if (!isValidWorkEmail(profileEmail)) {
      await showFormAlert(
        'Work email required',
        'Enter a valid work email (used for HR emails and login).',
      )
      return
    }
    const dojRaw = form.dateOfJoining.trim()
    const parsedDoj = dojRaw ? parseDojInput(dojRaw) : null
    if (dojRaw && !parsedDoj) {
      await showFormAlert('Date of joining', `Use format ${DOJ_INPUT_PLACEHOLDER}.`)
      return
    }
    const dolRaw = form.dateOfLeaving.trim()
    const parsedDol = dolRaw ? parseDojInput(dolRaw) : null
    if (dolRaw && !parsedDol) {
      await showFormAlert('Date of leaving', `Use format ${DOJ_INPUT_PLACEHOLDER}.`)
      return
    }
    if (!salaryBase) {
      await showFormAlert(
        'Base salary required',
        `${SALARY_COLUMN_LABELS.inHand} must be greater than zero before you can save.`,
      )
      return
    }
    if (form.grantAccess) {
      const loginEmail = (form.loginEmail.trim() || profileEmail).toLowerCase()
      if (!loginEmail) {
        await showFormAlert(
          'Dashboard access',
          'Add an email for dashboard access, or turn off login access.',
        )
        return
      }
      if (!form.linkedUserId && form.loginPassword.length > 0 && form.loginPassword.length < 8) {
        await showFormAlert(
          'Dashboard access',
          'If you set a password manually, it must be at least 8 characters. Or leave it blank to email a setup link.',
        )
        return
      }
    }

    const personLabel = `${form.employeeCode.trim()} - ${form.name.trim()}`

    let similarityMatches = emailSimilarityMatches
    if (isValidWorkEmail(profileEmail)) {
      try {
        similarityMatches = await checkAdminWorkEmailSimilarity(profileEmail, editingId ?? undefined)
        setEmailSimilarityMatches(similarityMatches)
      } catch {
        /* keep last inline result */
      }
    }
    if (similarityMatches.length > 0) {
      const duplicate = similarityMatches.some((m) => m.kind === 'duplicate')
      const intro = duplicate
        ? 'This work email is already on another employee record (or extremely similar).'
        : 'This work email looks very similar to another employee (possible typo or duplicate).'
      if (
        !(await confirmAction(
          `${intro}\n\n${describeSimilarWorkEmailMatches(similarityMatches)}\n\nSave anyway?`,
        ))
      ) {
        return
      }
    }

    if (editingId != null) {
      if (!(await confirmUpdate(personLabel))) return
    } else if (!(await confirmAction(`Add ${personLabel} to people and payroll?`))) {
      return
    }

    setSaving(true)
    notify(null, null)
    try {
      const payload = {
        employeeCode: form.employeeCode.trim(),
        name: form.name.trim(),
        email: profileEmail,
        company: form.company,
        teamId: form.teamId === '' ? null : form.teamId,
        department: form.department.trim() || undefined,
        gender: form.gender.trim() || null,
        dateOfJoining: parsedDoj,
        dateOfLeaving: parsedDol,
        shiftStart: form.shiftStart.trim() || undefined,
        status: form.status,
        salaryBase,
      }

      if (editingId != null) {
        await updateAdminEmployee(editingId, {
          ...payload,
          email: profileEmail,
          teamId: form.teamId === '' ? null : form.teamId,
          department: form.department.trim() || null,
          gender: form.gender.trim() || null,
          dateOfJoining: parsedDoj,
          dateOfLeaving: parsedDol,
          shiftStart: form.shiftStart.trim() || null,
        })
      } else {
        await createAdminEmployee({
          ...payload,
          email: profileEmail,
        })
      }

      const loginEmail = form.loginEmail.trim() || form.email.trim()
      if (form.grantAccess) {
        if (form.linkedUserId != null) {
          await updateAdminUser(form.linkedUserId, {
            email: loginEmail,
            name: form.name.trim(),
            role: form.loginRole,
            ...(form.loginPassword ? { password: form.loginPassword } : {}),
          })
        } else {
          await createAdminUser({
            email: loginEmail,
            name: form.name.trim(),
            role: form.loginRole,
            ...(form.loginPassword.trim() ? { password: form.loginPassword.trim() } : {}),
          })
        }
      } else if (form.linkedUserId != null) {
        await updateAdminUser(form.linkedUserId, {
          email: loginEmail || profileEmail || undefined,
          name: form.name.trim(),
        })
      }

      const code = payload.employeeCode
      const successMsg = form.grantAccess
        ? `Saved ${code} with payroll and dashboard access. A setup email was sent if SMTP is configured.`
        : `Saved ${code}. Payroll will pre-fill in Salary each month.`
      notify(null, null)
      notifyEmployeeRegistryUpdated({ source: 'people', employeeId: editingId ?? undefined })
      resetForm()
      await loadData()
      await showFormAlert('Saved', successMsg)
    } catch (e) {
      await showFormAlert('Could not save', errorMessage(e, 'Could not save person'))
    } finally {
      setSaving(false)
    }
  }

  const newLoginPasswordOk =
    !form.grantAccess || form.loginPassword.length === 0 || form.loginPassword.length >= 8
  const loginRoleHint = useMemo(
    () => DASHBOARD_ROLE_OPTIONS.find((o) => o.value === form.loginRole.trim().toLowerCase())?.hint ?? '',
    [form.loginRole],
  )

  const startAdd = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, company: DEFAULT_UPLOAD_COMPANY })
    setFormPanelOpen(true)
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const allSalaryKeys = useMemo(
    () => [...EMPLOYEE_SALARY_KEYS, ...EMPLOYER_SALARY_KEYS],
    [],
  )

  return (
    <div className="px-4 pb-6 pt-2 sm:px-6 lg:px-8">
      {formPanelOpen ? (
        <div ref={formRef} className="admin-people-form-screen">
          <div className="border-b border-[color-mix(in_srgb,var(--color-warm-muted)_70%,transparent)] bg-[color-mix(in_srgb,var(--color-brand-muted)_20%,#fff)] px-4 py-3 sm:px-8">
            <PageWayfinding
              title={editingEmployee ? `Edit ${editingEmployee.employeeCode}` : 'Add person'}
              backLabel="People directory"
              onBack={resetForm}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_srgb,var(--color-warm-muted)_70%,transparent)] bg-[color-mix(in_srgb,var(--color-brand-muted)_35%,#fff)] px-4 py-4 sm:px-8">
            <div>
              <button
                type="button"
                className="btn-ghost mb-2 px-2 py-1 text-xs"
                onClick={resetForm}
              >
                ← Back to people
              </button>
              <h3 className="text-lg font-semibold text-[var(--color-ink)]">
                {editingEmployee ? `Edit ${editingEmployee.employeeCode}` : 'Add person'}
              </h3>
              <p className="mt-0.5 text-sm text-[var(--color-warm-text)]">
                {editingEmployee?.name ?? 'Profile, base salary, and optional dashboard login'}
              </p>
            </div>
          </div>

          <div className="admin-people-form-body space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block">
                <span className="field-label">Code</span>
                <input
                  type="text"
                  className="field field-compact mt-1 w-full uppercase"
                  value={form.employeeCode}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, employeeCode: e.target.value.toUpperCase() }))
                  }
                  placeholder="PMPL40"
                />
              </label>
              <label className="block sm:col-span-2 lg:col-span-1">
                <span className="field-label">Full name</span>
                <input
                  type="text"
                  className="field field-compact mt-1 w-full"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="block lg:col-span-3">
                <span className="field-label">Work email</span>
                <input
                  type="email"
                  required
                  className="field field-compact mt-1 w-full max-w-xl"
                  value={form.email}
                  onChange={(e) => syncLoginEmailFromProfile(e.target.value)}
                  placeholder="name@company.com"
                  autoComplete="email"
                />
                {emailSimilarityMatches.length > 0 ? (
                  <div
                    className="mt-2 max-w-xl rounded-lg border border-amber-200/90 bg-amber-50/90 px-3 py-2 text-xs leading-relaxed text-amber-950"
                    role="status"
                  >
                    <p className="font-semibold">Check this email</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                      {emailSimilarityMatches.slice(0, 4).map((m) => (
                        <li key={`${m.employeeId}-${m.email}`}>
                          {m.kind === 'duplicate' ? (
                            <>
                              Already used by{' '}
                              <span className="font-medium">{m.employeeCode}</span> ({m.name}) -{' '}
                              {m.email}
                            </>
                          ) : (
                            <>
                              Similar to{' '}
                              <span className="font-medium">{m.employeeCode}</span> ({m.name}) -{' '}
                              {m.email} ({m.score}% match)
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </label>
              <label className="block">
                <span className="field-label">Company</span>
                <select
                  className="field field-compact mt-1 w-full"
                  value={form.company}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, company: e.target.value as UploadCompanyCode }))
                  }
                >
                  {UPLOAD_COMPANY_CODES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">Status</span>
                <select
                  className="field field-compact mt-1 w-full"
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, status: e.target.value as 'active' | 'inactive' }))
                  }
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>
              <label className="block">
                <span className="field-label">Team</span>
                <select
                  className="field field-compact mt-1 w-full"
                  value={form.teamId === '' ? '' : String(form.teamId)}
                  onChange={(e) => {
                    const value = e.target.value
                    const teamId = value === '' ? '' : Number.parseInt(value, 10)
                    setForm((f) => ({ ...f, teamId }))
                  }}
                >
                  <option value="">Unassigned</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="field-label">DOJ ({DOJ_INPUT_PLACEHOLDER})</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="field field-compact mt-1 w-full"
                  value={form.dateOfJoining}
                  onChange={(e) => setForm((f) => ({ ...f, dateOfJoining: e.target.value }))}
                  placeholder={DOJ_INPUT_PLACEHOLDER}
                />
              </label>
              <label className="block">
                <span className="field-label">DOL ({DOJ_INPUT_PLACEHOLDER})</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="field field-compact mt-1 w-full"
                  value={form.dateOfLeaving}
                  onChange={(e) => setForm((f) => ({ ...f, dateOfLeaving: e.target.value }))}
                  placeholder={DOJ_INPUT_PLACEHOLDER}
                />
                <span className="mt-1 block text-[0.65rem] text-[var(--color-warm-text)]">
                  Set when generating a relieving letter, or enter here. Inactive from the day after DOL.
                </span>
              </label>
              <label className="block">
                <span className="field-label">Shift start</span>
                <input
                  type="text"
                  className="field field-compact mt-1 w-full"
                  value={form.shiftStart}
                  onChange={(e) => setForm((f) => ({ ...f, shiftStart: e.target.value }))}
                  placeholder="09:30"
                />
              </label>
              <label className="block">
                <span className="field-label">Department</span>
                <input
                  type="text"
                  className="field field-compact mt-1 w-full"
                  value={form.department}
                  onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                />
              </label>
              <label className="block">
                <span className="field-label">Gender</span>
                <select
                  className="field field-compact mt-1 w-full"
                  value={form.gender}
                  onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
                >
                  {GENDER_OPTIONS.map((opt) => (
                    <option key={opt.value || 'unset'} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <details className="admin-form-fold" open>
              <summary>Base salary</summary>
              <div className="pt-3">
                <SalaryFieldGrid keys={allSalaryKeys} form={form} onChange={updateSalaryField} />
                <label className="mt-3 block max-w-xs">
                  <span className="field-label">Default increment %</span>
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    className="field field-compact mt-1 w-full tabular-nums"
                    value={form.incrementPercent}
                    placeholder="e.g. 7.5"
                    onChange={(e) => setForm((f) => ({ ...f, incrementPercent: e.target.value }))}
                  />
                  <p className="mt-1 text-[0.6875rem] text-[var(--color-warm-text)]">
                    Stored on the employee profile. On payroll, enter Inc. % for the increment month - amount =
                    {SALARY_COLUMN_LABELS.inHand} × % ÷ 100.
                  </p>
                </label>
              </div>
            </details>

            <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-warm-muted)_72%,transparent)] bg-[color-mix(in_srgb,var(--color-warm-page)_30%,#fff)] px-4 py-3 sm:px-5">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-[var(--color-warm-muted)]"
                  checked={form.grantAccess}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      grantAccess: e.target.checked,
                      loginEmail: e.target.checked ? f.loginEmail || f.email : f.loginEmail,
                    }))
                  }
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--color-ink)]">
                    Can log in to this system
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--color-warm-text)]">
                    {editingEmployee
                      ? 'Sign-in uses their work email. Set dashboard role and optional new password below.'
                      : 'Creates a dashboard login. We email them a link and code to choose their password (leave password blank).'}
                  </span>
                </span>
              </label>
              {form.grantAccess ? (
                <label className="mt-4 block max-w-md">
                  <span className="field-label">Dashboard role</span>
                  <select
                    className="field field-compact mt-1 w-full"
                    value={form.loginRole}
                    onChange={(e) => setForm((f) => ({ ...f, loginRole: e.target.value }))}
                  >
                    {DASHBOARD_ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {loginRoleHint ? (
                    <span className="mt-1.5 block text-xs text-[var(--color-warm-text)]">{loginRoleHint}</span>
                  ) : null}
                </label>
              ) : null}
              {form.grantAccess && !form.linkedUserId ? (
                <label className="mt-4 block max-w-md">
                  <span className="field-label">Initial password (optional)</span>
                  <PasswordInput
                    minLength={8}
                    className="field-compact mt-1 w-full"
                    value={form.loginPassword}
                    onChange={(e) => setForm((f) => ({ ...f, loginPassword: e.target.value }))}
                    autoComplete="new-password"
                    placeholder="Leave blank - setup email sent instead"
                  />
                  {form.email.trim() ? (
                    <span className="mt-1.5 block text-xs text-[var(--color-warm-text)]">
                      Login: {form.email.trim().toLowerCase()}
                    </span>
                  ) : null}
                </label>
              ) : null}
              {form.grantAccess && form.linkedUserId ? (
                <label className="mt-4 block max-w-md">
                  <span className="field-label">Reset password (optional)</span>
                  <PasswordInput
                    className="field-compact mt-1 w-full"
                    value={form.loginPassword}
                    onChange={(e) => setForm((f) => ({ ...f, loginPassword: e.target.value }))}
                    autoComplete="new-password"
                  />
                </label>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-[color-mix(in_srgb,var(--color-warm-muted)_70%,transparent)] bg-[color-mix(in_srgb,var(--color-warm-muted)_8%,#fff)] px-4 py-4 sm:px-8">
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={saving || !newLoginPasswordOk}
              onClick={() => void onSave()}
            >
              {saving ? 'Saving…' : editingEmployee ? 'Save person' : 'Add person'}
            </button>
            <button type="button" className="btn-ghost text-sm" disabled={saving} onClick={resetForm}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="admin-directory min-w-0">
          {!loading && stats.total > 0 ? (
            <AccountLinkBanner
              variant="admin"
              unlinkedCount={employees.filter((e) => {
                const email = (e.email ?? '').trim()
                const linked = findUserForEmployee(users, e) != null
                return !(email && linked)
              }).length}
              className="mb-4 rounded-xl"
            />
          ) : null}
          <div className="admin-directory-head">
            <div>
              <h3 className="text-base font-semibold text-[var(--color-ink)]">People</h3>
              <p className="mt-1 text-xs text-[var(--color-warm-text)]">
                {stats.total} total · {stats.withBase} salary set
                {stats.missingBase > 0 ? ` · ${stats.missingBase} need salary` : ''}
                {stats.missingDoj > 0 ? ` · ${stats.missingDoj} need DOJ` : ''}
                {registerCheckActive && stats.notInRegister > 0
                  ? ` · ${stats.notInRegister} not in register`
                  : ''}{' '}
                · {stats.withLogin} logins
                {filter !== 'all' ? ` · showing ${filteredEmployees.length} filtered` : ''}
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <select
                className="field field-compact min-w-0 sm:min-w-[11rem]"
                value={filter}
                onChange={(e) => setFilter(e.target.value as PeopleDirectoryFilter)}
                aria-label="People filter"
              >
                <option value="all">All people</option>
                <option value="missing-base">Missing base salary</option>
                <option value="unlinked-email">Unlinked email / login</option>
                <option value="missing-doj">Missing date of joining</option>
                {registerCheckActive ? (
                  <option value="not-in-register">Not in this month’s register</option>
                ) : null}
              </select>
              <input
                type="search"
                className="field field-compact min-w-0 flex-1 sm:min-w-[14rem]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
              />
              <button type="button" className="btn-primary shrink-0 text-xs" onClick={startAdd}>
                Add person
              </button>
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs"
                disabled={loading}
                onClick={() => void loadData()}
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="admin-table-scroll">
            <table className="admin-table min-w-max w-full border-collapse text-left text-sm">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th className="hidden md:table-cell">Team</th>
                  <th className="hidden text-right lg:table-cell">{SALARY_COLUMN_LABELS.inHand}</th>
                  <th className="hidden xl:table-cell">Payroll ready</th>
                  <th>Status</th>
                  <th className="text-right"> </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={peopleTableColSpan} className="px-4 py-12 text-center text-[var(--color-warm-text)]">
                      Loading…
                    </td>
                  </tr>
                ) : filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={peopleTableColSpan} className="px-4 py-12 text-center text-[var(--color-warm-text)]">
                      {employees.length === 0
                        ? 'No people yet. Use the form to add someone, or upload attendance to import from register.'
                        : 'No matches for your search.'}
                    </td>
                  </tr>
                ) : (
                  (() => {
                    let rowIndex = 0
                    return groupedEmployees.flatMap((section) => {
                      const header = (
                        <TeamGroupHeader
                          key={`people-team-${section.group.teamId ?? 'unassigned'}`}
                          group={section.group}
                          memberCount={section.items.length}
                          colSpan={peopleTableColSpan}
                        />
                      )
                      const rows = section.items.map((employee) => {
                        const index = rowIndex++
                        const isEditing = employee.id === editingId
                        const missingBase = employee.salaryBase == null
                        const missingDoj =
                          isPeopleActive(employee) && !employee.dateOfJoining
                        const linkedUser = findUserForEmployee(users, employee)
                        const hasLogin = linkedUser != null
                        const emailOk = Boolean((employee.email ?? '').trim()) && hasLogin
                        const registerOk =
                          employee.inPeriodRegister === undefined
                            ? null
                            : employee.inPeriodRegister !== false
                        return (
                          <tr
                            key={employee.id}
                            className={`border-b border-[color-mix(in_srgb,var(--color-warm-muted)_55%,transparent)] ${tableRowStripBg(index)} ${
                              isEditing
                                ? 'bg-[color-mix(in_srgb,var(--color-brand-muted)_75%,#fff)]'
                                : ''
                            }`}
                          >
                            <td>
                              <span className="admin-emp-code">{employee.employeeCode}</span>
                              {missingBase ? (
                                <span className="mt-0.5 block text-[0.6rem] font-semibold uppercase tracking-wide text-amber-700">
                                  No salary
                                </span>
                              ) : null}
                            </td>
                            <td>
                              <span className="font-medium text-[var(--color-ink)]">{employee.name}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--color-warm-text)]">
                                {employee.email ? (
                                  <span className="truncate">{employee.email}</span>
                                ) : (
                                  <span className="text-amber-700">No email</span>
                                )}
                                {hasLogin ? (
                                  <span className="shrink-0 text-[var(--color-brand)]">· Login</span>
                                ) : null}
                              </span>
                            </td>
                            <td className="hidden text-[var(--color-warm-text)] md:table-cell">
                              {employee.teamName || '-'}
                            </td>
                            <td className="hidden text-right tabular-nums lg:table-cell">
                              {employee.salaryBase ? `₹${money(employee.salaryBase.inHand)}` : '-'}
                            </td>
                            <td className="hidden xl:table-cell">
                              <ul className="flex flex-col gap-0.5 text-[0.65rem] leading-snug text-[var(--color-warm-text)]">
                                <li className={missingBase ? 'text-amber-700' : 'text-[var(--color-brand)]'}>
                                  {missingBase ? 'Base missing' : 'Base set'}
                                </li>
                                <li className={missingDoj ? 'text-amber-700' : 'text-[var(--color-brand)]'}>
                                  {missingDoj
                                    ? 'DOJ missing'
                                    : employee.dateOfJoining
                                      ? `DOJ ${formatDojDdMmYyyy(employee.dateOfJoining)}`
                                      : 'DOJ -'}
                                </li>
                                <li className={employee.dateOfLeaving ? 'text-[var(--color-warm-text)]' : 'text-[var(--color-brand)]'}>
                                  {employee.dateOfLeaving
                                    ? `DOL ${formatDojDdMmYyyy(employee.dateOfLeaving)}`
                                    : 'DOL -'}
                                </li>
                                <li className={emailOk ? 'text-[var(--color-brand)]' : 'text-amber-700'}>
                                  {emailOk ? 'Email & login' : 'Email / login gap'}
                                </li>
                                {registerOk != null ? (
                                  <li className={registerOk ? 'text-[var(--color-brand)]' : 'text-amber-700'}>
                                    {registerOk ? 'In register' : 'Not in register'}
                                  </li>
                                ) : null}
                              </ul>
                            </td>
                            <td>
                              <span
                                className={`inline-flex rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide ${
                                  isPeopleActive(employee)
                                    ? 'bg-[var(--color-brand-muted)] text-[var(--color-brand)]'
                                    : 'bg-[color-mix(in_srgb,var(--color-warm-muted)_55%,#fff)] text-[var(--color-warm-text)]'
                                }`}
                              >
                                {employee.effectiveStatus}
                              </span>
                            </td>
                            <td className="text-right">
                              <button
                                type="button"
                                className={`btn-ghost text-xs ${isEditing ? 'text-[var(--color-brand)]' : ''}`}
                                onClick={() => startEdit(employee)}
                              >
                                {isEditing ? 'Editing' : 'Edit'}
                              </button>
                            </td>
                          </tr>
                        )
                      })
                      return [header, ...rows]
                    })
                  })()
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
