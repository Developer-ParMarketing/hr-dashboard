/**
 * Company-specific attendance rules (aligned with HR policy).
 * PM only: Sunday off, 9h/day target, WFH cap, late grace, weekly deficit/deductions.
 */

import { isPmPolicyCompany } from '../constants/companies'
import type { NormalizedEmployee } from '../types/attendance'

const STANDARD_DAY = 9

/** Expected hours target for one calendar day (0 = weekly off, not counted toward deficit). */
export function expectedHoursTargetForDay(
  policyCompany: string | null | undefined,
  dayOfWeek: number,
): number {
  if (!isPmPolicyCompany(policyCompany)) return 0
  if (dayOfWeek === 0) return 0
  return STANDARD_DAY
}

/** Max WFH days per month before policy warning; null = no numeric cap. */
export function maxWfhDaysPolicy(policyCompany: string | null | undefined): number | null {
  return isPmPolicyCompany(policyCompany) ? 3 : null
}

function isWfhDayToken(token: string): boolean {
  const u = token.trim().toUpperCase()
  return u === 'WFH' || u.startsWith('WFH(')
}

/** Count WFH-marked days in 1…dim for the report month. */
export function countWfhDaysInMonth(
  emp: NormalizedEmployee,
  reportYear: number,
  reportMonth: number,
): number {
  const dim = new Date(reportYear, reportMonth, 0).getDate()
  let n = 0
  for (let day = 1; day <= dim; day++) {
    const cell = (emp.days[day - 1] ?? '').trim()
    if (isWfhDayToken(cell)) n += 1
  }
  return n
}

/** Short note when PM exceeds WFH allowance. */
export function wfhPolicyWarning(
  policyCompany: string | null | undefined,
  wfhDaysInMonth: number,
): string | null {
  const cap = maxWfhDaysPolicy(policyCompany)
  if (cap == null || wfhDaysInMonth <= cap) return null
  return `WFH ${wfhDaysInMonth}/${cap} (over policy)`
}
