import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { processAttendancePdf, loadSavedMonth, setWeeklyAttendanceStatus } from '../api/attendance'
import { useAuth } from '../auth/AuthContext'
import { canEditAttendance, getAttendanceViewMode, attendanceRegisterViews } from '../auth/permissions'
import {
  companySelectionToApiString,
  DEFAULT_UPLOAD_COMPANY,
  isUploadCompanyCode,
  isUploadCompanySelection,
  UPLOAD_COMPANY_CODES,
  type UploadCompanyCode,
  type UploadCompanySelection,
} from '../constants/companies'
import { useWorkspacePeriod } from '../utils/workspacePeriod'
import {
  calendarDayForReportMonth,
  enrichEmployeesFromDailyRecords,
  dedupeEmployeesById,
  hasHoursRollupData,
  normalizeEmployee,
  resolveDailyColumnDay,
} from '../utils/attendance'
import { formatDisplayDate, isoFromYmd } from '../utils/displayDate'
import { downloadAbsenceReportAsXlsx, downloadDailyViewAsXlsx, downloadTeamPresenceSummaryAsXlsx } from '../utils/exportDailyXlsx'
import { UploadComponent } from '../components/UploadComponent'
import { AttendancePeriodPicker } from '../components/AttendancePeriodPicker'
import { AttendanceOnboardingStrip } from '../components/AttendanceOnboardingStrip'
import { AccountLinkBanner } from '../components/AccountLinkBanner'
import { fetchMe } from '../api/auth'
import { DailyTable } from '../components/DailyTable'
import { DailyTeamPresenceSection } from '../components/DailyTeamPresenceSection'
import { WeeklyTable } from '../components/WeeklyTable'
import { WeeklyAttendanceTable } from '../components/WeeklyAttendanceTable'
import { AppShell } from '../components/AppShell'
import { MonthlyTable } from '../components/MonthlyTable'
import type {
  AttendanceBrowsePeriod,
  AttendanceFilter,
  DailyAttendanceRecord,
  GroupedRecentUpload,
  NormalizedEmployee,
  ProcessAttendanceResponse,
  RawEmployee,
  WeeklyAttendanceRecord,
  CompanyHolidayDay,
} from '../types/attendance'
import { toastSuccess } from '../utils/toastBridge'
import type { NotificationStatusEntry } from '../utils/emailWorkflow'
import {
  lastRawForOpenedRegister,
  openedRegisterFromParts,
  openedRegisterFromUpload,
  processedRegisterFromUploadResponse,
  type OpenedRegisterContext,
} from '../utils/openRegister'
import { openedRegisterFromBrowsePeriod, browseViewForPeriod, browsePeriodSummaryLabel } from '../utils/attendanceBrowse'
import { isAttendanceOpenIntent, type AttendanceOpenIntent } from '../utils/attendanceNavigation'
import { filterEmployeesByTeam } from '../utils/teamGroups'
import { confirmAction } from '../utils/confirmAction'
import { listTeams, type TeamRecord } from '../api/teams'
import { subscribeEmployeeRegistryUpdated } from '../utils/employeeRegistryEvents'
import type { ModuleId } from '../modules/types'

type TabId = 'upload' | 'daily' | 'weekly' | 'monthly'
type ReportView = 'daily' | 'weekly' | 'monthly'
/** After upload or opening a saved file: lock UI to that register type. Full month browse uses `all`. */
type ActiveReportScope = ReportView | 'all'

const REPORT_VIEWS: ReportView[] = ['daily', 'weekly', 'monthly']

function defaultTabForRole(
  viewMode: 'full' | 'team' | 'self',
  registerOnly: boolean,
  urlTab: TabId | null,
  intentTab: ReportView | null = null,
): TabId {
  if (intentTab) return intentTab
  if (registerOnly) return 'monthly'
  if (urlTab === 'daily' || urlTab === 'weekly' || urlTab === 'monthly') return urlTab
  if (urlTab === 'upload') return viewMode === 'full' ? 'upload' : 'monthly'
  if (viewMode === 'full') return 'upload'
  return 'monthly'
}

function reviewTabForRole(_viewMode: 'full' | 'team' | 'self', preferred?: ReportView | null): ReportView {
  if (preferred && REPORT_VIEWS.includes(preferred)) return preferred
  return 'monthly'
}

function reviewTabFromOpenIntent(intent: AttendanceOpenIntent | null | undefined): ReportView | null {
  if (!intent || intent.kind !== 'period') return null
  const fromRegister = intent.processedRegister?.reportType
  if (fromRegister && REPORT_VIEWS.includes(fromRegister)) return fromRegister
  if (intent.preferredView && REPORT_VIEWS.includes(intent.preferredView)) return intent.preferredView
  return null
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

function applyReportPeriodFromResponse(
  raw: ProcessAttendanceResponse,
  setPeriod: (next: { year?: number; month?: number; company?: UploadCompanyCode }) => void,
): { year: number; month: number } | null {
  const iso = raw.reportDateIso ?? raw.parseMeta?.reportDateIso
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m] = iso.split('-').map(Number)
    if (Number.isFinite(y) && y >= 2000 && y <= 2100 && Number.isFinite(m) && m >= 1 && m <= 12) {
      setPeriod({ year: y, month: m })
      return { year: y, month: m }
    }
  }
  const y = raw.reportYear
  const m = raw.reportMonth
  if (
    typeof y === 'number' &&
    Number.isFinite(y) &&
    y >= 2000 &&
    y <= 2100 &&
    typeof m === 'number' &&
    Number.isFinite(m) &&
    m >= 1 &&
    m <= 12
  ) {
    setPeriod({ year: y, month: m })
    return { year: y, month: m }
  }
  return null
}

type AttendancePageProps = {
  shellActive?: ModuleId
  browseContext?: 'attendance' | 'attendanceDetail'
  initialOpenIntent?: AttendanceOpenIntent | null
  onBackToBrowse?: () => void
  backToBrowseLabel?: string
}

