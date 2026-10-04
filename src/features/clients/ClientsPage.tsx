import { ChevronRight, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../../app/Shell'
import { CLIENT_STATUS, optionOf } from '../../data/labels'
import { matches } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Client, ClientStatus } from '../../data/types'
import { usePref } from '../../lib/prefs'
import { Button } from '../../ui/Button'
import { Badge, EmptyState, SearchField } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { Chips } from '../../ui/Segmented'
import { useOpenParam } from '../useOpenParam'
import { ClientDetail } from './ClientDetail'
import { ClientForm } from './ClientForm'

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

export function ClientsPage() {
  const { data } = useStore()
  const [filter, setFilter] = usePref<ClientStatus | 'all'>('clients.filter', 'all')
  const [query, setQuery] = useState('')
  const detail = useSheet<Client>()
  const form = useSheet<Client>()
  useOpenParam(data.clients, detail.show)

  const list = [...data.clients]
    .filter((c) => (filter === 'all' || c.status === filter) && matches(query, c.name, c.company, c.email, c.location))
    .sort((a, b) => a.name.localeCompare(b.name))

  const edit = (c: Client | null) => {
    detail.close()
    form.show(c)
  }

  return (
    <>
      <PageHeader
        title="Clientes"
        actions={
          <Button icon={<Plus size={18} />} onClick={() => edit(null)}>
            Novo
          </Button>
        }
      />
      {data.clients.length === 0 ? (
        <EmptyState icon={<Users size={22} />} title="Nenhum cliente ainda" text="Guarde contatos e acompanhe projetos e valores de cada cliente." action="Adicionar cliente" onAction={() => edit(null)} />
      ) : (
        <>
          <div className="mb-3">
            <SearchField value={query} onChange={setQuery} placeholder="Buscar cliente" />
          </div>
          <div className="mb-5">
            <Chips value={filter} onChange={setFilter} options={[{ value: 'all' as const, label: 'Todos' }, ...CLIENT_STATUS]} />
          </div>
          {list.length ? (
            <div className="card p-1.5 lg:grid lg:grid-cols-2 lg:gap-x-2">
              {list.map((c) => {
                const s = optionOf(CLIENT_STATUS, c.status)
                return (
                  <button key={c.id} type="button" onClick={() => detail.show(c)} className="flex w-full items-center gap-3.5 rounded-2xl px-2.5 py-3 text-left transition-colors hover:bg-white/[0.03] tap">
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-elevated text-[15px] font-semibold text-soft">{initials(c.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{c.name}</span>
                      {(c.company || c.location) && <span className="block truncate text-[13px] text-faint">{[c.company, c.location].filter(Boolean).join(' · ')}</span>}
                    </span>
                    <Badge tone={s.tone}>{s.label}</Badge>
                    <ChevronRight size={18} className="shrink-0 text-faint" />
                  </button>
                )
              })}
            </div>
          ) : (
            <EmptyState compact icon={<Users size={22} />} title="Nenhum cliente encontrado" />
          )}
        </>
      )}
      <ClientDetail client={detail.item} open={detail.open} onClose={detail.close} onEdit={edit} />
      <ClientForm client={form.item} open={form.open} onClose={form.close} />
    </>
  )
}
