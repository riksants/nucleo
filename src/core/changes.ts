/**
 * "O que mudou?": the person compared with themselves — never with others.
 * Built from the same metrics as Semana/Financeiro. A period in progress is
 * compared with the same days of the previous one. A line only appears when
 * both periods have enough data; nothing is shown as 0% for lack of data.
 */
import { isEnabled } from '../app/modules'
import type { DataState, Settings } from '../data/types'
import { formatMoney } from '../lib/money'
import { wallClock } from '../lib/zoned'
import { financeIndex, monthBounds, monthLabel, monthOf, startDay, totalsBetween } from './finance'
import { savedBetween } from './financeGoals'
import { percent, rangeMetrics, type RangeMetrics, type Tally } from './metrics'
import { addDaysToDate, todayIn, weekdayOfDate, weekStart, zoneOf } from './period'
import { stepDoneAt, taskMap } from './plans'
import { computeScore } from './score'
import { goalProgress } from './weekGoals'

export type ChangePeriod = 'week' | 'month'

export interface ChangeLine {
  area: 'tasks' | 'habits' | 'routine' | 'training' | 'organization' | 'weeklyGoals' | 'score' | 'finance' | 'financeGoals' | 'plans'
  text: string
}

export interface Changes {
  period: ChangePeriod
  current: { from: string; to: string }
  previous: { from: string; to: string }
  /** "Comparação até quinta." / "Comparação até o dia 12." — null when the period is complete. */
  partialNote: string | null
  /** The app was not in use for the whole previous period. */
  notComparable: boolean
  lines: ChangeLine[]
}

/** Minimum expected items for a percentage to be compared (same as the Score minimums). */
export const MIN_EXPECTED = 3

const WEEKDAY = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
const days = (n: number) => `${n} ${n === 1 ? 'vez' : 'vezes'}`

export function periods(period: ChangePeriod, today: string) {
  if (period === 'week') {
    const from = weekStart(today)
    return { current: { from, to: today }, previous: { from: addDaysToDate(from, -7), to: addDaysToDate(today, -7) }, label: `Comparação até ${WEEKDAY[weekdayOfDate(today)]}, com os mesmos dias da semana anterior.` }
  }
  const month = monthOf(today)
  const { from } = monthBounds(month)
  const prev = monthBounds(monthOf(addDaysToDate(from, -1)))
  const day = Number(today.slice(8, 10))
  const prevTo = `${prev.from.slice(0, 7)}-${String(Math.min(day, prev.days)).padStart(2, '0')}`
  return { current: { from, to: today }, previous: { from: prev.from, to: prevTo }, label: `Comparação até o dia ${day}, com o mesmo período de ${monthLabel(prev.from.slice(0, 7))}.` }
}

function pctLine(area: ChangeLine['area'], name: string, cur: Tally, prev: Tally): ChangeLine | null {
  if (cur.expected < MIN_EXPECTED || prev.expected < MIN_EXPECTED) return null
  const a = percent(prev)!
  const b = percent(cur)!
  return { area, text: a === b ? `Seu cumprimento de ${name} ficou em ${b}%, igual ao período anterior.` : `Seu cumprimento de ${name} passou de ${a}% para ${b}%.` }
}

