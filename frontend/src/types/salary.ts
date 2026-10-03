export type PmSalaryBreakdown = {
  grossCtc: number
  calendarDays?: number
  perDay: number
  payDays: number
  grossPay: number
  gratuity: number
  pt: number
  pfEmployee: number
  pfEmployer: number
  esicEmployer: number
  esicEmployee: number
  otherEarning: number
  wfhDeduction: number
  lateMarkDeduction: number
  increment: number
  netPay: number
  wfhDays: number
  lateMarkCount: number
  lateDeductionDays: number
}

export type PmSalaryInputFields = {
  employeeCode?: string
  employeeName?: string
  inHand?: number
  pfEmployee?: number
  esiEmployee?: number
  pt?: number
  gratuity?: number
  employerPf?: number
  employerPfArr?: number
  employerEsi?: number
  otherEarning?: number
  increment?: number
}

export type SalaryUploadRow = {
  rowNumber: number
  employeeCode: string
  employeeName: string
  /** In Hand (column I) */
  grossSalary: number
  adjustment: number
  pm?: PmSalaryInputFields
  errors: string[]
  warnings: string[]
  matched: boolean
  employeeId?: number
  dbEmployeeName?: string
  dbCompany?: string | null
}

export type SalaryValidationResponse = {
  uploadId: string
  fileName: string
  year: number
  month: number
  company: string
  rows: SalaryUploadRow[]
  summary: {
    totalRows: number
    validRows: number
    matchedRows: number
    errorRows: number
    blockedByApproval: number
    canCalculate: boolean
  }
}

export type SalaryCalculationRow = {
  employeeId: number
  employeeCode: string
  employeeName: string
  /** Gross Pay (column T) */
  grossSalary: number
  /** Pay days (column S) */
  workingDays: number
  /** Late deduction days */
  deficitHours: number
  /** WFH + late mark deductions */
  attendanceDeduction: number
  adjustment: number
  /** Net pay (column AE) */
  finalSalary: number
  salaryRecordId: number
  status: string
  warnings: string[]
  pm?: PmSalaryBreakdown
}

export type SalaryCalculationResponse = {
  uploadId: string
  year: number
  month: number
  company: string
  monthKey: string
  rows: SalaryCalculationRow[]
  summary: {
    calculated: number
    skippedApproved: number
    blockedByApproval: number
    totalDeduction: number
    totalFinal: number
  }
}

export type SalaryResultsResponse = {
  year: number
  month: number
  monthKey: string
  company: string | null
  hasAttendanceData: boolean
  hasSalaryResults: boolean
  lastCalculatedAt: string | null
  lastCalculatedBy: string | null
  attendanceStale: boolean
  staleMessage: string | null
  rows: {
    salaryRecordId: number
    employeeId: number
    employeeCode: string
    employeeName: string
    grossSalary: number | null
    workingDays: number | null
    adjustment: number | null
    attendanceDeduction: number | null
    finalSalary: number | null
    status: string
    pm?: PmSalaryBreakdown
  }[]
}

export type SalaryStep = 'sheet' | 'calculate' | 'results'

export type SalarySheetInputRow = {
  employeeId: number
  employeeCode: string
  employeeName: string
  department?: string | null
  gender?: string | null
  dateOfJoining?: string | null
  process?: string | null
  status?: string | null
  inHand: number
  pfEmployee: number
  esiEmployee: number
  pt: number
  gratuity: number
  employerPf: number
  employerPfArr: number
  employerEsi: number
  otherEarning: number
  incrementPercent?: number | null
  increment: number
  teamId?: number | null
  teamName?: string | null
  teamSortOrder?: number | null
  teamManagerName?: string | null
}

export type SalarySheetRow = SalarySheetInputRow & {
  matched: boolean
  errors: string[]
  warnings: string[]
  preview?: PmSalaryBreakdown
}

export type SalarySheetResponse = {
  year: number
  month: number
  company: string
  rows: SalarySheetRow[]
  summary: {
    totalRows: number
    matchedRows: number
    errorRows: number
    blockedByApproval: number
    canCalculate: boolean
    savedAt: string | null
    savedBy: string | null
    hasAttendanceData: boolean
    hasSalaryResults: boolean
    lastCalculatedAt: string | null
    attendanceStale: boolean
    staleMessage: string | null
  }
}
