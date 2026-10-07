import { ExternalLink, Wrench } from 'lucide-react'
import { PageHeader } from '../../app/Shell'
import { optionOf, TOOL_STATUS } from '../../data/labels'
import { isPaidTool, nextChargeDate, toolSpending } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Tool } from '../../data/types'
import { formatDateValue, relativeDays } from '../../lib/dates'
import { displayUrl, normalizeUrl } from '../../lib/links'
import { formatMoney } from '../../lib/money'
import { usePref } from '../../lib/prefs'
import { Badge, EmptyState } from '../../ui/Display'
import { useSheet } from '../../ui/formHooks'
import { Chips } from '../../ui/Segmented'
import { useOpenParam } from '../useOpenParam'
import { ToolForm } from './ToolForm'

type Filter = 'all' | 'paying' | 'free' | 'cancelled'

const FILTERS: { value: Filter; label: string; test(t: Tool): boolean }[] = [
  { value: 'all', label: 'Todas', test: () => true },
  { value: 'paying', label: 'Pagando', test: (t) => isPaidTool(t) },
  { value: 'free', label: 'Grátis', test: (t) => t.billing === 'free' || t.status === 'free' },
  { value: 'cancelled', label: 'Canceladas', test: (t) => t.status === 'cancelled' },
]

const PER = { monthly: '/mês', yearly: '/ano', once: ' único', free: '' }

function ToolRow({ tool, onOpen }: { tool: Tool; onOpen(t: Tool): void }) {
  const status = optionOf(TOOL_STATUS, tool.status)
  const next = isPaidTool(tool) && tool.nextCharge ? nextChargeDate(tool) : ''
  const rel = next ? relativeDays(next) : null
  return (
    <div className="flex items-center gap-2 rounded-2xl px-1 transition-colors hover:bg-tint/[0.03] tap">
      <button type="button" onClick={() => onOpen(tool)} className="flex min-w-0 flex-1 items-center gap-3.5 px-1.5 py-3 text-left">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-elevated text-[15px] font-semibold text-soft">{tool.name.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[15px] font-medium">{tool.name}</span>
            {tool.plan && <span className="shrink-0 text-[13px] text-faint">{tool.plan}</span>}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-faint">
            {rel ? (
              <span className={rel.days <= 3 ? 'text-warn' : ''}>
                Cobra {formatDateValue(next).toLowerCase()} · {rel.label}
              </span>
            ) : (
              status.label
            )}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="num block text-[15px] font-semibold">
            {tool.billing === 'free' || tool.price === 0 ? 'Grátis' : `${formatMoney(tool.price, tool.currency)}`}
            {tool.price > 0 && <span className="text-[13px] font-normal text-faint">{PER[tool.billing]}</span>}
          </span>
          {tool.status !== 'active' && tool.status !== 'free' && (
            <span className="mt-1 inline-block">
              <Badge tone={status.tone}>{status.label}</Badge>
            </span>
          )}
        </span>
      </button>
      {tool.link && (
        <a href={normalizeUrl(tool.link)} target="_blank" rel="noreferrer" aria-label={`Abrir ${displayUrl(tool.link)}`} className="grid size-10 shrink-0 place-items-center rounded-xl text-faint hover:bg-tint/[0.05] tap hover:text-ink">
          <ExternalLink size={17} />
        </a>
      )}
    </div>
  )
}

export function ToolsPage() {
  const { data, displayCurrency, convert } = useStore()
  const [filter, setFilter] = usePref<Filter>('tools.filter', 'all')
  const form = useSheet<Tool>()
  useOpenParam(data.tools, form.show)

  const spending = toolSpending(data.tools, displayCurrency, convert)
  const test = FILTERS.find((f) => f.value === filter)?.test ?? (() => true)
  const list = [...data.tools].filter(test).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <PageHeader
        title="Assinaturas"
        primary={{ label: 'Nova', aria: 'Nova assinatura', onPress: () => form.show() }}
      />
      {data.tools.length === 0 ? (
        <EmptyState icon={<Wrench size={22} />} title="Nenhuma assinatura ainda" text="Registre o que você usa e paga, e veja quanto isso custa por mês." action="Adicionar assinatura" onAction={() => form.show()} />
      ) : (
        <>
          <section className="card mb-5 p-5">
            <p className="text-[13px] font-semibold text-soft">Gasto mensal</p>
            <p className="num mt-2 text-[34px] leading-none font-semibold tracking-tight">{formatMoney(spending.monthly.total, displayCurrency)}</p>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-[15px]">
              <span className="text-soft">Anual aproximado</span>
              <span className="num font-semibold">{formatMoney(spending.yearly.total, displayCurrency)}</span>
            </div>
            <p className="mt-2 text-[13px] text-faint">
              {spending.count} {spending.count === 1 ? 'assinatura ativa' : 'assinaturas ativas'}
              {!spending.monthly.complete && ' · algumas sem cotação ficaram de fora'}
            </p>
          </section>
          <div className="mb-5">
            <Chips value={filter} onChange={setFilter} options={FILTERS} />
          </div>
          {list.length ? (
            <div className="card p-1.5 lg:grid lg:grid-cols-2 lg:gap-x-2">
              {list.map((t) => (
                <ToolRow key={t.id} tool={t} onOpen={form.show} />
              ))}
            </div>
          ) : (
            <EmptyState compact icon={<Wrench size={22} />} title="Nada por aqui" />
          )}
        </>
      )}
      <ToolForm open={form.open} onClose={form.close} tool={form.item} />
    </>
  )
}
