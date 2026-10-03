import { runConfirm } from './confirmBridge'

export async function confirmAction(message: string): Promise<boolean> {
  return runConfirm({ message })
}

/** High-stakes saves (payroll sheet, holidays). Inline attendance edits save without prompting. */
export async function confirmSave(subject: string): Promise<boolean> {
  return runConfirm({
    title: 'Save changes?',
    message: `Save ${subject}?`,
    confirmLabel: 'Save',
  })
}

export async function confirmUpdate(subject: string): Promise<boolean> {
  return runConfirm({
    title: 'Save changes?',
    message: `Save changes to ${subject}?`,
    confirmLabel: 'Save',
  })
}

export async function confirmDelete(subject: string): Promise<boolean> {
  return runConfirm({
    title: 'Delete permanently?',
    message: `Delete ${subject}?`,
    detail: 'This cannot be undone.',
    tone: 'danger',
    confirmLabel: 'Delete',
  })
}

export async function confirmRemove(subject: string): Promise<boolean> {
  return runConfirm({
    title: 'Remove?',
    message: `Remove ${subject}?`,
    confirmLabel: 'Remove',
    tone: 'danger',
  })
}

/** Blocking OK dialog for form validation and other non-confirm errors. */
export async function showFormAlert(title: string, message: string): Promise<void> {
  await runConfirm({
    title,
    message,
    confirmLabel: 'OK',
    alertOnly: true,
  })
}

export async function confirmMonthlyBulkDecision(
  employeeCount: number,
  status: 'approved' | 'rejected',
): Promise<boolean> {
  const verb = status === 'approved' ? 'Approve' : 'Reject'
  const emp = employeeCount === 1 ? '1 employee' : `${employeeCount} employees`
  return runConfirm({
    title: status === 'approved' ? 'Approve monthly attendance?' : 'Reject monthly attendance?',
    message: `${verb} monthly attendance for ${emp}?`,
    detail: 'Daily and weekly views stay editable until the month is approved here.',
    confirmLabel: verb,
    tone: status === 'rejected' ? 'danger' : 'default',
  })
}

export async function confirmWeeklyBulkDecision(
  count: number,
  status: 'approved' | 'rejected',
): Promise<boolean> {
  const verb = status === 'approved' ? 'Approve' : 'Reject'
  const noun = count === 1 ? '1 weekly record' : `${count} weekly records`
  return runConfirm({
    title: status === 'approved' ? 'Approve weeks?' : 'Reject weeks?',
    message: `${verb} ${noun}?`,
    confirmLabel: verb,
    tone: status === 'rejected' ? 'danger' : 'default',
  })
}

export async function confirmRequestDecision(
  status: 'approved' | 'rejected',
  summary: string,
): Promise<boolean> {
  const verb = status === 'approved' ? 'Approve' : 'Reject'
  return runConfirm({
    title: `${verb} request?`,
    message: `${verb} this request?`,
    detail: summary,
    confirmLabel: verb,
    tone: status === 'rejected' ? 'danger' : 'default',
  })
}
