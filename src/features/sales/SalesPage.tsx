import { BadgeDollarSign, ChevronRight, Search, Sparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../../app/Shell'
import { shiftMonths } from '../../core/automation/dates'
import { todayIn, zoneOf } from '../../core/period'
import { isLate, matchesSearch, nextDue, readSaleText, readSearch, type SaleDraft } from '../../core/salesSmart'
import { BUYER_STATUS_LABEL, BUYER_TONE, buyers as groupBuyers, overdueAmount, saleRemaining, salesOverview, saleStatus, type Buyer, type BuyerStatus, type MoneyTotals } from '../../data/sales'
import { useStore } from '../../data/store'
import type { Currency, Sale } from '../../data/types'
import { formatDateValue, relativeDays } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { Badge, EmptyState } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { Chips, Segmented } from '../../ui/Segmented'
import { useOpenParam } from '../useOpenParam'
import { BuyerDetail } from './BuyerDetail'
import { SaleDetail } from './SaleDetail'
import { SaleForm, type BuyerPreset, type SaleInitial } from './SaleForm'
import { usePeople } from './SaleFields'
import { useBuyerName } from './useBuyerName'

type Tab = 'open' | 'late' | 'paid' | 'all' | 'people'

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: 'UTC' })
const exactDate = (d: string) => WEEKDAY.format(new Date(`${d}T12:00:00Z`))

/** Money per currency, never added together. */
function perCurrency(sales: Sale[], pick: (s: Sale) => number): { currency: Currency; amount: number }[] {
  const map = new Map<Currency, number>()
  for (const s of sales) {
    const v = pick(s)
    if (v > 0) map.set(s.currency, (map.get(s.currency) ?? 0) + v)
  }
  return [...map].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount)
}

function SaleRow({ sale, today, onOpen }: { sale: Sale; today: string; onOpen(s: Sale): void }) {
  const buyer = useBuyerName()
  const status = saleStatus(sale)
  const remaining = saleRemaining(sale)
  const late = isLate(sale, today)
  const due = nextDue(sale, today)
  const rel = due ? relativeDays(due) : null
  return (
    <button type="button" onClick={() => onOpen(sale)} className="relative flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-tint/[0.03] tap">
      {late && <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-full bg-expense" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{buyer(sale)}</span>
        <span className="block truncate text-[13px] text-faint">
          {sale.product}
          {sale.installments?.length ? ` · ${sale.installments.length}×` : ''}
          {rel && status !== 'paid' ? <span className={late ? 'font-semibold text-expense' : rel.days <= 2 ? 'text-warn' : ''}> · {late ? `venceu ${rel.label.toLowerCase()}` : `vence ${rel.label.toLowerCase()}`}</span> : ` · ${formatDateValue(sale.date)}`}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {status === 'paid' ? (
          <>
            <span className="num block text-[15px] font-semibold text-soft">{formatMoney(sale.total, sale.currency)}</span>
            <Badge tone="positive">Quitada</Badge>
          </>
        ) : (
          <>
            <span className={`num block text-[15px] font-semibold ${late ? 'text-expense' : ''}`}>{formatMoney(remaining, sale.currency)}</span>
            <span className="block text-[12px] text-faint">{status === 'partial' ? `de ${formatMoney(sale.total, sale.currency)}` : 'a receber'}</span>
          </>
        )}
      </span>
    </button>
  )
}

function BuyerRow({ buyer, onOpen }: { buyer: Buyer; onOpen(b: Buyer): void }) {
  const owing = buyer.totals.filter((t: MoneyTotals) => t.remaining > 0)
  return (
    <button type="button" onClick={() => onOpen(buyer)} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-tint/[0.03] tap">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{buyer.name}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[13px] text-faint">
          {buyer.sales.length} {buyer.sales.length === 1 ? 'compra' : 'compras'} <Badge tone={BUYER_TONE[buyer.status]}>{BUYER_STATUS_LABEL[buyer.status]}</Badge>
        </span>
      </span>
      <span className="shrink-0 text-right">
        {owing.length ? (
          owing.map((t) => (
            <span key={t.currency} className="num block text-[15px] font-semibold">
              {formatMoney(t.remaining, t.currency)}
            </span>
          ))
        ) : (
          <span className="block text-[13px] text-faint">nada pendente</span>
        )}
      </span>
      <ChevronRight size={16} className="shrink-0 text-accent-hi" />
    </button>
  )
}

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

/** Sold / received / to receive per currency, and how many people still owe. */
function Overview({ totals, owing }: { totals: MoneyTotals[]; owing: number }) {
  return (
    <div className="card mb-4 grid grid-cols-2 gap-x-4 gap-y-3 p-4 pl-5 sm:grid-cols-4" aria-label="Resumo de vendas">
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
        <MoneyLines list={totals} pick={(t) => t.remaining} className="text-[17px] font-semibold text-accent-hi" />
      </div>
      <div className="min-w-0">
        <p className="text-[12px] text-faint">Pessoas com valor pendente</p>
        <span className="num block text-[17px] font-semibold">{owing}</span>
      </div>
    </div>
  )
}

const PEOPLE_FILTERS: { value: BuyerStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'paid', label: 'Pagos' },
  { value: 'partial', label: 'Parciais' },
  { value: 'pending', label: 'Pendentes' },
]

