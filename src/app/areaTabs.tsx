import { useStore } from '../data/store'
import { SectionTabs, type SectionTab } from '../ui/SectionTabs'
import { isEnabled } from './modules'

type Area = 'rotina' | 'automacoes' | 'importar' | 'metas'

/** The screens joined in each area, as tabs (only the sections that are on). */
function useTabs(area: Area): { title: string; tabs: SectionTab[] } {
  const { settings } = useStore()
  const on = (id: Parameters<typeof isEnabled>[1]) => isEnabled(settings, id)
  switch (area) {
    case 'rotina':
      return {
        title: 'Rotina',
        tabs: [on('routine') && { label: 'Atividades', path: '/routine' as const }, on('habits') && { label: 'Hábitos', path: '/habits' as const }, on('recurring') && { label: 'Recorrentes', path: '/recurring' as const }].filter(Boolean) as SectionTab[],
      }
    case 'automacoes':
      return { title: 'Automações', tabs: [{ label: 'Histórico', path: '/automations' }, { label: 'Regras', path: '/rules' }] }
    case 'importar':
      return {
        title: 'Importar',
        tabs: [{ label: 'Arquivo', path: '/intake' as const }, on('finance') && { label: 'Extrato', path: '/import' as const }, on('finance') && { label: 'Histórico', path: '/imports' as const }].filter(Boolean) as SectionTab[],
      }
    case 'metas':
      return { title: 'Metas', tabs: on('finance') ? [{ label: 'Compras planejadas', path: '/goals' }, { label: 'Reservas', path: '/goals', params: { view: 'reservas' } }] : [] }
  }
}

/** The area's name for the screen title when its tabs show (e.g. "Rotina" over Hábitos), else the screen's own. */
export function useAreaTitle(area: Area, own: string): string {
  const { title, tabs } = useTabs(area)
  return tabs.length > 1 ? title : own
}

export function AreaTabs({ area }: { area: Area }) {
  const { title, tabs } = useTabs(area)
  return <SectionTabs tabs={tabs} label={title} />
}
