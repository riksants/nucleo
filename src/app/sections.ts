import { CircleEllipsis, House, Search, Settings as SettingsIcon, type LucideIcon } from 'lucide-react'
import type { ModuleId, Settings } from '../data/types'
import { enabledModules, isEnabled } from './modules'
import type { RoutePath } from './router'

export interface Section {
  path: RoutePath
  label: string
  icon: LucideIcon
}

export const HOME: Section = { path: '/', label: 'Início', icon: House }
export const MORE: Section = { path: '/more', label: 'Mais', icon: CircleEllipsis }
export const SEARCH: Section = { path: '/search', label: 'Buscar', icon: Search }
export const SETTINGS: Section = { path: '/settings', label: 'Configurações', icon: SettingsIcon }

/** Preferred order for the three tab-bar slots after Início. The original three come first. */
const PRIMARY_ORDER: ModuleId[] = ['finance', 'projects', 'tasks', 'today', 'sales', 'routine', 'meals', 'subscribers', 'clients', 'notes']

/** Início + up to three enabled sections. Same tabs as before unless the person hides one. */
export function primarySections(settings: Pick<Settings, 'modules'>): Section[] {
  const enabled = enabledModules(settings)
  const picked = PRIMARY_ORDER.filter((id) => isEnabled(settings, id)).slice(0, 3)
  return [HOME, ...picked.map((id) => enabled.find((m) => m.id === id)!)]
}

/** Everything enabled that is not in the tab bar, shown under "Mais" and in the sidebar group. */
export function secondarySections(settings: Pick<Settings, 'modules'>): Section[] {
  const primary = new Set(primarySections(settings).map((s) => s.path))
  return enabledModules(settings).filter((m) => !primary.has(m.path))
}
