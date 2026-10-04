import { BadgeDollarSign, ChevronRight, Pencil, Plus, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../../app/Shell'
import {
  BUYER_STATUS_LABEL,
  BUYER_TONE,
  buyers as groupBuyers,
  clientKey,
  isOverdue,
  saleRemaining,
  saleStatus,
  salesOverview,
  SALE_STATUS_LABEL,
  type Buyer,
  type BuyerStatus,
  type MoneyTotals,
  type SaleFilter,
} from '../../data/sales'
import { matches } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Currency, Sale } from '../../data/types'
import { formatDateValue, relativeDays } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { Button, IconButton } from '../../ui/Button'
import { Badge, EmptyState, SearchField } from '../../ui/Display'
import { Field, Select, TextInput } from '../../ui/Field'
import { useSheet } from '../../ui/formHooks'
import { Chips, Segmented } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { useOpenParam } from '../useOpenParam'
import { useBuyerName } from './useBuyerName'
import { BuyerDetail } from './BuyerDetail'
import { SaleForm, SalePayments, STATUS_TONE, type BuyerPreset } from './SaleForm'

const STATUS_FILTERS: { value: SaleFilter['status']; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'partial', label: 'Parciais' },
  { value: 'paid', label: 'Quitadas' },
  { value: 'overdue', label: 'Atrasadas' },
]

const PEOPLE_FILTERS: { value: BuyerStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'paid', label: 'Pagos' },
  { value: 'partial', label: 'Parciais' },
  { value: 'pending', label: 'Pendentes' },
]

/** Money of several currencies, one per line (never added together). */
function MoneyLines({ list, pick, className }: { list: MoneyTotals[]; pick(t: MoneyTotals): number; className: string }) {
  return (
    <>
      {list.map((t) => (
        <span key={t.currency} className={`num block truncate ${className}`}>
          {formatMoney(pick(t), t.currency)}
        </span>
      ))}
    </>
  )
}

/** Simple summary at the top of Vendas. */
function Overview({ totals, owing }: { totals: MoneyTotals[]; owing: number }) {
  return (
    <div className="card mb-5 grid grid-cols-2 gap-x-4 gap-y-3 p-4 pl-5 sm:grid-cols-4" aria-label="Resumo de vendas">
      <div className="min-w-0">
        <p className="text-[12px] text-faint">Total vendido</p>
        <MoneyLines list={totals} pick={(t) => t.total} className="text-[17px] font-semibold" />
      </div>
      <div className="min-w-0">
        <p className="text-[12px] text-faint">Total recebido</p>
        <MoneyLines list={totals} pick={(t) => t.paid} className="text-[17px] font-semibold text-income" />
      </div>
      <div className="min-w-0">
        <p className="text-[12px] text-faint">Total a receber</p>
        <MoneyLines list={totals} pick={(t) => t.remaining} className="text-[17px] font-semibold text-warn" />
      </div>
      <div className="min-w-0">
        <p className="text-[12px] text-faint">Pessoas com valor pendente</p>
        <span className="num block text-[17px] font-semibold">{owing}</span>
      </div>
    </div>
  )
}

function BuyerRow({ buyer, onOpen }: { buyer: Buyer; onOpen(b: Buyer): void }) {
  const owing = buyer.totals.filter((t) => t.remaining > 0)
  return (
    <button type="button" onClick={() => onOpen(buyer)} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03] tap">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{buyer.name}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[13px] text-faint">
          {buyer.sales.length} {buyer.sales.length === 1 ? 'compra' : 'compras'} <Badge tone={BUYER_TONE[buyer.status]}>{BUYER_STATUS_LABEL[buyer.status]}</Badge>
        </span>
      </span>
      <span className="shrink-0 text-right">
        {owing.length ? (
          owing.map((t) => (
            <span key={t.currency} className="num block text-[15px] font-semibold text-warn">
              {formatMoney(t.remaining, t.currency)}
            </span>
          ))
        ) : (
          <MoneyLines list={buyer.totals} pick={(t) => t.total} className="text-[15px] font-semibold text-soft" />
        )}
        <span className="block text-[12px] text-faint">{owing.length ? 'pendente' : 'comprado'}</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-faint" />
    </button>
  )
}

