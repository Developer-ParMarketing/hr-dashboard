import { isPmPolicyCompany } from '../constants/companies'
import type {
  CompanyHolidayDay,
  DailyAttendanceRecord,
  NormalizedEmployee,
  RawEmployee,
  WeeklyAttendanceRecord,
} from '../types/attendance'

const DAYS = 31
const PAID_LEAVE_CREDIT_HOURS = 9

/** Late if first punch is after shift start + this many minutes (e.g. 9:00 shift → late after 9:15). */
export const LATE_GRACE_MINUTES = 15

export function absenceReasonStorageKey(
  employeeCode: string,
  employeeName: string,
  calendarDay: number,
): string {
  return `${employeeCode}\x1f${employeeName}\x1f${String(calendarDay)}`
}

export type DailyAttendanceDerived = {
  shift: string
  login: string
  isPresent: boolean
  isLate: boolean
  /** Late column: only "On time" when we can judge (times and/or API late flag). */
  lateLabel: 'Late' | 'On time' | '-'
  dayStatus: 'Present' | 'Absent'
}

/** Single-day row logic aligned with the Daily table (shift + grace for late). */
export function deriveDailyAttendanceForDay(
  emp: NormalizedEmployee,
  dayIndex: number,
  graceMinutes: number = LATE_GRACE_MINUTES,
): DailyAttendanceDerived {
  const cell = emp.days[dayIndex] ?? ''
  const shift = emp.shiftStart ?? '-'
  const fromRow = (emp.inTime ?? '').trim()
  const fromDay = (emp.dayInTimes[dayIndex] ?? '').trim()
  /** Daily view should show the ESSL row InTime directly when present. */
  const actualIn = fromRow || fromDay
  /** Only the InTime column is a real clock-in; do not infer login from P(09:30) worked-duration in the day cell. */
  const loginMinutes = actualIn ? extractLoginTimeMinutes(actualIn) : null
  const login =
    loginMinutes !== null
      ? formatMinutesAsClock(loginMinutes)
      : actualIn
        ? actualIn
        : '-'
  const tokenShowsPresent = isPresentToken(cell)
  /** Present if clock-in exists, WFH, or day cell shows P / P(9:30) etc. (daily PDFs often only have P(duration), no separate InTime column). */
  const isPresent =
    loginMinutes !== null ||
    isWfhToken(cell) ||
    tokenShowsPresent
  const apiLate = Boolean(emp.dayLateFlags[dayIndex])
  const computedLate =
    isPresent && actualIn
      ? isLateToken('P', emp.shiftStart, graceMinutes, actualIn)
      : false
  const isLate = apiLate || computedLate
  const hasShift = !!(emp.shiftStart && String(emp.shiftStart).trim())
  let lateLabel: 'Late' | 'On time' | '-'
  if (!isPresent) lateLabel = '-'
  else if (isLate) lateLabel = 'Late'
  else if (
    loginMinutes !== null ||
    hasShift ||
    apiLate ||
    tokenShowsPresent
  )
    lateLabel = 'On time'
  else lateLabel = '-'

  return {
    shift,
    login,
    isPresent,
    isLate,
    lateLabel,
    dayStatus: isPresent ? 'Present' : 'Absent',
  }
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function parseHours(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = String(v).replace(/,/g, '').trim()
  if (!s || s.toLowerCase() === 'nan') return null
  if (s.includes(':')) {
    const parts = s.split(':')
    const h = parseInt(parts[0], 10)
    const m = parseInt(parts[1] ?? '0', 10)
    if (Number.isFinite(h) && Number.isFinite(m)) return h + m / 60
    return null
  }
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function getDailyArray(raw: RawEmployee): string[] {
  const out: string[] = Array(DAYS).fill('')

  const daily = raw.daily ?? raw.attendance
  if (Array.isArray(daily)) {
    for (let i = 0; i < DAYS && i < daily.length; i++) {
      out[i] = toStr(daily[i])
    }
    return out
  }

  if (daily && typeof daily === 'object') {
    const obj = daily as Record<string, unknown>
    for (let d = 1; d <= DAYS; d++) {
      const keys = [`day${d}`, `Day${d}`, `D${d}`, String(d)]
      for (const k of keys) {
        if (k in obj) {
          out[d - 1] = toStr(obj[k])
          break
        }
      }
    }
    return out
  }

  if (Array.isArray(raw.days)) {
    for (let i = 0; i < DAYS && i < raw.days.length; i++) {
      out[i] = toStr(raw.days[i])
    }
    return out
  }

  for (let d = 1; d <= DAYS; d++) {
    const key = `day${d}` as keyof RawEmployee
    if (key in raw && raw[key] !== undefined) {
      out[d - 1] = toStr(raw[key])
    }
  }

  return out
}

function normHeaderKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function getDayInTimes(raw: RawEmployee): string[] {
  const out: string[] = Array(DAYS).fill('')
  const obj = raw as Record<string, unknown>
  for (let d = 1; d <= DAYS; d++) {
    const candidates = [
      `day${d}InTime`,
      `day${d}_in_time`,
      `day${d}_inTime`,
      `day${d}_in`,
      `loginD${d}`,
      `LOGIN D${d}`,
      `login${d}`,
      `Login${d}`,
      `in_time_day${d}`,
      `inTimeDay${d}`,
    ]
    for (const k of candidates) {
      if (k in obj) {
        out[d - 1] = toStr(obj[k])
        break
      }
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    const nk = normHeaderKey(k)
    const m = nk.match(/^logind(\d{1,2})$/)
    if (!m) continue
    const d = parseInt(m[1], 10)
    if (d < 1 || d > DAYS) continue
    if ((out[d - 1] ?? '').trim() !== '') continue
    const s = toStr(v)
    if (s) out[d - 1] = s
  }
  for (const [k, v] of Object.entries(obj)) {
    const nk = normHeaderKey(k)
    const m =
      nk.match(/^day(\d{1,2})intime$/) ||
      nk.match(/^day(\d{1,2})in$/) ||
      nk.match(/^d(\d{1,2})intime$/) ||
      nk.match(/^d(\d{1,2})in$/) ||
      nk.match(/^intime(\d{1,2})$/) ||
      nk.match(/^in(\d{1,2})$/) ||
      nk.match(/^login(\d{1,2})$/)
    if (!m) continue
    const d = parseInt(m[1], 10)
    if (d < 1 || d > DAYS) continue
    if ((out[d - 1] ?? '').trim() !== '') continue
    const s = toStr(v)
    if (s) out[d - 1] = s
  }
  return out
}

function getDayWorkedHours(raw: RawEmployee): (number | null)[] {
  const out: (number | null)[] = Array(DAYS).fill(null)
  const obj = raw as Record<string, unknown>
  for (let d = 1; d <= DAYS; d++) {
    const candidates = [
      `day${d}Hours`,
      `day${d}_hours`,
      `hours_d${d}`,
      `Hours D${d}`,
      `HOURS D${d}`,
      `workDurD${d}`,
    ]
    for (const ck of candidates) {
      if (!(ck in obj)) continue
      const v = obj[ck]
      if (v === undefined || v === null || String(v).trim() === '') continue
      const p = parseHours(v)
      if (p != null) out[d - 1] = p
      break
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    const nk = normHeaderKey(k)
    const m =
      nk.match(/^hoursd(\d{1,2})$/) ||
      nk.match(/^day(\d{1,2})hours$/) ||
      nk.match(/^workdurd(\d{1,2})$/) ||
      nk.match(/^workdur(\d{1,2})$/) ||
      nk.match(/^workdurationd(\d{1,2})$/) ||
      nk.match(/^durationd(\d{1,2})$/) ||
      nk.match(/^totalhoursd(\d{1,2})$/)
    if (!m) continue
    const d = parseInt(m[1], 10)
    if (d < 1 || d > DAYS) continue
    if (out[d - 1] != null) continue
    const p = parseHours(v)
    if (p != null) out[d - 1] = p
  }
  return out
}

function getDayWfhUnverified(raw: RawEmployee): boolean[] {
  const out: boolean[] = Array(DAYS).fill(false)
  const obj = raw as Record<string, unknown>
  for (let d = 1; d <= DAYS; d++) {
    const candidates = [
      `day${d}WfhUnverified`,
      `day${d}_wfh_unverified`,
      `day${d}WFHUnverified`,
      `day${d}_wfh_from_leave`,
    ]
    for (const ck of candidates) {
      if (!(ck in obj)) continue
      out[d - 1] = parseLateTruthy(obj[ck])
      break
    }
  }
  return out
}

function parseLateTruthy(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number' && Number.isFinite(v)) return v !== 0
  const s = String(v).trim().toLowerCase()
  if (!s || s === 'nan') return false
  return (
    s === '1' ||
    s === '1.0' ||
    s === 'true' ||
    s === 'yes' ||
    s === 'y' ||
    s === 'late' ||
    s === 'l'
  )
}

function getDayLateFlags(raw: RawEmployee): boolean[] {
  const out: boolean[] = Array(DAYS).fill(false)
  const obj = raw as Record<string, unknown>
  for (let d = 1; d <= DAYS; d++) {
    const candidates = [
      `day${d}IsLate`,
      `day${d}_is_late`,
      `day${d}_late`,
      `day${d}_late_mark`,
      `lateD${d}`,
      `LATE D${d}`,
    ]
    for (const k of candidates) {
      if (k in obj && obj[k] !== undefined) {
        out[d - 1] = parseLateTruthy(obj[k])
        break
      }
    }
  }
  for (const [k, v] of Object.entries(obj)) {
    const nk = normHeaderKey(k)
    const m = nk.match(/^lated(\d{1,2})$/)
    if (!m) continue
    const d = parseInt(m[1], 10)
    if (d < 1 || d > DAYS) continue
    if (out[d - 1]) continue
    out[d - 1] = parseLateTruthy(v)
  }
  return out
}

function getTotalLateDays(raw: RawEmployee): number | null {
  const obj = raw as Record<string, unknown>
  const v = obj.totalLateDays ?? obj.total_late_days
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v))
  const n = Number.parseFloat(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null
}

export function normalizeEmployee(raw: RawEmployee): NormalizedEmployee {
  const obj = raw as Record<string, unknown>
  const employeeCode = toStr(
    raw.employeeCode ?? raw.empCode ?? raw.code ?? '',
  )
  const employeeName = toStr(
    raw.employeeName ?? raw.empName ?? raw.name ?? 'Unknown',
  )
  const department = raw.department ?? raw.dept
  const shiftFromUnknownKey = Object.entries(obj).find(([k, v]) => {
    if (v == null || String(v).trim() === '') return false
    const key = k.toLowerCase().replace(/[^a-z0-9]/g, '')
    return (
      key === 'sintime' ||
      key === 'shiftintime' ||
      key === 'shiftstarttime' ||
      key === 'shiftstart' ||
      key === 'shift' ||
      key === 'shifttime' ||
      key === 'expectedin' ||
      key === 'dutyfrom' ||
      key === 'schin' ||
      key === 'scheduledin' ||
      key === 'starttime' ||
      key === 'dutyin'
    )
  })?.[1]
  const shiftStart = toStr(
    raw.shiftStart ??
      raw.shift_start ??
      raw.shiftTime ??
      raw.shift_time ??
      raw.dutyStart ??
      raw.duty_start ??
      raw.shift ??
      obj['S.InTime'] ??
      obj['S. InTime'] ??
      obj['S.In Time'] ??
      obj['S InTime'] ??
      obj['Shift In Time'] ??
      shiftFromUnknownKey ??
      '',
  )
  const rowInTime = toStr(
    raw.inTime ??
      raw.in_time ??
      obj['InTime'] ??
      obj['A.InTime'] ??
      obj['A. InTime'] ??
      obj['IN TIME'] ??
      '',
  )
  const days = getDailyArray(raw)
  const dayInTimes = getDayInTimes(raw)
  const dayLateFlags = getDayLateFlags(raw)
  const dayWorkedHours = getDayWorkedHours(raw)
  const totalLateDays = getTotalLateDays(raw)
  const dayWfhUnverified = getDayWfhUnverified(raw)
  const rawId = obj.id
  const id =
    typeof rawId === 'number' && Number.isFinite(rawId) ? rawId : undefined
  const teamIdRaw = raw.teamId ?? raw.team_id
  const teamId =
    typeof teamIdRaw === 'number' && Number.isFinite(teamIdRaw) ? teamIdRaw : null
  const teamName = toStr(raw.teamName ?? raw.team_name ?? '')
  const teamSortRaw = raw.teamSortOrder ?? raw.team_sort_order
  const teamSortOrder =
    typeof teamSortRaw === 'number' && Number.isFinite(teamSortRaw) ? teamSortRaw : undefined
  const teamManagerName = toStr(raw.teamManagerName ?? raw.team_manager_name ?? '')

  return {
    ...(id != null ? { id } : {}),
    employeeCode,
    employeeName,
    department: department ? toStr(department) : undefined,
    teamId,
    teamName: teamName || undefined,
    teamSortOrder,
    teamManagerName: teamManagerName || undefined,
    shiftStart: shiftStart || undefined,
    inTime: rowInTime || undefined,
    days,
    dayInTimes,
    dayLateFlags,
    dayWorkedHours,
    dayWfhUnverified,
    totalLateDays,
    week1: parseHours(raw.week1),
    week2: parseHours(raw.week2),
    week3: parseHours(raw.week3),
    week4: parseHours(raw.week4),
    week5: parseHours(raw.week5),
    week1Deficit: parseHours(raw.week1Deficit ?? raw.week1_deficit),
    week2Deficit: parseHours(raw.week2Deficit ?? raw.week2_deficit),
    week3Deficit: parseHours(raw.week3Deficit ?? raw.week3_deficit),
    week4Deficit: parseHours(raw.week4Deficit ?? raw.week4_deficit),
    week5Deficit: parseHours(raw.week5Deficit ?? raw.week5_deficit),
    totalHours: parseHours(
      raw.totalHours ?? raw.totalMonthlyHours ?? raw.monthlyHours,
    ),
    deficitHours: parseHours(
      raw.deficitHours ?? raw.monthly_deficit_hours ?? raw.deficit_hours ?? raw.deficit,
    ),
  }
}

export function extractEmployees(
  payload: Record<string, unknown>,
): RawEmployee[] {
  const list =
    payload.employees ?? payload.data ?? payload.results ?? payload.items
  if (Array.isArray(list)) return list as RawEmployee[]
  return []
}

export function isPresentToken(token: string): boolean {
  const t = token.trim().toUpperCase()
  if (!t || t === 'AB' || t === 'WO' || t === 'DA') return false
  if (t === 'SL' || t === 'PL' || t === 'CL') return false
  if (t === 'WFH' || t.startsWith('WFH(')) return false
  return t === 'P' || t.startsWith('P(')
}

export function isAbsentToken(token: string): boolean {
  return token.trim().toUpperCase() === 'AB'
}

/** Weekly off in ESSL (WO) or Computex day-off (DA) */
export function isWeeklyOffToken(token: string): boolean {
  const u = token.trim().toUpperCase()
  return u === 'WO' || u === 'DA'
}

export function normalizeDisplayMarkToken(token: string): string {
  const t = token.trim()
  if (!t) return ''
  if (t.toUpperCase() === 'DA') return 'WO'
  return t
}

function isWfhToken(token: string): boolean {
  const u = token.trim().toUpperCase()
  return u === 'WFH' || u.startsWith('WFH(')
}

function isPaidLeaveToken(token: string): boolean {
  const u = token.trim().toUpperCase()
  return u === 'SL' || u === 'PL' || u === 'CL'
}

function isGenericLeaveMark(token: string): boolean {
  return token.trim().toLowerCase() === 'leave'
}

/** Prefer SL / PL / CL from stored or raw import token when status is leave. */
function paidLeaveTokenFromDailyRow(row: DailyAttendanceRecord): string {
  for (const src of [row.statusToken, row.rawStatusToken]) {
    const t = normalizeDisplayMarkToken((src ?? '').trim())
    if (isPaidLeaveToken(t)) return t.toUpperCase()
  }
  return ''
}

function compactMarkFromLabel(label: string): string {
  if (!label || label === '-') return '-'
  const u = label.trim().toUpperCase()
  if (u.startsWith('WFH(')) return 'WFH'
  if (u.startsWith('P(')) return 'P'
  if (isPaidLeaveToken(label)) return u
  return label
}

function isCreditedLeaveToken(token: string): boolean {
  const u = token.trim().toUpperCase()
  return u === 'DA' || isPaidLeaveToken(u)
}

function isMeaningfulDayToken(token: string): boolean {
  const t = token.trim().toUpperCase()
  if (!t) return false
  return !(t === '-' || t === 'NA' || t === 'N/A')
}

/** Zebra strip for table body rows (odd / even) - pass to every cell so sticky columns match */
export function tableRowStripBg(rowIndex: number): string {
  return rowIndex % 2 === 0
    ? 'bg-[var(--color-surface)]'
    : 'bg-[color-mix(in_srgb,var(--color-warm-page)_45%,#fff)]'
}

export function cellClass(token: string, rowStripBg?: string, wfhUnverified: boolean = false): string {
  const surface = rowStripBg ?? 'bg-[var(--color-surface)]'
  const t = token.trim()
  const u = t.toUpperCase()
  if (!t) return `${surface} text-[color-mix(in_srgb,var(--color-ink)_38%,transparent)]`
  if (isPresentToken(t)) return 'bg-emerald-50 text-emerald-800 font-medium'
  if (isAbsentToken(t)) return 'bg-red-50 text-red-800 font-medium'
  if (isWeeklyOffToken(t)) return 'bg-[color-mix(in_srgb,var(--color-warm-muted)_65%,#fff)] text-[var(--color-warm-text)]'
  if (u.includes('HD') && isWfhToken(t))
    return wfhUnverified
      ? 'bg-[color-mix(in_srgb,#f59e0b_18%,#fff)] text-amber-900 font-medium ring-1 ring-amber-300/70'
      : 'bg-amber-100 text-amber-900 font-medium'
  if (isWfhToken(t))
    return wfhUnverified
      ? 'bg-[color-mix(in_srgb,#f59e0b_12%,#fff)] text-amber-900 font-medium ring-1 ring-amber-300/70'
      : 'bg-sky-50 text-sky-800 font-medium'
  if (isPaidLeaveToken(t)) return 'bg-violet-50 text-violet-800 font-medium'
  return `${surface} text-[var(--color-warm-text)]`
}

export function parseClockTimeToMinutes(value: string): number | null {
  const v = value.trim().replace(/\./g, ':')
  if (!v) return null
  const hourOnly = v.match(/^(\d{1,2})(?:\s*([AP]M))?$/i)
  if (hourOnly) {
    let h = Number(hourOnly[1])
    const mer = (hourOnly[2] ?? '').toUpperCase()
    if (!Number.isFinite(h)) return null
    if (mer) {
      if (h < 1 || h > 12) return null
      if (mer === 'AM') {
        if (h === 12) h = 0
      } else if (h !== 12) {
        h += 12
      }
    }
    if (h < 0 || h > 23) return null
    return h * 60
  }

  const m = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?$/i)
  if (!m) return null
  let h = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mm) || mm < 0 || mm > 59) return null
  const meridian = (m[4] ?? '').toUpperCase()
  if (meridian) {
    if (h < 1 || h > 12) return null
    if (meridian === 'AM') {
      if (h === 12) h = 0
    } else if (h !== 12) {
      h += 12
    }
  }
  if (h < 0 || h > 23) return null
  return h * 60 + mm
}

