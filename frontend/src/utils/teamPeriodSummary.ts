import type { NormalizedEmployee, WeeklyAttendanceRecord, CompanyHolidayDay } from '../types/attendance'
import {
  formatHoursHm,
  formatInr,
  leaveHoursForPeriod,
  monthlyHoursAndDeficitByCalendar,
} from './attendance'
import {
  groupRowsByTeam,
  teamMetaFromEmployee,
  UNASSIGNED_TEAM_LABEL,
  type TeamGroupingMeta,
} from './teamGroups'
import type { WeeklyCalcRow } from './weeklyAttendanceRows'

export type TeamPeriodSummaryCard = {
  group: TeamGroupingMeta
  headline: string
  details: string[]
}

export type TeamPeriodSummary = {
  title: string
  description: string
  footer?: string
  cards: TeamPeriodSummaryCard[]
}

function rollupWeeklyRows(
  calcRows: WeeklyCalcRow[],
  employeeByCode: Map<string, NormalizedEmployee>,
): TeamPeriodSummaryCard[] {
  const grouped = groupRowsByTeam(calcRows, (row) => {
    const emp = employeeByCode.get(row.employeeCode)
    return emp
      ? teamMetaFromEmployee(emp)
      : teamMetaFromEmployee({
          teamId: null,
          teamName: UNASSIGNED_TEAM_LABEL,
          teamSortOrder: 9999,
        })
  })

  return grouped.map(({ group, items }) => {
    let hoursSum = 0
    let hoursCount = 0
    let requiredSum = 0
    let deficitSum = 0
    let deductionSum = 0
    let approved = 0
    let pending = 0
    for (const row of items) {
      if (row.totalHours != null && Number.isFinite(row.totalHours)) {
        hoursSum += row.totalHours
        hoursCount += 1
      }
      requiredSum += row.requiredHours
      deficitSum += row.deficitHours
      deductionSum += row.deduction
      if (row.status === 'approved' || row.status === 'locked') approved += 1
      else if (row.status === 'pending') pending += 1
    }
    const hoursLabel =
      hoursCount > 0 ? formatHoursHm(hoursSum) : '-'
    const requiredLabel = formatHoursHm(requiredSum)
    const deficitLabel = formatHoursHm(deficitSum)
    const details: string[] = [
      `${items.length} ${items.length === 1 ? 'person' : 'people'}`,
      `Deficit ${deficitLabel}`,
    ]
    if (deductionSum > 0) details.push(`Deduction ${formatInr(deductionSum)}`)
    if (approved > 0) details.push(`${approved} approved`)
    if (pending > 0) details.push(`${pending} pending approval`)
    return {
      group,
      headline: `${hoursLabel} / ${requiredLabel} hours`,
      details,
    }
  })
}

export function computeWeeklyTeamPeriodSummary(input: {
  calcRows: WeeklyCalcRow[]
  employees: NormalizedEmployee[]
  weekLabel: string
}): TeamPeriodSummary {
  const employeeByCode = new Map(input.employees.map((e) => [e.employeeCode, e]))
  const cards = rollupWeeklyRows(input.calcRows, employeeByCode)
  let totalPeople = input.calcRows.length
  let totalDeficit = 0
  for (const row of input.calcRows) totalDeficit += row.deficitHours

  return {
    title: input.weekLabel,
    description: 'Hours and approval status rolled up by team for this calendar week.',
    footer:
      cards.length > 0
        ? `All teams: ${totalPeople} ${totalPeople === 1 ? 'person' : 'people'} · total deficit ${formatHoursHm(totalDeficit)}`
        : undefined,
    cards,
  }
}

export function computeMonthlyTeamPeriodSummary(input: {
  employees: NormalizedEmployee[]
  reportYear: number
  reportMonth: number
  monthDays: number[]
  policyCompany?: string | null
  weeklyRecords: WeeklyAttendanceRecord[]
  monthLabel: string
  companyHolidays?: CompanyHolidayDay[]
}): TeamPeriodSummary {
  const grouped = groupRowsByTeam(input.employees, (emp) => teamMetaFromEmployee(emp))

  const cards: TeamPeriodSummaryCard[] = grouped.map(({ group, items }) => {
    let hoursSum = 0
    let hasHours = false
    let expectedSum = 0
    let hasExpected = false
    let deficitSum = 0
    let leaveSum = 0
    for (const emp of items) {
      const scoped = monthlyHoursAndDeficitByCalendar(
        emp,
        input.reportYear,
        input.reportMonth,
        input.policyCompany,
        input.weeklyRecords,
        input.companyHolidays ?? [],
      )
      if (scoped.hours != null) {
        hoursSum += scoped.hours
        hasHours = true
      }
      if (scoped.expectedTarget != null) {
        expectedSum += scoped.expectedTarget
        hasExpected = true
      }
      if (scoped.deficit != null) deficitSum += scoped.deficit
      const leave = leaveHoursForPeriod(emp, input.monthDays)
      if (leave != null) leaveSum += leave
    }
    const hoursLabel = hasHours ? formatHoursHm(hoursSum) : '-'
    const expectedLabel = hasExpected ? formatHoursHm(expectedSum) : '-'
    const details: string[] = [
      `${items.length} ${items.length === 1 ? 'person' : 'people'}`,
      `Deficit ${formatHoursHm(deficitSum)}`,
    ]
    if (leaveSum > 0) details.push(`Leave ${formatHoursHm(leaveSum)}`)
    return {
      group,
      headline: `${hoursLabel} / ${expectedLabel} hours`,
      details,
    }
  })

  return {
    title: input.monthLabel,
    description: 'Month-to-date hours and deficit by team (from register marks and approved weekly rows).',
    cards,
  }
}