function SaleRow({ sale, onOpen }: { sale: Sale; onOpen(s: Sale): void }) {
  const buyer = useBuyerName()
  const status = saleStatus(sale)
  const remaining = saleRemaining(sale)
  const overdue = isOverdue(sale)
  const rel = sale.dueDate && status !== 'paid' ? relativeDays(sale.dueDate) : null
  return (
    <button type="button" onClick={() => onOpen(sale)} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03] tap">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{buyer(sale)}</span>
        <span className="block truncate text-[13px] text-faint">
          {sale.product}
          {sale.quantity !== 1 ? ` × ${sale.quantity.toLocaleString('pt-BR')}` : ''} · {formatDateValue(sale.date)}
          {rel && <span className={overdue ? 'text-expense' : rel.days <= 3 ? 'text-warn' : ''}> · prazo {rel.label}</span>}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="num block text-[15px] font-semibold">{formatMoney(sale.total, sale.currency)}</span>
        {status === 'paid' ? (
          <Badge tone="positive">{SALE_STATUS_LABEL.paid}</Badge>
        ) : (
          <span className={`num text-[13px] ${overdue ? 'text-expense' : 'text-warn'}`}>falta {formatMoney(remaining, sale.currency)}</span>
        )}
      </span>
    </button>
  )
}

