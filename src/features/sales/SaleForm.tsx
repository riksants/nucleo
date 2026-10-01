import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { newId, useStore } from '../../data/store'
import { paymentProblem, saleRemaining, saleStatus, SALE_STATUS_LABEL, salePaid, totalProblem, withPayment } from '../../data/sales'
import type { Currency, Payment, Sale } from '../../data/types'
import { formatDateValue, toDateInput } from '../../lib/dates'
import { amountToInput, formatMoney, parseAmount } from '../../lib/money'
import { Button, IconButton } from '../../ui/Button'
import { Badge, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, MoneyInput, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft } from '../../ui/formHooks'
import { ClientSelect } from '../shared/RelationSelect'

export const STATUS_TONE = { pending: 'warn', partial: 'accent', paid: 'positive' } as const

export function SaleForm({ open, onClose, sale }: { open: boolean; onClose(): void; sale: Sale | null }) {
  const { save, settings, displayCurrency } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const [d, set] = useDraft(open, () => ({
    clientId: sale?.clientId ?? null,
    clientName: sale?.clientName ?? '',
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
      const p: Payment = { id: newId(), date: d.date, amount: amount ?? 0, note: 'Pago na venda' }
      const err = paymentProblem(next, p)
      if (err) return err
      next = withPayment(next, p)
    }
    await save('sales', next)
    toast(sale ? 'Venda atualizada' : 'Venda registrada')
    onClose()
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={sale ? 'Editar venda' : 'Nova venda'}
      submitLabel={sale ? 'Salvar' : 'Registrar venda'}
      onSubmit={submit}
      size="lg"
      onDelete={sale ? () => del('sales', sale.id, 'venda', { feminine: true, after: onClose }) : undefined}
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

/** Payment history of one sale, with add/remove. Totals always derive from this list. */
export function SalePayments({ sale }: { sale: Sale }) {
  const { save } = useStore()
  const { toast, confirm } = useFeedback()
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(toDateInput())
  const [busy, setBusy] = useState(false)
  const status = saleStatus(sale)

  const add = async () => {
    if (busy) return
    const p: Payment = { id: newId(), date, amount: parseAmount(amount) ?? 0, note: '' }
    const err = paymentProblem(sale, p)
    if (err) return toast(err, 'error')
    setBusy(true)
    try {
      await save('sales', withPayment(sale, p))
      setAmount('')
      setAdding(false)
      toast('Pagamento registrado')
    } finally {
      setBusy(false)
    }
  }

  const removePayment = async (p: Payment) => {
    const ok = await confirm({ title: 'Remover pagamento?', message: `${formatMoney(p.amount, sale.currency)} de ${formatDateValue(p.date).toLowerCase()}`, confirmLabel: 'Remover', danger: true })
    if (!ok) return
    await save('sales', { ...sale, payments: sale.payments.filter((x) => x.id !== p.id) })
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
          <p className={`num mt-0.5 text-[15px] font-semibold ${saleRemaining(sale) ? 'text-warn' : 'text-soft'}`}>{formatMoney(saleRemaining(sale), sale.currency)}</p>
        </div>
      </div>
      <SectionTitle action={status !== 'paid' && !adding ? 'Registrar pagamento' : undefined} onAction={() => setAdding(true)}>
        Pagamentos · <Badge tone={STATUS_TONE[status]}>{SALE_STATUS_LABEL[status]}</Badge>
      </SectionTitle>
      {adding && (
        <div className="card mb-3 space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor">
              <TextInput inputMode="decimal" className="num" autoFocus placeholder={amountToInput(saleRemaining(sale))} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Data">
              <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
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
            <div key={p.id} className="flex items-center gap-3 py-2 pr-2 pl-4">
              <span className="flex-1 text-[15px]">{formatDateValue(p.date)}</span>
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
