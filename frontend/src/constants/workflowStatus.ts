export type SalaryWorkflowStep =
  | 'idle'
  | 'uploading'
  | 'validating'
  | 'calculating'
  | 'completed'
  | 'error'

export type ApprovalWorkflowStep =
  | 'idle'
  | 'saving'
  | 'submitting'
  | 'approving'
  | 'approved'
  | 'locked'
  | 'pending'
  | 'draft'
  | 'error'

export type EmailWorkflowStep = 'pending' | 'sent' | 'failed' | 'none'

export const SALARY_WORKFLOW_LABELS: Record<SalaryWorkflowStep, string> = {
  idle: '',
  uploading: 'Uploading…',
  validating: 'Validating…',
  calculating: 'Calculating…',
  completed: 'Completed',
  error: 'Failed',
}

export const APPROVAL_WORKFLOW_LABELS: Record<
  Exclude<ApprovalWorkflowStep, 'idle' | 'error'>,
  string
> = {
  saving: 'Saving…',
  submitting: 'Submitting…',
  approving: 'Approving…',
  approved: 'Approved',
  locked: 'Locked',
  pending: 'Pending',
  draft: 'Draft',
}

export const EMAIL_WORKFLOW_LABELS: Record<Exclude<EmailWorkflowStep, 'none'>, string> = {
  pending: 'Pending',
  sent: 'Sent',
  failed: 'Failed',
}

export type WorkflowTone = 'neutral' | 'loading' | 'success' | 'warning' | 'error' | 'info'

export function salaryWorkflowTone(step: SalaryWorkflowStep): WorkflowTone {
  if (step === 'completed') return 'success'
  if (step === 'error') return 'error'
  if (step === 'idle') return 'neutral'
  return 'loading'
}

export function approvalWorkflowTone(step: ApprovalWorkflowStep): WorkflowTone {
  if (step === 'approved' || step === 'locked') return 'success'
  if (step === 'pending') return 'warning'
  if (step === 'error') return 'error'
  if (step === 'saving' || step === 'submitting' || step === 'approving') return 'loading'
  return 'neutral'
}

export function emailWorkflowTone(step: EmailWorkflowStep): WorkflowTone {
  if (step === 'sent') return 'success'
  if (step === 'failed') return 'error'
  if (step === 'pending') return 'warning'
  return 'neutral'
}

export function weeklyRecordApprovalStep(status: string | null | undefined): ApprovalWorkflowStep {
  const s = (status ?? 'draft').trim().toLowerCase()
  if (s === 'pending' || s === 'pending_approval' || s === 'pending approval') return 'pending'
  if (s === 'locked') return 'locked'
  if (s === 'approved') return 'approved'
  if (s === 'rejected') return 'draft'
  return 'draft'
}
