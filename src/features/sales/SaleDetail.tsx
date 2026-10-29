import { CalendarClock, ChevronRight, Copy, HandCoins, MessageCircle, Pause, Pencil, Play, Repeat, Square } from 'lucide-react'
import { useRef, useState } from 'react'
import { todayIn, zoneOf } from '../../core/period'
import { chargeMessage, installmentViews, isLate, nextDue, settles, whatsappLink } from '../../core/salesSmart'
import { clientKey, paymentProblem, saleRemaining, salePaid, saleStatus, withoutGeneralPayment, withPayment } from '../../data/sales'
import { newId, useStore } from '../../data/store'
import { useReceipts } from '../../data/useReceipts'
import type { Payment, Sale } from '../../data/types'
import { parseMoney } from '../../lib/calc'
import { formatDateValue } from '../../lib/dates'
import { amountToInput, formatMoney } from '../../lib/money'
import { AmountField } from '../../ui/AmountField'
import { Button } from '../../ui/Button'
import { Badge } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, TextArea, TextInput } from '../../ui/Field'
import { useDraft } from '../../ui/formHooks'
import { Sheet } from '../../ui/Sheet'
import { PaymentAmountError } from './SaleForm'
import { useBuyerName } from './useBuyerName'

const STATE_LABEL = { paid: 'Paga', partial: 'Parcial', pending: 'A vencer', overdue: 'Atrasada' } as const
const STATE_TONE = { paid: 'text-income', partial: 'text-accent-hi', pending: 'text-soft', overdue: 'text-expense' } as const

/** The phone to charge: the client's WhatsApp/phone, else one saved on any sale of the same buyer. */
export function useBuyerPhone(sale: Sale | null): { phone: string; save(phone: string): Promise<void> } {
  const { data, save } = useStore()
  const { saveSales } = useReceipts()
  if (!sale) return { phone: '', save: async () => {} }
  const client = sale.clientId ? data.clients.find((c) => c.id === sale.clientId) : undefined
  const key = clientKey(sale)
  const phone = client?.whatsapp || client?.phone || sale.phone || data.sales.find((s) => clientKey(s) === key && s.phone)?.phone || ''
  return {
    phone,
    // Only the phone is asked and saved: on the client when there is one, else on this sale.
    save: async (p: string) => {
      if (client) await save('clients', { ...client, whatsapp: p })
      else await saveSales([{ ...sale, phone: p }])
    },
  }
}

