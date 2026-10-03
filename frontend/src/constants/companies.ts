/** Companies available when uploading ESSL / cross-check files - PM only for now. */
export const UPLOAD_COMPANY_CODES = ['PM'] as const
// export const UPLOAD_COMPANY_CODES = ['PM', 'CCM', 'SML', 'TC', 'LL'] as const

export type UploadCompanyCode = (typeof UPLOAD_COMPANY_CODES)[number]

/** Default / only active company in the dashboard. */
export const DEFAULT_UPLOAD_COMPANY: UploadCompanyCode = 'PM'

// export const UPLOAD_ALL_COMPANIES = 'ALL' as const

/** Empty string kept for legacy form state only - app defaults to PM. */
export type UploadCompanySelection =
  | UploadCompanyCode
  // | typeof UPLOAD_ALL_COMPANIES
  | ''

export function isUploadCompanyCode(value: string): value is UploadCompanyCode {
  return (UPLOAD_COMPANY_CODES as readonly string[]).includes(value)
}

export function isUploadCompanySelection(value: string): value is Exclude<UploadCompanySelection, ''> {
  // return value === UPLOAD_ALL_COMPANIES || isUploadCompanyCode(value)
  return isUploadCompanyCode(value)
}

/** Value sent as `company` / `companyName` to the attendance API */
export function companySelectionToApiString(selection: UploadCompanySelection): string {
  if (selection === '') return DEFAULT_UPLOAD_COMPANY
  // if (selection === UPLOAD_ALL_COMPANIES) return ''
  return selection
}

export function formatCompanySelectionLabel(selection: Exclude<UploadCompanySelection, ''>): string {
  // return selection === UPLOAD_ALL_COMPANIES ? 'All companies' : selection
  return selection
}

/** Normalize stored DB company values to the active upload selection. */
export function companyFromStored(stored: string | null | undefined): UploadCompanyCode {
  if (stored && isUploadCompanyCode(stored)) return stored
  return DEFAULT_UPLOAD_COMPANY
}

/** PM attendance rules (deficit, deductions, late grace, WFH cap) apply only for PM. */
export function isPmPolicyCompany(company: string | null | undefined): boolean {
  const c = (company ?? '').trim().toUpperCase()
  if (!c) return true
  return c === 'PM'
}
