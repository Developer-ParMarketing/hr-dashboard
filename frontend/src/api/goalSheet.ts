import { client } from './client'
import { normalizeCycleSubmission } from '../utils/normalizeCycleSubmission'
import type {
  AppraisalAnswer,
  AppraisalSubmission,
  AppraisalTemplate,
  RatingScaleEntry,
} from './performance'

export type GoalSheetAnswer = AppraisalAnswer
export type GoalSheetSubmission = AppraisalSubmission
export type GoalSheetTemplate = AppraisalTemplate

export async function fetchGoalSheetMeta(): Promise<{ ratingScale: RatingScaleEntry[] }> {
  const { data } = await client.get<{ ratingScale: RatingScaleEntry[] }>('/api/goal-sheet/meta')
  return data
}

export async function fetchMyGoalSheet(year?: number): Promise<{
  linked: boolean
  submission: GoalSheetSubmission | null
}> {
  const qs = year != null ? `?year=${year}` : ''
  const { data } = await client.get<{ linked: boolean; submission: GoalSheetSubmission | null }>(
    `/api/goal-sheet/me${qs}`,
  )
  return {
    linked: data.linked,
    submission: data.submission ? normalizeCycleSubmission(data.submission) : null,
  }
}

export async function fetchGoalSheetForEmployee(
  employeeId: number,
  year: number,
): Promise<GoalSheetSubmission> {
  const { data } = await client.get<{ submission: GoalSheetSubmission }>(
    `/api/goal-sheet/employees/${employeeId}?year=${year}`,
  )
  return normalizeCycleSubmission(data.submission)
}

export async function fetchTeamGoalSheets(year: number): Promise<{
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
  const { data } = await client.get(`/api/goal-sheet/team?year=${year}`)
  return data
}

export async function fetchLeadershipGoalSheets(year: number): Promise<{
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
  const { data } = await client.get(`/api/goal-sheet/leadership?year=${year}`)
  return data
}

export async function saveGoalSheet(
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
): Promise<GoalSheetSubmission> {
  const { data } = await client.patch<{ submission: GoalSheetSubmission }>(
    `/api/goal-sheet/employees/${employeeId}`,
    { year, ...payload },
  )
  return normalizeCycleSubmission(data.submission)
}

export async function fetchAdminGoalSheets(year: number): Promise<{
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
  const { data } = await client.get(`/api/admin/goal-sheet/submissions?year=${year}`)
  return data
}

export { canActAsManagementReviewer, isLeadershipReviewer } from './performance'
