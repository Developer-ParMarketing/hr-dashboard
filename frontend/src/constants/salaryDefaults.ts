/** Matches backend salaryBase DEFAULT_PM_PT (February payroll uses ₹300 in calculatePmSalary). */
export const DEFAULT_PM_PT = 200

export const DEFAULT_PM_STATUTORY_FORM = {
  pfEmployee: '0',
  esiEmployee: '0',
  pt: String(DEFAULT_PM_PT),
  gratuity: '0',
  employerPf: '0',
  employerPfArr: '0',
  employerEsi: '0',
} as const
