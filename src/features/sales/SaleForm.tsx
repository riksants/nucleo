import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { buildInstallments, itemsSummary, nextRepeat } from '../../core/salesSmart'
import { todayIn, zoneOf } from '../../core/period'
import { belongsToSale } from '../../data/receipts'
import { newId, useStore } from '../../data/store'
import { useReceipts } from '../../data/useReceipts'
import { OVERPAY, totalProblem, withPayment } from '../../data/sales'
import type { Currency, Installment, Payment, Sale, SaleItem } from '../../data/types'
import { formatDateValue } from '../../lib/dates'
import { amountToInput, formatMoney } from '../../lib/money'
import { parseMoney } from '../../lib/calc'
import { AmountField } from '../../ui/AmountField'
import { IconButton } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, MoneyInput, Select, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { BuyerField, buyerNeedsChoice, ProductField, usePeople } from './SaleFields'

export const STATUS_TONE = { pending: 'neutral', partial: 'accent', paid: 'positive' } as const

/** A new sale can start with the buyer already chosen (from the person's page). */
export interface BuyerPreset {
  clientId: string | null
  clientName: string
}

/** A sale prepared elsewhere (a sentence, "Vender novamente"): only what is known is filled. */
export interface SaleInitial {
  clientId?: string | null
  clientName?: string
  /** The buyer was already chosen (sell again). */
  confirmed?: boolean
  product?: string
  quantity?: number
  items?: SaleItem[]
  discount?: number
  total?: number | null
  paid?: number | null
  dueDate?: string
  installments?: number
  currency?: Currency | null
  recurring?: Sale['recurring']
  notes?: string
}

interface ItemRow {
  id: string
  name: string
  qty: string
  price: string
}

const toRows = (items?: SaleItem[]): ItemRow[] => (items ?? []).map((i) => ({ id: i.id, name: i.name, qty: String(i.quantity), price: amountToInput(i.price) }))

