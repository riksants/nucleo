import { CircleEllipsis, House, Search, Settings as SettingsIcon, Sparkles, type LucideIcon } from 'lucide-react'
import type { ModuleId, Settings } from '../data/types'
import { enabledModules, isEnabled } from './modules'
import type { RoutePath } from './router'

export interface Section {
  path: RoutePath
  label: string
  shortLabel?: string
  icon: LucideIcon
}

export const HOME: Section = { path: '/', label: 'Início', icon: House }
export const MORE: Section = { path: '/more', label: 'Mais', icon: CircleEllipsis }
export const SEARCH: Section = { path: '/search', label: 'Buscar', icon: Search }
/** Always available (not a hideable section): Hoje, Início, Mais and the sidebar link to it. */
export const ASSISTANT: Section = { path: '/assistant', label: 'Assistente', icon: Sparkles }
export const SETTINGS: Section = { path: '/settings', label: 'Configurações', icon: SettingsIcon }

/** Preferred order for the three tab-bar slots after Início. The original three come first. */
const PRIMARY_ORDER: ModuleId[] = ['finance', 'projects', 'tasks', 'today', 'agenda', 'week', 'sales', 'routine', 'meals', 'subscribers', 'clients', 'notes']

/** Up to three sections fit in the tab bar after Início. */
export const MAX_TABS = 3

/**
 * Início + up to three enabled sections: the ones the person chose (in their order), or the default order.
 * A chosen section that gets hidden simply leaves the bar (its data stays).
 */
export function primarySections(settings: Pick<Settings, 'modules' | 'tabs'>): Section[] {
  const enabled = enabledModules(settings)
  const order = settings.tabs ?? PRIMARY_ORDER
  const picked = order.filter((id) => isEnabled(settings, id)).slice(0, MAX_TABS)
  return [HOME, ...picked.map((id) => enabled.find((m) => m.id === id)!)]
}

/** Everything enabled that is not in the tab bar, shown under "Mais" and in the sidebar group. */
export function secondarySections(settings: Pick<Settings, 'modules' | 'tabs'>): Section[] {
  const primary = new Set(primarySections(settings).map((s) => s.path))
  return enabledModules(settings).filter((m) => !primary.has(m.path))
}
