import type { ModuleId } from '../modules/types'

export type FeatureModuleContent = {
  kicker: string
  title: string
  intro: string
  sections: Array<{ title: string; items: string[] }>
  actions?: Array<{ label: string; href: string }>
  requestForm?: 'leave' | 'in-out' | 'reimbursement'
  /** Shown on coming-soon FeatureModulePage banner */
  comingSoonNote?: string
}

export const FEATURE_MODULE_CONTENT: Partial<Record<ModuleId, FeatureModuleContent>> = {
  leaveRequest: {
    kicker: 'Requests',
    title: 'Leave request',
    intro: 'Apply for personal, sick, or casual leave. Track status and approvals on this page.',
    sections: [
      {
        title: 'Before you apply',
        items: [
          'Personal leave (PL): submit at least 24 hours before leave starts.',
          'SL / CL: update on Computax before the first half of the same day.',
          'All leave must be approved by your manager or HR.',
        ],
      },
    ],
    actions: [{ label: 'View leave policy', href: '/policies' }],
  },
  inOutRequest: {
    kicker: 'Requests',
    title: 'In / out request',
    intro:
      'Portal check-in and check-out during shift windows. Managers approve daily punches; HR and leadership see all records.',
    sections: [
      {
        title: 'How it works',
        items: [
          'Check in within one hour of shift start; check out within one hour after shift end (IST).',
          'Device time and server time are both stored.',
          'After check-out, your manager approves before attendance is updated.',
        ],
      },
    ],
  },
  reimbursement: {
    kicker: 'Requests',
    title: 'Reimbursement request',
    intro: 'Submit expense claims and track approval status on this page.',
    sections: [
      {
        title: 'Required details',
        items: [
          'Expense date, amount, and category.',
          'Supporting bills or receipts.',
          'Manager approval before finance processing.',
        ],
      },
    ],
  },
  payslip: {
    kicker: 'Payroll',
    title: 'Pay slip',
    intro:
      'Employee self-service pay slips will appear here after payroll results are wired for each person.',
    comingSoonNote:
      'Pay slips are not downloadable yet. HR can run and export payroll from Salary; employee self-service will link to those results when ready.',
    sections: [
      {
        title: 'Planned pay slip contents',
        items: [
          'Gross pay, deductions, and net pay for the month.',
          'Pay days, late mark deductions, and WFH adjustments.',
          'PF, PT, ESIC, and other statutory components.',
        ],
      },
    ],
    actions: [{ label: 'Back to dashboard', href: '/' }],
  },
  taxInfo: {
    kicker: 'Payroll',
    title: 'Tax information',
    intro: 'Income tax declarations and regime selection - planned for a later release.',
    comingSoonNote:
      'Tax declarations are not editable yet. This page outlines what will be available once the tax workflow is enabled.',
    sections: [
      {
        title: 'Planned tax workspace',
        items: [
          'Section 80C, 80D, HRA, and other declaration entries.',
          'Old vs new tax regime comparison.',
          'Year-to-date taxable income summary.',
        ],
      },
    ],
  },
  tds: {
    kicker: 'Payroll',
    title: 'TDS deduction',
    intro: 'Monthly TDS tracking will connect to payroll results when this module goes live.',
    comingSoonNote:
      'TDS totals are not calculated on this page yet. Figures will come from published salary runs.',
    sections: [
      {
        title: 'Planned TDS summary',
        items: [
          'Monthly TDS deducted from salary.',
          'Cumulative TDS for the financial year.',
          'Year-end reconciliation with your tax certificate.',
        ],
      },
    ],
  },
  form16: {
    kicker: 'Payroll',
    title: 'Form 16',
    intro: 'Annual Form 16 download will be published by HR after year-end closing.',
    comingSoonNote:
      'Form 16 PDFs are not issued from this portal yet. Check with HR for certificates until this workflow is enabled.',
    sections: [
      {
        title: 'Planned Form 16 parts',
        items: [
          'Part A: TDS certificate from the employer.',
          'Part B: Salary breakup and deductions for the year.',
          'Download PDF once HR publishes the certificate.',
        ],
      },
    ],
  },
  documents: {
    kicker: 'People',
    title: 'Documents',
    intro:
      'Upload mandatory onboarding documents. HR and management (Jay/Mansi) can open each employee’s files and previous-employer details in a new tab.',
    sections: [
      {
        title: 'Employees',
        items: [
          'Aadhar, PAN, 10th & 12th certificates (add more degrees), electricity bill or agreement.',
          'Previous company letters, three salary slips, cancelled cheque or passbook.',
        ],
      },
      {
        title: 'HR review',
        items: [
          'All employees and completion status.',
          'View documents opens a tab with uploads plus other previous employer details (location, reason for leaving, reference contact).',
        ],
      },
    ],
  },
  performance: {
    kicker: 'People',
    title: 'Performance appraisal',
    intro: 'Goal setting, mid-year reviews, and annual appraisal cycles.',
    sections: [
      {
        title: 'Appraisal cycle',
        items: [
          'Set OKRs or KPIs at the start of the period.',
          'Manager review and self-assessment forms.',
          'Final rating, feedback, and development plan.',
        ],
      },
    ],
  },
  goalSheet: {
    kicker: 'People',
    title: 'Goal sheet',
    intro: 'Annual goals by team, separate from the appraisal cycle.',
    sections: [
      {
        title: 'Goal sheet cycle',
        items: [
          'Employees document goals for the year.',
          'Managers review and submit to leadership.',
          'Same workflow as performance appraisal, with goal-specific criteria.',
        ],
      },
    ],
  },
}

export function getFeatureModuleContent(moduleId: ModuleId): FeatureModuleContent | null {
  return FEATURE_MODULE_CONTENT[moduleId] ?? null
}