export function extractLoginTimeMinutes(token: string): number | null {
  const t = token.trim()
  if (!t) return null
  const re = /(\d{1,2}):(\d{2})(?:\s*([AP]M))?/gi
  const match = re.exec(t)
  if (!match) return null
  return parseClockTimeToMinutes(
    `${match[1]}:${match[2]}${match[3] ? ` ${match[3]}` : ''}`,
  )
}

export function formatMinutesAsClock(minutes: number | null): string {
  if (minutes === null) return '-'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function isLateToken(
  token: string,
  shiftStart: string | null | undefined,
  graceMinutes: number,
  actualInTime?: string | null,
): boolean {
  if (!isPresentToken(token)) return false
  const login = parseClockTimeToMinutes((actualInTime ?? '').trim())
  const shift = parseClockTimeToMinutes(shiftStart ?? '')
  if (login === null || shift === null) return false
  return login > shift + Math.max(0, graceMinutes)
}

export function extractWorkedHours(token: string): number | null {
  const t = token.trim()
  if (!t) return null

  /** Duration token: P(09:30) / WFH(09:30) = 9h30 worked. */
  const pDur = t.match(/^(?:P|WFH)\((\d{1,2}):(\d{2})(?::\d{2})?\)$/i)
  if (pDur) {
    const h = parseInt(pDur[1], 10)
    const mm = parseInt(pDur[2], 10)
    if (Number.isFinite(h) && Number.isFinite(mm)) return h + mm / 60
  }

  const hoursLabel = t.match(/(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\b/i)
  if (hoursLabel) {
    const n = Number(hoursLabel[1])
    return Number.isFinite(n) ? n : null
  }

  const allTimes = Array.from(
    t.matchAll(/(\d{1,2}):(\d{2})(?:\s*([AP]M))?/gi),
  ).map((m) =>
    parseClockTimeToMinutes(`${m[1]}:${m[2]}${m[3] ? ` ${m[3]}` : ''}`),
  )
  if (allTimes.length >= 2 && allTimes[0] != null && allTimes[1] != null) {
    const start = allTimes[0]
    const end = allTimes[1]
    if (start !== null && end !== null && end >= start) {
      return (end - start) / 60
    }
  }

  return null
}

/**
 * Convert sheet “work duration” as decimal hours (e.g. 9.5) to H:MM (e.g. 9:30).
 * 9.30 as a float is 9h18m; typical ESSL export uses 9.5 for 9h30m.
 */
export function decimalWorkedHoursToDurationHm(decimalHours: number): string {
  if (!Number.isFinite(decimalHours) || decimalHours < 0) return '0:00'
  const totalMin = Math.round(decimalHours * 60)
  const hh = Math.floor(totalMin / 60)
  const mm = totalMin % 60
  return `${hh}:${String(mm).padStart(2, '0')}`
}

export const WEEKLY_HOURS_THRESHOLD = 54

export function formatHoursHm(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  return decimalWorkedHoursToDurationHm(n)
}

export function formatInr(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '₹0'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount)
}

export function weeklyStatusLabel(status: string | null | undefined): string {
  const s = (status ?? 'draft').trim().toLowerCase()
  if (s === 'pending' || s === 'pending_approval' || s === 'pending approval') return 'Pending'
  if (s === 'locked') return 'Locked'
  if (s === 'approved') return 'Approved'
  if (s === 'rejected') return 'Draft'
  return 'Draft'
}

export function parseHoursInput(v: unknown): number | null {
  return parseHours(v)
}

export function markFromAttendanceToken(token: string | null | undefined): string {
  const u = (token ?? '').trim().toUpperCase()
  if (!u) return ''
  if (u === 'P' || u.startsWith('P(')) return 'P'
  if (u === 'WFH' || u.startsWith('WFH(')) return 'WFH'
  if (u === 'DA') return 'WO'
  return u
}

export function tokenFromMark(mark: string, hours: number | null): string {
  const m = mark.trim().toUpperCase()
  if (!m) return ''
  if (m === 'P' || m === 'PRESENT') {
    return hours != null && hours > 0 ? `P(${decimalWorkedHoursToDurationHm(hours)})` : 'P'
  }
  if (m === 'WFH') {
    return hours != null && hours > 0 ? `WFH(${decimalWorkedHoursToDurationHm(hours)})` : 'WFH'
  }
  return m
}

export function hoursCountTowardWeek(mark: string, hours: number | null): number {
  if (hours == null || hours <= 0) return 0
  const m = mark.trim().toUpperCase()
  if (m === 'AB' || m === 'WO' || m === 'DA' || m === 'SL' || m === 'PL' || m === 'CL') return 0
  return hours
}

export function weeklyDeductionRupees(
  monthlySalary: number | null | undefined,
  deficitHours: number | null | undefined,
  storedDeduction?: number | null,
  policyCompany?: string | null,
): number {
  if (!isPmPolicyCompany(policyCompany)) return 0
  if (deficitHours == null || deficitHours <= 0) return 0
  if (monthlySalary != null && Number.isFinite(monthlySalary) && monthlySalary > 0) {
    const hourly = monthlySalary / (26 * 9)
    return Math.round(hourly * deficitHours * 100) / 100
  }
  if (storedDeduction != null && storedDeduction > 24) return storedDeduction
  return 0
}

/** Token for grid styling / weekly cells (register + saved daily row). */
export function employeeDayStatusToken(
  emp: NormalizedEmployee,
  dayIndex: number,
  dailyRow?: DailyAttendanceRecord | null,
): string {
  const register = normalizeDisplayMarkToken((emp.days[dayIndex] ?? '').trim())
  if (dailyRow) {
    const fromDaily = dailyRecordToken(dailyRow)
    if (fromDaily) return fromDaily
  }
  return isGenericLeaveMark(register) ? '' : register
}

/** Short mark for weekly grid (P, WFH, SL, …). */
export function plainDayDisplayMark(
  emp: NormalizedEmployee,
  dayIndex: number,
  dailyRow?: DailyAttendanceRecord | null,
): string {
  const token = employeeDayStatusToken(emp, dayIndex, dailyRow)
  if (!token) return '-'
  if (isPresentToken(token)) return 'P'
  if (isWfhToken(token)) return 'WFH'
  if (isPaidLeaveToken(token)) return token.toUpperCase()
  return token
}

/** Weekly day cell: present + Work Dur → `P(9:30)`; else plain `P` or status token. */
export function formatWeeklyDayCellLabel(
  emp: NormalizedEmployee,
  dayIndex: number,
  dailyRow?: DailyAttendanceRecord | null,
): string {
  const token = employeeDayStatusToken(emp, dayIndex, dailyRow)
  if (!token) return '-'
  const u = token.toUpperCase()
  if (u === 'WFH' || u.startsWith('WFH(')) {
    const fromCol = emp.dayWorkedHours[dayIndex]
    const fromToken = extractWorkedHours(token)
    const h =
      fromCol != null && Number.isFinite(fromCol)
        ? fromCol
        : fromToken != null && Number.isFinite(fromToken)
          ? fromToken
          : null
    if (h != null) return `WFH(${decimalWorkedHoursToDurationHm(h)})`
    if (u.includes('HD')) return 'WFH(5:00)'
    return 'WFH'
  }
  if (isPresentToken(token)) {
    const fromCol = emp.dayWorkedHours[dayIndex]
    const fromToken = extractWorkedHours(token)
    const h =
      fromCol != null && Number.isFinite(fromCol)
        ? fromCol
        : fromToken != null && Number.isFinite(fromToken)
          ? fromToken
          : null
    if (h != null) {
      return `P(${decimalWorkedHoursToDurationHm(h)})`
    }
    // If worked duration is unavailable but login exists, still show time in "with time" mode.
    const login = (emp.dayInTimes[dayIndex] ?? '').trim()
    const loginMin = extractLoginTimeMinutes(login)
    if (loginMin != null) {
      return `P(${formatMinutesAsClock(loginMin)})`
    }
    const loginFromRow = (emp.inTime ?? '').trim()
    const loginFromRowMin = extractLoginTimeMinutes(loginFromRow)
    if (loginFromRowMin != null) {
      return `P(${formatMinutesAsClock(loginFromRowMin)})`
    }
    return token
  }
  return token
}

export function countPresentDays(days: string[]): number {
  return days.filter((d) => isPresentToken(d)).length
}

/** Present + WFH day count for calendar days (same tokens as the monthly grid). */
export function countPresentDaysInCalendar(
  emp: NormalizedEmployee,
  calendarDays: number[],
  dailyRecords: DailyAttendanceRecord[],
  reportYear: number,
  reportMonth: number,
): number {
  let n = 0
  for (const day of calendarDays) {
    const i = day - 1
    if (i < 0 || i >= emp.days.length) continue
    const dailyRow = dailyRecordForEmployeeDay(
      dailyRecords,
      emp.employeeCode,
      reportYear,
      reportMonth,
      day,
    )
    const token = employeeDayStatusToken(emp, i, dailyRow)
    const u = token.trim().toUpperCase()
    if (isPresentToken(token) || u === 'WFH' || u.startsWith('WFH(')) n += 1
  }
  return n
}

/** Present for attendance row filters (office/WFH mark or day clock-in). */
export function dayHasPresentMark(emp: NormalizedEmployee, dayIndex: number): boolean {
  if (dayIndex < 0 || dayIndex >= emp.days.length) return false
  const cell = emp.days[dayIndex] ?? ''
  if (isPresentToken(cell) || isWfhToken(cell)) return true
  return Boolean((emp.dayInTimes[dayIndex] ?? '').trim())
}

/** Explicit absent mark (AB) on a day cell. */
export function dayHasAbsentMark(emp: NormalizedEmployee, dayIndex: number): boolean {
  if (dayIndex < 0 || dayIndex >= emp.days.length) return false
  return isAbsentToken(emp.days[dayIndex] ?? '')
}

/** Employees with at least one present / absent day (optional calendar-day scope). */
export function rowMatchesFilter(
  emp: NormalizedEmployee,
  filter: 'all' | 'present' | 'absent',
  calendarDays?: number[],
): boolean {
  if (filter === 'all') return true
  const indices =
    calendarDays != null && calendarDays.length > 0
      ? calendarDays
          .map((d) => d - 1)
          .filter((i) => i >= 0 && i < emp.days.length)
      : emp.days.map((_, i) => i)
  if (indices.length === 0) return false
  if (filter === 'present') {
    return indices.some((i) => dayHasPresentMark(emp, i))
  }
  return indices.some((i) => dayHasAbsentMark(emp, i))
}

/** Late-day count for summary: per-day flags when any set; else parser total_late_days */
export function effectiveLateDayCount(emp: NormalizedEmployee): number {
  const fromFlags = emp.dayLateFlags.filter(Boolean).length
  if (fromFlags > 0) return fromFlags
  return emp.totalLateDays ?? 0
}

/** Latest day-of-month (1…maxDay) where any employee has a day cell or in-time. */
export function latestDayWithAttendanceData(
  employees: NormalizedEmployee[],
  maxDay: number,
): number | null {
  const cap = Math.min(Math.max(1, maxDay), 31)
  for (let d = cap; d >= 1; d--) {
    const i = d - 1
    const any = employees.some(
      (e) =>
        (e.days[i] ?? '').trim().length > 0 ||
        (e.dayInTimes[i] ?? '').trim().length > 0,
    )
    if (any) return d
  }
  return null
}

/**
 * Fallback when the API does not send `reportDay` (e.g. tabular Excel upload): **yesterday’s**
 * calendar date when it falls in the selected report month, else **latest day with data** in
 * the upload, else last day of month. For PDFs, prefer backend `reportDay` / `reportDate` instead.
 */
export function calendarDayForReportMonth(
  reportYear: number,
  reportMonth: number,
  now: Date = new Date(),
  employees: NormalizedEmployee[] = [],
): number {
  const dim = new Date(reportYear, reportMonth, 0).getDate()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)

  if (
    yesterday.getFullYear() === reportYear &&
    yesterday.getMonth() + 1 === reportMonth
  ) {
    return Math.min(Math.max(1, yesterday.getDate()), dim)
  }

  const fromData = latestDayWithAttendanceData(employees, dim)
  if (fromData != null) return fromData

  return dim
}