/** "Recebi": the amount still owed and today, ready; change either for a partial payment or another date. */
export function ReceiveSheet({ sale, payment, onClose }: { sale: Sale | null; payment?: Payment | null; onClose(): void }) {
  const { settings, data, repository } = useStore()
  const { saveSales } = useReceipts()
  const { toast, confirm } = useFeedback()
  const today = todayIn(zoneOf(settings))
  const busy = useRef(false)
  const open = Boolean(sale)
  const editing = Boolean(payment)
  const [d, set] = useDraft(open, () => ({
    amount: amountToInput(payment ? payment.amount : sale ? saleRemaining(sale) : 0),
    date: payment?.date ?? today,
    // One id per opening: a double tap, or trying again after an error, updates the same payment (never two).
    id: payment?.id ?? newId(),
    error: null as string | null,
  }))
  if (!sale) return null
  const amount = parseMoney(d.amount) ?? 0
  const others = sale.payments.filter((p) => p.id !== d.id)
  const owed = Math.max(0, sale.total - others.reduce((s, p) => s + p.amount, 0))
  const plan = sale.installments?.length ? settles({ ...sale, payments: others }, Math.min(amount, owed), today) : []

  const confirmPay = async () => {
    if (busy.current) return
    const p: Payment = { ...(payment ?? { note: '' }), id: d.id, date: d.date, amount, finance: payment ? payment.finance : true } as Payment
    const err = paymentProblem(sale, p)
    if (err) return set('error', err)
    busy.current = true
    try {
      await saveSales([withPayment(sale, p)])
      void repository.syncNow?.()
      const left = owed - amount
      toast(editing ? 'Pagamento corrigido' : left > 0 ? `Recebido · falta ${formatMoney(left, sale.currency)}` : 'Recebido · venda quitada')
      onClose()
    } finally {
      busy.current = false
    }
  }

  const remove = async () => {
    if (!payment) return
    if (payment.generalId) {
      const pieces = data.sales.flatMap((s) => s.payments.filter((x) => x.generalId === payment.generalId))
      const whole = pieces.reduce((sum, x) => sum + x.amount, 0)
      const ok = await confirm({ title: 'Remover pagamento geral?', message: `Este valor faz parte de um pagamento geral de ${formatMoney(whole, sale.currency)}. Ele sai de todas as compras e do Financeiro.`, confirmLabel: 'Remover', danger: true })
      if (!ok) return
      await saveSales(withoutGeneralPayment(data.sales, payment.generalId))
    } else {
      const ok = await confirm({ title: 'Remover este pagamento?', message: `${formatMoney(payment.amount, sale.currency)} de ${formatDateValue(payment.date).toLowerCase()}. A entrada dele no Financeiro também sai; a venda volta a ter esse valor a receber.`, confirmLabel: 'Remover', danger: true })
      if (!ok) return
      await saveSales([{ ...sale, payments: sale.payments.filter((x) => x.id !== payment.id) }])
    }
    void repository.syncNow?.()
    toast('Pagamento removido')
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Corrigir pagamento' : 'Recebi'}>
      <div className="space-y-4">
        <p className="text-[14px] text-soft">
          {sale.product} · falta {formatMoney(owed, sale.currency)}
        </p>
        {payment?.generalId ? (
          <p className="rounded-2xl bg-tint/[0.04] p-3 text-[14px] text-soft">Este valor veio de um pagamento geral da pessoa (dividido pelo app). Para mudar, remova e registre de novo.</p>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
            <Field label="Valor recebido">
              <AmountField currency={sale.currency} value={d.amount} onChange={(v) => (set('amount', v), set('error', null))} enterKeyHint="done" onEnter={confirmPay} />
            </Field>
            <Field label="Data">
              <TextInput type="date" value={d.date} max={today} onChange={(e) => set('date', e.target.value)} />
            </Field>
          </div>
        )}
        <PaymentAmountError error={d.error} onUseRemaining={() => (set('amount', amountToInput(owed)), set('error', null))} />
        {plan.length > 0 && !payment?.generalId && (
          <p className="text-[13px] text-soft" aria-live="polite">
            Abate:{' '}
            {plan
              .map((x) => `${x.index + 1}ª parcela${x.full ? '' : ` (parte: ${formatMoney(x.covers, sale.currency)})`}`)
              .join(', ')}
          </p>
        )}
        {amount > 0 && amount < owed && !payment && <p className="text-[13px] text-faint">Pagamento parcial: continuam {formatMoney(owed - amount, sale.currency)} a receber.</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          {!payment?.generalId && (
            <Button className="flex-1" onClick={confirmPay}>
              {editing ? 'Salvar correção' : 'Confirmar recebimento'}
            </Button>
          )}
          {payment && (
            <Button variant="ghost" onClick={remove}>
              Remover pagamento
            </Button>
          )}
        </div>
        <p className="text-[12px] text-faint">Entra também no Financeiro como entrada, uma vez só.</p>
      </div>
    </Sheet>
  )
}

/** "Cobrar": a polite message with what is really owed; the person reviews it and opens WhatsApp themselves. */
export function ChargeSheet({ sale, onClose }: { sale: Sale | null; onClose(): void }) {
  const { settings } = useStore()
  const buyer = useBuyerName()
  const { toast } = useFeedback()
  const contact = useBuyerPhone(sale)
  const today = todayIn(zoneOf(settings))
  const open = Boolean(sale)
  const [d, set] = useDraft(open, () => {
    if (!sale) return { text: '', phone: '' }
    const due = nextDue(sale, today)
    return { text: chargeMessage({ name: buyer(sale), product: sale.product, saleDate: sale.date, pending: formatMoney(saleRemaining(sale), sale.currency), due, late: Boolean(due) && due < today }), phone: '' }
  })
  if (!sale) return null
  const phone = contact.phone || d.phone
  const link = phone ? whatsappLink(phone, d.text) : null
  return (
    <Sheet open={open} onClose={onClose} title={`Cobrar ${buyer(sale)}`}>
      <div className="space-y-4">
        {!contact.phone && (
          <div className="space-y-2 rounded-2xl bg-tint/[0.04] p-3">
            <Field label={`WhatsApp de ${buyer(sale)}`} hint="com código do país, ex.: 55 11 98888-7777">
              <TextInput type="tel" inputMode="tel" autoComplete="tel" value={d.phone} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Button
              variant="secondary"
              disabled={d.phone.replace(/\D/g, '').length < 8}
              onClick={async () => {
                await contact.save(d.phone.trim())
                toast('Número salvo')
              }}
            >
              Salvar número
            </Button>
          </div>
        )}
        <Field label="Mensagem" hint="confira e ajuste se quiser">
          <TextArea rows={6} value={d.text} onChange={(e) => set('text', e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          {link ? (
            <a href={link} target="_blank" rel="noreferrer" className="press inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-accent px-5 text-[15px] font-semibold text-on-accent hover:bg-accent-soft">
              <MessageCircle size={18} /> Abrir WhatsApp
            </a>
          ) : (
            <span className="inline-flex h-11 flex-1 items-center justify-center rounded-full bg-accent/40 px-5 text-[15px] font-semibold text-on-accent/70">Informe o WhatsApp</span>
          )}
          <Button
            variant="secondary"
            icon={<Copy size={16} />}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(d.text)
                toast('Mensagem copiada')
              } catch {
                toast('Não deu para copiar neste navegador', 'error')
              }
            }}
          >
            Copiar
          </Button>
        </div>
        <p className="text-[12px] leading-relaxed text-faint">O Núcleo só prepara a mensagem: você envia no WhatsApp. Abrir o WhatsApp não marca nada como cobrado nem pago.</p>
      </div>
    </Sheet>
  )
}

