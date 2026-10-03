import type { NormalizedEmployee } from '../types/attendance'

export type TeamGroupingMeta = {
  teamId: number | null
  teamName: string
  teamSortOrder: number
  teamManagerName?: string
}

export type TeamGroupedRows<T> = {
  group: TeamGroupingMeta
  items: T[]
}

export const UNASSIGNED_TEAM_LABEL = 'Unassigned'

export function teamMetaFromEmployee(emp: Pick<
  NormalizedEmployee,
  'teamId' | 'teamName' | 'teamSortOrder' | 'teamManagerName'
>): TeamGroupingMeta {
  const teamName = emp.teamName?.trim() || UNASSIGNED_TEAM_LABEL
  return {
    teamId: emp.teamId ?? null,
    teamName,
    teamSortOrder: emp.teamSortOrder ?? 9999,
    teamManagerName: emp.teamManagerName,
  }
}

export function groupRowsByTeam<T>(
  rows: T[],
  getMeta: (row: T) => TeamGroupingMeta,
): TeamGroupedRows<T>[] {
  const map = new Map<string, TeamGroupedRows<T>>()
  for (const row of rows) {
    const meta = getMeta(row)
    const key = meta.teamId != null ? String(meta.teamId) : 'unassigned'
    const existing = map.get(key)
    if (existing) {
      existing.items.push(row)
      continue
    }
    map.set(key, { group: meta, items: [row] })
  }
  return [...map.values()].sort((a, b) => {
    if (a.group.teamSortOrder !== b.group.teamSortOrder) {
      return a.group.teamSortOrder - b.group.teamSortOrder
    }
    return a.group.teamName.localeCompare(b.group.teamName)
  })
}

export function employeeTeamLookup(
  employees: NormalizedEmployee[],
): Map<number, TeamGroupingMeta> {
  const map = new Map<number, TeamGroupingMeta>()
  for (const emp of employees) {
    if (emp.id == null) continue
    map.set(emp.id, teamMetaFromEmployee(emp))
  }
  return map
}

export function filterEmployeesByTeam(
  employees: NormalizedEmployee[],
  teamFilter: number | 'all',
): NormalizedEmployee[] {
  if (teamFilter === 'all') return employees
  return employees.filter((emp) => emp.teamId === teamFilter)
}