/**
 * Daily PDF output often puts the register date in **day1** (or one column), while the
 * UI may pick **day16** from calendar heuristics - leaving `days[15]` empty for everyone.
 * If the preferred column has no data, use the day index with the most non-empty cells.
 */
export function resolveDailyColumnDay(
  employees: NormalizedEmployee[],
  preferredCalendarDay: number,
): number {
  const pref = Math.min(Math.max(1, preferredCalendarDay), 31)
  const prefIdx = pref - 1
  if (employees.length === 0) return pref

  const cellScore = (idx: number): number =>
    employees.filter(
      (e) =>
        (e.days[idx] ?? '').trim() !== '' ||
        (e.dayInTimes[idx] ?? '').trim() !== '',
    ).length

  if (cellScore(prefIdx) > 0) return pref

  let bestIdx = prefIdx
  let best = -1
  for (let i = 0; i < 31; i++) {
    const s = cellScore(i)
    if (s > best) {
      best = s
      bestIdx = i
    }
  }
  if (best > 0) return bestIdx + 1
  return pref
}

export function matchesSearch(emp: NormalizedEmployee, q: string): boolean {
  if (!q.trim()) return true
  const n = q.trim().toLowerCase()
  return (
    emp.employeeName.toLowerCase().includes(n) ||
    emp.employeeCode.toLowerCase().includes(n)
  )
}