/** A sale, read (not edited): who, what, money, dates, installments and payments, with the actions that matter. */
export function SaleDetail({
  sale,
  onClose,
  onEdit,
  onSellAgain,
  onOpenPerson,
}: {
  sale: Sale | null
  onClose(): void
  onEdit(s: Sale): void
  onSellAgain(s: Sale): void
  onOpenPerson(key: string): void
}) {
  const { settings, data } = useStore()
  const { saveSales } = useReceipts()
  const { toast, confirm } = useFeedback()
  const buyer = useBuyerName()
  const today = todayIn(zoneOf(settings))
  const [receiving, setReceiving] = useState<{ payment: Payment | null } | null>(null)
  const [charging, setCharging] = useState(false)
  if (!sale) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>

  const status = saleStatus(sale)
  const remaining = saleRemaining(sale)
  const late = isLate(sale, today)
  const due = nextDue(sale, today)
  const views = installmentViews(sale, today)
  const charges = data.sales.filter((s) => s.recurOf === sale.id)
  const root = sale.recurOf ? data.sales.find((s) => s.id === sale.recurOf) : undefined
  const setRepeat = async (status: 'active' | 'paused' | 'ended') => {
    if (status === 'ended') {
      const ok = await confirm({ title: 'Encerrar a repetição?', message: 'Nenhuma cobrança nova será criada. As que já existem continuam.', confirmLabel: 'Encerrar' })
      if (!ok) return
    }
    await saveSales([{ ...sale, recurring: { ...sale.recurring!, status } }])
    toast(status === 'paused' ? 'Repetição pausada' : status === 'active' ? 'Repetição retomada' : 'Repetição encerrada')
  }

  return (
    <>
      <Sheet open={Boolean(sale) && !receiving && !charging} onClose={onClose} title={buyer(sale)}>
        <div className="space-y-5">
          <div>
            <p className="text-[17px] leading-snug font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">{sale.product}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-soft">
              Vendida {formatDateValue(sale.date).toLowerCase()}
              {status === 'paid' ? <Badge tone="positive">Quitada</Badge> : late ? <Badge tone="warn">Atrasada</Badge> : <Badge tone="accent">A receber</Badge>}
              {sale.recurring && (
                <span className="inline-flex items-center gap-1 text-faint">
                  <Repeat size={14} /> {sale.recurring.status === 'active' ? 'repete' : sale.recurring.status === 'paused' ? 'pausada' : 'encerrada'}
                </span>
              )}
            </p>
          </div>

          <div className="card grid grid-cols-3 divide-x divide-line">
            <div className="p-3.5">
              <p className="text-[12px] text-faint">Total</p>
              <p className="num mt-0.5 text-[15px] font-semibold">{formatMoney(sale.total, sale.currency)}</p>
            </div>
            <div className="p-3.5">
              <p className="text-[12px] text-faint">Recebido</p>
              <p className="num mt-0.5 text-[15px] font-semibold text-income">{formatMoney(Math.min(salePaid(sale), sale.total), sale.currency)}</p>
            </div>
            <div className="p-3.5">
              <p className="text-[12px] text-faint">Falta</p>
              <p className={`num mt-0.5 text-[15px] font-semibold ${remaining ? (late ? 'text-expense' : 'text-ink') : 'text-soft'}`}>{formatMoney(remaining, sale.currency)}</p>
            </div>
          </div>
          {remaining > 0 && due && (
            <p className={`flex items-center gap-2 text-[14px] ${late ? 'font-semibold text-expense' : 'text-soft'}`}>
              <CalendarClock size={16} /> {late ? 'Venceu' : 'Vence'} {formatDateValue(due).toLowerCase()}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            {remaining > 0 && (
              <Button icon={<HandCoins size={18} />} onClick={() => setReceiving({ payment: null })}>
                Recebi
              </Button>
            )}
            {remaining > 0 && (
              <Button variant="secondary" icon={<MessageCircle size={18} />} onClick={() => setCharging(true)}>
                Cobrar
              </Button>
            )}
            <Button variant="secondary" onClick={() => onSellAgain(sale)}>
              Vender novamente
            </Button>
            <Button variant="ghost" icon={<Pencil size={18} />} onClick={() => onEdit(sale)}>
              Editar venda
            </Button>
          </div>

          {sale.items && sale.items.length > 0 && (
            <section aria-label="Itens">
              <h3 className="mb-2 text-[13px] font-semibold text-soft">Itens</h3>
              <ul className="card divide-y divide-line">
                {sale.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-[14px]">
                    <span className="min-w-0 flex-1 truncate">
                      {i.quantity !== 1 && <span className="num text-soft">{i.quantity}× </span>}
                      {i.name}
                    </span>
                    <span className="num shrink-0 font-medium">{formatMoney(Math.round(i.price * i.quantity), sale.currency)}</span>
                  </li>
                ))}
                {(sale.discount ?? 0) > 0 && (
                  <li className="flex items-center justify-between px-4 py-2.5 text-[14px] text-soft">
                    Desconto <span className="num">−{formatMoney(sale.discount!, sale.currency)}</span>
                  </li>
                )}
              </ul>
            </section>
          )}

          {views.length > 0 && (
            <section aria-label="Parcelas">
              <h3 className="mb-2 text-[13px] font-semibold text-soft">
                Parcelas · {views.filter((v) => v.state === 'paid').length} de {views.length} pagas
              </h3>
              <ul className="card divide-y divide-line">
                {views.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 px-4 py-2.5 text-[14px]">
                    <span className="num w-8 shrink-0 text-soft">{v.index + 1}ª</span>
                    <span className="min-w-0 flex-1">{formatDateValue(v.due)}</span>
                    <span className="num shrink-0">{formatMoney(v.amount, sale.currency)}</span>
                    <span className={`w-16 shrink-0 text-right text-[12px] font-semibold ${STATE_TONE[v.state]}`}>{STATE_LABEL[v.state]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Pagamentos">
            <h3 className="mb-2 text-[13px] font-semibold text-soft">Pagamentos</h3>
            {sale.payments.length ? (
              <ul className="card divide-y divide-line">
                {sale.payments.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setReceiving({ payment: p })} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14px] hover:bg-tint/[0.03]">
                      <span className="min-w-0 flex-1">
                        <span className="block">{formatDateValue(p.date)}</span>
                        <span className="block text-[12px] text-faint">{p.generalId ? 'Parte de um pagamento geral' : p.note || 'Toque para corrigir ou remover'}</span>
                      </span>
                      <span className="num shrink-0 font-medium text-income">{formatMoney(p.amount, sale.currency)}</span>
                      <ChevronRight size={16} className="shrink-0 text-accent-hi" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="card px-4 py-3 text-[14px] text-faint">Nenhum pagamento ainda.</p>
            )}
          </section>

          {sale.recurring && (
            <section aria-label="Repetição" className="card space-y-3 p-4">
              <p className="text-[14px]">
                Repete {sale.recurring.every === 'week' ? 'toda semana' : sale.recurring.every === 'month' ? 'todo mês' : 'todo ano'}
                {sale.recurring.status === 'active' && sale.recurNext ? ` · próxima cobrança ${formatDateValue(sale.recurNext).toLowerCase()}` : ''}
                {charges.length > 0 && ` · ${charges.length} ${charges.length === 1 ? 'cobrança gerada' : 'cobranças geradas'}`}
              </p>
              {sale.recurring.status !== 'ended' && (
                <div className="flex flex-wrap gap-2">
                  {sale.recurring.status === 'active' ? (
                    <Button variant="secondary" icon={<Pause size={16} />} onClick={() => setRepeat('paused')}>
                      Pausar
                    </Button>
                  ) : (
                    <Button variant="secondary" icon={<Play size={16} />} onClick={() => setRepeat('active')}>
                      Retomar
                    </Button>
                  )}
                  <Button variant="ghost" icon={<Square size={14} />} onClick={() => setRepeat('ended')}>
                    Encerrar
                  </Button>
                </div>
              )}
            </section>
          )}
          {root && <p className="text-[13px] text-faint">Cobrança gerada pela repetição de “{root.product}”.</p>}

          {sale.notes && <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-soft">{sale.notes}</p>}

          <button type="button" onClick={() => onOpenPerson(clientKey(sale))} className="flex w-full items-center justify-between rounded-2xl border border-line px-4 py-3 text-left text-[15px] text-soft hover:text-ink">
            Tudo de {buyer(sale)}: compras, pagamentos e pendente
            <ChevronRight size={16} />
          </button>
        </div>
      </Sheet>
      <ReceiveSheet sale={receiving ? sale : null} payment={receiving?.payment} onClose={() => setReceiving(null)} />
      <ChargeSheet sale={charging ? sale : null} onClose={() => setCharging(false)} />
    </>
  )
}