export function computeChanges(data: DataState, settings: Settings, period: ChangePeriod, now = new Date()): Changes {
  const tz = zoneOf(settings)
  const today = todayIn(tz, now)
  const p = periods(period, today)
  const base: Changes = { period, current: p.current, previous: p.previous, partialNote: p.label, notComparable: false, lines: [] }
  if (startDay(settings) > p.previous.from) return { ...base, notComparable: true }

  const cur: RangeMetrics = rangeMetrics(data, settings, p.current.from, p.current.to, now)
  const prev: RangeMetrics = rangeMetrics(data, settings, p.previous.from, p.previous.to, now)
  const when = period === 'week' ? { cur: 'nesta semana', prev: 'na anterior', prevLong: 'na semana anterior' } : { cur: 'neste mês', prev: 'no mesmo período do mês passado', prevLong: 'no mesmo período do mês passado' }
  const lines: ChangeLine[] = []

  if (isEnabled(settings, 'tasks') && (cur.tasks.completed || prev.tasks.completed)) {
    const d = cur.tasks.completed - prev.tasks.completed
    const n = Math.abs(d)
    lines.push({ area: 'tasks', text: d === 0 ? `Você concluiu ${cur.tasks.completed} ${cur.tasks.completed === 1 ? 'tarefa' : 'tarefas'}, o mesmo número do período anterior.` : `Você concluiu ${n} ${n === 1 ? 'tarefa' : 'tarefas'} a ${d > 0 ? 'mais' : 'menos'} que ${when.prevLong} (${cur.tasks.completed} e ${prev.tasks.completed}).` })
  }
  const habits = pctLine('habits', 'hábitos', cur.habitsNoTraining, prev.habitsNoTraining)
  if (habits) lines.push(habits)
  const routine = pctLine('routine', 'rotina', cur.routineNoTraining, prev.routineNoTraining)
  if (routine) lines.push(routine)
  if (cur.training.done || prev.training.done) lines.push({ area: 'training', text: `Você treinou ${days(cur.training.done)} ${when.cur}; ${when.prev}, ${prev.training.done === 1 ? 'foi 1 vez' : `foram ${prev.training.done}`}.` })
  const org = pctLine('organization', 'recorrentes', cur.recurring, prev.recurring)
  if (org) lines.push(org)

  if (period === 'week') {
    const curGoals = data.weeklyGoals.filter((g) => g.week === p.current.from && g.status !== 'archived')
    const prevGoals = data.weeklyGoals.filter((g) => g.week === p.previous.from && g.status !== 'archived')
    if (curGoals.length && prevGoals.length) {
      const prevFull = rangeMetrics(data, settings, p.previous.from, addDaysToDate(p.previous.from, 6), now)
      const a = curGoals.filter((g) => goalProgress(g, cur).achieved).length
      const b = prevGoals.filter((g) => goalProgress(g, prevFull).achieved).length
      lines.push({ area: 'weeklyGoals', text: `Metas da semana: ${a} de ${curGoals.length} cumpridas até agora; na anterior, ${b} de ${prevGoals.length}.` })
    }
    if (!settings.hideScore && isEnabled(settings, 'week')) {
      const snap = data.weekSnapshots.find((s) => s.week === p.previous.from)
      const a = computeScore(cur, curGoals).overall
      const prevFull = rangeMetrics(data, settings, p.previous.from, addDaysToDate(p.previous.from, 6), now)
      const b = snap?.score && snap.scoreVersion === 1 ? (snap.score.overall ?? null) : computeScore(prevFull, prevGoals).overall
      if (a !== null && b !== null) lines.push({ area: 'score', text: a === b ? `NÚCLEO Score: ${a} até agora, igual à semana anterior.` : `NÚCLEO Score: ${a} até agora; na semana anterior, ${b}.` })
    }
  }

  if (isEnabled(settings, 'finance')) {
    const idx = financeIndex(data.transactions, settings)
    const a = totalsBetween(idx, p.current.from, p.current.to)
    const b = totalsBetween(idx, p.previous.from, p.previous.to)
    const cur$ = settings.baseCurrency
    if (a.count && b.count) {
      const d = a.expense - b.expense
      const scope = period === 'week' ? 'nesta semana' : `até o dia ${Number(today.slice(8, 10))}`
      const ref = period === 'week' ? 'dos mesmos dias da semana anterior' : 'do mesmo período do mês passado'
      const same = period === 'week' ? 'aos mesmos dias da semana anterior' : 'ao mesmo período do mês passado'
      lines.push({ area: 'finance', text: d === 0 ? `Seus gastos ${scope} ficaram iguais ${same}.` : `Seus gastos ${scope} estão ${formatMoney(Math.abs(d), cur$)} ${d < 0 ? 'abaixo' : 'acima'} ${ref}.` })
    }
    const sa = savedBetween(data.financeGoals ?? [], cur$, p.current.from, p.current.to)
    const sb = savedBetween(data.financeGoals ?? [], cur$, p.previous.from, p.previous.to)
    if (sa !== null && sb !== null && (sa || sb)) lines.push({ area: 'financeGoals', text: `Você guardou ${formatMoney(sa, cur$)} nas metas com prazo ${when.cur}; ${when.prev}, ${formatMoney(sb, cur$)}.` })
  }

  if (isEnabled(settings, 'life')) {
    const tasks = taskMap(data.tasks)
    const dayOf = (iso: string) => wallClock(new Date(iso), tz).date
    const count = (from: string, to: string) => {
      const byPlan = new Map<string, number>()
      for (const s of data.planSteps) {
        const at = stepDoneAt(s, tasks)
        if (!at) continue
        const d = dayOf(at)
        if (d >= from && d <= to) byPlan.set(s.planId, (byPlan.get(s.planId) ?? 0) + 1)
      }
      return byPlan
    }
    const a = count(p.current.from, p.current.to)
    const b = count(p.previous.from, p.previous.to)
    for (const [planId, n] of a) {
      const plan = data.lifePlans.find((x) => x.id === planId)
      if (!plan) continue
      lines.push({ area: 'plans', text: `Você concluiu ${n} ${n === 1 ? 'etapa' : 'etapas'} ${plan.kind === 'objective' ? 'do objetivo' : 'do projeto'} ${plan.title}.` })
    }
    const ta = [...a.values()].reduce((x, y) => x + y, 0)
    const tb = [...b.values()].reduce((x, y) => x + y, 0)
    if (tb && (ta || a.size === 0)) lines.push({ area: 'plans', text: `Etapas concluídas: ${ta} ${when.cur}; ${when.prev}, ${tb}.` })
  }

  return { ...base, lines }
}
