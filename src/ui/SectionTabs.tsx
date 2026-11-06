import { useRoute, type RoutePath } from '../app/router'

export interface SectionTab {
  label: string
  path: RoutePath
  /** Extra query (e.g. view=reservas); the tab is current only when it matches. */
  params?: Record<string, string>
}

/**
 * Tabs on the orange band that join screens of one area (Rotina: Atividades · Hábitos · Recorrentes; Automações:
 * Histórico · Regras; Importar; Metas). Links, so the back button and old links keep working.
 */
export function SectionTabs({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  const { path, params } = useRoute()
  if (tabs.length < 2) return null
  const isCurrent = (t: SectionTab) => t.path === path && Object.entries(t.params ?? {}).every(([k, v]) => params.get(k) === v) && (t.params ? true : !tabs.some((o) => o !== t && o.path === path && o.params && Object.entries(o.params).every(([k, v]) => params.get(k) === v)))
  return (
    <nav aria-label={label} className="section-tabs flex w-full gap-1 rounded-[13px] p-[3px] lg:max-w-md">
      {tabs.map((t) => {
        const current = isCurrent(t)
        const query = t.params ? `?${new URLSearchParams(t.params)}` : ''
        return (
          <a
            key={t.label}
            href={`#${t.path}${query}`}
            aria-current={current ? 'page' : undefined}
            className={`flex h-[34px] min-w-0 flex-1 items-center justify-center rounded-[10px] px-2 text-[15px] whitespace-nowrap transition-colors ${current ? 'section-tab-on font-semibold' : 'font-medium opacity-80 hover:opacity-100'}`}
          >
            <span className="truncate">{t.label}</span>
          </a>
        )
      })}
    </nav>
  )
}
