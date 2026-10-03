import type { ModuleId } from '../modules/types'

/** Feature modules rendered by FeatureModulePage */
export const FEATURE_MODULE_ROUTES: Array<{ path: string; moduleId: ModuleId }> = [
  { path: '/leave-request', moduleId: 'leaveRequest' },
  { path: '/in-out-request', moduleId: 'inOutRequest' },
  { path: '/reimbursement', moduleId: 'reimbursement' },
  { path: '/payslip', moduleId: 'payslip' },
  { path: '/tax-information', moduleId: 'taxInfo' },
  { path: '/tds-deduction', moduleId: 'tds' },
  { path: '/form-16', moduleId: 'form16' },
  { path: '/documents', moduleId: 'documents' },
  { path: '/performance', moduleId: 'performance' },
]
