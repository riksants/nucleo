import { ChevronRight, Search } from 'lucide-react'
import { useState } from 'react'
import { navigate, type RoutePath } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { MODULE_BY_PATH } from '../../app/modules'
import { matches } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Entity } from '../../data/types'
import { formatDateTime } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { EmptyState, SearchField } from '../../ui/Display'

interface Hit {
  id: string
  title: string
  subtitle?: string
}

interface Group {
  path: RoutePath
  label: string
  hits: Hit[]
}

const MAX_PER_GROUP = 6

function iconFor(path: RoutePath) {
  return MODULE_BY_PATH[path]?.icon ?? Search
}

export function SearchPage() {
  const { data } = useStore()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const q = query.trim()

  const group = <T extends Entity>(path: RoutePath, label: string, items: T[], fields: (x: T) => (string | undefined)[], hit: (x: T) => Omit<Hit, 'id'>): Group => ({
    path,
    label,
    hits: items.filter((x) => matches(q, ...fields(x))).map((x) => ({ id: x.id, ...hit(x) })),
  })

  const groups: Group[] = q
    ? [
        group('/clients', 'Clientes', data.clients, (c) => [c.name, c.company, c.email, c.phone, c.location, c.notes], (c) => ({ title: c.name, subtitle: c.company })),
        group('/projects', 'Projetos', data.projects, (p) => [p.name, p.notes, p.link], (p) => ({ title: p.name, subtitle: p.link })),
        group('/tasks', 'Tarefas', data.tasks, (t) => [t.title], (t) => ({ title: t.title, subtitle: t.status === 'done' ? 'Feita' : undefined })),
        group('/tools', 'Ferramentas', data.tools, (t) => [t.name, t.plan, t.notes, t.link], (t) => ({ title: t.name, subtitle: t.price ? formatMoney(t.price, t.currency) : t.plan })),
        group('/finance', 'Movimentações', data.transactions, (t) => [t.reason], (t) => ({
          title: t.reason,
          subtitle: `${formatMoney(t.baseAmount >= 0 ? t.amount : -t.amount, t.currency, { sign: true })} · ${formatDateTime(t.createdAt)}`,
        })),
        group('/notes', 'Anotações', data.notes, (n) => [n.title, n.body], (n) => ({ title: n.title || n.body.slice(0, 60), subtitle: n.title ? n.body.slice(0, 80) : undefined })),
        group('/accounts', 'Contas', data.accounts, (a) => [a.name, a.link, a.email, a.username, a.notes], (a) => ({ title: a.name, subtitle: a.email || a.username })),
        group('/goals', 'Metas', data.goals, (g) => [g.name, g.note], (g) => ({ title: g.name, subtitle: formatMoney(g.price, g.currency) })),
        group('/portfolio', 'Portfólio', data.portfolio, (p) => [p.name, p.notes, p.link], (p) => ({ title: p.name, subtitle: p.link })),
      ].filter((g) => g.hits.length > 0)
    : []

  return (
    <>
      <PageHeader title="Buscar" />
      <div className="mb-6">
        <SearchField value={query} onChange={setQuery} placeholder="Clientes, projetos, notas, contas…" autoFocus />
      </div>

      {!q && <p className="px-1 text-[15px] text-faint">Procure em clientes, projetos, tarefas, ferramentas, movimentações, anotações e contas.</p>}
      {q && groups.length === 0 && <EmptyState compact icon={<Search size={22} />} title="Nada encontrado" text={`Nenhum resultado para “${q}”.`} />}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        {groups.map((g) => {
          const Icon = iconFor(g.path)
          const all = expanded === g.path
          const hits = all ? g.hits : g.hits.slice(0, MAX_PER_GROUP)
          return (
            <section key={g.path}>
              <h2 className="mb-2 flex items-center gap-2 px-1 text-[13px] font-medium tracking-wide text-soft uppercase">
                <Icon size={15} />
                {g.label}
                <span className="text-faint">{g.hits.length}</span>
              </h2>
              <div className="card p-1.5">
                {hits.map((h) => (
                  <button key={h.id} type="button" onClick={() => navigate(g.path, { open: h.id })} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{h.title}</span>
                      {h.subtitle && <span className="block truncate text-[13px] text-faint">{h.subtitle}</span>}
                    </span>
                    <ChevronRight size={16} className="shrink-0 text-faint" />
                  </button>
                ))}
                {g.hits.length > MAX_PER_GROUP && !all && (
                  <button type="button" onClick={() => setExpanded(g.path)} className="w-full rounded-2xl px-3.5 py-3 text-left text-sm font-medium text-accent-hi">
                    Ver mais {g.hits.length - MAX_PER_GROUP}
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
