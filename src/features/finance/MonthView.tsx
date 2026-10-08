import { CalendarDays, ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react'
import { useMemo } from 'react'
import { navigate } from '../../app/router'
import { PageHeader } from '../../app/Shell'
import { addMonthsTo, monthBounds, monthForecast, monthLabel, monthOf, monthSummary, startDay, totalsBetween, financeIndex, type MonthId } from '../../core/finance'
import { categoryLabel } from '../../core/financeCategories'
import { savedOn } from '../../core/financeGoals'
import { forecastText, monthComparisonText } from '../../core/financeText'
import { addDaysToDate, useToday, zoneOf } from '../../core/period'
import { useStore } from '../../data/store'
import { formatMoney } from '../../lib/money'
import { Button, IconButton } from '../../ui/Button'
import { SectionTitle } from '../../ui/Display'

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'income' | 'expense' }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-soft">{label}</p>
      <p className={`num mt-1 text-[clamp(17px,4.6vw,22px)] leading-tight font-semibold break-words ${tone === 'income' ? 'text-income' : tone === 'expense' ? 'text-expense' : ''}`}>{value}</p>
    </div>
  )
}

/** Compact "Este mês" card on the Financeiro page: forecast + comparison + link to the month. */
export function ThisMonthCard() {
  const { data, settings } = useStore()
  const today = useToday(zoneOf(settings))
  const month = monthOf(today)
  const cur = settings.baseCurrency
  const summary = useMemo(() => monthSummary(data, settings, month), [data.transactions, settings, month, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const forecast = useMemo(() => monthForecast(data, settings), [data.transactions, data.tools, settings, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const f = forecastText(forecast, cur)
  const comparison = monthComparisonText(summary, cur)
  const top = summary.categories.find((c) => c.category !== '')

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2">
        <TrendingUp size={18} className="shrink-0 text-accent-hi" />
        <p className="min-w-0 flex-1 text-[13px] font-semibold text-soft">Este mês · {monthLabel(month)}</p>
      </div>
      <p className={`mt-3 text-[15px] leading-relaxed ${forecast.ready ? 'font-medium' : 'text-soft'}`}>{f.title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-faint">{f.detail}</p>
      {(comparison || top) && (
        <div className="mt-4 space-y-1 border-t border-line pt-3 text-[14px] text-soft">
          {top && (
            <p>
              Maior categoria: {categoryLabel(settings, top.category)} — <span className="num">{formatMoney(top.amount, cur)}</span>
            </p>
          )}
          {comparison && <p>{comparison}</p>}
        </div>
      )}
      <Button variant="secondary" block className="mt-4" icon={<CalendarDays size={18} />} onClick={() => navigate('/finance', { view: 'month' })}>
        Resumo do mês
      </Button>
    </div>
  )
}

/** Month summary. Only the chosen month (and the previous, for comparison) is computed. */
export function MonthSummaryView({ month: requested }: { month: string | null }) {
  const { data, settings } = useStore()
  const today = useToday(zoneOf(settings))
  const current = monthOf(today)
  const month: MonthId = requested && /^\d{4}-\d{2}$/.test(requested) && requested <= current ? requested : current
  const cur = settings.baseCurrency
  const first = useMemo(() => {
    const index = financeIndex(data.transactions, settings)
    const days = [...index.days.keys()].sort()
    const start = monthOf(startDay(settings))
    return days.length && monthOf(days[0]) < start ? monthOf(days[0]) : start
  }, [data.transactions, settings])
  const s = useMemo(() => monthSummary(data, settings, month), [data.transactions, settings, month, today]) // eslint-disable-line react-hooks/exhaustive-deps
  const prevUnnecessary = useMemo(() => {
    if (!s.comparison) return null
    const index = financeIndex(data.transactions, settings)
    const prev = addMonthsTo(month, -1)
    const pb = monthBounds(prev)
    const end = s.comparison.partial ? `${prev}-${String(Math.min(s.comparison.uptoDay, pb.days)).padStart(2, '0')}` : pb.to
    return totalsBetween(index, pb.from, end)
  }, [data.transactions, settings, month, s.comparison])
  const comparison = monthComparisonText(s, cur)
  const goals = data.financeGoals
    .filter((g) => (g.history?.[0]?.date ?? g.createdAt.slice(0, 10)) <= s.to)
    .map((g) => ({ g, start: savedOn(g, addDaysToDate(s.from, -1)), end: savedOn(g, s.inProgress ? today : s.to) }))
    .filter((x) => x.g.status !== 'archived' || x.end !== x.start)
  const max = s.categories[0]?.amount ?? 0
  const go = (m: MonthId) => navigate('/finance', m === current ? { view: 'month' } : { view: 'month', m })
  const t = s.totals

  return (
    <>
      <PageHeader
        title={cap(monthLabel(month))}
        subtitle={`${month.slice(0, 4)}${s.inProgress ? ' · mês em andamento' : ''}`}
        actions={
          <div className="flex items-center gap-1">
            <IconButton label="Mês anterior" size="sm" disabled={month <= first} onClick={() => go(addMonthsTo(month, -1))}>
              <ChevronLeft size={18} />
            </IconButton>
            <IconButton label="Próximo mês" size="sm" disabled={month >= current} onClick={() => go(addMonthsTo(month, 1))}>
              <ChevronRight size={18} />
            </IconButton>
            <Button variant="secondary" onClick={() => navigate('/finance')}>
              Voltar
            </Button>
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="space-y-6">
          <section className="card p-5">
            <div className="grid grid-cols-2 gap-4">
              <Figure label="Entradas" value={formatMoney(t.income, cur)} tone={t.income ? 'income' : undefined} />
              <Figure label="Saídas" value={formatMoney(t.expense, cur)} tone={t.expense ? 'expense' : undefined} />
            </div>
            <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-4">
              <p className="text-[15px] text-soft">Resultado{s.inProgress ? ' até agora' : ''}</p>
              <p className={`num text-[19px] font-semibold ${t.net < 0 ? 'text-expense' : ''}`}>{formatMoney(t.net, cur, { sign: true })}</p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 text-[14px]">
              <div className="min-w-0">
                <p className="text-faint">{s.startedInMonth ? 'Saldo ao começar' : 'Saldo no início do mês'}</p>
                <p className="num mt-0.5 font-medium break-words">{formatMoney(s.opening, cur)}</p>
              </div>
              <div className="min-w-0">
                <p className="text-faint">{s.inProgress ? 'Saldo atual' : 'Saldo no fim do mês'}</p>
                <p className="num mt-0.5 font-medium break-words">{formatMoney(s.closing, cur)}</p>
              </div>
            </div>
            {t.otherCurrency > 0 && <p className="mt-4 text-[13px] leading-relaxed text-faint">Inclui {t.otherCurrency} {t.otherCurrency === 1 ? 'movimentação em outra moeda' : 'movimentações em outras moedas'}, pelo valor convertido no dia do registro.</p>}
          </section>

          <section>
            <SectionTitle>Comparação</SectionTitle>
            <div className="card space-y-1.5 px-5 py-4 text-[15px] leading-relaxed">
              <p>{comparison ?? (t.count ? 'Ainda não há um mês anterior para comparar.' : 'Sem movimentações neste mês.')}</p>
              {s.comparison && (
                <p className="text-[13px] text-faint">
                  {s.comparison.partial ? `Mesmo período de ${monthLabel(addMonthsTo(month, -1))}` : cap(monthLabel(addMonthsTo(month, -1)))}: entradas {formatMoney(s.comparison.previous.income, cur)} · saídas {formatMoney(s.comparison.previous.expense, cur)} · resultado {formatMoney(s.comparison.previous.net, cur, { sign: true })}
                </p>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section>
            <SectionTitle>Categorias com maior gasto</SectionTitle>
            {s.categories.length ? (
              <div className="card space-y-3.5 p-5">
                {s.categories.slice(0, 6).map((c) => (
                  <div key={c.category}>
                    <div className="flex items-baseline justify-between gap-3 text-[15px]">
                      <span className={`min-w-0 truncate ${c.category ? '' : 'text-soft'}`}>{categoryLabel(settings, c.category || undefined)}</span>
                      <span className="num shrink-0 font-medium">{formatMoney(c.amount, cur)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-tint/[0.06]">
                      <div className="h-full rounded-full bg-accent/70" style={{ width: `${max ? Math.max(3, Math.round((c.amount / max) * 100)) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="card px-5 py-4 text-[15px] text-faint">Sem saídas neste mês.</p>
            )}
          </section>

          <section>
            <SectionTitle>Gastos marcados como desnecessários</SectionTitle>
            <div className="card px-5 py-4 text-[15px] leading-relaxed">
              {t.unnecessaryCount ? (
                <p>
                  {t.unnecessaryCount} {t.unnecessaryCount === 1 ? 'gasto' : 'gastos'} · <span className="num">{formatMoney(t.unnecessaryAmount, cur)}</span>
                </p>
              ) : (
                <p className="text-soft">Nenhum gasto marcado neste mês.</p>
              )}
              {prevUnnecessary && (prevUnnecessary.unnecessaryCount > 0 || t.unnecessaryCount > 0) && (
                <p className="mt-1 text-[13px] text-faint">
                  {s.comparison?.partial ? 'Mesmo período' : 'Mês'} anterior: {prevUnnecessary.unnecessaryCount} · {formatMoney(prevUnnecessary.unnecessaryAmount, cur)}
                </p>
              )}
              <p className="mt-2 text-[13px] text-faint">Só você marca um gasto como desnecessário, ao registrar ou editar uma saída.</p>
            </div>
          </section>

          {goals.length > 0 && (
            <section>
              <SectionTitle>Metas com prazo no mês</SectionTitle>
              <div className="card divide-y divide-line">
                {goals.map(({ g, start, end }) => (
                  <div key={g.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-3 text-[15px]">
                    <span className="min-w-0 truncate">{g.name}</span>
                    <span className="num text-soft">
                      {formatMoney(end, g.currency)} <span className={end - start >= 0 ? 'text-income' : 'text-soft'}>({formatMoney(end - start, g.currency, { sign: true })})</span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {month === current && (
            <section>
              <SectionTitle>Previsão</SectionTitle>
              <ForecastBlock />
            </section>
          )}
        </div>
      </div>
    </>
  )
}

function ForecastBlock() {
  const { data, settings } = useStore()
  const f = forecastText(monthForecast(data, settings), settings.baseCurrency)
  return (
    <div className="card px-5 py-4">
      <p className="text-[15px] leading-relaxed">{f.title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-faint">{f.detail}</p>
    </div>
  )
}
