import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { belongsToSale } from '../../data/receipts'
import { newId, useStore } from '../../data/store'
import { useReceipts } from '../../data/useReceipts'
import { buyers, OVERPAY, paymentProblem, personName, saleRemaining, saleStatus, SALE_STATUS_LABEL, salePaid, similarPeople, totalProblem, withoutGeneralPayment, withPayment } from '../../data/sales'
import type { Currency, Payment, Sale } from '../../data/types'
import { formatDateValue, toDateInput } from '../../lib/dates'
import { amountToInput, formatMoney, parseAmount } from '../../lib/money'
import { Button, IconButton } from '../../ui/Button'
import { Badge, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, MoneyInput, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft } from '../../ui/formHooks'
import { ClientSelect } from '../shared/RelationSelect'

export const STATUS_TONE = { pending: 'neutral', partial: 'accent', paid: 'positive' } as const

/** A new sale can start with the buyer already chosen (from the person's page). */
export interface BuyerPreset {
  clientId: string | null
  clientName: string
}

export function SaleForm({ open, onClose, sale, preset }: { open: boolean; onClose(): void; sale: Sale | null; preset?: BuyerPreset | null }) {
  const { settings, displayCurrency, data } = useStore()
  const { saveSales, removeSale, linkedCount } = useReceipts()
  const { toast, confirm } = useFeedback()
  const [d, set] = useDraft(open, () => ({
    clientId: sale?.clientId ?? preset?.clientId ?? null,
    clientName: sale?.clientName ?? preset?.clientName ?? '',
    product: sale?.product ?? '',
    quantity: String(sale?.quantity ?? 1),
    date: sale?.date ?? toDateInput(),
    total: amountToInput(sale?.total ?? 0),
    currency: (sale?.currency ?? displayCurrency ?? settings.baseCurrency) as Currency,
    dueDate: sale?.dueDate ?? '',
    notes: sale?.notes ?? '',
    firstPayment: '',
  }))

  const submit = async () => {
    if (!d.clientId && !d.clientName.trim()) return 'Diga para quem vendeu'
    if (!d.product.trim()) return 'Diga o que vendeu'
    const quantity = Number(d.quantity.replace(',', '.'))
    if (!Number.isFinite(quantity) || quantity <= 0) return 'Quantidade inválida'
    const total = parseAmount(d.total)
    const payments = sale?.payments ?? []
    const problem = totalProblem(total, payments)
    if (problem) return problem
    let next: Sale = {
      ...(sale ?? { id: newId(), createdAt: new Date().toISOString(), updatedAt: '', payments: [] }),
      clientId: d.clientId,
      clientName: d.clientId ? '' : d.clientName.trim(),
      product: d.product.trim(),
      quantity,
      date: d.date,
      total: total!,
      currency: d.currency,
      dueDate: d.dueDate,
      notes: d.notes,
    } as Sale
    if (!sale && d.firstPayment.trim()) {
      const amount = parseAmount(d.firstPayment)
      const p: Payment = { id: newId(), date: d.date, amount: amount ?? 0, note: 'Pago na venda', finance: true }
      const err = paymentProblem(next, p)
      if (err) return err
      next = withPayment(next, p)
    }
    await saveSales([next])
    toast(sale ? 'Venda atualizada' : 'Venda registrada')
    onClose()
  }

  // Suggest people that already exist (Vendas or Clientes) so the same person isn't typed twice.
  const typed = d.clientId ? '' : d.clientName
  const known = buyers(data.sales, (s) => (s.clientId ? (data.clients.find((c) => c.id === s.clientId)?.name ?? '') : s.clientName)).filter((b) => !b.clientId && b.name)
  const suggestions = [
    ...similarPeople(data.clients, typed).map((c) => ({ key: `c:${c.id}`, label: `${c.name} · cliente`, pick: () => set('clientId', c.id) })),
    ...similarPeople(known, typed)
      .filter((b) => b.name !== typed)
      .map((b) => ({ key: b.key, label: `${b.name} · ${b.sales.length} ${b.sales.length === 1 ? 'compra' : 'compras'}`, pick: () => set('clientName', b.name) })),
  ].slice(0, 4)
  const exact = typed.trim() ? known.find((b) => personName(b.name) === personName(typed)) : undefined

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

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={sale ? 'Editar venda' : 'Nova venda'}
      submitLabel={sale ? 'Salvar' : 'Registrar venda'}
      onSubmit={submit}
      size="lg"
      onDelete={sale ? () => deleteSale(sale) : undefined}
    >
      <FormGrid>
        <div className="half">
          <Field label="Cliente" hint="dos seus clientes">
            <ClientSelect value={d.clientId} onChange={(v) => set('clientId', v)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Ou nome de quem comprou" hint={d.clientId ? 'usando cliente' : undefined}>
            <TextInput value={d.clientName} disabled={Boolean(d.clientId)} onChange={(e) => set('clientName', e.target.value)} placeholder="Ex.: Maria (vizinha)" />
          </Field>
          {exact && exact.name !== typed.trim() && <p className="mt-1.5 text-[13px] text-faint">Vai para as compras de {exact.name}.</p>}
          {suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2" aria-label="Pessoas que já existem">
              {suggestions.map((x) => (
                <button key={x.key} type="button" onClick={x.pick} className="press h-8 max-w-full truncate rounded-full border border-line bg-surface px-3 text-[13px] text-soft hover:text-ink">
                  Usar {x.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="half">
          <Field label="Produto">
            <TextInput value={d.product} onChange={(e) => set('product', e.target.value)} autoFocus={!sale} />
          </Field>
        </div>
        <div className="half">
          <Field label="Quantidade">
            <TextInput inputMode="decimal" className="num" value={d.quantity} onChange={(e) => set('quantity', e.target.value)} />
          </Field>
        </div>
        <Field label="Valor total">
          <MoneyInput value={d.total} onChange={(v) => set('total', v)} currency={d.currency} onCurrency={(c) => set('currency', c)} />
        </Field>
        <div className="half">
          <Field label="Data da venda">
            <TextInput type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Prazo para quitar" hint="opcional">
            <TextInput type="date" value={d.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </Field>
        </div>
        {!sale && (
          <Field label="Já recebeu quanto?" hint="opcional">
            <TextInput inputMode="decimal" className="num" placeholder="0,00" value={d.firstPayment} onChange={(e) => set('firstPayment', e.target.value)} />
          </Field>
        )}
        <Field label="Observações" hint="opcional">
          <TextArea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}

/** Small label that tells general and specific payments apart everywhere. */
export function PaymentKind({ general }: { general: boolean }) {
  return general ? (
    <span className="rounded-full bg-tint/[0.06] px-2 py-0.5 text-[12px] font-medium text-soft">Pagamento geral</span>
  ) : (
    <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[12px] font-medium text-accent-hi">Pagamento específico</span>
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

/** Payment history of one sale, with add/remove. Totals always derive from this list. */
export function SalePayments({ sale }: { sale: Sale }) {
  const { data, repository } = useStore()
  const { saveSales } = useReceipts()
  const { toast, confirm } = useFeedback()
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(toDateInput())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const status = saleStatus(sale)

  const add = async () => {
    if (busy) return
    const p: Payment = { id: newId(), date, amount: parseAmount(amount) ?? 0, note: '', finance: true }
    const err = paymentProblem(sale, p)
    setError(err)
    if (err) return
    setBusy(true)
    try {
      await saveSales([withPayment(sale, p)])
      void repository.syncNow?.()
      setAmount('')
      setAdding(false)
      toast('Pagamento específico registrado')
    } finally {
      setBusy(false)
    }
  }

  const removePayment = async (p: Payment) => {
    if (p.generalId) {
      // A piece of a general payment: the whole general payment goes, never just one piece.
      const pieces = data.sales.flatMap((s) => s.payments.filter((x) => x.generalId === p.generalId))
      const whole = pieces.reduce((sum, x) => sum + x.amount, 0)
      const ok = await confirm({
        title: 'Remover pagamento geral?',
        message: `Este valor faz parte de um pagamento geral de ${formatMoney(whole, sale.currency)} (${formatDateValue(p.date).toLowerCase()}). O pagamento geral inteiro será removido de todas as compras.`,
        confirmLabel: 'Remover',
        danger: true,
      })
      if (!ok) return
      await saveSales(withoutGeneralPayment(data.sales, p.generalId))
      void repository.syncNow?.()
      return
    }
    const ok = await confirm({ title: 'Remover pagamento?', message: `${formatMoney(p.amount, sale.currency)} de ${formatDateValue(p.date).toLowerCase()}`, confirmLabel: 'Remover', danger: true })
    if (!ok) return
    await saveSales([{ ...sale, payments: sale.payments.filter((x) => x.id !== p.id) }])
    void repository.syncNow?.()
  }

  return (
    <section className="mt-2">
      <div className="card mb-4 grid grid-cols-3 divide-x divide-line">
        <div className="p-3.5">
          <p className="text-[12px] text-faint">Total</p>
          <p className="num mt-0.5 text-[15px] font-semibold">{formatMoney(sale.total, sale.currency)}</p>
        </div>
        <div className="p-3.5">
          <p className="text-[12px] text-faint">Pago</p>
          <p className="num mt-0.5 text-[15px] font-semibold text-income">{formatMoney(salePaid(sale), sale.currency)}</p>
        </div>
        <div className="p-3.5">
          <p className="text-[12px] text-faint">Falta</p>
          <p className={`num mt-0.5 text-[15px] font-semibold ${saleRemaining(sale) ? 'text-ink' : 'text-soft'}`}>{formatMoney(saleRemaining(sale), sale.currency)}</p>
        </div>
      </div>
      <SectionTitle action={status !== 'paid' && !adding ? 'Registrar pagamento' : undefined} onAction={() => setAdding(true)}>
        Pagamentos · <Badge tone={STATUS_TONE[status]}>{SALE_STATUS_LABEL[status]}</Badge>
      </SectionTitle>
      {adding && (
        <div className="card mb-3 space-y-3 p-4">
          <p className="text-[13px] text-faint">Pagamento específico desta compra.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor">
              <TextInput
                inputMode="decimal"
                className="num"
                autoFocus
                placeholder={amountToInput(saleRemaining(sale))}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setError(null)
                }}
              />
            </Field>
            <Field label="Data">
              <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <PaymentAmountError
            error={error}
            onUseRemaining={() => {
              setAmount(amountToInput(saleRemaining(sale)))
              setError(null)
            }}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" icon={<Plus size={17} />} disabled={busy} onClick={add}>
              Adicionar
            </Button>
          </div>
        </div>
      )}
      {sale.payments.length ? (
        <div className="card divide-y divide-line">
          {sale.payments.map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-2.5 pr-2 pl-4">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-[15px]">
                  {formatDateValue(p.date)} <PaymentKind general={Boolean(p.generalId)} />
                </span>
                {p.generalId ? (
                  <span className="mt-0.5 block text-[12px] text-faint">Aplicado automaticamente pelo app (compras mais antigas primeiro){p.note ? ` · ${p.note}` : ''}</span>
                ) : (
                  p.note && <span className="mt-0.5 block text-[12px] text-faint">{p.note}</span>
                )}
              </span>
              <span className="num text-[15px] font-medium">{formatMoney(p.amount, sale.currency)}</span>
              <IconButton label="Remover pagamento" size="sm" onClick={() => removePayment(p)}>
                <Trash2 size={16} />
              </IconButton>
            </div>
          ))}
        </div>
      ) : (
        !adding && <p className="card px-4 py-3.5 text-[15px] text-faint">Nenhum pagamento ainda.</p>
      )}
    </section>
  )
}
