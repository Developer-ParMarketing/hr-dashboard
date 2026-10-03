/** PM salary sheet columns - matches "salary calculation PM.xlsx" (A-AE). */

import { SALARY_COLUMN_LABELS, SALARY_FULL_COLUMN_KEYS, salaryColumnLabelForKey } from './salaryColumnLabels'

export type SalaryInputFieldKey =
  | 'inHand'
  | 'pfEmployee'
  | 'esiEmployee'
  | 'pt'
  | 'gratuity'
  | 'employerPf'
  | 'employerPfArr'
  | 'employerEsi'
  | 'otherEarning'
  | 'incrementPercent'
  | 'increment'

export type PmSalaryColumnKind = 'meta' | 'input' | 'calc'

export type PmSalaryColumnDef = {
  key: string
  label: string
  kind: PmSalaryColumnKind
  field?: keyof PmCalcFields
  inputKey?: SalaryInputFieldKey
}

export type PmCalcFields = {
  grossCtc: number
  perDay: number
  payDays: number
  wfhDays: number
  lateMarkCount: number
  grossPay: number
  gratuity: number
  pt: number
  pfEmployee: number
  pfEmployer: number
  esicEmployer: number
  esicEmployee: number
  wfhDeduction: number
  lateMarkDeduction: number
  netPay: number
}

const L = (key: string): string => SALARY_COLUMN_LABELS[key] ?? key

export const PM_SALARY_COLUMNS: PmSalaryColumnDef[] = [
  { key: 'employeeCode', label: L('employeeCode'), kind: 'meta' },
  { key: 'employeeName', label: L('employeeName'), kind: 'meta' },
  { key: 'doj', label: L('doj'), kind: 'meta' },
  { key: 'process', label: L('process'), kind: 'meta' },
  { key: 'department', label: L('department'), kind: 'meta' },
  { key: 'gender', label: L('gender'), kind: 'meta' },
  { key: 'status', label: L('status'), kind: 'meta' },
  { key: 'inHand', label: L('inHand'), kind: 'input', inputKey: 'inHand' },
  { key: 'pfEmployee', label: L('pfEmployee'), kind: 'input', inputKey: 'pfEmployee' },
  { key: 'esiEmployee', label: L('esiEmployee'), kind: 'input', inputKey: 'esiEmployee' },
  { key: 'ptBase', label: L('ptBase'), kind: 'input', inputKey: 'pt' },
  { key: 'gratuityBase', label: L('gratuityBase'), kind: 'input', inputKey: 'gratuity' },
  { key: 'employerPf', label: L('employerPf'), kind: 'input', inputKey: 'employerPf' },
  { key: 'employerPfArr', label: L('employerPfArr'), kind: 'input', inputKey: 'employerPfArr' },
  { key: 'employerEsi', label: L('employerEsi'), kind: 'input', inputKey: 'employerEsi' },
  { key: 'grossCtc', label: L('grossCtc'), kind: 'calc', field: 'grossCtc' },
  { key: 'perDay', label: L('perDay'), kind: 'calc', field: 'perDay' },
  { key: 'payDays', label: L('payDays'), kind: 'calc', field: 'payDays' },
  { key: 'wfhDays', label: L('wfhDays'), kind: 'calc', field: 'wfhDays' },
  { key: 'lateMarkCount', label: L('lateMarkCount'), kind: 'calc', field: 'lateMarkCount' },
  { key: 'grossPay', label: L('grossPay'), kind: 'calc', field: 'grossPay' },
  { key: 'gratuity', label: L('gratuity'), kind: 'calc', field: 'gratuity' },
  { key: 'pt', label: L('pt'), kind: 'calc', field: 'pt' },
  { key: 'pfEmployeeCalc', label: L('pfEmployeeCalc'), kind: 'calc', field: 'pfEmployee' },
  { key: 'pfEmployer', label: L('pfEmployer'), kind: 'calc', field: 'pfEmployer' },
  { key: 'esicEmployer', label: L('esicEmployer'), kind: 'calc', field: 'esicEmployer' },
  { key: 'esicEmployee', label: L('esicEmployee'), kind: 'calc', field: 'esicEmployee' },
  { key: 'otherEarning', label: L('otherEarning'), kind: 'input', inputKey: 'otherEarning' },
  { key: 'wfhDeduction', label: L('wfhDeduction'), kind: 'calc', field: 'wfhDeduction' },
  { key: 'lateMarkDeduction', label: L('lateMarkDeduction'), kind: 'calc', field: 'lateMarkDeduction' },
  { key: 'increment', label: L('increment'), kind: 'input', inputKey: 'increment' },
  { key: 'netPay', label: L('netPay'), kind: 'calc', field: 'netPay' },
  /** Not shown on PM sheet - used for row save / internal refs only */
  { key: 'incrementPercent', label: L('incrementPercent'), kind: 'input', inputKey: 'incrementPercent' },
  { key: 'fileList', label: L('fileList'), kind: 'meta' },
]

