import type { AuthUser } from '../api/auth'
import {
  canEditAttendance,
  isAdminUser,
  isEmployeeDashboardUser,
  isManagerUser,
} from '../auth/permissions'
import type { ReportType } from '../types/reports'

export type ReportDefinition = {
  id: ReportType
  label: string
  description: string
}

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    id: 'leave',
    label: 'Leave',
    description: 'Leave requests in the selected month with status and approver details.',
  },
  {
    id: 'in-out',
    label: 'In / out',
    description: 'Portal punch requests with approval status for the selected month.',
  },
  {
    id: 'self',
    label: 'My attendance',
    description:
      'Your monthly attendance from the saved register: present, late, absent, leave, and worked hours.',
  },
  {
    id: 'team',
    label: 'Team attendance',
    description:
      'Monthly attendance from the saved register for your direct reports (managers) or all employees (HR).',
  },
  {
    id: 'admin',
    label: 'Admin report',
    description: 'Dashboard users, employee counts, uploads, and payroll status.',
  },
  {
    id: 'payroll',
    label: 'Payroll report',
    description: 'Calculated salary rows with deductions and net pay.',
  },
  {
    id: 'contact',
    label: 'Contact report',
    description: 'Employee email, department, shift, and status.',
  },
  {
    id: 'email',
    label: 'Email report',
    description: 'Late and weekly notification emails sent or failed.',
  },
]

export function reportLabel(id: ReportType): string {
  return REPORT_DEFINITIONS.find((item) => item.id === id)?.label ?? id
}

/** Tab label and intro copy scoped to the signed-in role. */
export function reportDefinitionForUser(
  id: ReportType,
  user: AuthUser | null | undefined,
): ReportDefinition {
  const base = REPORT_DEFINITIONS.find((item) => item.id === id) ?? {
    id,
    label: reportLabel(id),
    description: '',
  }

  if (!user) return base

  if (id === 'leave' && isEmployeeDashboardUser(user)) {
    return {
      ...base,
      label: 'My leave',
      description:
        'Your leave requests in the selected month with type, dates, status, and approver details.',
    }
  }
  if (id === 'leave' && isManagerUser(user)) {
    return {
      ...base,
      description:
        'Leave requests for your direct reports in the selected month, with status and approver details.',
    }
  }
  if (id === 'leave' && canEditAttendance(user)) {
    return {
      ...base,
      description: 'Leave requests for all employees in the selected month.',
    }
  }

  if (id === 'in-out' && isEmployeeDashboardUser(user)) {
    return {
      ...base,
      label: 'My in / out',
      description: 'Your portal punch requests for the selected month and their approval status.',
    }
  }
  if (id === 'in-out' && isManagerUser(user)) {
    return {
      ...base,
      description: 'In/out punch requests for your direct reports in the selected month.',
    }
  }
  if (id === 'in-out' && canEditAttendance(user)) {
    return {
      ...base,
      description: 'In/out punch requests for all employees in the selected month.',
    }
  }

  if (id === 'team' && isManagerUser(user)) {
    return {
      ...base,
      description:
        'Monthly attendance from the saved register for people assigned to you: present, late, absent, leave, and hours.',
    }
  }
  if (id === 'team' && canEditAttendance(user) && !isAdminUser(user)) {
    return {
      ...base,
      label: 'Attendance',
      description:
        'Company-wide monthly attendance from the saved register, per employee.',
    }
  }

  return base
}
