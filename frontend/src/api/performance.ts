import { client } from './client'
import { canEditAttendance } from '../auth/permissions'
import type { AuthUser } from './auth'
import { normalizeCycleSubmission } from '../utils/normalizeCycleSubmission'

export type RatingScaleEntry = {
  value: number
  label: string
  note: string
}

export type AppraisalAnswer = {
  criterionIndex: number
  employeeRating: number | null
  employeeComments: string | null
  managerRating: number | null
  managerComments: string | null
  managementRating: number | null
  managementComments: string | null
}

export type AppraisalTemplate = {
  teamSlug: string
  teamName: string
  titleColumn: 'Skills' | 'Goal Title'
  criteria: Array<{ index: number; title: string; description: string }>
}

export type AppraisalSubmission = {
  id: number
  cycleYear: number
  employeeId: number
  employeeCode: string
  employeeName: string
  teamSlug: string | null
  teamName: string | null
  dateOfJoining: string | null
  canFill: boolean
  daysUntilEditable: number | null
  canEditEmployeeFields: boolean
  canEditManagerFields: boolean
  canEditManagementFields: boolean
  showManagerReview: boolean
  showManagementReview: boolean
  managerSubmittedAt: string | null
  employeeSubmittedAt: string | null
  managementSubmittedAt: string | null
  overallEmployeeRating: number | null
  overallManagerRating: number | null
  overallManagementRating: number | null
  overallEmployeeComments: string | null
  overallManagerComments: string | null
  overallManagementComments: string | null
  answers: AppraisalAnswer[]
  template: AppraisalTemplate | null
  employeeUpdatedAt: string | null
  managerUpdatedAt: string | null
  managementUpdatedAt: string | null
  historyCycleYears?: number[]
  activeCycleYear?: number
  employeeWindowOpen?: boolean
  employeeEditNote?: string | null
}

export async function fetchPerformanceMeta(): Promise<{ ratingScale: RatingScaleEntry[] }> {
  const { data } = await client.get<{ ratingScale: RatingScaleEntry[] }>('/api/performance/meta')
  return data
}

export async function fetchMyAppraisal(year?: number): Promise<{
  linked: boolean
  submission: AppraisalSubmission | null
}> {
  const qs = year != null ? `?year=${year}` : ''
  const { data } = await client.get<{ linked: boolean; submission: AppraisalSubmission | null }>(
    `/api/performance/me${qs}`,
  )
  return {
    linked: data.linked,
    submission: data.submission ? normalizeCycleSubmission(data.submission) : null,
  }
}

export async function fetchAppraisalForEmployee(
  employeeId: number,
  year: number,
): Promise<AppraisalSubmission> {
  const { data } = await client.get<{ submission: AppraisalSubmission }>(
    `/api/performance/employees/${employeeId}?year=${year}`,
  )
  return normalizeCycleSubmission(data.submission)
}

export async function fetchTeamAppraisals(year: number): Promise<{
  year: number
  members: Array<{
    employeeId: number
    employeeCode: string
    employeeName: string
    teamName: string | null
    canFill: boolean
    employeeSubmittedAt: string | null
    overallEmployeeRating: number | null
    overallManagerRating: number | null
    managerSubmittedAt: string | null
    employeeUpdatedAt: string | null
    managerUpdatedAt: string | null
  }>
}> {
  const { data } = await client.get(`/api/performance/team?year=${year}`)
  return data
}

export async function fetchLeadershipAppraisals(year: number): Promise<{
  year: number
  members: Array<{
    employeeId: number
    employeeCode: string
    employeeName: string
    teamName: string | null
    employeeSubmittedAt: string | null
    overallEmployeeRating: number | null
    overallManagerRating: number | null
    managerSubmittedAt: string | null
  }>
}> {
  const { data } = await client.get(`/api/performance/leadership?year=${year}`)
  return data
}

export async function saveAppraisal(
  employeeId: number,
  year: number,
  payload: {
    role: 'employee' | 'manager' | 'management'
    submit?: boolean
    overallRating: number | null
    overallComments?: string | null
    answers: Array<{
      criterionIndex: number
      rating: number | null
      comments: string | null
    }>
  },
): Promise<AppraisalSubmission> {
  const { data } = await client.patch<{ submission: AppraisalSubmission }>(
    `/api/performance/employees/${employeeId}`,
    { year, ...payload },
  )
  return normalizeCycleSubmission(data.submission)
}

export async function fetchAdminAppraisals(year: number): Promise<{
  year: number
  rows: Array<{
    submissionId: number
    employeeId: number
    employeeCode: string
    employeeName: string
    teamName: string | null
    teamSlug: string | null
    dateOfJoining: string | null
    canFill: boolean
    employeeSubmittedAt: string | null
    overallEmployeeRating: number | null
    overallManagerRating: number | null
    managerSubmittedAt: string | null
    employeeUpdatedAt: string | null
    managerUpdatedAt: string | null
  }>
}> {
  const { data } = await client.get(`/api/admin/performance/appraisals?year=${year}`)
  return data
}

const LEADERSHIP_JAY = 'jay.parmar@parmarketing.agency'
const LEADERSHIP_MANSI = 'mansi.prasad@parmarketing.agency'

export function isLeadershipJay(email: string | undefined | null): boolean {
  return (email ?? '').trim().toLowerCase() === LEADERSHIP_JAY
}

export function isLeadershipMansi(email: string | undefined | null): boolean {
  return (email ?? '').trim().toLowerCase() === LEADERSHIP_MANSI
}

export function isLeadershipReviewer(email: string | undefined | null): boolean {
  return isLeadershipJay(email) || isLeadershipMansi(email)
}

const EXECUTIVE_CYCLE_REVIEWER_EMAILS = new Set([
  'devanshi.siddhpura@parmarketing.agency',
  'jiya.mehta@parmarketing.agency',
])

/** Matches API `canActAsManagementReviewer` (Jay/Mansi, HR, Devanshi, Jiya). */
export function canActAsManagementReviewer(user: AuthUser | null | undefined): boolean {
  if (!user) return false
  if (isLeadershipReviewer(user.email)) return true
  if (canEditAttendance(user)) return true
  return EXECUTIVE_CYCLE_REVIEWER_EMAILS.has(user.email.trim().toLowerCase())
}
