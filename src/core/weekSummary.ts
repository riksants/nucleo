/**
 * Plain-language weekly summary. Works the same for a live week (flattened
 * metrics) and for a closed week (the snapshot's stored metrics). A sentence
 * only appears when there is data behind it — nothing is made up.
 */
import type { Currency } from '../data/types'
import { formatMoney } from '../lib/money'

export type FlatMetrics = Record<string, number | null>

const n = (f: FlatMetrics, k: string) => f[k] ?? 0
const pct = (done: number, total: number) => (total ? Math.round((done / total) * 100) : null)
const plural = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`

export function headline(f: FlatMetrics) {
  return {
    itemsPercent: pct(n(f, 'items.done'), n(f, 'items.expected')),
    itemsDone: n(f, 'items.done'),
    itemsTotal: n(f, 'items.expected'),
    tasksDone: n(f, 'tasks.dueDone'),
    tasksTotal: n(f, 'tasks.due'),
    habitsDone: n(f, 'habits.done'),
    habitsTotal: n(f, 'habits.expected'),
    trainingDone: n(f, 'training.done'),
    trainingPlanned: n(f, 'training.planned'),
  }
}

export function summarySentences(f: FlatMetrics, opts: { current: boolean; currency: Currency; skipFinance?: boolean }): string[] {
  const out: string[] = []
  const items = n(f, 'items.expected')
  if (items) out.push(`Você concluiu ${n(f, 'items.done')} de ${items} ${items === 1 ? 'item' : 'itens'} ${opts.current ? 'até agora' : 'nesta semana'}.`)
  const tDone = n(f, 'training.done')
  const tPlan = n(f, 'training.planned')
  if (tDone || tPlan) out.push(`Treinou ${plural(tDone, 'vez', 'vezes')}${tPlan ? ` (${plural(tPlan, 'dia planejado', 'dias planejados')})` : ''}.`)
  const hp = pct(n(f, 'habits.done'), n(f, 'habits.expected'))
  if (hp !== null) out.push(`Cumpriu ${hp}% dos seus hábitos (${n(f, 'habits.done')} de ${n(f, 'habits.expected')}).`)
  const rp = pct(n(f, 'routine.done'), n(f, 'routine.expected'))
  if (rp !== null) out.push(`Seguiu ${rp}% da rotina.`)
  const completed = n(f, 'tasks.completed')
  if (completed) out.push(`Concluiu ${plural(completed, 'tarefa', 'tarefas')}.`)
  const pending = n(f, 'tasks.due') - n(f, 'tasks.dueDone')
  if (pending > 0) out.push(`${plural(pending, 'tarefa com prazo na semana', 'tarefas com prazo na semana')} ${opts.current ? (pending === 1 ? 'ainda está pendente' : 'ainda estão pendentes') : pending === 1 ? 'ficou pendente' : 'ficaram pendentes'}.`)
  const rec = n(f, 'recurring.expected')
  if (rec) out.push(`Recorrentes: ${n(f, 'recurring.done')} de ${rec}.`)
  const minutes = n(f, 'study.minutes')
  if (minutes) out.push(`Estudou ${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')} nos horários de estudo.`)
  else if (n(f, 'study.days')) out.push(`Estudou em ${plural(n(f, 'study.days'), 'dia', 'dias')}.`)
  const events = n(f, 'events')
  if (events) out.push(`${plural(events, 'compromisso', 'compromissos')} na agenda.`)
  // The Dinheiro card (Etapa 3) shows the details when it is on screen.
  if (!opts.skipFinance && f['finance.net'] !== null && f['finance.net'] !== undefined) {
    out.push(`Entraram ${formatMoney(n(f, 'finance.income'), opts.currency)} e saíram ${formatMoney(n(f, 'finance.expense'), opts.currency)} (saldo da semana ${formatMoney(n(f, 'finance.net'), opts.currency, { sign: true })}).`)
  }
  return out
}

/** Neutral comparison of the week's completion with the previous one. */
export function compareWeeks(current: FlatMetrics, previous: FlatMetrics): string | null {
  const a = pct(n(current, 'items.done'), n(current, 'items.expected'))
  const b = pct(n(previous, 'items.done'), n(previous, 'items.expected'))
  if (a === null || b === null) return null
  const d = a - b
  if (Math.abs(d) <= 3) return `Parecido com a semana anterior (${b}%).`
  return d > 0 ? `${d} pontos percentuais acima da semana anterior (${b}%).` : `Semana anterior: ${b}% dos itens.`
}