/** All columns - PM sheet layout (Emp Code … Netpay). */
const FULL_COLUMN_KEYS = SALARY_FULL_COLUMN_KEYS

const COLUMN_BY_KEY = new Map(PM_SALARY_COLUMNS.map((c) => [c.key, c]))

export type SalaryTableView = 'summary' | 'statutory' | 'full'

const SUMMARY_COLUMN_KEYS = [
  'employeeCode',
  'employeeName',
  'inHand',
  'payDays',
  'wfhDays',
  'lateMarkCount',
  'grossPay',
  'wfhDeduction',
  'lateMarkDeduction',
  'incrementPercent',
  'increment',
  'otherEarning',
  'netPay',
] as const

const STATUTORY_COLUMN_KEYS = [
  'employeeCode',
  'employeeName',
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
  'wfhDeduction',
  'lateMarkDeduction',
  'incrementPercent',
  'increment',
  'otherEarning',
  'netPay',
] as const

function pickColumns(keys: readonly string[]): PmSalaryColumnDef[] {
  return keys
    .map((key) => COLUMN_BY_KEY.get(key))
    .filter((c): c is PmSalaryColumnDef => c != null)
}

export function salaryColumnsForView(view: SalaryTableView): PmSalaryColumnDef[] {
  switch (view) {
    case 'summary':
      return pickColumns(SUMMARY_COLUMN_KEYS)
    case 'statutory':
      return pickColumns(STATUTORY_COLUMN_KEYS)
    case 'full':
    default:
      return pickColumns(FULL_COLUMN_KEYS)
  }
}

export function salaryColumnLabel(col: PmSalaryColumnDef, view: SalaryTableView): string {
  return salaryColumnLabelForKey(col.key, view)
}

export function isStickySalaryColumn(key: string): boolean {
  return key === 'employeeCode' || key === 'employeeName'
}

export const SALARY_TABLE_VIEW_OPTIONS: { id: SalaryTableView; label: string; hint: string }[] = [
  { id: 'summary', label: 'Summary', hint: 'Days, WFH & late counts, gross, deductions, net' },
  { id: 'statutory', label: 'Base & pay', hint: 'In hand, PF/ESI/PT, rates, net' },
  { id: 'full', label: 'All columns', hint: 'Emp Code through Netpay (30 columns)' },
]

export const SALARY_INPUT_COLUMNS = PM_SALARY_COLUMNS.filter(
  (c): c is PmSalaryColumnDef & { inputKey: SalaryInputFieldKey } =>
    c.kind === 'input' && c.inputKey != null,
).map((c) => ({
  key: c.inputKey,
  label: c.label,
  min: c.inputKey === 'inHand' ? 0 : undefined,
}))

/** Persistent base salary fields (Admin employee profile - not monthly increment/other). */
export const SALARY_BASE_PROFILE_COLUMNS = SALARY_INPUT_COLUMNS.filter(
  (col) => col.key !== 'increment' && col.key !== 'incrementPercent' && col.key !== 'otherEarning',
)

export const SALARY_META_COLUMNS = PM_SALARY_COLUMNS.filter((c) => c.kind === 'meta')

export const SALARY_CALCULATED_COLUMNS = PM_SALARY_COLUMNS.filter(
  (c): c is PmSalaryColumnDef & { field: keyof PmCalcFields } =>
    c.kind === 'calc' && c.field != null,
).map((c) => ({ label: c.label, field: c.field }))

export { SALARY_COLUMN_LABELS } from './salaryColumnLabels'

/** @deprecated use PM_SALARY_COLUMNS */
export { PM_SALARY_COLUMNS as SALARY_ALL_COLUMNS }