export function weekRollupHours(
  emp: NormalizedEmployee,
  weekNo: number,
): number | null {
  switch (weekNo) {
    case 1:
      return emp.week1
    case 2:
      return emp.week2
    case 3:
      return emp.week3
    case 4:
      return emp.week4
    case 5:
      return emp.week5
    default:
      return null
  }
}

/** True if the ESSL row included any week / month hour rollups (not empty PDF export). */
export function hasHoursRollupData(employees: NormalizedEmployee[]): boolean {
  for (const e of employees) {
    if (e.totalHours != null || e.deficitHours != null) return true
    if (
      e.week1 != null ||
      e.week2 != null ||
      e.week3 != null ||
      e.week4 != null ||
      e.week5 != null
    )
      return true
    if (
      e.week1Deficit != null ||
      e.week2Deficit != null ||
      e.week3Deficit != null ||
      e.week4Deficit != null ||
      e.week5Deficit != null
    )
      return true
  }
  return false
}

/** Calendar weeks for a month (Mon-Sun), dynamic count (typically 4-6). */
export function calendarWeeksForMonth(
  reportYear: number,
  reportMonth: number,
): number[][] {
  const dim = new Date(reportYear, reportMonth, 0).getDate()
  const weeks: number[][] = []
  const firstDow = new Date(reportYear, reportMonth - 1, 1).getDay()
  // JS Sunday=0..Saturday=6 -> Monday-first index (Mon=0..Sun=6)
  const firstDowMondayFirst = (firstDow + 6) % 7
  for (let d = 1; d <= dim; d++) {
    const idx = Math.floor((firstDowMondayFirst + (d - 1)) / 7)
    if (!weeks[idx]) weeks[idx] = []
    weeks[idx].push(d)
  }
  return weeks
}

