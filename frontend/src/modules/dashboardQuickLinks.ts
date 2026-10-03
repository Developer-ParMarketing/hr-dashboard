import type { AuthUser } from '../api/auth'
import { canEditAttendance, isManagerUser } from '../auth/permissions'
import type { ModuleId } from './types'

export type DashboardQuickLink = {
  moduleId: ModuleId
  href: string
  label: string
  hint: string
}

export const EMPLOYEE_DASHBOARD_QUICK_LINKS: DashboardQuickLink[] = [
  {
    moduleId: 'leaveRequest',
    href: '/leave-request',
    label: 'Leave request',
    hint: 'Apply or track leave',
  },
  {
    moduleId: 'inOutRequest',
    href: '/in-out-request',
    label: 'In / out',
    hint: 'Portal punch & corrections',
  },
  {
    moduleId: 'reimbursement',
    href: '/reimbursement',
    label: 'Reimbursement',
    hint: 'Submit expense claims',
  },
  {
    moduleId: 'documents',
    href: '/documents',
    label: 'Documents',
    hint: 'Upload onboarding files',
  },
  {
    moduleId: 'attendance',
    href: '/attendance',
    label: 'My attendance',
    hint: 'View your register',
  },
]

export function managerDashboardQuickLinks(user: AuthUser): DashboardQuickLink[] {
  const links: DashboardQuickLink[] = [
    {
      moduleId: 'leaveRequest',
      href: '/leave-request',
      label: 'Approve requests',
      hint: 'Leave, reimbursement, in/out',
    },
    {
      moduleId: 'attendance',
      href: '/attendance',
      label: 'Team attendance',
      hint: 'Review & approve weeks',
    },
    {
      moduleId: 'performance',
      href: '/performance',
      label: 'Appraisals',
      hint: 'Team performance forms',
    },
  ]
  if (canEditAttendance(user) || isManagerUser(user)) {
    links.push({
      moduleId: 'reports',
      href: '/reports/leave',
      label: 'Reports',
      hint: 'Leave & in/out',
    })
  }
  return links
}
