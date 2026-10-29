import { ExternalLink, Wrench } from 'lucide-react'
import { PageHeader } from '../../app/Shell'
import { EARLY_DAYS } from '../../core/automation/toolCharge'
import { addDaysToDate, todayIn, zoneOf } from '../../core/period'
import { optionOf, TOOL_STATUS } from '../../data/labels'
import { isPaidTool, nextChargeDate, toolSpending } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Currency, Tool } from '../../data/types'
import { formatDateValue, relativeDays } from '../../lib/dates'
import { displayUrl, normalizeUrl } from '../../lib/links'
import { formatMoney } from '../../lib/money'
import { usePref } from '../../lib/prefs'
import { Badge, EmptyState, SectionTitle } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { Chips } from '../../ui/Segmented'
import { useOpenParam } from '../useOpenParam'
import { ToolForm } from './ToolForm'
import { DueCard, PaySheet } from './ToolPay'
import { PendingCharges } from '../automations/PendingCharges'
import { pendingRuns } from '../automations/runs'

type Filter = 'all' | 'paying' | 'free' | 'cancelled'

const FILTERS: { value: Filter; label: string; test(t: Tool): boolean }[] = [
  { value: 'all', label: 'Todas', test: () => true },
  { value: 'paying', label: 'Pagando', test: (t) => isPaidTool(t) },
  { value: 'free', label: 'Grátis', test: (t) => t.billing === 'free' || t.status === 'free' },
  { value: 'cancelled', label: 'Canceladas', test: (t) => t.status === 'cancelled' },
]

const PER = { monthly: '/mês', yearly: '/ano', once: ' único', free: '' }
const MONTH = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' })

/** Paid, active tools by currency: what each currency costs per month and per year (never summed across currencies). */
function byCurrency(tools: Tool[]): { currency: Currency; monthly: number; yearly: number; count: number }[] {
  const map = new Map<Currency, { monthly: number; yearly: number; count: number }>()
  for (const t of tools.filter(isPaidTool)) {
    const m = map.get(t.currency) ?? { monthly: 0, yearly: 0, count: 0 }
    m.monthly += t.billing === 'monthly' ? t.price : Math.round(t.price / 12)
    m.yearly += t.billing === 'monthly' ? t.price * 12 : t.price
    m.count++
    map.set(t.currency, m)
  }
  return [...map].map(([currency, v]) => ({ currency, ...v })).sort((a, b) => b.count - a.count)
}

