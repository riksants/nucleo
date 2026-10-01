import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { newId, useStore } from '../../data/store'
import { advanceCharge, INTERVAL_LABEL, PER_INTERVAL, SUBSCRIBER_STATUS_LABEL } from '../../data/subscriptions'
import type { BillingInterval, Currency, Offering, SubPlan, Subscriber, SubscriberStatus } from '../../data/types'
import { formatDateValue, toDateInput } from '../../lib/dates'
import { amountToInput, formatMoney, parseAmount } from '../../lib/money'
import { Button, IconButton } from '../../ui/Button'
import { SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, MoneyInput, Select, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft } from '../../ui/formHooks'
import { Segmented } from '../../ui/Segmented'
import { ClientSelect, ProjectSelect } from '../shared/RelationSelect'

export function OfferingForm({ open, onClose, offering }: { open: boolean; onClose(): void; offering: Offering | null }) {
  const { save, data } = useStore()
  const { toast, confirm } = useFeedback()
  const del = useDelete()
  const [d, set] = useDraft(open, () => ({ name: offering?.name ?? '', projectId: offering?.projectId ?? null, notes: offering?.notes ?? '' }))
  const project = data.projects.find((p) => p.id === d.projectId)

  const submit = async () => {
    const name = d.name.trim() || project?.name || ''
    if (!name) return 'Dê um nome ou escolha um projeto'
    await save('offerings', { ...offering, ...d, name })
    toast(offering ? 'Produto atualizado' : 'Produto criado')
    onClose()
  }

  const remove = async () => {
    if (!offering) return
    const used = data.subscribers.filter((s) => s.offeringId === offering.id).length
    if (used) {
      await confirm({ title: 'Não dá para excluir ainda', message: `${used} assinante(s) usam este produto. Exclua ou mova os assinantes antes.`, confirmLabel: 'Ok' })
      return
    }
    await del('offerings', offering.id, 'produto', { after: onClose })
  }

  return (
    <FormSheet open={open} onClose={onClose} title={offering ? 'Editar produto' : 'Novo produto por assinatura'} onSubmit={submit} onDelete={offering ? remove : undefined}>
      <FormGrid>
        <Field label="Projeto" hint="opcional — vincular a um projeto seu">
          <ProjectSelect value={d.projectId} onChange={(v) => set('projectId', v)} />
        </Field>
        <Field label="Nome" hint={project ? 'em branco = nome do projeto' : undefined}>
          <TextInput value={d.name} placeholder={project?.name ?? 'Ex.: App de treinos'} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Observações" hint="opcional">
          <TextArea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}

export function PlanForm({ open, onClose, plan, offeringId }: { open: boolean; onClose(): void; plan: SubPlan | null; offeringId: string }) {
  const { save, data, settings } = useStore()
  const { toast, confirm } = useFeedback()
  const del = useDelete()
  const [d, set] = useDraft(open, () => ({
    name: plan?.name ?? '',
    price: amountToInput(plan?.price ?? 0),
    currency: (plan?.currency ?? settings.displayCurrency ?? settings.baseCurrency) as Currency,
    interval: (plan?.interval ?? 'monthly') as BillingInterval,
  }))

  const submit = async () => {
    if (!d.name.trim()) return 'Dê um nome ao plano'
    const price = parseAmount(d.price)
    if (price === null || price <= 0) return 'Digite o preço'
    await save('subPlans', { ...plan, offeringId: plan?.offeringId ?? offeringId, name: d.name.trim(), price, currency: d.currency, interval: d.interval })
    toast(plan ? 'Plano atualizado' : 'Plano criado')
    onClose()
  }

  const remove = async () => {
    if (!plan) return
    const used = data.subscribers.filter((s) => s.planId === plan.id).length
    if (used) {
      await confirm({ title: 'Não dá para excluir ainda', message: `${used} assinante(s) estão neste plano.`, confirmLabel: 'Ok' })
      return
    }
    await del('subPlans', plan.id, 'plano', { after: onClose })
  }

  return (
    <FormSheet open={open} onClose={onClose} title={plan ? 'Editar plano' : 'Novo plano'} onSubmit={submit} onDelete={plan ? remove : undefined}>
      <FormGrid>
        <Field label="Nome do plano">
          <TextInput value={d.name} placeholder="Ex.: Pro" onChange={(e) => set('name', e.target.value)} autoFocus={!plan} />
        </Field>
        <Field label="Cobrança">
          <Segmented block value={d.interval} onChange={(v) => set('interval', v)} options={[{ value: 'monthly', label: 'Mensal' }, { value: 'yearly', label: 'Anual' }]} />
        </Field>
        <Field label={`Preço ${d.interval === 'monthly' ? 'por mês' : 'por ano'}`}>
          <MoneyInput value={d.price} onChange={(v) => set('price', v)} currency={d.currency} onCurrency={(c) => set('currency', c)} />
        </Field>
        {plan && <p className="text-[13px] leading-relaxed text-faint">Mudar o preço vale para as projeções. Pagamentos já registrados mantêm o valor e a moeda originais.</p>}
      </FormGrid>
    </FormSheet>
  )
}

export function SubscriberForm({ open, onClose, subscriber, defaultOfferingId }: { open: boolean; onClose(): void; subscriber: Subscriber | null; defaultOfferingId?: string }) {
  const { save, data } = useStore()
  const { toast } = useFeedback()
  const del = useDelete()
  const [d, set, setAll] = useDraft(open, () => ({
    offeringId: subscriber?.offeringId ?? defaultOfferingId ?? data.offerings[0]?.id ?? '',
    planId: subscriber?.planId ?? '',
    name: subscriber?.name ?? '',
    clientId: subscriber?.clientId ?? null,
    email: subscriber?.email ?? '',
    startDate: subscriber?.startDate ?? toDateInput(),
    nextCharge: subscriber?.nextCharge ?? toDateInput(),
    status: (subscriber?.status ?? 'active') as SubscriberStatus,
    notes: subscriber?.notes ?? '',
  }))
  const plans = data.subPlans.filter((p) => p.offeringId === d.offeringId)
  const planId = plans.some((p) => p.id === d.planId) ? d.planId : (plans[0]?.id ?? '')
  const client = data.clients.find((c) => c.id === d.clientId)

  const submit = async () => {
    if (!d.offeringId) return 'Crie um produto primeiro'
    if (!planId) return 'Crie um plano para este produto'
    const name = d.name.trim() || client?.name || ''
    if (!name) return 'Informe o nome do assinante'
    const cancelledAt = d.status === 'cancelled' ? subscriber?.cancelledAt || toDateInput() : ''
    await save('subscribers', { ...subscriber, ...d, planId, name, cancelledAt, payments: subscriber?.payments ?? [] })
    toast(subscriber ? 'Assinante atualizado' : 'Assinante adicionado')
    onClose()
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={subscriber ? 'Editar assinante' : 'Novo assinante'}
      onSubmit={submit}
      size="lg"
      onDelete={subscriber ? () => del('subscribers', subscriber.id, 'assinante', { after: onClose }) : undefined}
    >
      <FormGrid>
        <div className="half">
          <Field label="Produto">
            <Select value={d.offeringId} onChange={(e) => setAll((x) => ({ ...x, offeringId: e.target.value, planId: '' }))}>
              {data.offerings.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="half">
          <Field label="Plano">
            <Select value={planId} onChange={(e) => set('planId', e.target.value)}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatMoney(p.price, p.currency)}
                  {PER_INTERVAL[p.interval]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="half">
          <Field label="Cliente" hint="opcional">
            <ClientSelect value={d.clientId} onChange={(v) => set('clientId', v)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Nome" hint={client ? 'em branco = nome do cliente' : undefined}>
            <TextInput value={d.name} placeholder={client?.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
        </div>
        <Field label="E-mail" hint="opcional">
          <TextInput type="email" inputMode="email" autoCapitalize="none" value={d.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <div className="half">
          <Field label="Início">
            <TextInput type="date" value={d.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Próxima cobrança">
            <TextInput type="date" value={d.nextCharge} onChange={(e) => set('nextCharge', e.target.value)} />
          </Field>
        </div>
        <Field label="Situação">
          <Segmented block value={d.status} onChange={(v) => set('status', v)} options={(Object.keys(SUBSCRIBER_STATUS_LABEL) as SubscriberStatus[]).map((v) => ({ value: v, label: SUBSCRIBER_STATUS_LABEL[v] }))} />
        </Field>
        <Field label="Observações" hint="opcional">
          <TextArea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}

/** Payments received from one subscriber. Recording one can move the next charge one cycle ahead. */
export function SubscriberPayments({ subscriber, plan }: { subscriber: Subscriber; plan: SubPlan | undefined }) {
  const { save } = useStore()
  const { toast, confirm } = useFeedback()
  const [adding, setAdding] = useState(false)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(toDateInput())
  const [advance, setAdvance] = useState(true)
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (busy || !plan) return
    const cents = parseAmount(amount || amountToInput(plan.price))
    if (!cents) return toast('Digite o valor recebido', 'error')
    setBusy(true)
    try {
      const payment = { id: newId(), date, amount: cents, currency: plan.currency, note: '' }
      await save('subscribers', {
        ...subscriber,
        payments: [...subscriber.payments, payment].sort((a, b) => (a.date < b.date ? -1 : 1)),
        nextCharge: advance && subscriber.nextCharge ? advanceCharge(subscriber.nextCharge, plan.interval) : subscriber.nextCharge,
      })
      setAdding(false)
      setAmount('')
      toast('Pagamento registrado')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    const ok = await confirm({ title: 'Remover pagamento?', message: 'A próxima cobrança não volta sozinha; ajuste se precisar.', confirmLabel: 'Remover', danger: true })
    if (ok) await save('subscribers', { ...subscriber, payments: subscriber.payments.filter((p) => p.id !== id) })
  }

  return (
    <section className="mt-5">
      <SectionTitle action={subscriber.status !== 'cancelled' && !adding && plan ? 'Registrar pagamento' : undefined} onAction={() => setAdding(true)}>
        Pagamentos recebidos
      </SectionTitle>
      {adding && plan && (
        <div className="card mb-3 space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Valor (${plan.currency})`}>
              <TextInput inputMode="decimal" className="num" autoFocus placeholder={amountToInput(plan.price)} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Data">
              <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          {subscriber.nextCharge && (
            <label className="flex items-center gap-3 text-[15px]">
              <input type="checkbox" className="size-5 accent-[var(--color-accent)]" checked={advance} onChange={(e) => setAdvance(e.target.checked)} />
              Avançar próxima cobrança ({formatDateValue(advanceCharge(subscriber.nextCharge, plan.interval)).toLowerCase()})
            </label>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
            <Button className="flex-1" disabled={busy} onClick={add}>
              Adicionar
            </Button>
          </div>
        </div>
      )}
      {subscriber.payments.length ? (
        <div className="card divide-y divide-line">
          {[...subscriber.payments].reverse().map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-2 pr-2 pl-4">
              <span className="flex-1 text-[15px]">{formatDateValue(p.date)}</span>
              <span className="num text-[15px] font-medium">{formatMoney(p.amount, p.currency)}</span>
              <IconButton label="Remover pagamento" size="sm" onClick={() => remove(p.id)}>
                <Trash2 size={16} />
              </IconButton>
            </div>
          ))}
        </div>
      ) : (
        !adding && <p className="card px-4 py-3.5 text-[15px] text-faint">Nenhum pagamento registrado.</p>
      )}
      {plan && <p className="mt-2 px-1 text-[13px] text-faint">Plano {plan.name} · {INTERVAL_LABEL[plan.interval].toLowerCase()} · {formatMoney(plan.price, plan.currency)}{PER_INTERVAL[plan.interval]}</p>}
    </section>
  )
}