/** 1-based week index in the month for an ISO date (YYYY-MM-DD). */
export function weekIndexForIsoDate(
  reportYear: number,
  reportMonth: number,
  isoDate: string,
): number {
  const day = Number.parseInt(isoDate.slice(8, 10), 10)
  if (!Number.isFinite(day) || day < 1) return 1
  const weeks = calendarWeeksForMonth(reportYear, reportMonth)
  const idx = weeks.findIndex((w) => w.includes(day))
  return idx >= 0 ? idx + 1 : 1
}

function workedHoursForCalendarDays(
  emp: NormalizedEmployee,
  reportYear: number,
  reportMonth: number,
  dayNums: number[],
): { hours: number; hasAnyDaySignal: boolean } {
  let total = 0
  let hasAnyDaySignal = false
  for (const day of dayNums) {
    const i = day - 1
    if (i < 0 || i >= DAYS) continue
    const token = (emp.days[i] ?? '').trim()
    const dayHours = emp.dayWorkedHours[i]
    if (isMeaningfulDayToken(token) || (dayHours != null && Number.isFinite(dayHours))) {
      hasAnyDaySignal = true
    }

    // Sunday is weekly off - does not count toward worked hours.
    if (new Date(reportYear, reportMonth - 1, day).getDay() === 0) continue

    if (token.toUpperCase() === 'WFH(HD)') {
      total += hoursCountTowardWeek(token, 5)
      continue
    }

    const fromToken = extractWorkedHours(token)
    const hours = dayHours != null && Number.isFinite(dayHours) ? dayHours : fromToken
    total += hoursCountTowardWeek(token, hours)
  }
  return { hours: total, hasAnyDaySignal }
}

/** Mon-Sat calendar days in the list (Sunday excluded). */
export function countMonSatDaysInDayNumbers(
  reportYear: number,
  reportMonth: number,
  dayNums: number[],
): number {
  let n = 0
  for (const d of dayNums) {
    const dow = new Date(reportYear, reportMonth - 1, d).getDay()
    if (dow >= 1 && dow <= 6) n += 1
  }
  return n
}

/** Mon-Sat expected working hours with company holiday list applied. */
export function expectedMonSatHoursForDays(
  reportYear: number,
  reportMonth: number,
  dayNums: number[],
  holidays?: CompanyHolidayDay[],
): number {
  const map = new Map<string, 'full' | 'half'>()
  for (const h of holidays ?? []) {
    map.set(h.holidayDate.slice(0, 10), h.dayType === 'half' ? 'half' : 'full')
  }
  let total = 0
  for (const d of dayNums) {
    const dow = new Date(reportYear, reportMonth - 1, d).getDay()
    if (dow < 1 || dow > 6) continue
    const iso = isoDateYmd(reportYear, reportMonth, d)
    const ht = map.get(iso)
    if (ht === 'full') continue
    if (ht === 'half') total += PAID_LEAVE_CREDIT_HOURS / 2
    else total += PAID_LEAVE_CREDIT_HOURS
  }
  return total
}

export function countMonSatDaysInMonth(
  reportYear: number,
  reportMonth: number,
): number {
  const dim = new Date(reportYear, reportMonth, 0).getDate()
  const dayNums: number[] = []
  for (let d = 1; d <= dim; d++) dayNums.push(d)
  return countMonSatDaysInDayNumbers(reportYear, reportMonth, dayNums)
}

export type CalendarScopedHours = {
  hours: number | null
  deficit: number | null
  expectedTarget: number | null
}

