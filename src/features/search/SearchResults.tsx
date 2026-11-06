import { ChevronRight, Search } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { isEnabled, MODULE_BY_PATH } from '../../app/modules'
import { navigate, type RoutePath } from '../../app/router'
import { projectOutstanding, sumIn, upcomingCharges } from '../../data/selectors'
import { saleRemaining } from '../../data/sales'
import { useStore } from '../../data/store'
import { formatMoney } from '../../lib/money'
import { EmptyState } from '../../ui/Display'
import { type Destination, type HintId } from './catalog'
import { parseQuery } from './engine'
import { buildRecordIndex } from './records'
import { rankPlaces, searchRecords } from './search'

const MAX_PER_GROUP = 6
const MAX_PLACES = 5
const MAX_ACTIONS = 4

interface Row {
  key: string
  title: string
  subtitle?: ReactNode
  icon?: ReactNode
  go(): void
}

export interface Group {
  label: string
  icon?: ReactNode
  rows: Row[]
}

const go = (path: RoutePath, params?: Record<string, string>) => () => navigate(path, params)

/**
 * The search of the whole app (sections, actions and everything the person registered), shared by the menu ☰ and the
 * Buscar screen: the same engine, the same results.
 */
export function useSearchGroups(query: string): Group[] {
  const store = useStore()
  const { data, settings } = store
  const q = query.trim()
  const index = useMemo(() => buildRecordIndex(data, settings), [data, settings])

  const hint = (id: HintId | undefined): string | undefined => {
    if (!id) return undefined
    const { displayCurrency, convert } = store
    const money = (list: { cents: number; currency: typeof displayCurrency }[]) => {
      const sum = sumIn(list, displayCurrency, convert)
      return `${sum.complete ? '' : '≈ '}${formatMoney(sum.total, displayCurrency)}`
    }
    switch (id) {
      case 'projectsReceivable':
        return `${money(data.projects.map((p) => ({ cents: projectOutstanding(p), currency: p.currency })))} a receber`
      case 'salesReceivable':
        return `${money(data.sales.map((s) => ({ cents: Math.max(0, saleRemaining(s)), currency: s.currency })))} a receber`
      case 'balance':
        return formatMoney(store.balance, settings.baseCurrency)
      case 'upcomingCharges': {
        const n = upcomingCharges(data.tools, 30).length
        return n ? `${n} nos próximos 30 dias` : 'Nenhuma nos próximos 30 dias'
      }
      case 'openTasks': {
        const n = data.tasks.filter((t) => t.status !== 'done').length
        return n === 1 ? '1 em aberto' : `${n} em aberto`
      }
    }
  }

  const groups: Group[] = useMemo(() => {
    if (!q) return []
    const parsed = parseQuery(q)
    const places = rankPlaces(parsed, { enabled: (id) => isEnabled(settings, id), hasSubPlans: data.subPlans.length > 0 })
    const toRow = ({ dest, hidden }: { dest: Destination; hidden: boolean }): Row => {
      const Icon = dest.icon
      const live = hidden ? undefined : hint(dest.hint)
      return {
        key: dest.id,
        title: dest.title,
        subtitle: hidden ? 'Seção escondida · toque para mostrar em Personalizar seções' : live ? `${live} · ${dest.subtitle}` : dest.subtitle,
        icon: <Icon size={18} />,
        go: hidden ? go('/settings', { painel: 'secoes' }) : go(dest.path, dest.params),
      }
    }
    const actions = places.filter((p) => p.dest.kind === 'action').slice(0, MAX_ACTIONS).map(toRow)
    const goTo = places.filter((p) => p.dest.kind !== 'action').slice(0, MAX_PLACES).map(toRow)
    const placeGroups: Group[] = []
    if (goTo.length) placeGroups.push({ label: 'Ir para', rows: goTo })
    if (actions.length) placeGroups.push({ label: 'Fazer agora', rows: actions })
    // "adicionar cliente": the action comes first.
    if (parsed.create) placeGroups.reverse()

    const records: Group[] = searchRecords(index, parsed).map((g) => {
      const Icon = MODULE_BY_PATH[g.path]?.icon ?? Search
      return {
        label: g.label,
        icon: <Icon size={16} />,
        rows: g.hits.map((h) => ({ key: h.key, title: h.title, subtitle: h.subtitle, go: go(h.path, { open: h.openId }) })),
      }
    })
    return [...placeGroups, ...records]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, index, settings, data.subPlans.length])

  return groups
}

/** The result groups. `onGo` runs before navigating (the menu closes itself). */
export function SearchResults({ query, groups, onGo, columns = true }: { query: string; groups: Group[]; onGo?(): void; columns?: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const q = query.trim()
  if (!q) return null
  if (!groups.length)
    return (
      <EmptyState
        compact
        icon={<Search size={20} />}
        title="Nada encontrado"
        text={`Nenhuma seção, ação ou registro para “${q}”. Tente outra palavra ou pergunte ao Assistente.`}
        action="Perguntar ao Assistente"
        onAction={() => (onGo?.(), navigate('/assistant', { ask: q }))}
      />
    )
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)] gap-5 ${columns ? 'lg:grid-cols-2 lg:items-start lg:gap-6' : ''}`} aria-live="polite">
      {groups.map((g) => {
        const all = expanded === g.label
        const rows = all ? g.rows : g.rows.slice(0, MAX_PER_GROUP)
        return (
          <section key={g.label} aria-label={g.label}>
            <h2 className="mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold text-soft">
              {g.icon}
              {g.label}
              {g.icon && <span className="text-faint">{g.rows.length}</span>}
            </h2>
            <div className="card p-1.5">
              {rows.map((r) => (
                <button key={r.key} type="button" onClick={() => (onGo?.(), r.go())} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-tint/[0.03] tap">
                  {r.icon && (
                    <span aria-hidden className="icon-tile grid size-9 shrink-0 place-items-center rounded-xl">
                      {r.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{r.title}</span>
                    {r.subtitle && <span className="block truncate text-[13px] text-faint">{r.subtitle}</span>}
                  </span>
                  <ChevronRight size={16} className="shrink-0 text-faint" />
                </button>
              ))}
              {g.rows.length > MAX_PER_GROUP && !all && (
                <button type="button" onClick={() => setExpanded(g.label)} className="w-full rounded-2xl px-3.5 py-3 text-left text-sm font-medium text-accent-hi">
                  Ver mais {g.rows.length - MAX_PER_GROUP}
                </button>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
