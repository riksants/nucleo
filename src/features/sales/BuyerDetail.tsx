import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { newId, useStore } from '../../data/store'
import {
  applyGeneralPayment,
  BUYER_STATUS_LABEL,
  BUYER_TONE,
  buyerPayments,
  owedIn,
  saleRemaining,
  saleStatus,
  SALE_STATUS_LABEL,
  salePaid,
  withoutGeneralPayment,
  type Buyer,
  type PaymentEntry,
} from '../../data/sales'
import type { Currency } from '../../data/types'
import { formatDateValue, toDateInput } from '../../lib/dates'
import { amountToInput, formatMoney, parseAmount } from '../../lib/money'
import { Button, IconButton } from '../../ui/Button'
import { Badge, SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, Select, TextInput } from '../../ui/Field'
import { Sheet } from '../../ui/Sheet'
import { PaymentAmountError, PaymentKind, STATUS_TONE, type BuyerPreset } from './SaleForm'

/** One person in Vendas: every purchase, what was paid (general or specific) and what is still owed. */
export function BuyerDetail({
  buyer,
  open,
  onClose,
  onOpenSale,
  onNewSale,
}: {
  buyer: Buyer | null
  open: boolean
  onClose(): void
  onOpenSale(id: string): void
  onNewSale(preset: BuyerPreset): void
}) {
  const { save, data, repository } = useStore()
  const { toast, confirm } = useFeedback()
  const owing = buyer?.totals.filter((t) => t.remaining > 0) ?? []
  const [paying, setPaying] = useState(false)
  const [currency, setCurrency] = useState<Currency>(owing[0]?.currency ?? 'BRL')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(toDateInput())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // The general payment form always starts empty.
  const startPaying = () => {
    setAmount('')
    setNote('')
    setError(null)
    setDate(toDateInput())
    setPaying(true)
  }
  const close = () => {
    setPaying(false)
    onClose()
  }

  if (!buyer) return null

  const payCurrency = owing.some((t) => t.currency === currency) ? currency : (owing[0]?.currency ?? currency)
  const history = buyerPayments(buyer.sales)
  const preset: BuyerPreset = { clientId: buyer.clientId, clientName: buyer.clientId ? '' : buyer.name }

  const registerGeneral = async () => {
    if (busy) return
    const result = applyGeneralPayment(buyer.sales, { generalId: newId(), currency: payCurrency, amount: parseAmount(amount), date, note: note.trim() }, newId)
    if ('error' in result) return setError(result.error)
    setBusy(true)
    try {
      for (const s of result.changed) await save('sales', s)
      void repository.syncNow?.()
      setPaying(false)
      setAmount('')
      setNote('')
      toast('Pagamento geral registrado')
    } finally {
      setBusy(false)
    }
  }

  const removeEntry = async (e: PaymentEntry) => {
    const ok = await confirm({
      title: e.kind === 'general' ? 'Remover pagamento geral?' : 'Remover pagamento?',
      message: `${formatMoney(e.amount, e.currency)} de ${formatDateValue(e.date).toLowerCase()}${e.kind === 'general' ? ' — sai de todas as compras em que foi aplicado.' : ''}`,
      confirmLabel: 'Remover',
      danger: true,
    })
    if (!ok) return
    if (e.kind === 'general') {
      for (const s of withoutGeneralPayment(data.sales, e.id)) await save('sales', s)
    } else {
      const sale = buyer.sales.find((s) => s.id === e.parts[0].saleId)
      if (sale) await save('sales', { ...sale, payments: sale.payments.filter((p) => p.id !== e.id) })
    }
    void repository.syncNow?.()
  }

  return (
    <Sheet open={open} onClose={close} title={buyer.name} size="lg" actions={<Badge tone={BUYER_TONE[buyer.status]}>{BUYER_STATUS_LABEL[buyer.status]}</Badge>}>
      <p className="pb-3 text-[14px] text-faint">
        {buyer.sales.length} {buyer.sales.length === 1 ? 'compra' : 'compras'}
        {buyer.clientId ? ' · cliente' : ''}
      </p>
      <div className="card mb-4 divide-y divide-line">
        {buyer.totals.map((t) => (
          <div key={t.currency} className="grid grid-cols-3 divide-x divide-line">
            <div className="p-3.5">
              <p className="text-[12px] text-faint">Total comprado</p>
              <p className="num mt-0.5 text-[15px] font-semibold">{formatMoney(t.total, t.currency)}</p>
            </div>
            <div className="p-3.5">
              <p className="text-[12px] text-faint">Total pago</p>
              <p className="num mt-0.5 text-[15px] font-semibold text-income">{formatMoney(t.paid, t.currency)}</p>
            </div>
            <div className="p-3.5">
              <p className="text-[12px] text-faint">Falta pagar</p>
              <p className={`num mt-0.5 text-[15px] font-semibold ${t.remaining ? 'text-warn' : 'text-soft'}`}>{formatMoney(t.remaining, t.currency)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={!owing.length} onClick={startPaying}>
          Pagamento geral
        </Button>
        <Button variant="secondary" icon={<Plus size={17} />} onClick={() => onNewSale(preset)}>
          Nova venda
        </Button>
      </div>

      {paying && (
        <div className="card mb-5 space-y-3 p-4">
          <p className="text-[13px] leading-relaxed text-faint">Pagamento geral: não é de um produto específico. O app aplica o valor nas compras em aberto mais antigas desta moeda.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor" hint={`falta ${formatMoney(owedIn(buyer.sales, payCurrency), payCurrency)}`}>
              <TextInput
                inputMode="decimal"
                className="num"
                autoFocus
                aria-label="Valor do pagamento geral"
                placeholder={amountToInput(owedIn(buyer.sales, payCurrency))}
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
          {owing.length > 1 && (
            <Field label="Moeda">
              <Select value={payCurrency} onChange={(e) => setCurrency(e.target.value)}>
                {owing.map((t) => (
                  <option key={t.currency} value={t.currency}>
                    {t.currency} · falta {formatMoney(t.remaining, t.currency)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Observação" hint="opcional">
            <TextInput value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Pix" />
          </Field>
          <PaymentAmountError
            error={error}
            onUseRemaining={() => {
              setAmount(amountToInput(owedIn(buyer.sales, payCurrency)))
              setError(null)
            }}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setPaying(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" disabled={busy} onClick={registerGeneral}>
              Registrar pagamento geral
            </Button>
          </div>
        </div>
      )}

      <SectionTitle>Compras</SectionTitle>
      <div className="card mb-5 p-1.5">
        {[...buyer.sales].reverse().map((s) => {
          const st = saleStatus(s)
          return (
            <button key={s.id} type="button" onClick={() => onOpenSale(s.id)} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">
                  {s.product}
                  {s.quantity !== 1 ? ` × ${s.quantity.toLocaleString('pt-BR')}` : ''}
                </span>
                <span className="block truncate text-[13px] text-faint">
                  {formatDateValue(s.date)} · pago {formatMoney(salePaid(s), s.currency)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="num block text-[15px] font-semibold">{formatMoney(s.total, s.currency)}</span>
                {st === 'paid' ? <Badge tone={STATUS_TONE.paid}>{SALE_STATUS_LABEL.paid}</Badge> : <span className="num text-[13px] text-warn">falta {formatMoney(saleRemaining(s), s.currency)}</span>}
              </span>
            </button>
          )
        })}
      </div>

      <SectionTitle>Histórico de pagamentos</SectionTitle>
      {history.length ? (
        <div className="card divide-y divide-line">
          {history.map((e) => (
            <div key={`${e.kind}:${e.id}:${e.currency}`} className="flex items-start gap-3 py-3 pr-2 pl-4">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-[15px]">
                  {formatDateValue(e.date)} <PaymentKind general={e.kind === 'general'} />
                </span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-faint">
                  {e.kind === 'general' ? `Distribuído automaticamente: ${e.parts.map((p) => `${p.product} ${formatMoney(p.amount, e.currency)}`).join(' · ')}` : e.parts[0].product}
                  {e.note ? ` · ${e.note}` : ''}
                </span>
              </span>
              <span className="num pt-0.5 text-[15px] font-medium">{formatMoney(e.amount, e.currency)}</span>
              <IconButton label="Remover pagamento" size="sm" onClick={() => removeEntry(e)}>
                <Trash2 size={16} />
              </IconButton>
            </div>
          ))}
        </div>
      ) : (
        <p className="card px-4 py-3.5 text-[15px] text-faint">Nenhum pagamento ainda.</p>
      )}
    </Sheet>
  )
}