export function weeklyHoursAndDeficitByCalendar(
  emp: NormalizedEmployee,
  reportYear: number,
  reportMonth: number,
  weekNo: number,
  policyCompany?: string | null,
  weeklyRecords: WeeklyAttendanceRecord[] = [],
  companyHolidays: CompanyHolidayDay[] = [],
): CalendarScopedHours {
  const weeks = calendarWeeksForMonth(reportYear, reportMonth)
  const dayNums = weeks[weekNo - 1] ?? []
  if (dayNums.length === 0) {
    return { hours: null, deficit: null, expectedTarget: null }
  }

  const weekStart = isoDateYmd(reportYear, reportMonth, dayNums[0])
  const stored = weeklyRecordForWeekStart(weeklyRecords, emp.employeeCode, weekStart)
  if (stored && stored.totalHours != null && Number.isFinite(stored.totalHours)) {
    const expectedFromCalendar = isPmPolicyCompany(policyCompany)
      ? expectedMonSatHoursForDays(reportYear, reportMonth, dayNums, companyHolidays)
      : null
    const expected =
      stored.requiredHours != null && Number.isFinite(stored.requiredHours)
        ? stored.requiredHours
        : expectedFromCalendar
    const deficit =
      stored.deficitHours != null && Number.isFinite(stored.deficitHours)
        ? Math.max(0, stored.deficitHours)
        : expected != null
          ? Math.max(0, expected - stored.totalHours)
          : null
    return {
      hours: stored.totalHours,
      deficit,
      expectedTarget: expected,
    }
  }

  const dayWorkedAll = workedHoursForCalendarDays(emp, reportYear, reportMonth, dayNums)
  const hasWeekSignal = dayWorkedAll.hasAnyDaySignal
  const hours = hasWeekSignal ? dayWorkedAll.hours : null

  if (!isPmPolicyCompany(policyCompany)) {
    return { hours, deficit: null, expectedTarget: null }
  }

  const expected = expectedMonSatHoursForDays(reportYear, reportMonth, dayNums, companyHolidays)

  const deficit = hours != null ? Math.max(0, expected - hours) : null

  return {
    hours,
    deficit,
    expectedTarget: expected,
  }
}

export function monthlyHoursAndDeficitByCalendar(
  emp: NormalizedEmployee,
  reportYear: number,
  reportMonth: number,
  policyCompany?: string | null,
  weeklyRecords: WeeklyAttendanceRecord[] = [],
  companyHolidays: CompanyHolidayDay[] = [],
): CalendarScopedHours {
  const weeks = calendarWeeksForMonth(reportYear, reportMonth)
  let hoursSum = 0
  let expectedSum = 0
  let hasAnyWeek = false
  let hasExpected = false

  for (let wn = 1; wn <= weeks.length; wn++) {
    if ((weeks[wn - 1] ?? []).length === 0) continue
    const scoped = weeklyHoursAndDeficitByCalendar(
      emp,
      reportYear,
      reportMonth,
      wn,
      policyCompany,
      weeklyRecords,
      companyHolidays,
    )
    if (scoped.hours != null) {
      hoursSum += scoped.hours
      hasAnyWeek = true
    }
    if (scoped.expectedTarget != null) {
      expectedSum += scoped.expectedTarget
      hasExpected = true
    }
  }

  const hours = hasAnyWeek ? hoursSum : null
  const expectedTarget = hasExpected ? expectedSum : null
  const deficit =
    hours != null && expectedTarget != null ? Math.max(0, expectedTarget - hours) : null

  if (!isPmPolicyCompany(policyCompany)) {
    return { hours, deficit: null, expectedTarget: null }
  }

  return { hours, deficit, expectedTarget }
}

export function formatWeekBreakdown(
  emp: NormalizedEmployee,
  dayNumbers: number[],
): string {
  const parts: string[] = []
  for (const d of dayNumbers) {
    const i = d - 1
    if (i < 0 || i >= DAYS) continue
    const wh = emp.dayWorkedHours[i]
    const fromToken = extractWorkedHours(emp.days[i] ?? '')
    const h = wh ?? fromToken
    if (h != null && Number.isFinite(h)) {
      parts.push(`${d}:${decimalWorkedHoursToDurationHm(h)}`)
    }
  }
  return parts.length > 0 ? parts.join(', ') : '-'
}

export function formatPeriodHoursBreakdown(
  emp: NormalizedEmployee,
  dayNumbers: number[],
): string {
  return formatWeekBreakdown(emp, dayNumbers)
}

export function workedHoursExcludingLeaveForPeriod(
  emp: NormalizedEmployee,
  dayNumbers: number[],
  periodHours: number | null,
): number | null {
  let directWorked = 0
  let leaveHours = 0
  let sawAnyDaySignal = false

  for (const d of dayNumbers) {
    const i = d - 1
    if (i < 0 || i >= DAYS) continue
    const token = (emp.days[i] ?? '').trim()
    const dayHours = emp.dayWorkedHours[i]
    if (isMeaningfulDayToken(token) || (dayHours != null && Number.isFinite(dayHours))) {
      sawAnyDaySignal = true
    }

    if (isCreditedLeaveToken(token)) {
      leaveHours += PAID_LEAVE_CREDIT_HOURS
      continue
    }

    if (dayHours != null && Number.isFinite(dayHours)) {
      directWorked += dayHours
      continue
    }
    const fromToken = extractWorkedHours(token)
    if (fromToken != null) {
      directWorked += fromToken
      continue
    }
    if (isPresentToken(token)) {
      const loginMin =
        extractLoginTimeMinutes((emp.dayInTimes[i] ?? '').trim()) ??
        extractLoginTimeMinutes((emp.inTime ?? '').trim())
      if (loginMin != null) {
        directWorked += loginMin / 60
        continue
      }
    }
    if (token.toUpperCase() === 'WFH(HD)') {
      directWorked += 5
    }
  }

  if (directWorked > 0) return directWorked
  if (periodHours != null) return Math.max(0, periodHours - leaveHours)
  if (sawAnyDaySignal) return 0
  return null
}

export function leaveHoursForPeriod(
  emp: NormalizedEmployee,
  dayNumbers: number[],
): number | null {
  let leaveHours = 0
  let sawAnyDaySignal = false
  for (const d of dayNumbers) {
    const i = d - 1
    if (i < 0 || i >= DAYS) continue
    const token = (emp.days[i] ?? '').trim()
    const dayHours = emp.dayWorkedHours[i]
    if (isMeaningfulDayToken(token) || (dayHours != null && Number.isFinite(dayHours))) {
      sawAnyDaySignal = true
    }
    if (isCreditedLeaveToken(token)) {
      leaveHours += PAID_LEAVE_CREDIT_HOURS
    }
  }
  if (leaveHours > 0) return leaveHours
  return sawAnyDaySignal ? 0 : null
}

