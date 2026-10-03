export type PolicySection = {
  id: string
  title: string
  summary: string
  rules: string[]
  note?: string
}

export type PolicyDocument = {
  id: 'attendance' | 'company'
  title: string
  kicker: string
  intro: string
  sections: PolicySection[]
  footnote?: { title: string; text: string }
  pdfFileName: string
  /** When set, Download serves this static PDF from public/ instead of generating one. */
  staticPdfPath?: string
}

export const ATTENDANCE_POLICY: PolicyDocument = {
  id: 'attendance',
  title: 'Attendance policy',
  kicker: 'Time & attendance',
  intro:
    'These rules apply to all employees for late marks, deficit hours, leave, and work from home. They are used when reviewing attendance registers and monthly payroll.',
  pdfFileName: 'Par-HR-Attendance-Policy.pdf',
  sections: [
    {
      id: 'late-mark',
      title: 'Late mark',
      summary: 'Late arrivals are tracked monthly. Salary deduction depends on how many late days you have.',
      rules: [
        'Up to 3 late marks in a month: no salary deduction (cover deficit hours as per policy).',
        '4 or more late marks: from the 3rd late mark onward, each costs 0.5 day pay (e.g. 4 lates → 1.0 day cut; 5 lates → 1.5 days).',
        'A late mark is recorded when you punch in after your shift start time (as per the attendance register).',
      ],
    },
    {
      id: 'half-day-early',
      title: 'Half day & early leave',
      summary: 'Short hours on a working day must be made up within the allowed window.',
      rules: [
        'If you take a half day, deduction is based on hours if you do not complete the required hours within that same day.',
        'If you leave early, you have until the same weekday next week to cover the deficit (e.g. leave early on Monday → cover by next Monday).',
        'Deficit hours should be covered through extra working hours, not by adjusting attendance without HR approval.',
      ],
    },
    {
      id: 'leave-wfh',
      title: 'Leaves & work from home',
      summary: 'All leave and WFH must be approved before it is taken.',
      rules: [
        'All leave and WFH requests must be approved in advance.',
        'Personal Leave (PL): approve at least 24 hours before the leave starts.',
        'Sick Leave (SL) and Casual Leave (CL): approve and update on Computax before the first half of the same day.',
        'Work from home (WFH): IN and OUT punch times must fall within your shift start and end times.',
        'Unapproved absence may be treated as loss of pay (LOP) in payroll.',
      ],
    },
    {
      id: 'registers',
      title: 'Registers & weekly approval',
      summary: 'Attendance uploaded to this system is the basis for salary calculation.',
      rules: [
        'Monthly attendance must be uploaded and weekly totals reviewed before payroll is processed.',
        'Managers verify their team’s attendance; HR runs payroll only after registers are complete for the month.',
        'Disputes on marks or hours must be raised with HR before the month is closed for salary.',
      ],
    },
  ],
  footnote: {
    title: 'Need help?',
    text: 'For exceptions or clarifications, contact HR before changing attendance records or running payroll for the month.',
  },
}

export const COMPANY_POLICY: PolicyDocument = {
  id: 'company',
  title: 'Company policy',
  kicker: 'Par Marketing',
  intro:
    'These guidelines describe how we work together at Par Marketing - professional conduct, confidentiality, and use of company resources. All employees are expected to read and follow them.',
  pdfFileName: 'PM_COMPANY_POLICY.pdf',
  staticPdfPath: '/policies/PM_COMPANY_POLICY.pdf',
  sections: [
    {
      id: 'conduct',
      title: 'Code of conduct',
      summary: 'We expect professional, respectful behaviour at all times.',
      rules: [
        'Treat colleagues, clients, and partners with respect; harassment or discrimination is not tolerated.',
        'Be punctual for meetings, shifts, and client commitments.',
        'Dress and communicate in a manner appropriate for a professional marketing workplace (including client calls and visits).',
        'Substance abuse that affects work performance or safety is prohibited on company premises and during work hours.',
      ],
    },
    {
      id: 'confidentiality',
      title: 'Confidentiality & client data',
      summary: 'Client and company information must be protected.',
      rules: [
        'Do not share client strategies, campaigns, budgets, or contact lists outside the company without written approval.',
        'Use company email and approved tools for work communication; do not forward client data to personal accounts.',
        'Return or delete confidential material when your role ends or when HR requests it.',
        'Report any suspected data breach or loss to HR and your manager immediately.',
      ],
    },
    {
      id: 'it-assets',
      title: 'IT, devices & social media',
      summary: 'Company systems and equipment are for legitimate business use.',
      rules: [
        'Laptops, phones, and access credentials remain company property; do not share passwords or leave devices unlocked.',
        'Install only approved software; do not disable security tools provided by IT.',
        'When posting about work on social media, follow brand and client confidentiality rules; do not disclose unreleased campaigns.',
        'Personal use of company internet should be minimal and must not interfere with work or violate law or policy.',
      ],
    },
    {
      id: 'leave-benefits',
      title: 'Employment, leave & benefits',
      summary: 'Standard terms that apply alongside your offer letter and local law.',
      rules: [
        'Probation, notice period, and benefits are as stated in your offer letter and HR records.',
        'Public holidays and leave types follow company calendar and the attendance policy.',
        'Expense claims require pre-approval where stated and must include valid receipts submitted within the declared timeline.',
        'Side employment or freelance work that conflicts with company or client interests must be disclosed to HR in advance.',
      ],
    },
    {
      id: 'health-safety',
      title: 'Health, safety & workplace',
      summary: 'Everyone contributes to a safe and inclusive workplace.',
      rules: [
        'Follow fire, evacuation, and safety instructions for your work location.',
        'Report hazards, injuries, or unsafe behaviour to HR or administration promptly.',
        'Remote workers must maintain a safe, private workspace suitable for confidential client work.',
      ],
    },
    {
      id: 'updates',
      title: 'Policy updates',
      summary: 'Policies may change as the business and regulations evolve.',
      rules: [
        'HR may update these policies; the latest version on the HR portal replaces earlier copies.',
        'Continued employment after an update constitutes acknowledgment unless local law requires separate consent.',
        'Questions about interpretation should be directed to HR in writing.',
      ],
    },
  ],
  footnote: {
    title: 'Questions?',
    text: 'Contact HR at hr@parmarketing.agency for policy clarifications or to report concerns confidentially.',
  },
}

/** @deprecated use ATTENDANCE_POLICY.sections */
export const ATTENDANCE_POLICY_SECTIONS = ATTENDANCE_POLICY.sections

export const POLICY_TABS = [
  { id: 'attendance' as const, label: 'Attendance policy', document: ATTENDANCE_POLICY },
  { id: 'company' as const, label: 'Company policy', document: COMPANY_POLICY },
]