export function AttendancePage({
  shellActive = 'attendance',
  browseContext = 'attendance',
  initialOpenIntent = null,
  onBackToBrowse,
  backToBrowseLabel = '← Back to saved registers',
}: AttendancePageProps = {}) {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const {
    year: reportYear,
    month: reportMonth,
    company: workspaceCompany,
    setPeriod: setWorkspacePeriod,
  } = useWorkspacePeriod()
  const registerOnly = browseContext === 'attendanceDetail'
  /** Used for UI labels / policy context; PDF processing includes all employees in the file. */
  const companyCode: UploadCompanySelection = workspaceCompany
  const [activeCompanyCode, setActiveCompanyCode] = useState<Exclude<UploadCompanySelection, ''> | null>(
    null,
  )
  const [file, setFile] = useState<File | null>(null)
  const [leaveFile, setLeaveFile] = useState<File | null>(null)
  const [wfhFile, setWfhFile] = useState<File | null>(null)
  const initialTabFromUrl = ((): TabId | null => {
    const t = searchParams.get('tab')
    if (t === 'upload' || t === 'daily' || t === 'weekly' || t === 'monthly') return t
    return null
  })()
  const [employees, setEmployees] = useState<NormalizedEmployee[]>([])
  const [weeklyRecords, setWeeklyRecords] = useState<WeeklyAttendanceRecord[]>([])
  const [dailyRecords, setDailyRecords] = useState<DailyAttendanceRecord[]>([])
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatusEntry[]>([])
  const [companyHolidays, setCompanyHolidays] = useState<CompanyHolidayDay[]>([])
  const [lastRaw, setLastRaw] = useState<ProcessAttendanceResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<AttendanceFilter>('all')
  const [teamFilter, setTeamFilter] = useState<number | 'all'>('all')
  const [teams, setTeams] = useState<TeamRecord[]>([])

  const allowEdit = canEditAttendance(user)
  const viewMode = getAttendanceViewMode(user)
  /** HR main `/attendance` route: upload here; after processing, open review on Attendance history. */
  const hrUploadOnly = browseContext === 'attendance' && viewMode === 'full' && allowEdit
  const usesRegisterBrowse = viewMode !== 'full' && !registerOnly && !hrUploadOnly
  const [pickedBrowsePeriod, setPickedBrowsePeriod] = useState<AttendanceBrowsePeriod | null>(null)
  const [employeeProfileLinked, setEmployeeProfileLinked] = useState<boolean | null>(null)

  useEffect(() => {
    if (viewMode !== 'self') {
      setEmployeeProfileLinked(null)
      return
    }
    void fetchMe()
      .then((me) => setEmployeeProfileLinked(me?.employeeProfile?.linked ?? false))
      .catch(() => setEmployeeProfileLinked(false))
  }, [viewMode])

  const intentReviewTab = reviewTabFromOpenIntent(initialOpenIntent)

  const [tab, setTab] = useState<TabId>(() => {
    if (intentReviewTab) return intentReviewTab
    return defaultTabForRole(viewMode, registerOnly, initialTabFromUrl, intentReviewTab)
  })
  const [reportView, setReportView] = useState<ReportView>(() =>
    intentReviewTab ??
      (initialTabFromUrl && initialTabFromUrl !== 'upload'
        ? initialTabFromUrl
        : reviewTabForRole(viewMode)),
  )
  const [activeReportScope, setActiveReportScope] = useState<ActiveReportScope>(() =>
    intentReviewTab ?? 'all',
  )
  const [openedRegister, setOpenedRegister] = useState<OpenedRegisterContext | null>(null)
  const handledOpenIntentRef = useRef<string | null>(null)
  const lastReviewTabRef = useRef<ReportView>(
    intentReviewTab ??
      (initialTabFromUrl && initialTabFromUrl !== 'upload'
        ? initialTabFromUrl
        : reviewTabForRole(viewMode)),
  )

  const attendanceTitle =
    viewMode === 'full'
      ? hrUploadOnly
        ? 'Upload attendance'
        : 'Attendance'
      : viewMode === 'team'
        ? 'Team attendance'
        : 'My attendance'
  const attendanceIntro =
    viewMode === 'full'
      ? hrUploadOnly
        ? 'Upload daily, weekly, or monthly ESSL files here. When processing finishes, you are taken to Attendance history on the same view (daily, weekly, or monthly) for that register.'
        : 'Upload registers in one place, then review daily and weekly tables. Approve attendance for payroll on the Monthly tab only.'
      : viewMode === 'team'
        ? 'Choose daily, weekly, or monthly. Processed dates and weeks are highlighted - tap one to view your team’s attendance.'
        : 'Choose daily, weekly, or monthly. Processed dates and weeks are highlighted - tap one to view your attendance.'

  const goToRegisterTab = useCallback(
    (preferred?: ReportView) => {
      const next = reviewTabForRole(viewMode, preferred ?? lastReviewTabRef.current)
      lastReviewTabRef.current = next
      setReportView(next)
      setTab(next)
    },
    [viewMode],
  )

  const goToUploadTab = useCallback(() => {
    if (tab === 'daily' || tab === 'weekly' || tab === 'monthly') {
      lastReviewTabRef.current = tab
    }
    setTab('upload')
  }, [tab])

  const clearBrowseSelection = useCallback(() => {
    setPickedBrowsePeriod(null)
    setOpenedRegister(null)
    setEmployees([])
    setWeeklyRecords([])
    setDailyRecords([])
    setNotificationStatus([])
    setCompanyHolidays([])
    setLastRaw(null)
    setActiveCompanyCode(null)
    setActiveReportScope('all')
    setError(null)
    setSearchInput('')
    setSearch('')
    setFilter('all')
  }, [])

  const registerViews = useMemo(() => attendanceRegisterViews(viewMode), [viewMode])

  const allowedViews = useMemo((): ReportView[] => {
    if (viewMode !== 'full') {
      return activeReportScope === 'all'
        ? registerViews
        : registerViews.filter((v) => v === activeReportScope)
    }
    if (activeReportScope === 'all') return REPORT_VIEWS
    return [activeReportScope]
  }, [activeReportScope, viewMode, registerViews])

  useEffect(() => {
    if (activeReportScope === 'all' || tab === 'upload') return
    if (!allowedViews.includes(tab as ReportView)) {
      setTab(activeReportScope)
    }
  }, [activeReportScope, allowedViews, tab])

  useEffect(() => {
    if (!openedRegister) return
    if (usesRegisterBrowse) return
    const locked = openedRegister.reportType
    if (activeReportScope !== locked) setActiveReportScope(locked)
    if (tab !== 'upload' && tab !== locked) setTab(locked)
  }, [openedRegister, activeReportScope, tab, usesRegisterBrowse])

  useEffect(() => {
    if (tab === 'daily' || tab === 'weekly' || tab === 'monthly') {
      lastReviewTabRef.current = tab
    }
  }, [tab])

  const hasData = employees.length > 0

  useEffect(() => {
    if (viewMode === 'self') return
    void listTeams()
      .then(setTeams)
      .catch(() => setTeams([]))
  }, [viewMode])

  useEffect(() => {
    if (registerOnly || !hrUploadOnly) return
    if (tab !== 'upload') setTab('upload')
  }, [hrUploadOnly, registerOnly, tab])

  useEffect(() => {
    if (registerOnly) return
    if (hrUploadOnly) return
    const t = searchParams.get('tab')
    if (t === 'upload' && viewMode !== 'full') return
    if (t === 'upload' || t === 'daily' || t === 'weekly' || t === 'monthly') {
      setTab(t)
      if (t !== 'upload') {
        setReportView(t as ReportView)
        lastReviewTabRef.current = t as ReportView
        if (viewMode === 'full') {
          setActiveReportScope((scope) => (scope === 'all' ? 'all' : (t as ActiveReportScope)))
        } else {
          setActiveReportScope('all')
        }
      }
    }
  }, [searchParams, registerOnly, hrUploadOnly, viewMode])

  const filteredEmployees = useMemo(
    () => filterEmployeesByTeam(employees, teamFilter),
    [employees, teamFilter],
  )
  const hoursRollupPresent = useMemo(
    () => hasHoursRollupData(employees),
    [employees],
  )
  const policyCompany = activeCompanyCode ?? DEFAULT_UPLOAD_COMPANY
  const browsePinnedWeekStart = useMemo(() => {
    if (pickedBrowsePeriod?.kind === 'weekly') return pickedBrowsePeriod.weekStart
    if (openedRegister?.reportType === 'weekly' && openedRegister.weekStartIso) {
      return openedRegister.weekStartIso
    }
    return null
  }, [pickedBrowsePeriod, openedRegister])

  const dailyViewCalendarDay = useMemo(() => {
    const raw = lastRaw
    const fromOpened =
      openedRegister?.reportType === 'daily' && typeof openedRegister.reportDay === 'number'
        ? openedRegister.reportDay
        : undefined
    const fromTop =
      typeof raw?.reportDay === 'number' ? raw.reportDay : undefined
    const fromMeta =
      typeof raw?.parseMeta?.reportDay === 'number'
        ? raw.parseMeta.reportDay
        : undefined
    const rd = fromOpened ?? fromTop ?? fromMeta
    const preferred =
      typeof rd === 'number' && rd >= 1 && rd <= 31
        ? rd
        : calendarDayForReportMonth(
            reportYear,
            reportMonth,
            new Date(),
            employees,
          )
    return resolveDailyColumnDay(employees, preferred)
  }, [lastRaw, reportYear, reportMonth, employees, openedRegister])

  const dailyDateLabelOverride = useMemo(() => {
    const openedIso = openedRegister?.reportDateIso
    if (
      openedRegister?.reportType === 'daily' &&
      typeof openedIso === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(openedIso)
    ) {
      const [y, m, d] = openedIso.split('-').map(Number)
      return formatDisplayDate(isoFromYmd(y, m, d))
    }
    const r = lastRaw
    if (!r) return null
    if (typeof r.reportDate === 'string' && r.reportDate.trim()) {
      return r.reportDate.trim()
    }
    const iso = r.reportDateIso ?? r.parseMeta?.reportDateIso
    if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [y, m, d] = iso.split('-').map(Number)
      return formatDisplayDate(isoFromYmd(y, m, d))
    }
    if (typeof r.parseMeta?.reportDate === 'string' && r.parseMeta.reportDate.trim()) {
      return r.parseMeta.reportDate.trim()
    }
    return null
  }, [lastRaw, openedRegister])

  const dailyColumnHint = useMemo(() => {
    if (typeof lastRaw?.reportDay === 'number' && lastRaw.reportDay >= 1) {
      return `Stored punches for register day ${dailyViewCalendarDay} (from your file).`
    }
    if (typeof lastRaw?.parseMeta?.reportDay === 'number') {
      return `Stored punches for register day ${dailyViewCalendarDay} (from your file).`
    }
    return 'Rows are saved daily attendance records for this date.'
  }, [lastRaw, dailyViewCalendarDay])

  const applySearch = useCallback(() => {
    setSearch(searchInput)
  }, [searchInput])

  const goToUploadForNewFile = useCallback(() => {
    setFile(null)
    setLeaveFile(null)
    setWfhFile(null)
    setEmployees([])
    setWeeklyRecords([])
    setDailyRecords([])
    setNotificationStatus([])
    setCompanyHolidays([])
    setError(null)
    setActiveReportScope('all')
    setOpenedRegister(null)
    setTab(registerOnly ? 'monthly' : 'upload')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [registerOnly])

  const returnToHistoryBrowse = useCallback(() => {
    if (onBackToBrowse) {
      onBackToBrowse()
      return
    }
    goToUploadForNewFile()
  }, [goToUploadForNewFile, onBackToBrowse])

  const viewTabBtn = (id: Exclude<TabId, 'upload'>, label: string) => {
    const active = tab === id
    const locked = activeReportScope !== 'all' && id !== activeReportScope
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        disabled={locked}
        onClick={() => {
          if (locked) return
          if (usesRegisterBrowse) clearBrowseSelection()
          lastReviewTabRef.current = id
          setReportView(id)
          setTab(id)
        }}
        className={`seg-btn px-3 py-1.5 text-xs ${active ? 'seg-btn-active' : ''} ${locked ? 'cursor-not-allowed opacity-40' : ''}`}
      >
        {label}
      </button>
    )
  }

  const uploadTabBtn = () => {
    const active = tab === 'upload'
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => setTab('upload')}
        className={`seg-btn px-3 py-1.5 text-xs ${active ? 'seg-btn-active' : ''}`}
      >
        Upload
      </button>
    )
  }

  const reviewTabLabels =
    viewMode === 'self'
      ? { daily: 'My day', weekly: 'My week', monthly: 'My month' }
      : viewMode === 'team'
        ? { daily: 'Daily', weekly: 'Team week', monthly: 'Month' }
        : { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }

  const applySavedSnapshot = useCallback(
    (snap: Awaited<ReturnType<typeof loadSavedMonth>>) => {
      const list = dedupeEmployeesById(
        snap.employees.map((row) => normalizeEmployee(row as unknown as RawEmployee)),
      )
      const daily = snap.daily ?? []
      const enriched = enrichEmployeesFromDailyRecords(list, daily, snap.year, snap.month)
      setEmployees(enriched)
      setWeeklyRecords(snap.weekly ?? [])
      setDailyRecords(daily)
      setNotificationStatus(snap.notifications ?? [])
      setCompanyHolidays(snap.holidays ?? [])
      return enriched
    },
    [],
  )

  const refreshSavedMonth = useCallback(
    async (year: number, month: number, company: UploadCompanySelection) => {
      const snap = await loadSavedMonth(year, month, company === '' ? DEFAULT_UPLOAD_COMPANY : company)
      return applySavedSnapshot(snap)
    },
    [applySavedSnapshot],
  )

  const process = useCallback(async () => {
    if (!file || !isUploadCompanySelection(companyCode)) return
    if (
      !(await confirmAction(
        `Process and save this ${reportView} register?\n\nFile: ${file.name}\n\nStored attendance will be updated for the period in the file.`,
      ))
    ) {
      return
    }
    const selectedCompanyCode = companyCode
    setLoading(true)
    setError(null)
    setEmployees([])
    setWeeklyRecords([])
    setDailyRecords([])
    setNotificationStatus([])
    setCompanyHolidays([])
    setLastRaw(null)
    setActiveCompanyCode(null)
    try {
      const { employees: list, raw } = await processAttendancePdf(
        file,
        companySelectionToApiString(selectedCompanyCode),
        reportView,
        {
          leaveFile,
          wfhFile,
        },
      )
      const detectedPeriod = applyReportPeriodFromResponse(raw, setWorkspacePeriod)
      const y = detectedPeriod?.year ?? reportYear
      const m = detectedPeriod?.month ?? reportMonth
      const daily = raw.daily ?? []
      const enriched = enrichEmployeesFromDailyRecords(list, daily, y, m)
      setEmployees(enriched)
      setLastRaw(raw)
      setWeeklyRecords(raw.weekly ?? [])
      setDailyRecords(daily)
      setNotificationStatus([])
      setCompanyHolidays([])
      setActiveCompanyCode(selectedCompanyCode)
      const uploadName =
        (typeof raw.uploadName === 'string' && raw.uploadName.trim()) || file.name
      const processedParts = processedRegisterFromUploadResponse(
        raw,
        reportView,
        uploadName,
        y,
        m,
      )
      setOpenedRegister(
        openedRegisterFromParts(
          {
            ...processedParts,
            reportYear: y,
            reportMonth: m,
            company: selectedCompanyCode,
          },
          daily,
          raw.weekly ?? [],
        ),
      )
      // Dashboard always shows saved records returned by the API.
      setSearchInput('')
      setSearch('')
      setFilter('all')
      if (hrUploadOnly) {
        setFile(null)
        setLeaveFile(null)
        setWfhFile(null)
        navigate('/attendance-detail', {
          state: {
            kind: 'period',
            year: y,
            month: m,
            company: selectedCompanyCode,
            preferredView: reportView,
            processedRegister: processedParts,
          } satisfies AttendanceOpenIntent,
        })
      } else {
        setActiveReportScope(reportView)
        if (list.length > 0) {
          lastReviewTabRef.current = reportView
          setTab(reportView)
        }
      }
      try {
        const snap = await loadSavedMonth(y, m, selectedCompanyCode)
        setNotificationStatus(snap.notifications ?? [])
        setCompanyHolidays(snap.holidays ?? [])
      } catch {
        setNotificationStatus([])
        setCompanyHolidays([])
      }
    } catch (e) {
      if (axios.isAxiosError(e)) {
        const msg =
          typeof e.response?.data === 'string'
            ? e.response.data
            : (e.response?.data as { message?: string })?.message
        setError(msg || e.message || 'Request failed')
      } else {
        setError(e instanceof Error ? e.message : 'Processing failed')
      }
      setEmployees([])
      setWeeklyRecords([])
      setDailyRecords([])
      setCompanyHolidays([])
      setLastRaw(null)
      setActiveCompanyCode(null)
      setActiveReportScope('all')
      setTab('upload')
    } finally {
      setLoading(false)
    }
  }, [
    file,
    companyCode,
    reportView,
    leaveFile,
    wfhFile,
    setWorkspacePeriod,
    hrUploadOnly,
    reportYear,
    reportMonth,
    navigate,
  ])

  const loadSavedPeriod = useCallback(
    async (
      year: number,
      month: number,
      company: UploadCompanySelection,
      opts?: {
        preferredView?: ReportView
        openIntent?: AttendanceOpenIntent | null
      },
    ) => {
      if (!isUploadCompanySelection(company)) return
      if (isUploadCompanyCode(company)) {
        setWorkspacePeriod({ year, month, company })
      } else {
        setWorkspacePeriod({ year, month })
      }
      setLoading(true)
      setError(null)
      try {
        const snap = await loadSavedMonth(
          year,
          month,
          isUploadCompanyCode(company) ? company : DEFAULT_UPLOAD_COMPANY,
        )
        const list = applySavedSnapshot(snap)
        setActiveCompanyCode(company)
        setSearchInput('')
        setSearch('')
        setFilter('all')

        const intent =
          opts?.openIntent?.kind === 'period' ? opts.openIntent : null
        const pr = intent?.processedRegister
        const openedFromIntent =
          pr != null
            ? openedRegisterFromParts(
                {
                  fileName: pr.fileName,
                  reportType: pr.reportType,
                  reportYear: year,
                  reportMonth: month,
                  company,
                  reportDay: pr.reportDay ?? null,
                  reportDateIso: pr.reportDateIso ?? null,
                  weekStartIso: pr.weekStartIso ?? null,
                  weekEndIso: pr.weekEndIso ?? null,
                },
                snap.daily ?? [],
                snap.weekly ?? [],
              )
            : null

        const reviewTab = reviewTabForRole(
          viewMode,
          openedFromIntent?.reportType ?? opts?.preferredView ?? null,
        )
        lastReviewTabRef.current = reviewTab
        setReportView(reviewTab)
        setTab(reviewTab)
        setActiveReportScope(openedFromIntent ? openedFromIntent.reportType : 'all')

        if (openedFromIntent) {
          setOpenedRegister(openedFromIntent)
          setLastRaw(
            lastRawForOpenedRegister(openedFromIntent, snap.daily ?? [], snap.weekly ?? []),
          )
        } else {
          setOpenedRegister(null)
          setLastRaw({
            parseMeta: { source: 'postgres' },
          })
        }

        if (list.length === 0) {
          toastSuccess(
            viewMode === 'self'
              ? `No attendance found for ${MONTHS[month - 1] ?? 'Month'} ${year}. If this looks wrong, ask HR to link your login email to your employee profile.`
              : `No saved attendance for ${MONTHS[month - 1] ?? 'Month'} ${year}.`,
          )
          return
        }
      } catch (e) {
        if (axios.isAxiosError(e)) {
          const msg =
            typeof e.response?.data === 'string'
              ? e.response.data
              : (e.response?.data as { message?: string })?.message
          setError(msg || e.message || 'Could not load saved attendance')
        } else {
          setError(e instanceof Error ? e.message : 'Could not load saved attendance')
        }
      } finally {
        setLoading(false)
      }
    },
    [applySavedSnapshot, viewMode, setWorkspacePeriod],
  )

  useEffect(() => {
    if (!user || registerOnly) return
    if (allowEdit && tab === 'upload') return
    if (usesRegisterBrowse) return
    void loadSavedPeriod(reportYear, reportMonth, companyCode)
  }, [
    user,
    registerOnly,
    allowEdit,
    tab,
    loadSavedPeriod,
    reportYear,
    reportMonth,
    companyCode,
    usesRegisterBrowse,
  ])

  useEffect(() => {
    if (!user || registerOnly) return
    if (allowEdit && tab === 'upload') return
    if (usesRegisterBrowse) return
    return subscribeEmployeeRegistryUpdated(() => {
      void loadSavedPeriod(reportYear, reportMonth, companyCode)
    })
  }, [
    user,
    registerOnly,
    allowEdit,
    tab,
    loadSavedPeriod,
    reportYear,
    reportMonth,
    companyCode,
    usesRegisterBrowse,
  ])

  useEffect(() => {
    if (!usesRegisterBrowse || !pickedBrowsePeriod) return
    const locked = browseViewForPeriod(pickedBrowsePeriod)
    if (tab === 'upload') return
    if (tab !== locked) {
      setTab(locked)
      setReportView(locked)
    }
    if (activeReportScope !== locked) setActiveReportScope(locked)
  }, [usesRegisterBrowse, pickedBrowsePeriod, tab, activeReportScope])

  const openRegisterFromHistory = useCallback(
    async (upload: GroupedRecentUpload) => {
      const openedBase = openedRegisterFromUpload(upload)
      const view = openedBase.reportType
      setReportView(view)
      if (usesRegisterBrowse) {
        setActiveReportScope('all')
      } else {
        setActiveReportScope(view)
      }
      if (isUploadCompanyCode(openedBase.company)) {
        setWorkspacePeriod({
          year: openedBase.reportYear,
          month: openedBase.reportMonth,
          company: openedBase.company,
        })
      } else {
        setWorkspacePeriod({ year: openedBase.reportYear, month: openedBase.reportMonth })
      }
      setLoading(true)
      setError(null)
      setSearchInput('')
      setSearch('')
      setFilter('all')
      try {
        const snap = await loadSavedMonth(
          openedBase.reportYear,
          openedBase.reportMonth,
          openedBase.company === '' ? DEFAULT_UPLOAD_COMPANY : openedBase.company,
        )
        const opened = openedRegisterFromParts(
          {
            fileName: openedBase.fileName,
            reportType: openedBase.reportType,
            reportYear: openedBase.reportYear,
            reportMonth: openedBase.reportMonth,
            company: openedBase.company,
            reportDay: openedBase.reportDay ?? null,
            reportDateIso: openedBase.reportDateIso ?? null,
            weekStartIso: openedBase.weekStartIso ?? null,
            weekEndIso: openedBase.weekEndIso ?? null,
          },
          snap.daily ?? [],
          snap.weekly ?? [],
        )
        setOpenedRegister(opened)
        const list = applySavedSnapshot(snap)
        setActiveCompanyCode(openedBase.company === '' ? DEFAULT_UPLOAD_COMPANY : openedBase.company)
        setLastRaw(lastRawForOpenedRegister(opened, snap.daily ?? [], snap.weekly ?? []))
        if (list.length === 0) {
          toastSuccess(`No saved data for ${opened.fileName}. Process the file first.`)
          if (!registerOnly) {
            setTab('upload')
          }
          return
        }
        setTab(view)
      } catch (e) {
        if (axios.isAxiosError(e)) {
          const msg =
            typeof e.response?.data === 'string'
              ? e.response.data
              : (e.response?.data as { message?: string })?.message
          setError(msg || e.message || 'Could not open register')
        } else {
          setError(e instanceof Error ? e.message : 'Could not open register')
        }
      } finally {
        setLoading(false)
      }
    },
    [applySavedSnapshot, registerOnly, setWorkspacePeriod],
  )

  const openBrowsePeriod = useCallback(
    async (period: AttendanceBrowsePeriod) => {
      const view = browseViewForPeriod(period)
      const opened = openedRegisterFromBrowsePeriod(period, companyCode)
      setPickedBrowsePeriod(period)
      setReportView(view)
      setActiveReportScope(view)
      setOpenedRegister(opened)
      if (isUploadCompanyCode(opened.company)) {
        setWorkspacePeriod({
          year: opened.reportYear,
          month: opened.reportMonth,
          company: opened.company,
        })
      } else {
        setWorkspacePeriod({ year: opened.reportYear, month: opened.reportMonth })
      }
      setLoading(true)
      setError(null)
      setSearchInput('')
      setSearch('')
      setFilter('all')
      try {
        const apiCompany = opened.company === '' ? DEFAULT_UPLOAD_COMPANY : opened.company
        const snap = await loadSavedMonth(opened.reportYear, opened.reportMonth, apiCompany)
        const list = applySavedSnapshot(snap)
        setActiveCompanyCode(apiCompany)
        setLastRaw(lastRawForOpenedRegister(opened, snap.daily ?? [], snap.weekly ?? []))
        if (list.length === 0) {
          toastSuccess('No saved attendance for this period yet.')
          setPickedBrowsePeriod(null)
          setOpenedRegister(null)
          return
        }
        setTab(view)
      } catch (e) {
        setPickedBrowsePeriod(null)
        setOpenedRegister(null)
        if (axios.isAxiosError(e)) {
          const msg =
            typeof e.response?.data === 'string'
              ? e.response.data
              : (e.response?.data as { message?: string })?.message
          setError(msg || e.message || 'Could not load attendance')
        } else {
          setError(e instanceof Error ? e.message : 'Could not load attendance')
        }
      } finally {
        setLoading(false)
      }
    },
    [applySavedSnapshot, companyCode, setWorkspacePeriod],
  )

  const selectBrowsePeriod = useCallback(
    (period: AttendanceBrowsePeriod) => {
      void openBrowsePeriod(period)
    },
    [openBrowsePeriod],
  )

  useEffect(() => {
    if (registerOnly || !hrUploadOnly) return
    if (!isAttendanceOpenIntent(location.state)) return
    navigate('/attendance-detail', { replace: true, state: location.state })
  }, [registerOnly, hrUploadOnly, location.state, navigate])

  useEffect(() => {
    if (registerOnly) return
    if (hrUploadOnly) return
    if (!isAttendanceOpenIntent(location.state)) return
    const intent = location.state
    const intentKey = JSON.stringify(intent)
    if (handledOpenIntentRef.current === intentKey) return
    handledOpenIntentRef.current = intentKey
    navigate(location.pathname, { replace: true, state: null })
    if (intent.kind === 'period') {
      void loadSavedPeriod(intent.year, intent.month, intent.company, {
        preferredView: intent.preferredView,
        openIntent: intent,
      })
      return
    }
    void openRegisterFromHistory(intent.upload)
  }, [
    registerOnly,
    hrUploadOnly,
    location.pathname,
    location.state,
    navigate,
    loadSavedPeriod,
    openRegisterFromHistory,
  ])

  useEffect(() => {
    if (!initialOpenIntent) return
    const intentKey = JSON.stringify(initialOpenIntent)
    if (handledOpenIntentRef.current === intentKey) return
    handledOpenIntentRef.current = intentKey
    if (initialOpenIntent.kind === 'period') {
      void loadSavedPeriod(
        initialOpenIntent.year,
        initialOpenIntent.month,
        initialOpenIntent.company,
        {
          preferredView: initialOpenIntent.preferredView,
          openIntent: initialOpenIntent,
        },
      )
      return
    }
    void openRegisterFromHistory(initialOpenIntent.upload)
  }, [initialOpenIntent, loadSavedPeriod, openRegisterFromHistory])

  const onBulkWeeklyStatusChange = useCallback(
    async (ids: number[], status: 'approved' | 'rejected') => {
      if (ids.length === 0) return
      setError(null)
      const results = await Promise.allSettled(
        ids.map((id) => setWeeklyAttendanceStatus(id, status, 'dashboard')),
      )
      const ok = results.filter((r) => r.status === 'fulfilled').length
      const fail = ids.length - ok
      try {
        await refreshSavedMonth(
          reportYear,
          reportMonth,
          activeCompanyCode ?? companyCode,
        )
      } catch (e) {
        const msg = axios.isAxiosError(e)
          ? ((e.response?.data as { message?: string })?.message ?? e.message)
          : e instanceof Error
            ? e.message
            : 'Could not refresh attendance'
        setError(msg)
        throw e
      }
      if (fail === 0) {
        const verb = status === 'approved' ? 'approved' : 'rejected'
        toastSuccess(`${ok} week${ok === 1 ? '' : 's'} ${verb}.`)
      } else {
        setError(`${fail} of ${ids.length} could not be updated. ${ok} succeeded.`)
      }
    },
    [refreshSavedMonth, reportYear, reportMonth, activeCompanyCode, companyCode],
  )

  const refreshAfterInlineEdit = useCallback(async () => {
    const company = activeCompanyCode ?? companyCode
    if (!isUploadCompanySelection(company)) return
    setError(null)
    try {
      if (usesRegisterBrowse && openedRegister) {
        const apiCompany = activeCompanyCode ?? company
        const snap = await loadSavedMonth(reportYear, reportMonth, apiCompany)
        applySavedSnapshot(snap)
        setLastRaw(lastRawForOpenedRegister(openedRegister, snap.daily ?? [], snap.weekly ?? []))
      } else {
        await refreshSavedMonth(reportYear, reportMonth, company)
      }
      toastSuccess('Changes saved.')
    } catch (e) {
      const msg = axios.isAxiosError(e)
        ? ((e.response?.data as { message?: string })?.message ?? e.message)
        : e instanceof Error
          ? e.message
          : 'Save failed'
      setError(msg)
      throw e
    }
  }, [
    refreshSavedMonth,
    reportYear,
    reportMonth,
    activeCompanyCode,
    companyCode,
    usesRegisterBrowse,
    openedRegister,
    applySavedSnapshot,
  ])

  const downloadDailyExcelWithReasons = useCallback(() => {
    if (employees.length === 0 && dailyRecords.length === 0) return
    downloadDailyViewAsXlsx(
      dailyRecords,
      employees,
      dailyViewCalendarDay,
      reportYear,
      reportMonth,
    )
    toastSuccess(`Daily Excel (day ${dailyViewCalendarDay}) downloaded from saved records.`)
  }, [dailyRecords, employees, dailyViewCalendarDay, reportYear, reportMonth])

  const downloadAbsenceReportExcel = useCallback(() => {
    if (employees.length === 0 && dailyRecords.length === 0) return
    const dayNum = dailyViewCalendarDay
    const dayLabel = formatDisplayDate(isoFromYmd(reportYear, reportMonth, dayNum))
    const n = downloadAbsenceReportAsXlsx(
      dailyRecords,
      employees,
      dayNum,
      reportYear,
      reportMonth,
    )
    if (n === 0) {
      toastSuccess(`No absent rows found for ${dayLabel}.`)
      return
    }
    toastSuccess(`Absence report (${dayLabel}) downloaded as Excel - ${n} row${n === 1 ? '' : 's'}.`)
  }, [dailyRecords, employees, dailyViewCalendarDay, reportYear, reportMonth])

  const downloadTeamPresenceExcel = useCallback(() => {
    if (employees.length === 0 && dailyRecords.length === 0) return
    const ok = downloadTeamPresenceSummaryAsXlsx(
      dailyRecords,
      filteredEmployees,
      dailyViewCalendarDay,
      reportYear,
      reportMonth,
      dailyDateLabelOverride,
    )
    if (ok) {
      toastSuccess(`Team presence Excel (day ${dailyViewCalendarDay}) downloaded.`)
    } else {
      toastSuccess('No team presence data for this day.')
    }
  }, [
    dailyRecords,
    employees.length,
    filteredEmployees,
    dailyViewCalendarDay,
    reportYear,
    reportMonth,
    dailyDateLabelOverride,
  ])

  const showDailyTeamPresence = viewMode !== 'self'
  const showTeamBifurcation = viewMode !== 'self'
  const simpleExcelExport = viewMode !== 'full'

  const showRegisterSearchToolbar =
    !registerOnly && tab !== 'upload' && viewMode !== 'self' && hasData

  const attendanceModeNav =
    hrUploadOnly
      ? null
      : !registerOnly && (allowEdit || hasData || viewMode !== 'full')
      ? allowEdit && activeReportScope === 'all'
        ? (
            <div className="seg shrink-0" role="tablist" aria-label="Attendance views">
              {uploadTabBtn()}
              {viewTabBtn('daily', reviewTabLabels.daily)}
              {viewTabBtn('weekly', reviewTabLabels.weekly)}
              {viewTabBtn('monthly', reviewTabLabels.monthly)}
            </div>
          )
        : allowedViews.length > 1
          ? (
              <div className="seg shrink-0" role="tablist" aria-label="Register view">
                {allowedViews.includes('daily') ? viewTabBtn('daily', reviewTabLabels.daily) : null}
                {allowedViews.includes('weekly') ? viewTabBtn('weekly', reviewTabLabels.weekly) : null}
                {allowedViews.includes('monthly') ? viewTabBtn('monthly', reviewTabLabels.monthly) : null}
              </div>
            )
          : (
              <span className="shrink-0 rounded-full bg-[var(--color-brand-muted)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-brand)]">
                {activeReportScope === 'daily'
                  ? 'Daily register'
                  : activeReportScope === 'weekly'
                    ? 'Weekly register'
                    : 'Monthly register'}
              </span>
            )
      : null

  const showHistoryBack = Boolean(onBackToBrowse) && (hasData || loading)

  const registerBody = (
    <>
          {!usesRegisterBrowse && !allowEdit ? (
            <div className="reports-toolbar card border max-w-md">
              <div className="reports-period">
                <button
                  type="button"
                  className="btn-ghost"
                  aria-label="Previous month"
                  disabled={loading}
                  onClick={() => {
                    const next = shiftMonth(reportYear, reportMonth, -1)
                    void loadSavedPeriod(next.year, next.month, companyCode)
                  }}
                >
                  ←
                </button>
                <span className="reports-period-label">
                  {MONTHS[reportMonth - 1] ?? 'Month'} {reportYear}
                </span>
                <button
                  type="button"
                  className="btn-ghost"
                  aria-label="Next month"
                  disabled={loading}
                  onClick={() => {
                    const next = shiftMonth(reportYear, reportMonth, 1)
                    void loadSavedPeriod(next.year, next.month, companyCode)
                  }}
                >
                  →
                </button>
              </div>
            </div>
          ) : !usesRegisterBrowse ? (
            <div className="reports-toolbar card border max-w-xl">
              <div className="reports-period flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  aria-label="Previous month"
                  disabled={loading}
                  onClick={() => {
                    const next = shiftMonth(reportYear, reportMonth, -1)
                    void loadSavedPeriod(next.year, next.month, companyCode)
                  }}
                >
                  ←
                </button>
                <span className="reports-period-label">
                  {MONTHS[reportMonth - 1] ?? 'Month'} {reportYear}
                </span>
                <button
                  type="button"
                  className="btn-ghost"
                  aria-label="Next month"
                  disabled={loading}
                  onClick={() => {
                    const next = shiftMonth(reportYear, reportMonth, 1)
                    void loadSavedPeriod(next.year, next.month, companyCode)
                  }}
                >
                  →
                </button>
                <label className="dashboard-company-select ml-1">
                  <select
                    className="field field-compact"
                    value={companyCode}
                    disabled={loading}
                    aria-label="Company"
                    onChange={(e) => {
                      const next = e.target.value as UploadCompanyCode
                      void loadSavedPeriod(reportYear, reportMonth, next)
                    }}
                  >
                    {UPLOAD_COMPANY_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ) : null}
    </>
  )

  return (
    <AppShell active={shellActive}>
      <main className="app-page">
        <header className="page-header">
          {registerOnly ? (
            <>
              <p className="page-kicker">Time & attendance</p>
              <h1 className="page-title">Attendance history</h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-warm-text)]">
                Viewing a saved register. Use back to return to history &amp; saved months.
              </p>
            </>
          ) : (
            <>
              <p className="page-kicker">Time & attendance</p>
              <h1 className="page-title">{attendanceTitle}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-warm-text)]">
                {attendanceIntro}
              </p>
              {hrUploadOnly ? (
                <p className="mt-3 text-sm">
                  <Link to="/attendance-detail" className="font-medium text-[var(--color-brand)]">
                    Attendance history - review daily, weekly, or monthly →
                  </Link>
                </p>
              ) : allowEdit && !registerOnly && tab !== 'upload' ? (
                <p className="mt-3 text-sm">
                  <Link to="/attendance-detail" className="font-medium text-[var(--color-brand)]">
                    History &amp; saved months →
                  </Link>
                </p>
              ) : null}
            </>
          )}
          {allowEdit && !registerOnly && !hrUploadOnly ? (
            <div className="mt-4">
              <AttendanceOnboardingStrip
                visible
                onGoUpload={goToUploadTab}
                onGoReview={() => goToRegisterTab('monthly')}
                onGoMonthly={() => goToRegisterTab('monthly')}
              />
            </div>
          ) : null}
          {attendanceModeNav && tab !== 'upload' ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {attendanceModeNav}
              {usesRegisterBrowse && pickedBrowsePeriod ? (
                <button
                  type="button"
                  className="btn-ghost shrink-0 text-sm"
                  onClick={clearBrowseSelection}
                >
                  ← Change period
                </button>
              ) : null}
              {allowEdit && activeReportScope === 'all' ? (
                <button
                  type="button"
                  onClick={goToUploadForNewFile}
                  className="btn-ghost shrink-0 text-sm"
                >
                  New upload
                </button>
              ) : null}
            </div>
          ) : null}
          {showHistoryBack ? (
            <div className="mt-4">
              <button type="button" className="btn-ghost text-sm" onClick={returnToHistoryBrowse}>
                {backToBrowseLabel}
              </button>
            </div>
          ) : null}
          {!registerOnly && (!usesRegisterBrowse || pickedBrowsePeriod) && tab !== 'upload'
            ? registerBody
            : null}
        </header>

        <div className="page-body">
          <div className="min-w-0">
          {viewMode === 'self' && !registerOnly && employeeProfileLinked === false ? (
            <AccountLinkBanner
              variant="employee"
              loginEmail={user?.email}
              className="mb-4 rounded-xl"
            />
          ) : null}
          {!registerOnly ? null : registerBody}
          {usesRegisterBrowse &&
          !pickedBrowsePeriod &&
          (tab === 'daily' || tab === 'weekly' || tab === 'monthly') ? (
            <div className="mb-4">
              <AttendancePeriodPicker
                reportType={tab}
                emptyHint={
                  viewMode === 'self'
                    ? 'No processed registers for this view yet. Ask HR to upload daily, weekly, or monthly files that include you.'
                    : 'No processed registers for this view yet. They appear after HR uploads files that include your direct reports.'
                }
                onSelect={selectBrowsePeriod}
              />
            </div>
          ) : null}
          {usesRegisterBrowse && pickedBrowsePeriod && hasData && tab !== 'upload' ? (
            <div className="browse-context-bar card mb-4 border px-4 py-2.5">
              <p className="text-sm text-[var(--color-ink)]">
                <span className="text-[var(--color-warm-text)]">Showing </span>
                {browsePeriodSummaryLabel(pickedBrowsePeriod)}
              </p>
              <button type="button" className="btn-ghost shrink-0 text-sm" onClick={clearBrowseSelection}>
                Change period
              </button>
            </div>
          ) : null}
          {!hasData && error ? (
            <div className="mb-4 space-y-2">
              {error ? <p className="alert-error">{error}</p> : null}
            </div>
          ) : null}
          {showRegisterSearchToolbar ? (
            <div className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
              <input
                type="search"
                aria-label="Search by name or employee code"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applySearch()
                }}
                placeholder="Name or code"
                className="field min-h-[2.625rem] min-w-0 flex-1 sm:min-w-[12rem] sm:max-w-md"
              />
              <button type="button" onClick={applySearch} className="btn-primary shrink-0">
                Find
              </button>
              <label className="flex shrink-0 items-center gap-2 text-sm text-[var(--color-warm-text)]">
                <span className="text-xs font-medium text-[color-mix(in_srgb,var(--color-ink)_50%,transparent)]">
                  Filter
                </span>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as AttendanceFilter)}
                  className="field min-h-[2.625rem] w-auto"
                >
                  <option value="all">All</option>
                  <option value="present">Has present</option>
                  <option value="absent">Has absent</option>
                </select>
              </label>
              {(viewMode === 'full' || viewMode === 'team') && teams.length > 0 ? (
                <label className="flex shrink-0 items-center gap-2 text-sm text-[var(--color-warm-text)]">
                  <span className="text-xs font-medium text-[color-mix(in_srgb,var(--color-ink)_50%,transparent)]">
                    Team
                  </span>
                  <select
                    value={teamFilter === 'all' ? 'all' : String(teamFilter)}
                    onChange={(e) => {
                      const value = e.target.value
                      setTeamFilter(value === 'all' ? 'all' : Number.parseInt(value, 10))
                    }}
                    className="field min-h-[2.625rem] w-auto max-w-[14rem]"
                  >
                    <option value="all">All teams</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}
          {allowEdit && !registerOnly && tab !== 'upload' && !hasData && !loading && !usesRegisterBrowse ? (
            <div className="card border mb-4 p-6 text-center sm:p-8">
              <p className="text-sm font-medium text-[var(--color-ink)]">No register loaded for this period</p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-warm-text)]">
                Use the Upload tab to process a file, or change month above. Daily, weekly, and monthly tables
                appear here once data is loaded.
              </p>
              <button type="button" className="btn-primary mt-5 inline-flex" onClick={goToUploadTab}>
                Go to upload
              </button>
            </div>
          ) : null}
          {usesRegisterBrowse && loading && pickedBrowsePeriod ? (
            <p className="mb-4 text-sm text-[var(--color-warm-text)]">Opening register…</p>
          ) : null}
          {hasData && tab !== 'upload' && error ? (
            <div className="mb-4 space-y-2">
              {error ? <p className="alert-error">{error}</p> : null}
            </div>
          ) : null}
          {allowEdit && !registerOnly && tab === 'upload' && (
            <div className="space-y-4">
              <UploadComponent
                reportView={reportView}
                onReportViewChange={setReportView}
                selectedFile={file}
                onFileSelect={setFile}
                leaveFile={leaveFile}
                wfhFile={wfhFile}
                onLeaveFileSelect={setLeaveFile}
                onWfhFileSelect={setWfhFile}
                onProcess={process}
                loading={loading}
                error={error}
                canUpload={allowEdit}
              />
            </div>
          )}

          {tab === 'daily' &&
            !hrUploadOnly &&
            hasData &&
            allowedViews.includes('daily') &&
            (!usesRegisterBrowse || pickedBrowsePeriod) && (
            <div
              className={
                usesRegisterBrowse && pickedBrowsePeriod
                  ? 'browse-attendance-scroll space-y-3 pr-1'
                  : 'space-y-3'
              }
            >
              {viewMode === 'full' ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={downloadTeamPresenceExcel}
                    disabled={employees.length === 0}
                    className="btn-secondary disabled:opacity-50"
                  >
                    Download team presence Excel
                  </button>
                  <button
                    type="button"
                    onClick={downloadAbsenceReportExcel}
                    disabled={employees.length === 0}
                    className="btn-secondary disabled:opacity-50"
                  >
                    Download absence Excel
                  </button>
                  <button
                    type="button"
                    onClick={downloadDailyExcelWithReasons}
                    disabled={employees.length === 0}
                    className="btn-primary disabled:opacity-50"
                  >
                    Download daily Excel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={downloadDailyExcelWithReasons}
                    disabled={employees.length === 0}
                    className="btn-primary disabled:opacity-50"
                  >
                    Download Excel
                  </button>
                </div>
              )}
              {showDailyTeamPresence ? (
                <DailyTeamPresenceSection
                  employees={filteredEmployees}
                  dailyRecords={dailyRecords}
                  reportYear={reportYear}
                  reportMonth={reportMonth}
                  calendarDay={dailyViewCalendarDay}
                  dateLabelOverride={dailyDateLabelOverride}
                />
              ) : null}
              <DailyTable
                employees={filteredEmployees}
                dailyRecords={dailyRecords}
                weeklyRecords={weeklyRecords}
                search={search}
                filter={filter}
                reportYear={reportYear}
                reportMonth={reportMonth}
                calendarDay={dailyViewCalendarDay}
                dateLabelOverride={dailyDateLabelOverride}
                dailyColumnHint={dailyColumnHint}
                notificationStatus={notificationStatus}
                onBulkWeeklyAction={allowEdit ? onBulkWeeklyStatusChange : undefined}
                allowEdit={allowEdit}
                onSaved={refreshAfterInlineEdit}
                onSaveError={setError}
                groupByTeam={showTeamBifurcation}
              />
            </div>
          )}

          {tab === 'weekly' &&
            !hrUploadOnly &&
            hasData &&
            allowedViews.includes('weekly') &&
            (!usesRegisterBrowse || pickedBrowsePeriod) && (
            <div
              className={
                usesRegisterBrowse && pickedBrowsePeriod
                  ? 'browse-attendance-scroll space-y-4 pr-1'
                  : 'space-y-6'
              }
            >
              <WeeklyAttendanceTable
                employees={filteredEmployees}
                weeklyRecords={weeklyRecords}
                search={search}
                filter={filter}
                reportYear={reportYear}
                reportMonth={reportMonth}
                policyCompany={policyCompany}
                notificationStatus={notificationStatus}
                onBulkWeeklyAction={allowEdit ? onBulkWeeklyStatusChange : undefined}
                allowEdit={allowEdit}
                showTeamSummary={false}
                groupByTeam={showTeamBifurcation}
                companyHolidays={companyHolidays}
                pinnedWeekStart={browsePinnedWeekStart}
                lockWeekPicker={Boolean(browsePinnedWeekStart)}
              />
              {!(usesRegisterBrowse && pickedBrowsePeriod) ? (
              <WeeklyTable
                employees={filteredEmployees}
                search={search}
                filter={filter}
                reportYear={reportYear}
                reportMonth={reportMonth}
                hoursRollupPresent={hoursRollupPresent}
                policyCompany={policyCompany}
                weeklyRecords={weeklyRecords}
                dailyRecords={dailyRecords}
                onBulkWeeklyAction={allowEdit ? onBulkWeeklyStatusChange : undefined}
                allowEdit={allowEdit}
                onSaved={refreshAfterInlineEdit}
                onSaveError={setError}
                groupByTeam={showTeamBifurcation}
                companyHolidays={companyHolidays}
                pinnedWeekStart={browsePinnedWeekStart}
                lockWeekPicker={Boolean(browsePinnedWeekStart)}
                simpleExcelExport={simpleExcelExport}
              />
              ) : null}
            </div>
          )}

          {tab === 'monthly' &&
            !hrUploadOnly &&
            hasData &&
            allowedViews.includes('monthly') &&
            (!usesRegisterBrowse || pickedBrowsePeriod) && (
            <div
              className={
                usesRegisterBrowse && pickedBrowsePeriod ? 'browse-attendance-scroll pr-1' : undefined
              }
            >
            <MonthlyTable
              employees={filteredEmployees}
              search={search}
              filter={filter}
              reportYear={reportYear}
              reportMonth={reportMonth}
              policyCompany={policyCompany}
              dailyRecords={dailyRecords}
              weeklyRecords={weeklyRecords}
              onBulkWeeklyAction={allowEdit ? onBulkWeeklyStatusChange : undefined}
              allowEdit={allowEdit}
              onSaved={refreshAfterInlineEdit}
              onSaveError={setError}
              showTeamSummary={false}
              groupByTeam={showTeamBifurcation}
              companyHolidays={companyHolidays}
              simpleExcelExport={simpleExcelExport}
            />
            </div>
          )}

          </div>
        </div>
      </main>
    </AppShell>
  )
}