/** "Entendi assim": what the sentence gave, with the exact date to check and what is still missing. */
function DraftCard({ draft, missing, currency, needCurrency, currencies, onCurrency, onOpen, today }: { draft: SaleDraft; missing: string[]; currency: Currency | null; needCurrency: boolean; currencies: Currency[]; onCurrency(c: Currency): void; onOpen(): void; today: string }) {
  const cur = currency ?? currencies[0]
  const money = (v: number | null) => (v === null ? '—' : formatMoney(v, cur))
  const rest = draft.total !== null ? Math.max(0, draft.total - (draft.paid ?? 0)) : null
  const rows: [string, string, boolean][] = [
    ['Cliente', draft.clientName || 'falta', !draft.clientName],
    ['Produto', `${draft.quantity !== 1 ? `${draft.quantity}× ` : ''}${draft.product || 'falta'}`, !draft.product],
    ['Total', draft.total !== null ? money(draft.total) : 'falta', draft.total === null],
    ['Já recebido', draft.paid !== null ? money(draft.paid) : 'nada informado', false],
    ['Restante', rest !== null ? money(rest) : '—', false],
    ['Vencimento', draft.dueDate ? exactDate(draft.dueDate) : rest ? 'sem prazo' : '—', false],
  ]
  if (draft.installments > 1) rows.push(['Parcelas', `${draft.installments}× (você confere as datas)`, false])
  return (
    <section aria-label="Nova venda pronta para conferir" className="card relative overflow-hidden p-4 pl-5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-accent" />
      <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.1em] text-accent-hi uppercase">
        <Sparkles size={14} /> Entendi assim
      </p>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[14px]">
        {rows.map(([k, v, miss]) => [
          <dt key={`${k}-t`} className="text-soft">
            {k}
          </dt>,
          <dd key={`${k}-d`} className={`num [overflow-wrap:anywhere] ${miss ? 'font-semibold text-warn' : 'font-medium'}`}>
            {v}
          </dd>,
        ])}
      </dl>
      {needCurrency && (
        <div className="mt-3">
          <p className="mb-1.5 text-[13px] font-medium text-warn">Em qual moeda?</p>
          <div className="flex flex-wrap gap-2">
            {currencies.map((c) => (
              <button key={c} type="button" aria-pressed={c === currency} onClick={() => onCurrency(c)} className={`press h-9 rounded-full border px-3.5 text-[14px] font-medium ${c === currency ? 'border-accent/40 bg-accent/[0.14] text-accent-hi' : 'border-line text-soft'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>
      )}
      {draft.dueDate && draft.dueDate < today && <p className="mt-2 text-[13px] text-warn">A data entendida já passou: confira.</p>}
      <p className="mt-3 text-[12px] leading-relaxed text-faint">{missing.length ? `Falta: ${missing.join(', ')}. ` : ''}Nada é salvo até você conferir e tocar em “Registrar venda”.</p>
      <button type="button" disabled={needCurrency && !currency} onClick={onOpen} className="press mt-3 inline-flex h-11 w-full items-center justify-center rounded-full bg-accent text-[15px] font-semibold text-on-accent hover:bg-accent-soft disabled:opacity-50">
        Conferir e registrar
      </button>
    </section>
  )
}

export function SalesPage() {
  const { data, settings, displayCurrency } = useStore()
  const buyer = useBuyerName()
  const people = usePeople()
  const today = todayIn(zoneOf(settings))
  const form = useSheet<Sale>()
  const detail = useSheet<string>()
  const person = useSheet<string>()
  const [preset, setPreset] = useState<BuyerPreset | null>(null)
  const [initial, setInitial] = useState<SaleInitial | null>(null)
  const [tab, setTab] = useState<Tab>('open')
  const [text, setText] = useState('')
  const [force, setForce] = useState<'search' | 'create' | null>(null)
  const [pickedCurrency, setPickedCurrency] = useState<Currency | null>(null)
  const [peopleStatus, setPeopleStatus] = useState<BuyerStatus | 'all'>('all')
  useOpenParam(data.sales, (s) => detail.show(s.id))

  const q = text.trim()
  const reading = useMemo(() => (q ? readSaleText(q, today, people.map((p) => p.name)) : null), [q, today, people])
  const mode = !reading ? null : force ?? (reading.kind === 'ambiguous' ? 'ambiguous' : reading.kind)
  const search = useMemo(() => (mode === 'search' ? readSearch(q, today) : null), [mode, q, today])
  const results = search ? data.sales.filter((s) => matchesSearch(s, buyer(s), search, today)).sort((a, b) => (a.date < b.date ? 1 : -1)) : []

  const late = data.sales.filter((s) => isLate(s, today)).sort((a, b) => (nextDue(a, today) < nextDue(b, today) ? -1 : 1))
  const open = data.sales
    .filter((s) => saleStatus(s) !== 'paid')
    // Late first (oldest due first), then the next due dates, then those without a date (newest first).
    .sort((a, b) => {
      const la = isLate(a, today) ? 0 : nextDue(a, today) ? 1 : 2
      const lb = isLate(b, today) ? 0 : nextDue(b, today) ? 1 : 2
      if (la !== lb) return la - lb
      if (la < 2) return nextDue(a, today) < nextDue(b, today) ? -1 : 1
      return a.date < b.date ? 1 : -1
    })
  const paid = data.sales.filter((s) => saleStatus(s) === 'paid').sort((a, b) => (a.date < b.date ? 1 : -1))
  const all = [...data.sales].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.createdAt < b.createdAt ? 1 : -1))
  const groups = useMemo(() => groupBuyers(data.sales, buyer).sort((a, b) => Number(a.status === 'paid') - Number(b.status === 'paid') || (a.lastDate < b.lastDate ? 1 : -1)), [data.sales, buyer])
  const overview = useMemo(() => salesOverview(data.sales, buyer), [data.sales, buyer])
  const receivable = perCurrency(open, saleRemaining)
  const lateTotal = perCurrency(late, (s) => overdueAmount(s, today))
  const usedCurrencies = [...new Set(data.sales.map((s) => s.currency))]
  const currencies = [...new Set([...(usedCurrencies.length ? usedCurrencies : []), displayCurrency, settings.baseCurrency])]

  const newSale = (p: BuyerPreset | null, init: SaleInitial | null = null) => {
    setPreset(p)
    setInitial(init)
    person.close()
    detail.close()
    form.show()
  }
  const fromDraft = () => {
    if (!reading || reading.kind === 'search') return
    const d = reading.draft
    const due = d.dueDate || (d.installments > 1 ? shiftMonths(today, 1, Number(today.slice(8))) : '')
    newSale(null, {
      clientName: d.clientName,
      product: d.product,
      quantity: d.quantity,
      total: d.total,
      paid: d.paid,
      dueDate: due,
      installments: d.installments,
      currency: d.currency ?? pickedCurrency ?? (usedCurrencies.length > 1 ? null : (usedCurrencies[0] ?? displayCurrency)),
    })
  }
  const sellAgain = (s: Sale) =>
    newSale(null, {
      clientId: s.clientId,
      clientName: s.clientName,
      confirmed: true,
      product: s.product,
      quantity: s.quantity,
      items: s.items?.map((i) => ({ ...i })),
      discount: s.discount,
      total: s.items?.length ? null : s.total + (s.discount ?? 0),
      currency: s.currency,
    })
  const opened = data.sales.find((s) => s.id === detail.item) ?? null
  const openPerson = groups.find((b) => b.key === person.item) ?? null
  const list = tab === 'open' ? open : tab === 'late' ? late : tab === 'paid' ? paid : all
  const missingLabel = reading && reading.kind === 'create' ? reading.missing.map((m) => (m === 'client' ? 'cliente' : m === 'product' ? 'o que vendeu' : 'valor')) : []
  const needCurrency = Boolean(reading && reading.kind !== 'search' && !reading.draft.currency && usedCurrencies.length > 1)

  return (
    <>
      <PageHeader
        rich
        icon={BadgeDollarSign}
        eyebrow={data.sales.length ? `${data.sales.length} ${data.sales.length === 1 ? 'venda' : 'vendas'}` : 'Quem comprou, quanto pagou e quanto falta'}
        title="Vendas"
        primary={{ label: 'Nova', aria: 'Nova venda', onPress: () => newSale(null) }}
        stats={
          data.sales.length
            ? [
                { label: receivable.length > 1 ? `A receber (${receivable[0].currency})` : 'A receber', value: receivable.length ? formatMoney(receivable[0].amount, receivable[0].currency, { compact: true }) : '—' },
                { label: 'Atrasadas', value: late.length },
                { label: 'Quitadas', value: paid.length },
              ]
            : undefined
        }
      />

      <div className="relative mb-4">
        <Search size={18} className="pointer-events-none absolute top-[18px] left-4 text-faint" />
        <textarea
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value)
            setForce(null)
          }}
          placeholder="Busque uma venda ou conte o que vendeu…"
          aria-label="Busque uma venda ou conte o que vendeu"
          enterKeyHint="search"
          className="block max-h-36 min-h-14 w-full resize-none rounded-[1.25rem] border border-line bg-surface py-4 pr-12 pl-11 text-[16px] leading-snug text-ink placeholder:text-faint focus:border-accent/70 focus:outline-none [field-sizing:content]"
        />
        {text && (
          <button type="button" aria-label="Limpar" onClick={() => (setText(''), setForce(null))} className="absolute top-3 right-2.5 grid size-8 place-items-center rounded-full text-faint hover:text-ink">
            <X size={18} />
          </button>
        )}
      </div>

      {mode === 'ambiguous' && (
        <div className="card mb-4 p-4">
          <p className="text-[14px] text-soft">O que você quer fazer com “{q}”?</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setForce('search')} className="press h-11 rounded-full text-[15px] font-semibold ring-1 ring-line-strong ring-inset">
              Buscar vendas
            </button>
            <button type="button" onClick={() => setForce('create')} className="press h-11 rounded-full bg-accent text-[15px] font-semibold text-on-accent">
              Criar uma venda
            </button>
          </div>
        </div>
      )}

      {mode === 'create' && reading && reading.kind !== 'search' && (
        <div className="mb-6">
          <DraftCard draft={reading.draft} missing={missingLabel} currency={reading.draft.currency ?? pickedCurrency} needCurrency={needCurrency} currencies={currencies} onCurrency={setPickedCurrency} onOpen={fromDraft} today={today} />
          <p className="mt-2 px-1 text-[12px] leading-relaxed text-faint">A leitura da frase é feita no aparelho, por regras: entende cliente, produto, quantidade, valor, quanto já recebeu, datas como “sexta” ou “dia 10” e “em 3x”. O que não entender fica em branco para você preencher.</p>
        </div>
      )}

      {mode === 'search' && search && (
        <section aria-label="Resultado da busca" className="mb-6">
          <div className="mb-2 flex flex-wrap items-center gap-2 px-1 text-[13px]">
            <span className="font-semibold">
              {results.length} {results.length === 1 ? 'venda' : 'vendas'}
            </span>
            {search.status && <span className="rounded-full bg-accent/[0.12] px-2.5 py-0.5 font-medium text-accent-hi">{{ overdue: 'atrasadas', open: 'a receber', paid: 'quitadas', partial: 'parciais' }[search.status]}</span>}
            {search.dateLabel && <span className="rounded-full bg-accent/[0.12] px-2.5 py-0.5 font-medium text-accent-hi">{search.dateLabel}</span>}
            {search.words.map((w) => (
              <span key={w} className="rounded-full bg-tint/[0.06] px-2.5 py-0.5 font-medium text-soft">
                “{w}”
              </span>
            ))}
            <button type="button" onClick={() => setText('')} className="ml-auto font-semibold text-accent-hi">
              Ver todas as vendas
            </button>
          </div>
          {results.length ? (
            <div className="card p-1.5">
              {results.map((s) => (
                <SaleRow key={s.id} sale={s} today={today} onOpen={(x) => detail.show(x.id)} />
              ))}
            </div>
          ) : (
            <EmptyState compact icon={<Search size={20} />} title="Nenhuma venda encontrada" text="Se quis registrar uma venda, escreva começando por “Vendi…”." action="Criar uma venda com esse texto" onAction={() => setForce('create')} />
          )}
        </section>
      )}

      {!q &&
        (data.sales.length === 0 ? (
          <EmptyState icon={<BadgeDollarSign size={20} />} title="Nenhuma venda ainda" text="Escreva na barra acima, por exemplo: “Vendi um bolo pra Ana por 80, ela paga sexta”. Ou registre pelo botão." action="Registrar venda" onAction={() => newSale(null)} />
        ) : (
          <>
            {(receivable.length > 1 || lateTotal.length > 0) && (
              <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 px-1 text-[13px] text-soft">
                {receivable.length > 1 && (
                  <span>
                    A receber:{' '}
                    {receivable.map((r) => (
                      <span key={r.currency} className="num mr-2 font-semibold text-ink">
                        {formatMoney(r.amount, r.currency)}
                      </span>
                    ))}
                  </span>
                )}
                {lateTotal.length > 0 && (
                  <span>
                    Vencido:{' '}
                    {lateTotal.map((r) => (
                      <span key={r.currency} className="num mr-2 font-semibold text-expense">
                        {formatMoney(r.amount, r.currency)}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            )}
            <div className="no-scrollbar -mx-5 mb-4 overflow-x-auto px-5 lg:mx-0 lg:px-0">
              <Segmented<Tab>
                variant="underline"
                size="sm"
                label="Vendas"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'open', label: `A receber · ${open.length}` },
                  { value: 'late', label: `Atrasadas · ${late.length}` },
                  { value: 'paid', label: `Quitadas · ${paid.length}` },
                  { value: 'all', label: 'Todas' },
                  { value: 'people', label: 'Pessoas' },
                ]}
              />
            </div>
            {(tab === 'all' || tab === 'people') && <Overview totals={overview.totals} owing={overview.owing} />}
            {tab === 'people' ? (
              <>
                <div className="mb-3">
                  <Chips<BuyerStatus | 'all'> value={peopleStatus} onChange={setPeopleStatus} options={PEOPLE_FILTERS} />
                </div>
                <div className="card p-1.5">
                  {groups
                    .filter((g) => peopleStatus === 'all' || g.status === peopleStatus)
                    .map((g) => (
                      <BuyerRow key={g.key} buyer={g} onOpen={(x) => person.show(x.key)} />
                    ))}
                </div>
              </>
            ) : list.length ? (
              <div className="card p-1.5">
                {list.map((s) => (
                  <SaleRow key={s.id} sale={s} today={today} onOpen={(x) => detail.show(x.id)} />
                ))}
              </div>
            ) : (
              <EmptyState compact icon={<BadgeDollarSign size={20} />} title={tab === 'late' ? 'Nada atrasado' : tab === 'open' ? 'Nada a receber' : tab === 'paid' ? 'Nenhuma quitada ainda' : 'Nenhuma venda'} text={tab === 'late' || tab === 'open' ? 'Tudo recebido.' : undefined} />
            )}
          </>
        ))}

      <SaleDetail
        // Another sale starts clean (no "Recebi"/"Cobrar" left open from the previous one).
        key={opened?.id ?? 'none'}
        sale={detail.open ? opened : null}
        onClose={detail.close}
        onEdit={(s) => {
          detail.close()
          setInitial(null)
          form.show(s)
        }}
        onSellAgain={sellAgain}
        onOpenPerson={(key) => {
          detail.close()
          person.show(key)
        }}
      />
      <BuyerDetail
        buyer={openPerson}
        open={person.open && openPerson !== null}
        onClose={person.close}
        onOpenSale={(id) => {
          person.close()
          detail.show(id)
        }}
        onNewSale={(p) => newSale(p)}
      />
      <SaleForm
        open={form.open}
        onClose={form.close}
        // The sentence stays in the bar until the sale it described is really registered.
        onSaved={() => initial && setText('')}
        sale={form.item}
        preset={form.item ? null : preset}
        initial={form.item ? null : initial}
      />
    </>
  )
}
