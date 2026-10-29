import { ChevronRight, Search } from 'lucide-react'
import { useDeferredValue, useMemo, useState, type ReactNode } from 'react'
import { isEnabled, MODULE_BY_PATH } from '../../app/modules'
import { navigate, type RoutePath } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { projectOutstanding, sumIn, upcomingCharges } from '../../data/selectors'
import { saleRemaining } from '../../data/sales'
import { useStore } from '../../data/store'
import { formatMoney } from '../../lib/money'
import { EmptyState, SearchField } from '../../ui/Display'
import { EXAMPLES, type Destination, type HintId } from './catalog'
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

interface Group {
  label: string
  icon?: ReactNode
  rows: Row[]
}

const go = (path: RoutePath, params?: Record<string, string>) => () => navigate(path, params)

export function SearchPage() {
  const store = useStore()
  const { data, settings } = store
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  // Typing stays instant; the results catch up right after (useful with many records on a phone).
  const deferred = useDeferredValue(query)
  const q = deferred.trim()

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

  const first = groups[0]?.rows[0]
  const examples = EXAMPLES.filter((e) => !e.module || isEnabled(settings, e.module))

  return (
    <>
      <PageHeader title="Buscar" />
      <form
        role="search"
        className="mb-6"
        onSubmit={(e) => {
          // Enter opens the best result.
          e.preventDefault()
          first?.go()
        }}
      >
        <SearchField value={query} onChange={setQuery} placeholder="Seções, ações, clientes, valores…" autoFocus />
      </form>

      {!query.trim() && (
        <section aria-label="Sugestões">
          <p className="mb-3 px-1 text-[15px] text-soft">Procure uma seção, uma ação ou qualquer coisa que você registrou. Experimente:</p>
          <div className="flex flex-wrap gap-2">
            {examples.map((e) => (
              <button key={e.query} type="button" onClick={() => setQuery(e.query)} className="press rounded-full bg-tint/[0.05] px-4 py-2 text-[14px] font-medium text-ink ring-1 ring-line ring-inset hover:bg-tint/[0.08]">
                {e.query}
              </button>
            ))}
          </div>
        </section>
      )}

      {q && groups.length === 0 && (
        <EmptyState
          compact
          icon={<Search size={20} />}
          title="Nada encontrado"
          text={`Nenhuma seção, ação ou registro para “${q}”. Tente outra palavra ou pergunte ao Assistente.`}
          action="Perguntar ao Assistente"
          onAction={() => navigate('/assistant', { ask: q })}
        />
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2 lg:items-start" aria-live="polite">
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
                  <button key={r.key} type="button" onClick={r.go} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-tint/[0.03] tap">
                    {r.icon && (
                      <span aria-hidden className="icon-tile grid size-9 shrink-0 place-items-center rounded-xl">
                        {r.icon}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{r.title}</span>
                      {r.subtitle && <span className="block truncate text-[13px] text-faint">{r.subtitle}</span>}
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-accent-hi" />
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
    </>
  )
}
