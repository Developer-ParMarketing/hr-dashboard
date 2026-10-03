import type { ModuleDefinition, ModuleGroupDefinition } from './types'

// Sidebar and home tiles - pair new routes with an entry here and in main.tsx.

export const MODULE_GROUPS: ModuleGroupDefinition[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'time', label: 'Time & attendance' },
  { id: 'requests', label: 'Requests' },
  /** Live: Salary (HR). Employee payslip + tax modules stay listed but marked coming soon. */
  { id: 'payroll', label: 'Payroll' },
  { id: 'reports', label: 'Reports' },
  { id: 'people', label: 'People' },
  { id: 'admin', label: 'Administration' },
]

/** Single source of truth for HR modules - add new entries here as routes ship. */
export const MODULES: ModuleDefinition[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Month status, pending actions, and module shortcuts.',
    group: 'overview',
    icon: '◫',
    href: '/',
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Account details, workspace defaults, and session.',
    group: 'overview',
    icon: '⚙',
    href: '/settings',
  },
  {
    id: 'attendance',
    label: 'Attendance',
    description: 'Upload ESSL daily, weekly, and monthly register files.',
    group: 'time',
    icon: '◷',
    href: '/attendance',
    quickActionLabel: 'Upload register',
  },
  {
    id: 'attendanceDetail',
    label: 'Attendance history',
    description: 'History & saved months - browse uploaded registers.',
    group: 'time',
    icon: '◷',
    href: '/attendance-detail',
    /** Saved-register browse is HR/editor work; employees use Attendance. */
    editorOnly: true,
  },
  {
    id: 'policies',
    label: 'Policies',
    description: 'Late marks, deficit hours, leave, and WFH rules.',
    group: 'time',
    icon: '◈',
    href: '/policies',
  },
  {
    id: 'holidayList',
    label: 'Holiday list',
    description: 'Company holidays by year for all employees.',
    group: 'time',
    icon: '◷',
    href: '/holidays',
  },
  {
    id: 'leaveRequest',
    label: 'Leave request',
    description: 'Apply for PL, SL, or CL with manager approval.',
    group: 'requests',
    icon: '◷',
    href: '/leave-request',
  },
  {
    id: 'inOutRequest',
    label: 'In/out request',
    description: 'Request a correction for missed punch in or out.',
    group: 'requests',
    icon: '◷',
    href: '/in-out-request',
  },
  {
    id: 'reimbursement',
    label: 'Reimbursement',
    description: 'Submit expense claims with receipts for approval.',
    group: 'requests',
    icon: '₹',
    href: '/reimbursement',
  },
  {
    id: 'payslip',
    label: 'Pay slip',
    description: 'View and download your monthly pay slip (coming soon).',
    group: 'payroll',
    icon: '₹',
    href: '/payslip',
    comingSoon: true,
  },
  {
    id: 'salary',
    label: 'Salary',
    description: 'HR: monthly sheet, calculate payroll, results and exports.',
    group: 'payroll',
    icon: '₹',
    href: '/salary',
    editorOnly: true,
    quickActionLabel: 'Run payroll',
  },
  {
    id: 'taxInfo',
    label: 'Tax information',
    description: 'Declarations, regime, and annual tax summary.',
    group: 'payroll',
    icon: '◈',
    href: '/tax-information',
    comingSoon: true,
  },
  {
    id: 'tds',
    label: 'TDS deduction',
    description: 'Monthly and year-to-date tax deducted at source.',
    group: 'payroll',
    icon: '◈',
    href: '/tds-deduction',
    comingSoon: true,
  },
  {
    id: 'form16',
    label: 'Form 16',
    description: 'Annual tax certificate Part A and Part B.',
    group: 'payroll',
    icon: '◈',
    href: '/form-16',
    comingSoon: true,
  },
  {
    id: 'reports',
    label: 'Reports',
    description: 'Leave, in/out, team, payroll, and other monthly exports.',
    group: 'reports',
    icon: '▤',
    href: '/reports',
  },
  {
    id: 'documents',
    label: 'Documents',
    description: 'Personal files, HR letters, and company policies.',
    group: 'people',
    icon: '◈',
    href: '/documents',
  },
  {
    id: 'performance',
    label: 'Performance appraisal',
    description: 'Team appraisal forms, self-assessment, and manager reviews.',
    group: 'people',
    icon: '◫',
    href: '/performance',
  },
  {
    id: 'goalSheet',
    label: 'Goal sheet',
    description: 'Annual goal setting with self, manager, and leadership review.',
    group: 'people',
    icon: '◫',
    href: '/goal-sheet',
  },
  {
    id: 'offerLetter',
    label: 'Offer letter',
    description: 'Generate offer PDFs and email candidates with joining forms.',
    group: 'people',
    icon: '◈',
    href: '/offer-letter',
  },
  {
    id: 'relievingLetter',
    label: 'Relieving letter',
    description: 'Experience / relieving letter PDF with letterhead and digital signature.',
    group: 'people',
    icon: '◈',
    href: '/relieving-letter',
  },
  {
    id: 'admin',
    label: 'Admin',
    description: 'People, dashboard access, and manager team assignments.',
    group: 'admin',
    icon: '⚙',
    href: '/admin',
    adminOnly: true,
    quickActionLabel: 'Add person',
  },
]

export function getModuleById(id: string): ModuleDefinition | undefined {
  return MODULES.find((m) => m.id === id)
}

export function getModuleByPath(pathname: string): ModuleDefinition | undefined {
  if (pathname === '/' || pathname === '') {
    return MODULES.find((m) => m.id === 'dashboard')
  }
  const exact = MODULES.find((m) => pathname === m.href)
  if (exact) return exact
  const sorted = [...MODULES].sort((a, b) => b.href.length - a.href.length)
  return sorted.find((m) => m.href !== '/' && pathname.startsWith(`${m.href}/`))
}
