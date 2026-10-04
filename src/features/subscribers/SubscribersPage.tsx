import { Pencil, Plus, Repeat } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../../app/Shell'
import { matches } from '../../data/selectors'
import { useStore } from '../../data/store'
import { convertTotals, nextChargeOf, PER_INTERVAL, projectRevenue, receivedByCurrency, SUBSCRIBER_STATUS_LABEL } from '../../data/subscriptions'
import type { Offering, SubPlan, Subscriber, SubscriberStatus } from '../../data/types'
import { formatDateTime, formatDateValue, relativeDays, toDateInput } from '../../lib/dates'
import { formatMoney } from '../../lib/money'
import { Button, IconButton } from '../../ui/Button'
import { Badge, EmptyState, SearchField, SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { Chips } from '../../ui/Segmented'
import { Sheet } from '../../ui/Sheet'
import { useOpenParam } from '../useOpenParam'
import { OfferingForm, PlanForm, SubscriberForm, SubscriberPayments } from './SubscriberForms'

const STATUS_TONE: Record<SubscriberStatus, 'accent' | 'warn' | 'neutral'> = { active: 'accent', trial: 'warn', paused: 'neutral', cancelled: 'neutral' }

function Projection() {
  const { data, displayCurrency, convert, settings } = useStore()
  const rows = projectRevenue(data.subscribers, data.subPlans)
  const now = new Date()
  const monthStart = toDateInput(new Date(now.getFullYear(), now.getMonth(), 1))
  const yearStart = toDateInput(new Date(now.getFullYear(), 0, 1))
  const monthReceived = receivedByCurrency(data.subscribers, monthStart)
  const yearReceived = receivedByCurrency(data.subscribers, yearStart)
  const active = rows.reduce((s, r) => s + r.active, 0)
  const multi = rows.length > 1
  const converted = multi ? convertTotals(rows.map((r) => ({ currency: r.currency, cents: r.monthlyPlans + r.yearlyAsMonthly })), displayCurrency, convert) : null

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="card p-5">
        <p className="text-[13px] font-medium tracking-wide text-soft uppercase">Previsto</p>
        <p className="mt-1 text-[14px] text-faint">
          {active} assinatura{active === 1 ? '' : 's'} ativa{active === 1 ? '' : 's'} · canceladas, pausadas e em teste não entram
        </p>
        {rows.length === 0 && <p className="mt-3 text-[15px] text-soft">Sem assinaturas ativas.</p>}
        <div className="mt-3 space-y-3">
          {rows.map((r) => (
            <div key={r.currency}>
              <p className="num text-[24px] leading-tight font-semibold">
                {formatMoney(r.monthlyPlans + r.yearlyAsMonthly, r.currency)}
                <span className="text-[14px] font-normal text-faint">/mês</span>
              </p>
              <p className="num text-[13px] text-faint">
                {r.yearlyAsMonthly ? `${formatMoney(r.monthlyPlans, r.currency)} de planos mensais + ≈${formatMoney(r.yearlyAsMonthly, r.currency)} equivalente dos anuais · ` : ''}
                {formatMoney(r.yearly, r.currency)}/ano{r.monthlyPlans ? ' (estimado)' : ''}
              </p>
            </div>
          ))}
        </div>
        {converted && (
          <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-faint">
            ≈ {formatMoney(converted.total, displayCurrency)}/mês convertido para {displayCurrency}
            {settings.rates ? ` · câmbio ${settings.rates.source}, ${formatDateTime(settings.rates.fetchedAt).toLowerCase()}` : ''}
            {converted.missing.length ? ` · sem cotação para ${converted.missing.join(', ')} (fora do total)` : ''}
          </p>
        )}
        <p className="mt-3 text-[13px] leading-relaxed text-faint">Projeção, não dinheiro em caixa: planos anuais são cobrados uma vez por ano.</p>
      </div>
      <div className="card p-5">
        <p className="text-[13px] font-medium tracking-wide text-soft uppercase">Recebido de verdade</p>
        <div className="mt-3 grid grid-cols-2 gap-4">
          {[
            { label: 'Este mês', map: monthReceived },
            { label: 'Este ano', map: yearReceived },
          ].map(({ label, map }) => (
            <div key={label}>
              <p className="text-[13px] text-faint">{label}</p>
              {map.size ? (
                [...map.entries()].map(([c, v]) => (
                  <p key={c} className="num text-[19px] font-semibold text-income">
                    {formatMoney(v, c)}
                  </p>
                ))
              ) : (
                <p className="num text-[19px] font-semibold text-soft">—</p>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-faint">Soma dos pagamentos registrados. Não entra no saldo do Financeiro automaticamente.</p>
      </div>
    </div>
  )
}

function SubscriberRow({ s, plan, offering, onOpen }: { s: Subscriber; plan?: SubPlan; offering?: Offering; onOpen(): void }) {
  const next = nextChargeOf(s, plan)
  const rel = next && s.status !== 'cancelled' ? relativeDays(next) : null
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03] tap">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{s.name}</span>
        <span className="block truncate text-[13px] text-faint">
          {offering?.name} · {plan?.name ?? 'sem plano'}
          {rel && <span className={rel.days <= 3 ? 'text-warn' : ''}> · cobra {rel.label}</span>}
          {s.status === 'cancelled' && s.cancelledAt && ` · cancelou ${formatDateValue(s.cancelledAt).toLowerCase()}`}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {plan && (
          <span className="num block text-[15px] font-semibold">
            {formatMoney(plan.price, plan.currency)}
            <span className="text-[12px] font-normal text-faint">{PER_INTERVAL[plan.interval]}</span>
          </span>
        )}
        {s.status !== 'active' && <Badge tone={STATUS_TONE[s.status]}>{SUBSCRIBER_STATUS_LABEL[s.status]}</Badge>}
      </span>
    </button>
  )
}

export function SubscribersPage() {
  const { data } = useStore()
  const offeringForm = useSheet<Offering>()
  const planForm = useSheet<{ plan: SubPlan | null; offeringId: string }>()
  const subForm = useSheet<Subscriber>()
  const detail = useSheet<string>()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<SubscriberStatus | 'all'>('active')
  useOpenParam(data.subscribers, (s) => detail.show(s.id))

  const plans = new Map(data.subPlans.map((p) => [p.id, p]))
  const offerings = new Map(data.offerings.map((o) => [o.id, o]))
  const list = data.subscribers
    .filter((s) => status === 'all' || s.status === status)
    .filter((s) => matches(query, s.name, s.email, offerings.get(s.offeringId)?.name, plans.get(s.planId)?.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  const open = data.subscribers.find((s) => s.id === detail.item) ?? null

  return (
    <>
      <PageHeader
        title="Assinantes"
        subtitle="Planos e assinantes dos seus projetos"
        actions={
          data.offerings.length > 0 && (
            <Button icon={<Plus size={18} />} onClick={() => subForm.show()} disabled={data.subPlans.length === 0}>
              Assinante
            </Button>
          )
        }
      />
      {data.offerings.length === 0 ? (
        <EmptyState
          icon={<Repeat size={22} />}
          title="Nenhum produto por assinatura"
          text="Comece cadastrando o que você oferece (pode ser um dos seus projetos) e os planos com preço e frequência."
          action="Cadastrar produto"
          onAction={() => offeringForm.show()}
        />
      ) : (
        <div className="space-y-7">
          <Projection />

          <section>
            <SectionTitle action="Novo produto" onAction={() => offeringForm.show()}>
              Produtos e planos
            </SectionTitle>
            <div className="grid gap-3 md:grid-cols-2">
              {data.offerings.map((o) => {
                const own = data.subPlans.filter((p) => p.offeringId === o.id)
                const activeCount = data.subscribers.filter((s) => s.offeringId === o.id && s.status === 'active').length
                return (
                  <article key={o.id} className="card p-4">
                    <div className="mb-2 flex items-start gap-2 pl-1">
                      <div className="min-w-0 flex-1 pt-1">
                        <h3 className="truncate text-[16px] font-semibold tracking-tight">{o.name}</h3>
                        <p className="text-[13px] text-faint">{activeCount} ativo{activeCount === 1 ? '' : 's'}</p>
                      </div>
                      <IconButton label="Editar produto" size="sm" onClick={() => offeringForm.show(o)}>
                        <Pencil size={16} />
                      </IconButton>
                    </div>
                    <div className="space-y-1">
                      {own.map((p) => (
                        <button key={p.id} type="button" onClick={() => planForm.show({ plan: p, offeringId: o.id })} className="flex w-full items-center justify-between rounded-xl bg-raised px-3.5 py-2.5 text-left text-[15px] hover:bg-elevated">
                          <span>{p.name}</span>
                          <span className="num text-soft">
                            {formatMoney(p.price, p.currency)}
                            {PER_INTERVAL[p.interval]}
                          </span>
                        </button>
                      ))}
                      <button type="button" onClick={() => planForm.show({ plan: null, offeringId: o.id })} className="w-full px-1 py-2 text-left text-sm font-medium text-accent-hi hover:text-ink">
                        + Novo plano
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          <section>
            <SectionTitle>Assinantes</SectionTitle>
            <div className="mb-3">
              <SearchField value={query} onChange={setQuery} placeholder="Buscar assinante" />
            </div>
            <div className="mb-4">
              <Chips<SubscriberStatus | 'all'>
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'active', label: 'Ativas' },
                  { value: 'trial', label: 'Teste' },
                  { value: 'paused', label: 'Pausadas' },
                  { value: 'cancelled', label: 'Canceladas' },
                  { value: 'all', label: 'Todas' },
                ]}
              />
            </div>
            {list.length ? (
              <div className="card p-1.5">
                {list.map((s) => (
                  <SubscriberRow key={s.id} s={s} plan={plans.get(s.planId)} offering={offerings.get(s.offeringId)} onOpen={() => detail.show(s.id)} />
                ))}
              </div>
            ) : (
              <EmptyState compact icon={<Repeat size={22} />} title={data.subPlans.length ? 'Ninguém aqui' : 'Crie um plano primeiro'} action={data.subPlans.length ? 'Adicionar assinante' : undefined} onAction={() => subForm.show()} />
            )}
          </section>
        </div>
      )}

      <Sheet
        open={detail.open && open !== null}
        onClose={detail.close}
        title={open?.name}
        actions={
          open && (
            <IconButton
              label="Editar assinante"
              size="sm"
              onClick={() => {
                detail.close()
                subForm.show(open)
              }}
            >
              <Pencil size={17} />
            </IconButton>
          )
        }
      >
        {open && (
          <>
            <p className="text-[14px] text-faint">
              {offerings.get(open.offeringId)?.name} · desde {formatDateValue(open.startDate).toLowerCase()} · <Badge tone={STATUS_TONE[open.status]}>{SUBSCRIBER_STATUS_LABEL[open.status]}</Badge>
            </p>
            {open.status !== 'cancelled' && nextChargeOf(open, plans.get(open.planId)) && (
              <p className="mt-2 text-[15px]">Próxima cobrança: {formatDateValue(nextChargeOf(open, plans.get(open.planId)))}</p>
            )}
            <SubscriberPayments subscriber={open} plan={plans.get(open.planId)} />
          </>
        )}
      </Sheet>
      <OfferingForm open={offeringForm.open} onClose={offeringForm.close} offering={offeringForm.item} />
      <PlanForm open={planForm.open} onClose={planForm.close} plan={planForm.item?.plan ?? null} offeringId={planForm.item?.offeringId ?? ''} />
      <SubscriberForm open={subForm.open} onClose={subForm.close} subscriber={subForm.item} />
    </>
  )
}