export function SalesPage() {
  const { data } = useStore()
  const buyer = useBuyerName()
  const form = useSheet<Sale>()
  const detail = useSheet<string>()
  const person = useSheet<string>()
  const [preset, setPreset] = useState<BuyerPreset | null>(null)
  const [tab, setTab] = useState<'people' | 'sales'>('people')
  const [peopleQuery, setPeopleQuery] = useState('')
  const [peopleStatus, setPeopleStatus] = useState<BuyerStatus | 'all'>('all')
  const [filter, setFilter] = useState<SaleFilter>({ query: '', status: 'all', from: '', to: '', clientKey: '' })
  const [showFilters, setShowFilters] = useState(false)
  useOpenParam(data.sales, (s) => detail.show(s.id))

  const buyers = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of data.sales) map.set(clientKey(s), buyer(s))
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [data.sales, buyer])

  const list = data.sales
    .filter((s) => matches(filter.query, buyer(s), s.product, s.notes))
    .filter((s) => filter.status === 'all' || (filter.status === 'overdue' ? isOverdue(s) : saleStatus(s) === filter.status))
    .filter((s) => (!filter.from || s.date >= filter.from) && (!filter.to || s.date <= filter.to))
    .filter((s) => !filter.clientKey || clientKey(s) === filter.clientKey)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1))

  // Receivable per currency: never added across currencies.
  const receivable = new Map<Currency, number>()
  for (const s of list) {
    const r = saleRemaining(s)
    if (r > 0) receivable.set(s.currency, (receivable.get(s.currency) ?? 0) + r)
  }
  const overdueCount = data.sales.filter((s) => isOverdue(s)).length
  const people = useMemo(() => groupBuyers(data.sales, buyer), [data.sales, buyer])
  const overview = useMemo(() => salesOverview(data.sales, buyer), [data.sales, buyer])
  const peopleList = people
    .filter((b) => matches(peopleQuery, b.name))
    .filter((b) => peopleStatus === 'all' || b.status === peopleStatus)
    // Who owes first, then the most recent buyers.
    .sort((a, b) => Number(a.status === 'paid') - Number(b.status === 'paid') || (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : a.name.localeCompare(b.name)))
  const openPerson = people.find((b) => b.key === person.item) ?? null
  const newSale = (p: BuyerPreset | null) => {
    setPreset(p)
    person.close()
    form.show()
  }
  const open = data.sales.find((s) => s.id === detail.item) ?? null
  const set = <K extends keyof SaleFilter>(k: K, v: SaleFilter[K]) => setFilter((f) => ({ ...f, [k]: v }))
  const filtered = filter.from || filter.to || filter.clientKey

  return (
    <>
      <PageHeader
        title="Vendas"
        subtitle={data.sales.length ? `${data.sales.length} vendas${overdueCount ? ` · ${overdueCount} atrasada${overdueCount > 1 ? 's' : ''}` : ''}` : 'Quem comprou, quanto pagou e quanto falta'}
        actions={
          <Button icon={<Plus size={18} />} onClick={() => newSale(null)}>
            Nova
          </Button>
        }
      />
      {data.sales.length === 0 ? (
        <EmptyState icon={<BadgeDollarSign size={22} />} title="Nenhuma venda ainda" text="Registre o que vendeu, para quem e acompanhe os pagamentos parciais." action="Registrar venda" onAction={() => newSale(null)} />
      ) : (
        <>
          <Overview totals={overview.totals} owing={overview.owing} />
          <div className="mb-4">
            <Segmented
              block
              label="Ver vendas por"
              value={tab}
              onChange={(v) => setTab(v)}
              options={[
                { value: 'people', label: 'Pessoas' },
                { value: 'sales', label: 'Vendas' },
              ]}
            />
          </div>
          {tab === 'people' ? (
            <>
              <div className="mb-3">
                <SearchField value={peopleQuery} onChange={setPeopleQuery} placeholder="Buscar pessoa" />
              </div>
              <div className="mb-4">
                <Chips value={peopleStatus} onChange={(v) => setPeopleStatus(v)} options={PEOPLE_FILTERS} />
              </div>
              {peopleList.length ? (
                <div className="card p-1.5">
                  {peopleList.map((b) => (
                    <BuyerRow key={b.key} buyer={b} onOpen={(x) => person.show(x.key)} />
                  ))}
                </div>
              ) : (
                <EmptyState compact icon={<BadgeDollarSign size={22} />} title="Ninguém com esse filtro" />
              )}
            </>
          ) : (
            <>
              {(filter.status !== 'all' || filter.query || filtered) && (
                <div className="card mb-5 p-4 pl-5">
                  <p className="text-[13px] text-soft">
                    A receber
                    {filter.status !== 'all' || filter.query || filtered ? ' (filtro atual)' : ''}
                  </p>
                  {receivable.size ? (
                    <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                      {[...receivable.entries()].map(([c, v]) => (
                        <span key={c} className="num text-[22px] font-semibold text-warn">
                          {formatMoney(v, c)}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="num mt-1 text-[22px] font-semibold text-soft">Nada a receber</p>
                  )}
                </div>
              )}
              <div className="mb-3 flex gap-2">
                <div className="flex-1">
                  <SearchField value={filter.query} onChange={(v) => set('query', v)} placeholder="Buscar cliente ou produto" />
                </div>
                <IconButton label="Filtros" tone={filtered || showFilters ? 'accent' : 'raised'} className="size-12!" onClick={() => setShowFilters(!showFilters)}>
                  <SlidersHorizontal size={19} />
                </IconButton>
              </div>
              {showFilters && (
                <div className="card mb-3 grid gap-3 p-4 sm:grid-cols-3">
                  <Field label="De">
                    <TextInput type="date" value={filter.from} onChange={(e) => set('from', e.target.value)} />
                  </Field>
                  <Field label="Até">
                    <TextInput type="date" value={filter.to} onChange={(e) => set('to', e.target.value)} />
                  </Field>
                  <Field label="Cliente">
                    <Select value={filter.clientKey} onChange={(e) => set('clientKey', e.target.value)}>
                      <option value="">Todos</option>
                      {buyers.map(([key, name]) => (
                        <option key={key} value={key}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              )}
              <div className="mb-4">
                <Chips value={filter.status} onChange={(v) => set('status', v)} options={STATUS_FILTERS} />
              </div>
              {list.length ? (
                <div className="card p-1.5">
                  {list.map((s) => (
                    <SaleRow key={s.id} sale={s} onOpen={(x) => detail.show(x.id)} />
                  ))}
                </div>
              ) : (
                <EmptyState compact icon={<BadgeDollarSign size={22} />} title="Nenhuma venda com esse filtro" />
              )}
            </>
          )}
        </>
      )}

      <BuyerDetail
        buyer={openPerson}
        open={person.open && openPerson !== null}
        onClose={person.close}
        onOpenSale={(id) => {
          person.close()
          detail.show(id)
        }}
        onNewSale={newSale}
      />

      <Sheet
        open={detail.open && open !== null}
        onClose={detail.close}
        title={open ? `${buyer(open)} · ${open.product}` : ''}
        actions={
          open && (
            <IconButton
              label="Editar venda"
              size="sm"
              onClick={() => {
                detail.close()
                form.show(open)
              }}
            >
              <Pencil size={17} />
            </IconButton>
          )
        }
      >
        {open && (
          <>
            <p className="pb-3 text-[14px] text-faint">
              {formatDateValue(open.date)} · {open.quantity.toLocaleString('pt-BR')} un.
              {open.dueDate ? ` · prazo ${formatDateValue(open.dueDate).toLowerCase()}` : ''} <Badge tone={STATUS_TONE[saleStatus(open)]}>{SALE_STATUS_LABEL[saleStatus(open)]}</Badge>
            </p>
            <SalePayments sale={open} />
            {open.notes && <p className="mt-4 text-sm leading-relaxed whitespace-pre-wrap text-soft">{open.notes}</p>}
            <button
              type="button"
              onClick={() => {
                detail.close()
                person.show(clientKey(open))
              }}
              className="mt-5 flex w-full items-center justify-between rounded-2xl border border-line px-4 py-3 text-left text-[15px] text-soft hover:text-ink"
            >
              Ver todas as compras de {people.find((x) => x.key === clientKey(open))?.name ?? buyer(open)}
              <ChevronRight size={16} />
            </button>
          </>
        )}
      </Sheet>
      <SaleForm open={form.open} onClose={form.close} sale={form.item} preset={form.item ? null : preset} />
    </>
  )
}
