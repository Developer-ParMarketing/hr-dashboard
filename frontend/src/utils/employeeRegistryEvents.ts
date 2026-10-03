/** Fired when Admin updates people, teams, or payroll base fields - open tabs should refetch. */
export const EMPLOYEE_REGISTRY_UPDATED = 'hr:employee-registry-updated'

export type EmployeeRegistryUpdatedDetail = {
  employeeId?: number
  source?: 'people' | 'teams'
}

export function notifyEmployeeRegistryUpdated(detail?: EmployeeRegistryUpdatedDetail): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EMPLOYEE_REGISTRY_UPDATED, { detail }))
}

export function subscribeEmployeeRegistryUpdated(
  handler: (detail: EmployeeRegistryUpdatedDetail | undefined) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => {
    handler((event as CustomEvent<EmployeeRegistryUpdatedDetail>).detail)
  }
  window.addEventListener(EMPLOYEE_REGISTRY_UPDATED, listener)
  return () => window.removeEventListener(EMPLOYEE_REGISTRY_UPDATED, listener)
}
