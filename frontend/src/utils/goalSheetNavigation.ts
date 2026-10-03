export type GoalSheetReviewMode = 'manager' | 'management' | 'view'

export function goalSheetEmployeeUrl(employeeId: number, mode: GoalSheetReviewMode, cycleYear?: number): string {
  const q = new URLSearchParams({ mode })
  if (cycleYear != null) q.set('year', String(cycleYear))
  return `/goal-sheet/employee/${employeeId}?${q.toString()}`
}

export function openGoalSheetEmployee(
  employeeId: number,
  mode: GoalSheetReviewMode,
  cycleYear?: number,
): void {
  window.open(goalSheetEmployeeUrl(employeeId, mode, cycleYear), '_blank', 'noopener,noreferrer')
}