/** First letter on a tile whose tint tells the state at a glance: paying (vermilion), free, cancelled. */
function Monogram({ tool }: { tool: Tool }) {
  const paying = isPaidTool(tool)
  const cancelled = tool.status === 'cancelled'
  return (
    <span className={`grid size-11 shrink-0 place-items-center rounded-2xl text-[16px] font-semibold ${paying ? 'icon-tile' : cancelled ? 'bg-tint/[0.04] text-faint' : 'bg-income/[0.12] text-income'}`}>
      {tool.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function ToolRow({ tool, onOpen }: { tool: Tool; onOpen(t: Tool): void }) {
  const status = optionOf(TOOL_STATUS, tool.status)
  const next = isPaidTool(tool) && tool.nextCharge ? nextChargeDate(tool) : ''
  const rel = next ? relativeDays(next) : null
  const cancelled = tool.status === 'cancelled'
  const free = tool.billing === 'free' || tool.price === 0
  return (
    <div className="flex items-center gap-2 rounded-2xl px-1 transition-colors hover:bg-tint/[0.03] tap">
      <button type="button" onClick={() => onOpen(tool)} className="flex min-w-0 flex-1 items-center gap-3.5 px-1.5 py-3 text-left">
        <Monogram tool={tool} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[15px] font-medium ${cancelled ? 'text-faint line-through' : ''}`}>{tool.name}</span>
          <span className="mt-0.5 block truncate text-[13px] text-faint">
            {tool.plan && `${tool.plan} · `}
            {rel ? <span className={rel.days <= 2 ? 'font-medium text-warn' : ''}>Cobra {rel.days <= 1 ? rel.label.toLowerCase() : formatDateValue(next).toLowerCase()}</span> : free ? 'Gratuita' : status.label}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className={`num block text-[15px] font-semibold ${cancelled ? 'text-faint' : ''}`}>
            {free ? 'Grátis' : formatMoney(tool.price, tool.currency)}
            {tool.price > 0 && <span className="text-[12px] font-normal text-faint">{PER[tool.billing]}</span>}
          </span>
          {tool.status !== 'active' && tool.status !== 'free' && !cancelled && (
            <span className="mt-1 inline-block">
              <Badge tone={status.tone}>{status.label}</Badge>
            </span>
          )}
        </span>
      </button>
      {tool.link && (
        <a href={normalizeUrl(tool.link)} target="_blank" rel="noreferrer" aria-label={`Abrir ${displayUrl(tool.link)}`} className="grid size-10 shrink-0 place-items-center rounded-xl text-faint hover:bg-tint/[0.05] tap hover:text-ink">
          <ExternalLink size={18} />
        </a>
      )}
    </div>
  )
}

export function ToolsPage() {
  const { data, settings, displayCurrency, convert } = useStore()
  const [filter, setFilter] = usePref<Filter>('tools.filter', 'all')
  const form = useSheet<Tool>()
  const pay = useSheet<Tool>()
  useOpenParam(data.tools, form.show)
  const today = todayIn(zoneOf(settings))

  const spending = toolSpending(data.tools, displayCurrency, convert)
  const currencies = byCurrency(data.tools)
  const mixed = currencies.length > 1
  const test = FILTERS.find((f) => f.value === filter)?.test ?? (() => true)
  const list = [...data.tools].filter(test).sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || a.name.localeCompare(b.name))

  const toolRuns = data.automationRuns.filter((r) => r.automation === 'toolCharge')
  const waiting = pendingRuns(toolRuns)
  // After the due date and not answered yet, plus presumed payments not confirmed: asked plainly.
  const overdue = waiting.filter((r) => r.date < today && !r.presumeDeclined)
  const presumed = toolRuns.filter((r) => r.status === 'done' && r.presumed)
  const toAsk = [...overdue, ...presumed].sort((a, b) => (a.date < b.date ? -1 : 1))
  const stillWaiting = waiting.filter((r) => !overdue.includes(r))
  const waitingTools = new Set(waiting.map((r) => r.origin.id))
  const upcoming = data.tools
    .filter((t) => isPaidTool(t) && t.nextCharge && !waitingTools.has(t.id))
    .map((t) => ({ tool: t, date: nextChargeDate(t) }))
    .filter((x) => x.date <= addDaysToDate(today, 30))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  const soon = upcoming.filter((u) => u.date <= addDaysToDate(today, 7)).length
  const total = (cents: number) => `${spending.monthly.complete ? '' : '≈ '}${formatMoney(cents, displayCurrency)}`

  return (
    <>
      <PageHeader
        rich
        icon={Wrench}
        eyebrow={`${spending.count} ${spending.count === 1 ? 'ativa paga' : 'ativas pagas'}`}
        title="Assinaturas"
        primary={{ label: 'Nova', aria: 'Nova assinatura', onPress: () => form.show() }}
        stats={
          data.tools.length
            ? [
                { label: 'Por mês', value: mixed ? `≈ ${total(spending.monthly.total).replace('≈ ', '')}` : formatMoney(currencies[0]?.monthly ?? 0, currencies[0]?.currency ?? displayCurrency) },
                { label: 'Por ano', value: mixed ? `≈ ${total(spending.yearly.total).replace('≈ ', '')}` : formatMoney(currencies[0]?.yearly ?? 0, currencies[0]?.currency ?? displayCurrency) },
                { label: 'Próximos 7 dias', value: soon },
              ]
            : undefined
        }
      />
      {data.tools.length === 0 ? (
        <EmptyState icon={<Wrench size={20} />} title="Nenhuma assinatura ainda" text="Registre o que você paga todo mês. O Núcleo avisa antes da cobrança e pergunta se você pagou." action="Adicionar assinatura" onAction={() => form.show()} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
          <div className="space-y-6">
            {toAsk.length > 0 && (
              <section aria-label="Precisa da sua confirmação">
                <SectionTitle>Precisa da sua confirmação</SectionTitle>
                <div className="card divide-y divide-line">
                  {toAsk.map((r) => (
                    <DueCard key={r.id} run={r} />
                  ))}
                </div>
              </section>
            )}
            {stillWaiting.length > 0 && (
              <section>
                <SectionTitle>A pagar</SectionTitle>
                <PendingCharges runs={stillWaiting} />
              </section>
            )}

            <section aria-label="Quanto custa">
              <SectionTitle>Quanto custa</SectionTitle>
              <div className="card divide-y divide-line">
                {currencies.length ? (
                  currencies.map((c) => (
                    <div key={c.currency} className="flex items-center gap-3 px-4 py-3.5">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-tint/[0.05] text-[12px] font-semibold text-soft">{c.currency}</span>
                      <span className="min-w-0 flex-1">
                        <span className="num block text-[18px] leading-tight font-semibold tracking-[-0.02em]">
                          {formatMoney(c.monthly, c.currency)}
                          <span className="text-[13px] font-normal text-faint">/mês</span>
                        </span>
                        <span className="block text-[12px] text-faint">
                          {c.count} {c.count === 1 ? 'assinatura' : 'assinaturas'} · {formatMoney(c.yearly, c.currency)} por ano
                        </span>
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="px-4 py-3.5 text-[15px] text-faint">Nenhuma assinatura paga ativa.</p>
                )}
                {mixed && (
                  <p className="px-4 py-3 text-[12px] leading-snug text-faint">
                    Moedas diferentes ficam separadas. Convertido para {displayCurrency} pela cotação: {total(spending.monthly.total)}/mês{!spending.monthly.complete && ' (algumas sem cotação ficaram de fora)'}.
                  </p>
                )}
              </div>
            </section>

            {upcoming.length > 0 && (
              <section aria-label="Próximas cobranças">
                <SectionTitle>Próximas cobranças</SectionTitle>
                <div className="card divide-y divide-line">
                  {upcoming.map(({ tool, date }) => {
                    const rel = relativeDays(date)
                    const canPay = date <= addDaysToDate(today, EARLY_DAYS)
                    return (
                      <div key={tool.id} className="flex items-center gap-3 px-3.5 py-2.5">
                        <span className={`flex w-12 shrink-0 flex-col items-center rounded-xl py-1.5 ${rel && rel.days <= 2 ? 'bg-accent/[0.12] text-accent-hi' : 'bg-tint/[0.05]'}`}>
                          <span className="num text-[17px] leading-none font-semibold">{Number(date.slice(8))}</span>
                          <span className="mt-0.5 text-[10px] font-semibold tracking-wide text-faint uppercase">{MONTH.format(new Date(`${date}T12:00:00Z`)).replace('.', '')}</span>
                        </span>
                        <button type="button" onClick={() => form.show(tool)} className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-[15px] font-medium">{tool.name}</span>
                          <span className="num block text-[12px] text-faint">
                            {formatMoney(tool.price, tool.currency)} · {rel?.label}
                          </span>
                        </button>
                        {canPay && (
                          <button type="button" onClick={() => pay.show(tool)} className="press h-9 shrink-0 rounded-full px-3.5 text-[13px] font-semibold text-accent-hi ring-1 ring-accent/30 ring-inset hover:bg-accent/[0.08]">
                            Já paguei
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
                <p className="mt-2 px-1 text-[12px] text-faint">O Núcleo avisa 2 dias antes e no dia (Configurações → Lembretes).</p>
              </section>
            )}
          </div>

          <section aria-label="Suas assinaturas">
            <div className="mb-3">
              <Chips value={filter} onChange={setFilter} options={FILTERS} />
            </div>
            {list.length ? (
              <div className="card p-1.5">
                {list.map((t) => (
                  <ToolRow key={t.id} tool={t} onOpen={form.show} />
                ))}
              </div>
            ) : (
              <EmptyState compact icon={<Wrench size={20} />} title="Nada por aqui" action={filter !== 'all' ? 'Ver todas' : undefined} onAction={() => setFilter('all')} />
            )}
          </section>
        </div>
      )}
      <ToolForm open={form.open} onClose={form.close} tool={form.item} />
      <PaySheet tool={pay.item ?? null} onClose={pay.close} />
    </>
  )
}
