import type { CompanyHolidayDay, NormalizedEmployee, WeeklyAttendanceRecord } from '../types/attendance'
import {
  calendarWeeksForMonth,
  decimalWorkedHoursToDurationHm,
  leaveHoursForPeriod,
  monthlyHoursAndDeficitByCalendar,
  weeklyHoursAndDeficitByCalendar,
} from '../utils/attendance'

export function fmtHours(n: number | null): string {
  if (n === null) return '-'
  return decimalWorkedHoursToDurationHm(n)
}

/** Monthly table summary columns after day cells. */
export const HOURS_SUMMARY_COL_COUNT = 6

type ThProps = { thHead: string }

export function HoursSummaryHeaders({ thHead }: ThProps) {
  return (
    <>
      <th className={`whitespace-nowrap text-center ${thHead}`}>Total working hours</th>
      <th className={`whitespace-nowrap text-center ${thHead}`}>Monthly expected</th>
      <th className={`whitespace-nowrap text-center ${thHead}`}>Monthly deficit</th>
      <th className={`whitespace-nowrap text-center ${thHead}`}>Monthly leave hrs</th>
      <th className={`whitespace-nowrap text-center ${thHead}`}>Total monthly</th>
      <th className={`whitespace-nowrap text-center ${thHead}`}>Total monthly deficit</th>
    </>
  )
}

type TdProps = {
  emp: NormalizedEmployee
  reportYear: number
  reportMonth: number
  /** Same zebra strip as the rest of the row (`tableRowStripBg`) */
  rowStripBg: string
  /** PM / LL / … - drives expected hours (week-offs) and PM WFH cap note */
  policyCompany?: string | null
  weeklyRecords?: WeeklyAttendanceRecord[]
  companyHolidays?: CompanyHolidayDay[]
}

type WeekScopedProps = {
  weekNo: number
  thHead: string
}

/** Only the selected week’s hours + deficit (for the Weekly table). */
export function WeekScopedSummaryHeaders({ weekNo, thHead }: WeekScopedProps) {
  return (
    <>
      <th className={`whitespace-nowrap text-center ${thHead}`}>Total working hours</th>
      <th className={`whitespace-nowrap text-center ${thHead}`}>Week {weekNo} expected</th>
      <th className={`whitespace-nowrap text-center ${thHead}`}>Week {weekNo} deficit</th>
      <th className={`whitespace-nowrap text-center ${thHead}`}>Week {weekNo} leave hrs</th>
    </>
  )
}

type WeekScopedCellsProps = {
  emp: NormalizedEmployee
  weekNo: number
  reportYear: number
  reportMonth: number
  rowStripBg: string
  policyCompany?: string | null
  weeklyRecords?: WeeklyAttendanceRecord[]
  companyHolidays?: CompanyHolidayDay[]
}

export function WeekScopedSummaryCells({
  emp,
  weekNo,
  reportYear,
  reportMonth,
  rowStripBg,
  policyCompany,
  weeklyRecords = [],
  companyHolidays = [],
}: WeekScopedCellsProps) {
  const calendarScoped = weeklyHoursAndDeficitByCalendar(
    emp,
    reportYear,
    reportMonth,
    weekNo,
    policyCompany,
    weeklyRecords,
    companyHolidays,
  )
  const wh = calendarScoped.hours
  const def = calendarScoped.deficit
  const expected = calendarScoped.expectedTarget
  const weeks = calendarWeeksForMonth(reportYear, reportMonth)
  const dayNumbers = weeks[weekNo - 1] ?? []
  const leaveHours = leaveHoursForPeriod(emp, dayNumbers)
  return (
    <>
      <td
        className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${rowStripBg}`}
      >
        {fmtHours(wh)}
      </td>
      <td
        className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${rowStripBg}`}
      >
        {fmtHours(expected)}
      </td>
      <td
        className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[color-mix(in_srgb,var(--color-brand)_38%,#000)] ${rowStripBg}`}
      >
        {fmtHours(def)}
      </td>
      <td
        className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${rowStripBg}`}
      >
        {fmtHours(leaveHours)}
      </td>
    </>
  )
}

export function HoursSummaryCells({
  emp,
  reportYear,
  reportMonth,
  rowStripBg,
  policyCompany,
  weeklyRecords = [],
  companyHolidays = [],
}: TdProps) {
  const month = monthlyHoursAndDeficitByCalendar(
    emp,
    reportYear,
    reportMonth,
    policyCompany,
    weeklyRecords,
    companyHolidays,
  )
  const monthDays = Array.from(
    { length: new Date(reportYear, reportMonth, 0).getDate() },
    (_, i) => i + 1,
  )
  const leaveHours = leaveHoursForPeriod(emp, monthDays)
  const totalMonthly = emp.totalHours
  const totalMonthlyDeficit = emp.deficitHours
  return (
    <>
      <td
        className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${rowStripBg}`}
      >
        {fmtHours(month.hours)}
      </td>
      <td
        className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${rowStripBg}`}
      >
        {fmtHours(month.expectedTarget)}
      </td>
      <td
        className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center text-sm font-medium tabular-nums ${rowStripBg} ${
          month.deficit !== 0
            ? 'text-[color-mix(in_srgb,var(--color-brand)_38%,#000)]'
            : 'text-[color-mix(in_srgb,var(--color-warm-text)_90%,transparent)]'
        }`}
      >
        {fmtHours(month.deficit)}
      </td>
      <td
        className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center tabular-nums text-[var(--color-warm-text)] ${rowStripBg}`}
      >
        {fmtHours(leaveHours)}
      </td>
      <td
        className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center text-sm font-semibold tabular-nums text-[var(--color-brand)] ${rowStripBg}`}
      >
        {fmtHours(totalMonthly)}
      </td>
      <td
        className={`border border-[var(--color-warm-muted)] px-2 py-2 text-center text-sm font-medium tabular-nums ${rowStripBg} ${
          totalMonthlyDeficit !== 0
            ? 'text-[color-mix(in_srgb,var(--color-brand)_38%,#000)]'
            : 'text-[color-mix(in_srgb,var(--color-warm-text)_90%,transparent)]'
        }`}
      >
        {fmtHours(totalMonthlyDeficit)}
      </td>
    </>
  )
}
