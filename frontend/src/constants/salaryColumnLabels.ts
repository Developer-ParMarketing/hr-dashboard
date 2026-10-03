/**
 * Payroll column titles (keep in sync with backend/src/salary/salaryColumnLabels.ts).
 */
export const SALARY_COLUMN_LABELS: Record<string, string> = {
  fileList: 'File list',
  employeeCode: 'Emp Code',
  employeeName: 'Emp Name',
  doj: 'DOJ',
  process: 'Process',
  department: 'Department',
  gender: 'Gender',
  status: 'Status',
  inHand: 'In Hand',
  pfEmployee: 'PFAmt',
  esiEmployee: 'ESIAmt',
  ptBase: 'PT',
  pt: 'PT',
  gratuityBase: 'Gratuity',
  gratuity: 'Gratuity',
  employerPf: 'Employer PF',
  employerPfArr: 'Employer PFARR',
  employerEsi: 'Employer ESI',
  grossCtc: 'Gross CTC',
  perDay: 'Per Day',
  payDays: 'Pay days',
  wfhDays: 'WFH count',
  lateMarkCount: 'Late mark count',
  grossPay: 'Gross Pay',
  pfEmployeeCalc: 'PF Employee',
  pfEmployer: 'PF Employer',
  esicEmployer: 'ESIC Employer',
  esicEmployee: 'ESIC Employee',
  otherEarning: 'Other Earning',
  wfhDeduction: 'WFH',
  lateMarkDeduction: 'Late Mark',
  incrementPercent: 'Inc. %',
  increment: 'Increment',
  netPay: 'Netpay',
}

/** Full payroll sheet column order (matches PM Excel layout). */
export const SALARY_FULL_COLUMN_KEYS = [
  'employeeCode',
  'employeeName',
  'doj',
  'process',
  'department',
  'gender',
  'status',
  'inHand',
  'pfEmployee',
  'esiEmployee',
  'ptBase',
  'gratuityBase',
  'employerPf',
  'employerPfArr',
  'employerEsi',
  'grossCtc',
  'perDay',
  'payDays',
  'grossPay',
  'gratuity',
  'pt',
  'pfEmployeeCalc',
  'pfEmployer',
  'esicEmployer',
  'esicEmployee',
  'otherEarning',
  'wfhDeduction',
  'lateMarkDeduction',
  'increment',
  'netPay',
] as const

/** Compact headers for the payroll Summary table only. */
export const SALARY_SUMMARY_SHORT_LABELS: Partial<Record<string, string>> = {
  employeeCode: 'Code',
  employeeName: 'Name',
  payDays: 'Days',
  wfhDays: 'WFH #',
  lateMarkCount: 'Late #',
  lateMarkDeduction: 'Late',
}

export function salaryColumnLabelForKey(columnKey: string, view: 'summary' | 'statutory' | 'full'): string {
  if (view === 'summary' && SALARY_SUMMARY_SHORT_LABELS[columnKey]) {
    return SALARY_SUMMARY_SHORT_LABELS[columnKey]!
  }
  return SALARY_COLUMN_LABELS[columnKey] ?? columnKey
}
