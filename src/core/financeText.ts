/**
 * Plain, neutral sentences about money. Never judges ("gastou errado"); an
 * estimate always says it is an estimate; comparisons say what is compared.
 */
import type { Currency } from '../data/types'
import { formatMoney } from '../lib/money'
import { addMonthsTo, FORECAST_MIN, monthLabel, type Forecast, type MonthSummary } from './finance'

const money = (c: number, cur: Currency, sign = false) => formatMoney(c, cur, { sign })
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function forecastText(f: Forecast, currency: Currency): { title: string; detail: string } {
  if (!f.ready) {
    const missing: string[] = []
    if (f.daysElapsed < FORECAST_MIN.days) missing.push(`${FORECAST_MIN.days} dias de uso no mês`)
    if (f.expenses < FORECAST_MIN.expenses) missing.push(`${FORECAST_MIN.expenses} saídas registradas`)
    if (f.expenseDays < FORECAST_MIN.expenseDays) missing.push(`saídas em ${FORECAST_MIN.expenseDays} dias diferentes`)
    return { title: 'Ainda não há dados suficientes para uma previsão confiável.', detail: `A estimativa aparece com pelo menos ${missing.join(', ')}.` }
  }
  const parts = [`ritmo de gastos variáveis de cerca de ${money(f.dailyVariable, currency)} por dia nos ${plural(f.daysLeft, 'dia restante', 'dias restantes')}`]
  if (f.upcomingCount) parts.push(`${plural(f.upcomingCount, 'cobrança prevista', 'cobranças previstas')} de assinaturas (${money(f.upcoming, currency)})`)
  const other = f.upcomingOther.length ? ` ${plural(f.upcomingOther.length, 'cobrança em outra moeda não entrou', 'cobranças em outras moedas não entraram')} na conta.` : ''
  return {
    title: `Se o ritmo atual continuar, sua estimativa de saldo no fim do mês é de aproximadamente ${money(f.estimate, currency)}.`,
    detail: `Estimativa com base no saldo atual, ${parts.join(' e ')}. Moradia, contas e assinaturas não são projetadas de novo, e novas entradas não são consideradas.${other}`,
  }
}

/** Comparison with the previous month; partial months compare the same days. */
export function monthComparisonText(s: MonthSummary, currency: Currency): string | null {
  const c = s.comparison
  if (!c) return s.comparisonNote
  const prev = monthLabel(addMonthsTo(s.month, -1))
  if (c.partial) {
    if (c.expenseChangePct === null) return `Até o dia ${c.uptoDay}, você gastou ${money(s.totals.expense, currency)}; no mesmo período de ${prev} não houve saídas.`
    const p = c.expenseChangePct
    const how = p === 0 ? 'estão praticamente iguais ao' : `estão ${Math.abs(p)}% ${p < 0 ? 'abaixo' : 'acima'} do`
    return `Até o dia ${c.uptoDay} deste mês, seus gastos ${how} mesmo período de ${prev}.`
  }
  if (c.expenseChangePct === null) return `Em ${prev} não houve saídas para comparar.`
  if (c.expenseChangePct === 0) return `Você gastou praticamente o mesmo que em ${prev}.`
  return `Você gastou ${Math.abs(c.expenseChangePct)}% ${c.expenseChangePct < 0 ? 'menos' : 'mais'} que em ${prev}.`
}

export interface WeekMoneyInput {
  current: boolean
  income: number
  expense: number
  net: number
  count: number
  dailyAverage: number
  top: { label: string; amount: number } | null
  expenseDiff: number | null
  unnecessaryCount: number
  unnecessaryAmount: number
  saved: number | null
}

/** Weekly review sentences ("Você gastou R$ 420 esta semana."). Empty when there is nothing to say. */
export function weekMoneySentences(w: WeekMoneyInput, currency: Currency): string[] {
  const out: string[] = []
  if (w.count) {
    const when = w.current ? 'esta semana, até agora' : 'nesta semana'
    out.push(w.expense ? `Você gastou ${money(w.expense, currency)} ${when}.` : `Nenhuma saída registrada ${when}.`)
    if (w.income) out.push(`Recebeu ${money(w.income, currency)}.`)
    if (w.top) out.push(`Seu maior gasto foi ${w.top.label}: ${money(w.top.amount, currency)}.`)
    if (w.expense) out.push(`Gasto médio por dia: ${money(w.dailyAverage, currency)}.`)
    if (w.expenseDiff !== null) {
      const same = w.current ? ' (mesmos dias)' : ''
      out.push(w.expenseDiff === 0 ? `Gastou o mesmo que na semana anterior${same}.` : `Você gastou ${money(Math.abs(w.expenseDiff), currency)} ${w.expenseDiff < 0 ? 'menos' : 'mais'} que na semana anterior${same}.`)
    }
    if (w.unnecessaryCount) out.push(`${plural(w.unnecessaryCount, 'gasto marcado', 'gastos marcados')} como desnecessário (${money(w.unnecessaryAmount, currency)}).`)
  }
  if (w.saved) out.push(w.saved > 0 ? `Guardou ${money(w.saved, currency)} nas metas com prazo.` : `Retirou ${money(-w.saved, currency)} das metas com prazo.`)
  return out
}
