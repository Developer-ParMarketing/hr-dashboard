import { isUploadCompanySelection, type UploadCompanySelection } from '../constants/companies'
import type { GroupedRecentUpload } from '../types/attendance'

export type AttendanceReviewView = 'daily' | 'weekly' | 'monthly'

export type AttendanceOpenIntent =
  | {
      kind: 'period'
      year: number
      month: number
      company: UploadCompanySelection
      /** Tab to open after load (e.g. same view as upload). */
      preferredView?: AttendanceReviewView
      /** When set, lock review UI to the register that was just processed. */
      processedRegister?: {
        fileName: string
        reportType: AttendanceReviewView
        reportDay?: number | null
        reportDateIso?: string | null
        weekStartIso?: string | null
        weekEndIso?: string | null
      }
    }
  | { kind: 'register'; upload: GroupedRecentUpload }

export function isAttendanceOpenIntent(value: unknown): value is AttendanceOpenIntent {
  if (!value || typeof value !== 'object') return false
  const intent = value as AttendanceOpenIntent
  if (intent.kind === 'period') {
    return (
      Number.isFinite(intent.year) &&
      Number.isFinite(intent.month) &&
      isUploadCompanySelection(intent.company)
    )
  }
  if (intent.kind === 'register') {
    const upload = intent.upload
    return (
      upload != null &&
      typeof upload === 'object' &&
      Number.isFinite(upload.reportYear) &&
      Number.isFinite(upload.reportMonth) &&
      typeof upload.fileName === 'string'
    )
  }
  return false
}
