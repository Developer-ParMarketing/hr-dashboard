const MIN_DAYS_SINCE_DOJ = 30;

export function daysSinceDoj(dateOfJoining: string | null | undefined, at = new Date()): number | null {
  if (!dateOfJoining || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfJoining.slice(0, 10))) {
    return null;
  }
  const join = new Date(`${dateOfJoining.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(join.getTime())) return null;
  const today = new Date(`${at.toISOString().slice(0, 10)}T12:00:00`);
  const diffMs = today.getTime() - join.getTime();
  return Math.floor(diffMs / 86_400_000);
}

export function canFillAppraisal(dateOfJoining: string | null | undefined, at = new Date()): boolean {
  const days = daysSinceDoj(dateOfJoining, at);
  if (days == null) return false;
  return days >= MIN_DAYS_SINCE_DOJ;
}

export function daysUntilAppraisalEditable(
  dateOfJoining: string | null | undefined,
  at = new Date(),
): number | null {
  const days = daysSinceDoj(dateOfJoining, at);
  if (days == null) return null;
  return Math.max(0, MIN_DAYS_SINCE_DOJ - days);
}