export function isoDateYmd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Day-of-month with the most daily rows in a calendar month (for daily register browse). */
export function inferDailyRegisterDay(
  dailyRecords: { attendanceDate: string }[],
  year: number,
  month: number,
): number | null {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`
  const counts = new Map<number, number>()
  for (const row of dailyRecords) {
    const iso = row.attendanceDate.slice(0, 10)
    if (!iso.startsWith(prefix)) continue
    const day = Number.parseInt(iso.slice(8, 10), 10)
    if (!Number.isFinite(day) || day < 1 || day > 31) continue
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  if (counts.size === 0) return null
  let bestDay: number | null = null
  let bestCount = 0
  for (const [day, count] of counts) {
    if (count > bestCount) {
      bestDay = day
      bestCount = count
    }
  }
  return bestDay
}

/** Calendar week start/end (YYYY-MM-DD) containing a day-of-month, or null. */
export function weekRangeForCalendarDay(
  reportYear: number,
  reportMonth: number,
  day: number,
): { weekStart: string; weekEnd: string } | null {
  const weeks = calendarWeeksForMonth(reportYear, reportMonth)
  const block = weeks.find((days) => days.includes(day))
  if (!block || block.length === 0) return null
  return {
    weekStart: isoDateYmd(reportYear, reportMonth, block[0]),
    weekEnd: isoDateYmd(reportYear, reportMonth, block[block.length - 1]),
  }
}

/** Calendar week start (YYYY-MM-DD) containing a day-of-month, or null. */
export function weekStartForCalendarDay(
  reportYear: number,
  reportMonth: number,
  day: number,
): string | null {
  const weeks = calendarWeeksForMonth(reportYear, reportMonth)
  const block = weeks.find((days) => days.includes(day))
  if (!block || block.length === 0) return null
  return isoDateYmd(reportYear, reportMonth, block[0])
}

export function weeklyRecordForWeekStart(
  weeklyRecords: WeeklyAttendanceRecord[],
  employeeCode: string,
  weekStart: string,
): WeeklyAttendanceRecord | undefined {
  const ws = weekStart.slice(0, 10)
  return weeklyRecords.find(
    (w) => w.employeeCode === employeeCode && w.weekStart.slice(0, 10) === ws,
  )
}

export function weeklyRecordForCalendarDay(
  weeklyRecords: WeeklyAttendanceRecord[],
  employeeCode: string,
  reportYear: number,
  reportMonth: number,
  day: number,
): WeeklyAttendanceRecord | undefined {
  const weekStart = weekStartForCalendarDay(reportYear, reportMonth, day)
  if (!weekStart) return undefined
  return weeklyRecordForWeekStart(weeklyRecords, employeeCode, weekStart)
}

export function dailyRecordForEmployeeDay(
  dailyRecords: DailyAttendanceRecord[],
  employeeCode: string,
  reportYear: number,
  reportMonth: number,
  day: number,
): DailyAttendanceRecord | undefined {
  const iso = isoDateYmd(reportYear, reportMonth, day)
  return dailyRecords.find(
    (r) => r.employeeCode === employeeCode && r.attendanceDate.slice(0, 10) === iso,
  )
}

export type MonthlyDayHoursDetail = {
  compactMark: string
  hoursLabel: string | null
  withHoursLabel: string
  inTime: string | null
  outTime: string | null
}

/** Compact mark + worked duration for monthly day cells (prefers stored daily row hours). */
export function monthlyDayHoursDetail(
  emp: NormalizedEmployee,
  dayIndex: number,
  dailyRow?: DailyAttendanceRecord | null,
): MonthlyDayHoursDetail {
  const registerToken = normalizeDisplayMarkToken((emp.days[dayIndex] ?? '').trim())
  const token =
    (dailyRow ? dailyRecordToken(dailyRow) : '') ||
    (isGenericLeaveMark(registerToken) ? '' : registerToken)

  const compactMark = dailyRow
    ? compactMarkFromLabel(dailyRecordMarkLabel(dailyRow))
    : !token
      ? '-'
      : isPresentToken(token)
        ? 'P'
        : isWfhToken(token)
          ? 'WFH'
          : isPaidLeaveToken(token)
            ? token.toUpperCase()
            : isGenericLeaveMark(token)
              ? '-'
              : token

  const hoursDecimal =
    dailyRow?.workingHours != null && Number.isFinite(dailyRow.workingHours)
      ? dailyRow.workingHours
      : emp.dayWorkedHours[dayIndex]

  const hoursLabel =
    hoursDecimal != null && Number.isFinite(hoursDecimal) && hoursDecimal > 0
      ? formatWorkingHoursDisplay(hoursDecimal)
      : null

  let withHoursLabel = dailyRow
    ? dailyRecordMarkLabel(dailyRow)
    : formatWeeklyDayCellLabel(emp, dayIndex)
  if (!dailyRow) {
    if (!withHoursLabel || withHoursLabel === '-') {
      if (isPresentToken(token) && hoursLabel) withHoursLabel = `P(${hoursLabel})`
      else if (isWfhToken(token) && hoursLabel) withHoursLabel = `WFH(${hoursLabel})`
      else if (token) withHoursLabel = markFromAttendanceToken(token) || token
    } else if (isPresentToken(token) && hoursLabel) {
      withHoursLabel = `P(${hoursLabel})`
    } else if (isWfhToken(token) && hoursLabel) {
      withHoursLabel = `WFH(${hoursLabel})`
    }
  }

  return {
    compactMark,
    hoursLabel,
    withHoursLabel,
    inTime: dailyRow?.inTime ?? emp.dayInTimes[dayIndex] ?? null,
    outTime: dailyRow?.outTime ?? null,
  }
}

/** One row per employee id (month load used to duplicate rows per daily join). */
export function dedupeEmployeesById(employees: NormalizedEmployee[]): NormalizedEmployee[] {
  const byId = new Map<number, NormalizedEmployee>()
  const byCode = new Map<string, NormalizedEmployee>()
  for (const emp of employees) {
    if (typeof emp.id === 'number' && Number.isFinite(emp.id)) {
      if (!byId.has(emp.id)) byId.set(emp.id, emp)
      continue
    }
    const code = emp.employeeCode.trim()
    if (code && !byCode.has(code)) byCode.set(code, emp)
  }
  return [...byId.values(), ...byCode.values()]
}

/** Fill empty employee day cells from saved daily attendance rows (monthly grid). */
export function enrichEmployeesFromDailyRecords(
  employees: NormalizedEmployee[],
  dailyRecords: DailyAttendanceRecord[],
  reportYear: number,
  reportMonth: number,
): NormalizedEmployee[] {
  if (dailyRecords.length === 0) return employees
  return employees.map((emp) => {
    let changed = false
    const days = [...emp.days]
    const dayInTimes = [...emp.dayInTimes]
    const dayWorkedHours = [...emp.dayWorkedHours]
    const dayLateFlags = [...emp.dayLateFlags]
    for (const row of dailyRecords) {
      if (row.employeeCode !== emp.employeeCode) continue
      const iso = row.attendanceDate.slice(0, 10)
      const parts = iso.split('-').map((v) => Number.parseInt(v, 10))
      if (parts.length < 3) continue
      const [y, m, d] = parts
      if (y !== reportYear || m !== reportMonth || !Number.isFinite(d) || d < 1 || d > 31) continue
      const i = d - 1
      const token = dailyRecordToken(row)
      const existing = (days[i] ?? '').trim()
      const shouldReplace =
        Boolean(token) &&
        (!existing ||
          isGenericLeaveMark(existing) ||
          ((row.dailyStatus ?? '').trim().toLowerCase() === 'wfh' && isPresentToken(existing)))
      if (shouldReplace && token) {
        days[i] = token
        changed = true
      }
      if (!dayInTimes[i]?.trim() && row.inTime) {
        dayInTimes[i] = row.inTime
        changed = true
      }
      if (dayWorkedHours[i] == null && row.workingHours != null) {
        dayWorkedHours[i] = row.workingHours
        changed = true
      }
      if (!dayLateFlags[i] && row.late) {
        dayLateFlags[i] = true
        changed = true
      }
    }
    if (!changed) return emp
    return { ...emp, days, dayInTimes, dayWorkedHours, dayLateFlags }
  })
}

export function formatStoredClock(value: string | null | undefined): string {
  const s = (value ?? '').trim()
  return s || '-'
}

export function formatWorkingHoursDisplay(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return '-'
  return decimalWorkedHoursToDurationHm(hours)
}

export function attendanceOriginLabel(origin: string | null | undefined): string {
  const s = (origin ?? 'calculated').trim().toLowerCase()
  if (s === 'approved') return 'Approved'
  if (s === 'hr_edit') return 'HR edit'
  if (s === 'raw') return 'Imported'
  return 'Calculated'
}

export function attendanceOriginClass(origin: string | null | undefined): string {
  const s = (origin ?? 'calculated').trim().toLowerCase()
  if (s === 'approved') return 'bg-emerald-100 text-emerald-900'
  if (s === 'hr_edit') return 'bg-amber-100 text-amber-950'
  if (s === 'raw') return 'bg-sky-100 text-sky-950'
  return 'bg-stone-100 text-stone-700'
}

export function isDailyRecordWfhUnverified(row: DailyAttendanceRecord): boolean {
  return (row.note ?? '').trim().toLowerCase() === 'wfh_unverified'
}

/** Resolve attendance mark token for daily row styling (statusToken preferred). */
export function dailyRecordToken(row: DailyAttendanceRecord): string {
  const status = (row.dailyStatus ?? '').trim().toLowerCase()
  let token = normalizeDisplayMarkToken((row.statusToken ?? '').trim())

  if (isGenericLeaveMark(token) || (status === 'leave' && !isPaidLeaveToken(token))) {
    const specific = paidLeaveTokenFromDailyRow(row)
    if (specific) token = specific
    else if (isGenericLeaveMark(token)) token = ''
  }

  if (status === 'wfh' && (token === 'P' || token.startsWith('P(') || !token)) {
    return 'WFH'
  }

  if (token && !isGenericLeaveMark(token)) return token

  if (status === 'wfh') return 'WFH'
  if (status === 'leave') {
    const specific = paidLeaveTokenFromDailyRow(row)
    if (specific) return specific
    return ''
  }
  if (status === 'weekly_off') return 'WO'
  if (status === 'absent') return 'AB'
  if (status === 'present' || status === 'late') return 'P'
  return ''
}

/** Human-readable mark for the daily table (WFH, P(9:30), SL, etc.). */
export function dailyRecordMarkLabel(row: DailyAttendanceRecord): string {
  const status = (row.dailyStatus ?? '').trim().toLowerCase()
  let token = dailyRecordToken(row)

  if (status === 'wfh' && (token === 'P' || token.startsWith('P('))) {
    if (row.workingHours != null && row.workingHours > 0) {
      return `WFH(${decimalWorkedHoursToDurationHm(row.workingHours)})`
    }
    return 'WFH'
  }

  if (!token || token === 'P') {
    if (status === 'leave') {
      const specific = paidLeaveTokenFromDailyRow(row)
      if (specific) return specific
    }
    if (status === 'weekly_off') return 'WO'
    if (status === 'wfh') return 'WFH'
    if (status === 'absent') return 'AB'
  }

  if (isGenericLeaveMark(token)) {
    const specific = paidLeaveTokenFromDailyRow(row)
    if (specific) return specific
    token = ''
  }

  if (!token) return '-'
  const u = token.toUpperCase()
  if (u.startsWith('WFH(') || u === 'WFH') return token
  if (u.startsWith('P(')) return token
  if (u === 'P') {
    if (status === 'wfh') {
      if (row.workingHours != null && row.workingHours > 0) {
        return `WFH(${decimalWorkedHoursToDurationHm(row.workingHours)})`
      }
      return 'WFH'
    }
    if (row.workingHours != null && row.workingHours > 0) {
      return `P(${decimalWorkedHoursToDurationHm(row.workingHours)})`
    }
    return 'P'
  }
  return markFromAttendanceToken(token) || token
}

/** Grid-style cell colours for daily marks (WFH, leave, absent, present, …). */
export function dailyRecordCellClass(row: DailyAttendanceRecord, stripBg?: string): string {
  const token = dailyRecordToken(row)
  const base = cellClass(token, stripBg, isDailyRecordWfhUnverified(row))
  const late = row.late || (row.dailyStatus ?? '').toLowerCase() === 'late'
  if (late && (isPresentToken(token) || isWfhToken(token))) {
    return `${base} ring-2 ring-amber-400 ring-inset`
  }
  return base
}

export function lateMarkForRecord(row: DailyAttendanceRecord): 'Late' | 'On time' | '-' {
  const status = (row.dailyStatus ?? '').toLowerCase()
  if (row.late || status === 'late') return 'Late'
  if (status === 'present' || status === 'wfh') return 'On time'
  const checkIn = (row.checkInTime ?? row.inTime ?? '').trim()
  if (checkIn && status !== 'absent' && status !== 'leave' && status !== 'weekly_off') {
    return 'On time'
  }
  return '-'
}

export function isDailyRecordPresent(row: DailyAttendanceRecord): boolean {
  const status = (row.dailyStatus ?? '').toLowerCase()
  if (status === 'present' || status === 'late' || status === 'wfh') return true
  if (status === 'absent' || status === 'leave' || status === 'weekly_off') return false
  return Boolean((row.checkInTime ?? row.inTime ?? '').trim())
}

export function isDailyRecordAbsent(row: DailyAttendanceRecord): boolean {
  const status = (row.dailyStatus ?? '').toLowerCase()
  if (status === 'absent') return true
  if (isDailyRecordPresent(row)) return false
  return isAbsentToken(dailyRecordToken(row))
}

export function matchesDailyRecordSearch(row: DailyAttendanceRecord, q: string): boolean {
  if (!q.trim()) return true
  const n = q.trim().toLowerCase()
  return (
    row.employeeName.toLowerCase().includes(n) ||
    row.employeeCode.toLowerCase().includes(n)
  )
}

function addMinutesToStoredClock(clock: string, addMin: number): string | null {
  const base = extractLoginTimeMinutes(clock)
  if (base == null || !Number.isFinite(addMin)) return null
  return formatMinutesAsClock(base + Math.round(addMin))
}

export function fallbackDailyRecordsFromEmployees(
  employees: NormalizedEmployee[],
  year: number,
  month: number,
  day: number,
): DailyAttendanceRecord[] {
  const date = isoDateYmd(year, month, day)
  const dayIndex = day - 1
  return employees.map((emp, idx) => {
    const derived = deriveDailyAttendanceForDay(emp, dayIndex)
    const checkIn = (emp.dayInTimes[dayIndex] ?? emp.inTime ?? '').trim()
    const hours = emp.dayWorkedHours[dayIndex]
    const outFromHours =
      checkIn && hours != null && hours > 0
        ? addMinutesToStoredClock(checkIn, hours * 60)
        : null
    const late = derived.isLate
    let lateMinutes: number | null = null
    if (late && checkIn && emp.shiftStart) {
      const inMin = extractLoginTimeMinutes(checkIn)
      const shiftMin = extractLoginTimeMinutes(emp.shiftStart)
      if (inMin != null && shiftMin != null && inMin > shiftMin) lateMinutes = inMin - shiftMin
    }
    return {
      id: idx,
      employeeId: idx,
      employeeCode: emp.employeeCode,
      employeeName: emp.employeeName,
      shiftStart: emp.shiftStart ?? '',
      attendanceDate: date,
      inTime: checkIn || null,
      checkInTime: checkIn || null,
      outTime: outFromHours,
      workingHours: hours,
      late,
      lateMinutes,
      dailyStatus: isWfhToken(emp.days[dayIndex] ?? '')
        ? 'wfh'
        : isPaidLeaveToken(emp.days[dayIndex] ?? '')
          ? 'leave'
          : isWeeklyOffToken(emp.days[dayIndex] ?? '')
            ? 'weekly_off'
            : isAbsentToken(emp.days[dayIndex] ?? '')
              ? 'absent'
              : derived.isPresent
                ? late
                  ? 'late'
                  : 'present'
                : 'absent',
      statusToken: emp.days[dayIndex] ?? null,
      note: emp.dayWfhUnverified[dayIndex] ? 'wfh_unverified' : null,
    }
  })
}

export function dailyRecordsForCalendarDay(
  stored: DailyAttendanceRecord[],
  employees: NormalizedEmployee[],
  year: number,
  month: number,
  day: number,
): DailyAttendanceRecord[] {
  const date = isoDateYmd(year, month, day)
  if (stored.length > 0) {
    return stored.filter((row) => row.attendanceDate.slice(0, 10) === date)
  }
  return fallbackDailyRecordsFromEmployees(employees, year, month, day)
}