export function SaleForm({ open, onClose, sale, preset, initial, onSaved }: { open: boolean; onClose(): void; sale: Sale | null; preset?: BuyerPreset | null; initial?: SaleInitial | null; onSaved?(sale: Sale): void }) {
  const { settings, displayCurrency } = useStore()
  const { saveSales, removeSale, linkedCount } = useReceipts()
  const { toast, confirm } = useFeedback()
  const people = usePeople()
  const saving = useRef(false)
  const buyerRef = useRef<HTMLDivElement>(null)
  const [mustChoose, setMustChoose] = useState(false)
  const today = todayIn(zoneOf(settings))
  const editing = Boolean(sale)
  const [d, set, setAll] = useDraft(open, () => {
    // "Valor" is before the discount (the sale keeps the total after it).
    const total = sale ? sale.total + (sale.discount ?? 0) : (initial?.total ?? null)
    const paid = initial?.paid ?? null
    const items = sale?.items ?? initial?.items
    return {
      buyer: {
        clientId: sale?.clientId ?? initial?.clientId ?? preset?.clientId ?? null,
        clientName: sale?.clientName ?? initial?.clientName ?? preset?.clientName ?? '',
        confirmed: Boolean(sale || preset || initial?.confirmed),
      },
      product: sale?.product ?? initial?.product ?? '',
      quantity: String(sale?.quantity ?? initial?.quantity ?? 1),
      total: total ? amountToInput(total) : '',
      currency: (sale?.currency ?? initial?.currency ?? displayCurrency ?? settings.baseCurrency) as Currency,
      received: (paid && total && paid >= total ? 'all' : paid ? 'part' : 'no') as 'no' | 'all' | 'part',
      paidAmount: paid && total && paid < total ? amountToInput(paid) : '',
      dueDate: sale?.dueDate ?? initial?.dueDate ?? '',
      date: sale?.date ?? today,
      notes: sale?.notes ?? initial?.notes ?? '',
      discount: sale?.discount ?? initial?.discount ? amountToInput(sale?.discount ?? initial?.discount ?? 0) : '',
      items: toRows(items),
      instOn: Boolean(initial?.installments && initial.installments > 1) || Boolean(sale?.installments?.length),
      instCount: String(initial?.installments && initial.installments > 1 ? initial.installments : (sale?.installments?.length ?? 3)),
      instFirst: sale?.installments?.[0]?.due ?? initial?.dueDate ?? '',
      instEvery: 'month' as 'month' | 'week',
      repeatOn: Boolean(sale?.recurring ?? initial?.recurring),
      repeatEvery: (sale?.recurring?.every ?? initial?.recurring?.every ?? 'month') as 'week' | 'month' | 'year',
      more: Boolean(items?.length || sale?.installments?.length || sale?.recurring || sale?.notes || sale?.discount || (initial?.installments ?? 0) > 1),
      // Fixed for this form: tapping "Registrar" twice (or retrying) never records the down payment twice.
      paymentId: newId(),
    }
  })

  const useItems = d.items.length > 0
  const summary = useItems ? itemsSummary(d.items.map((r) => ({ id: r.id, name: r.name, quantity: Number(r.qty.replace(',', '.')) || 0, price: parseMoney(r.price) ?? 0 })), parseMoney(d.discount) ?? 0) : null
  const total = summary ? summary.total : Math.max(0, (parseMoney(d.total) ?? 0) - (parseMoney(d.discount) ?? 0))
  const alreadyPaid = sale ? sale.payments.reduce((s, p) => s + p.amount, 0) : 0
  const paidNow = editing ? 0 : d.received === 'all' ? total : d.received === 'part' ? (parseMoney(d.paidAmount) ?? 0) : 0
  const owed = Math.max(0, total - alreadyPaid - paidNow)
  const preview: Installment[] = d.instOn && owed > 0 && d.instFirst && Number(d.instCount) >= 2 ? buildInstallments(owed, Number(d.instCount), d.instFirst, d.instEvery, () => 'x') : []

  const submit = async () => {
    if (saving.current) return
    if (!d.buyer.clientId && !d.buyer.clientName.trim()) return 'Diga para quem vendeu'
    if (buyerNeedsChoice(people, d.buyer)) {
      // Shown next to the name (and brought into view): a toast alone can hide behind the keyboard.
      setMustChoose(true)
      buyerRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return 'Escolha quem é essa pessoa (ou marque que é outra pessoa)'
    }
    if (!useItems && !d.product.trim()) return 'Diga o que vendeu'
    if (useItems && !summary?.product) return 'Dê um nome a cada item'
    const quantity = useItems ? (summary?.quantity ?? 1) : Number(d.quantity.replace(',', '.'))
    if (!Number.isFinite(quantity) || quantity <= 0) return 'Quantidade inválida'
    const problem = totalProblem(total || null, sale?.payments ?? [])
    if (problem) return problem
    if (!editing && d.received === 'part') {
      if (!paidNow || paidNow <= 0) return 'Digite quanto já recebeu'
      if (paidNow > total) return OVERPAY
    }
    if (d.instOn && owed > 0 && !preview.length) return 'Escolha a data da primeira parcela e pelo menos 2 parcelas'
    const installments = d.instOn && preview.length ? preview.map((i) => ({ ...i, id: newId() })) : undefined
    const dueDate = installments ? installments[installments.length - 1].due : owed > 0 ? d.dueDate : ''
    let next: Sale = {
      ...(sale ?? { id: newId(), createdAt: new Date().toISOString(), updatedAt: '', payments: [] }),
      clientId: d.buyer.clientId,
      clientName: d.buyer.clientId ? '' : d.buyer.clientName.trim(),
      product: useItems ? summary!.product : d.product.trim(),
      quantity,
      date: d.date,
      total,
      currency: d.currency,
      dueDate,
      notes: d.notes,
    } as Sale
    if (useItems) next.items = d.items.filter((r) => r.name.trim()).map((r) => ({ id: r.id, name: r.name.trim(), quantity: Number(r.qty.replace(',', '.')) || 1, price: parseMoney(r.price) ?? 0 }))
    else delete next.items
    const discount = parseMoney(d.discount) ?? 0
    if (discount > 0) next.discount = discount
    else delete next.discount
    if (installments) next.installments = installments
    else if (!d.instOn) delete next.installments
    if (d.repeatOn) {
      next.recurring = { every: d.repeatEvery, status: sale?.recurring?.status ?? 'active' }
      next.recurNext = sale?.recurNext && sale.recurring?.every === d.repeatEvery ? sale.recurNext : nextRepeat(dueDate || d.date, d.repeatEvery)
    } else {
      delete next.recurring
      delete next.recurNext
    }
    if (!editing && paidNow > 0) {
      // finance: the down payment becomes one income in Financeiro, once (fixed id).
      const p: Payment = { id: d.paymentId, date: d.date, amount: paidNow, note: 'Pago na venda', finance: true }
      next = withPayment(next, p)
    }
    saving.current = true
    try {
      await saveSales([next])
    } finally {
      saving.current = false
    }
    onSaved?.(next)
    toast(editing ? 'Venda atualizada' : owed > 0 ? `Venda registrada · ${formatMoney(owed, d.currency)} a receber` : 'Venda registrada e quitada')
    onClose()
  }

  const deleteSale = async (s: Sale) => {
    const linked = linkedCount(belongsToSale(s))
    const parts = [
      s.payments.some((p) => p.generalId) ? 'Parte de um pagamento geral foi aplicada nesta compra. Esse valor sai junto com a venda (o restante do pagamento geral continua nas outras compras).' : '',
      // The money was received: its incomes stay in Financeiro, only without the link.
      linked ? `${linked === 1 ? 'A entrada do pagamento continua' : `As ${linked} entradas dos pagamentos continuam`} no Financeiro, sem vínculo com a venda.` : '',
    ].filter(Boolean)
    const ok = await confirm({ title: 'Excluir venda?', message: parts.join(' ') || 'Essa ação não pode ser desfeita.', confirmLabel: 'Excluir', danger: true })
    if (!ok) return
    await removeSale(s)
    onClose()
    toast('Venda excluída')
  }

  const setItem = (id: string, patch: Partial<ItemRow>) => set('items', d.items.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const startItems = () =>
    setAll((x) => ({ ...x, more: true, items: [{ id: newId(), name: x.product, qty: x.quantity, price: x.total && Number(x.quantity) > 0 ? amountToInput(Math.round((parseMoney(x.total) ?? 0) / Number(x.quantity))) : '' }, { id: newId(), name: '', qty: '1', price: '' }] }))

  return (
    <FormSheet open={open} onClose={onClose} title={editing ? 'Editar venda' : 'Nova venda'} submitLabel={editing ? 'Salvar' : 'Registrar venda'} onSubmit={submit} size="lg" onDelete={sale ? () => deleteSale(sale) : undefined}>
      <FormGrid>
        <Field label="Cliente">
          <div ref={buyerRef}>
            <BuyerField
              value={d.buyer}
              alert={mustChoose && buyerNeedsChoice(people, d.buyer)}
              onChange={(v) => {
                setMustChoose(false)
                set('buyer', v)
              }}
              autoFocus={!editing && !d.buyer.clientId && !d.buyer.clientName}
            />
          </div>
        </Field>

        {!useItems && (
          <>
            <Field label="O que vendeu">
              <ProductField
                value={d.product}
                onChange={(v) => set('product', v)}
                onPick={(p) => setAll((x) => ({ ...x, product: p.name, currency: p.currency, total: amountToInput(Math.round(p.price * (Number(x.quantity.replace(',', '.')) || 1))) }))}
              />
            </Field>
            <Field label="Valor">
              <MoneyInput value={d.total} onChange={(v) => set('total', v)} currency={d.currency} onCurrency={(c) => set('currency', c)} />
            </Field>
          </>
        )}

        {!editing && (
          <Field label="Já recebeu?">
            <Segmented
              block
              value={d.received}
              onChange={(v) => set('received', v)}
              options={[
                { value: 'no', label: 'Ainda não' },
                { value: 'all', label: 'Tudo' },
                { value: 'part', label: 'Uma parte' },
              ]}
            />
          </Field>
        )}
        {!editing && d.received === 'part' && (
          <Field label="Quanto recebeu">
            <AmountField currency={d.currency} value={d.paidAmount} onChange={(v) => set('paidAmount', v)} />
          </Field>
        )}
        {owed > 0 && !d.instOn && (
          <Field label="Prazo para receber" hint={d.dueDate ? formatDateValue(d.dueDate) : 'opcional'}>
            <TextInput type="date" value={d.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </Field>
        )}
        {total > 0 && (
          <p className="num rounded-2xl bg-tint/[0.04] px-4 py-3 text-[14px] text-soft">
            Total {formatMoney(total, d.currency)}
            {alreadyPaid + paidNow > 0 && ` · recebido ${formatMoney(alreadyPaid + paidNow, d.currency)}`}
            {owed > 0 ? <span className="font-semibold text-ink"> · falta {formatMoney(owed, d.currency)}</span> : <span className="font-semibold text-income"> · quitada</span>}
          </p>
        )}

        <button type="button" aria-expanded={d.more} onClick={() => set('more', !d.more)} className="flex w-full items-center justify-between rounded-2xl px-1 py-1 text-left text-[14px] font-semibold text-accent-hi">
          Mais opções: itens, parcelas, desconto, repetir, data e observações
          <ChevronDown size={18} className={`shrink-0 transition-transform ${d.more ? 'rotate-180' : ''}`} />
        </button>

        {d.more && (
          <>
            {useItems ? (
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-soft">Itens</p>
                {d.items.map((r, i) => (
                  <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_3.5rem_6.5rem_2.5rem] items-center gap-2">
                    <TextInput aria-label={`Item ${i + 1}`} placeholder="Item" value={r.name} onChange={(e) => setItem(r.id, { name: e.target.value })} />
                    <TextInput aria-label={`Quantidade do item ${i + 1}`} inputMode="decimal" className="num px-2!" value={r.qty} onChange={(e) => setItem(r.id, { qty: e.target.value })} />
                    <TextInput aria-label={`Preço por unidade do item ${i + 1}`} inputMode="decimal" className="num px-2!" placeholder="Preço" value={r.price} onChange={(e) => setItem(r.id, { price: e.target.value })} />
                    <IconButton label={`Remover item ${i + 1}`} size="sm" onClick={() => set('items', d.items.filter((x) => x.id !== r.id))}>
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                ))}
                <button type="button" onClick={() => set('items', [...d.items, { id: newId(), name: '', qty: '1', price: '' }])} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent-hi">
                  <Plus size={16} /> Item
                </button>
                <Field label="Moeda">
                  <Select value={d.currency} onChange={(e) => set('currency', e.target.value)}>
                    {[...new Set([d.currency, settings.baseCurrency, displayCurrency])].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantidade">
                  <TextInput inputMode="decimal" className="num" value={d.quantity} onChange={(e) => set('quantity', e.target.value)} />
                </Field>
                <div className="flex items-end">
                  <button type="button" onClick={startItems} className="press h-12 w-full rounded-[var(--radius-field)] text-[14px] font-semibold text-accent-hi ring-1 ring-accent/30 ring-inset">
                    Vários itens
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Desconto" hint="opcional">
                <AmountField currency={d.currency} value={d.discount} onChange={(v) => set('discount', v)} />
              </Field>
              <Field label="Data da venda">
                <TextInput type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />
              </Field>
            </div>

            {owed > 0 && (
              <div className="space-y-3 rounded-2xl bg-tint/[0.03] p-3">
                <label className="flex items-center justify-between gap-3 text-[15px] font-medium">
                  Parcelar o que falta
                  <input type="checkbox" className="size-5 accent-[var(--color-accent)]" checked={d.instOn} onChange={(e) => setAll((x) => ({ ...x, instOn: e.target.checked, instFirst: x.instFirst || x.dueDate }))} />
                </label>
                {d.instOn && (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Parcelas">
                        <TextInput inputMode="numeric" className="num" value={d.instCount} onChange={(e) => set('instCount', e.target.value.replace(/\D/g, '').slice(0, 2))} />
                      </Field>
                      <Field label="1ª parcela">
                        <TextInput type="date" value={d.instFirst} onChange={(e) => set('instFirst', e.target.value)} />
                      </Field>
                      <Field label="A cada">
                        <Select value={d.instEvery} onChange={(e) => set('instEvery', e.target.value as 'month' | 'week')}>
                          <option value="month">mês</option>
                          <option value="week">semana</option>
                        </Select>
                      </Field>
                    </div>
                    {preview.length > 0 && (
                      <div className="text-[13px] text-soft" aria-label="Resumo das parcelas">
                        <p className="mb-1 font-medium text-ink">
                          {preview.length}× · soma {formatMoney(preview.reduce((s, i) => s + i.amount, 0), d.currency)}
                          {paidNow > 0 && ` (depois da entrada de ${formatMoney(paidNow, d.currency)})`}
                        </p>
                        <ul className="num grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
                          {preview.map((p, i) => (
                            <li key={i}>
                              {i + 1}ª {formatDateValue(p.due).toLowerCase()} · {formatMoney(p.amount, d.currency)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            <div className="space-y-3 rounded-2xl bg-tint/[0.03] p-3">
              <label className="flex items-center justify-between gap-3 text-[15px] font-medium">
                Repetir esta venda
                <input type="checkbox" className="size-5 accent-[var(--color-accent)]" checked={d.repeatOn} onChange={(e) => set('repeatOn', e.target.checked)} />
              </label>
              {d.repeatOn && (
                <>
                  <Segmented
                    block
                    value={d.repeatEvery}
                    onChange={(v) => set('repeatEvery', v)}
                    options={[
                      { value: 'week', label: 'Toda semana' },
                      { value: 'month', label: 'Todo mês' },
                      { value: 'year', label: 'Todo ano' },
                    ]}
                  />
                  <p className="text-[12px] leading-relaxed text-faint">
                    O Núcleo cria a próxima cobrança na data ({formatDateValue(nextRepeat(d.dueDate || d.date, d.repeatEvery)).toLowerCase()}), a receber. Pagamento só quando você confirmar. Para planos de um projeto com vários assinantes, use Assinantes.
                  </p>
                </>
              )}
            </div>

            <Field label="Observações" hint="opcional">
              <TextArea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </>
        )}
      </FormGrid>
    </FormSheet>
  )
}

/** Small label that tells general and specific payments apart everywhere. */
export function PaymentKind({ general }: { general: boolean }) {
  return general ? (
    <span className="rounded-full bg-tint/[0.06] px-2 py-0.5 text-[12px] font-medium text-soft">Pagamento geral</span>
  ) : (
    <span className="rounded-full bg-tint/[0.08] px-2 py-0.5 text-[12px] font-medium text-ink">Pagamento específico</span>
  )
}

/** Amount field with the "too much" rule: blocks and offers to use exactly what is missing. */
export function PaymentAmountError({ error, onUseRemaining }: { error: string | null; onUseRemaining(): void }) {
  if (!error) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-expense" role="alert">
      <span>{error}</span>
      {error === OVERPAY && (
        <button type="button" onClick={onUseRemaining} className="font-medium text-accent-hi underline-offset-2 hover:underline">
          Usar o valor que falta
        </button>
      )}
    </div>
  )
}
