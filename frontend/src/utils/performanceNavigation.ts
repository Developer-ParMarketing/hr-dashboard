export type PerformanceAppraisalMode = 'manager' | 'management' | 'view'

export function performanceEmployeeAppraisalUrl(
  employeeId: number,
  mode: PerformanceAppraisalMode,
  cycleYear?: number,
): string {
  const q = new URLSearchParams({ mode })
  if (cycleYear != null) q.set('year', String(cycleYear))
  return `/performance/employee/${employeeId}?${q.toString()}`
}

export function openPerformanceEmployeeAppraisal(
  employeeId: number,
  mode: PerformanceAppraisalMode,
  cycleYear?: number,
): void {
  window.open(performanceEmployeeAppraisalUrl(employeeId, mode, cycleYear), '_blank', 'noopener,noreferrer')
}
