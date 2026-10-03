import type { AuthUser } from '../api/auth'
import {
  canEditAttendance,
  canUseOfferLetters,
  isAdminUser,
  isEmployeeDashboardUser,
  isManagerUser,
} from '../auth/permissions'
import { getModuleByPath, MODULE_GROUPS, MODULES } from './registry'
import type { ModuleDefinition, ModuleGroupId, ModuleId } from './types'

const REPORT_MODULE_IDS = new Set<ModuleId>(['reports'])

function canAccessModule(user: AuthUser, module: ModuleDefinition): boolean {
  if (module.id === 'offerLetter' && !canUseOfferLetters(user)) return false
  if (module.id === 'relievingLetter' && !canUseOfferLetters(user)) return false
  if (module.adminOnly && !isAdminUser(user)) return false
  if (module.editorOnly && !canEditAttendance(user)) return false
  if (REPORT_MODULE_IDS.has(module.id)) {
    return (
      isAdminUser(user) ||
      canEditAttendance(user) ||
      isManagerUser(user) ||
      isEmployeeDashboardUser(user)
    )
  }
  return true
}

export function getVisibleModules(user: AuthUser): ModuleDefinition[] {
  return MODULES.filter((m) => canAccessModule(user, m))
}

/** Live modules first, then coming-soon stubs (still listed, not deleted). */
export function sortModulesForNav(modules: ModuleDefinition[]): ModuleDefinition[] {
  return [...modules].sort((a, b) => Number(Boolean(a.comingSoon)) - Number(Boolean(b.comingSoon)))
}

export function getGroupedModules(user: AuthUser): Array<{
  group: (typeof MODULE_GROUPS)[number]
  modules: ModuleDefinition[]
  live: ModuleDefinition[]
  upcoming: ModuleDefinition[]
}> {
  const visible = new Set(getVisibleModules(user).map((m) => m.id))
  return MODULE_GROUPS.map((group) => {
    const modules = sortModulesForNav(
      MODULES.filter((m) => m.group === group.id && visible.has(m.id)),
    )
    return {
      group,
      modules,
      live: modules.filter((m) => !m.comingSoon),
      upcoming: modules.filter((m) => m.comingSoon),
    }
  }).filter((entry) => entry.modules.length > 0)
}

export function getQuickActionModules(user: AuthUser): ModuleDefinition[] {
  return getVisibleModules(user).filter((m) => m.quickActionLabel && !m.comingSoon)
}

export function moduleIdFromPath(pathname: string): ModuleId | null {
  return getModuleByPath(pathname)?.id ?? null
}

export function groupContainsModule(groupId: ModuleGroupId, moduleId: ModuleId): boolean {
  const mod = MODULES.find((m) => m.id === moduleId)
  return mod?.group === groupId
}
