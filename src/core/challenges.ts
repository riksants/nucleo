/**
 * Challenges are personal (no ranking). Their progress is derived from the same
 * metrics as everything else; only "manual" challenges use one mark per day
 * (completions with source "challenge").
 */
import type { Challenge, ChallengeMode, DataState, HabitCategory, Settings, Weekday } from '../data/types'
import { addDaysToDate, todayIn, weekdayOfDate, zoneOf } from './period'
import { metricValue, rangeMetrics, type DayFacts } from './metrics'

export type ChallengeStatus = 'not_started' | 'active' | 'completed' | 'ended'

export const CHALLENGE_STATUS_LABEL: Record<ChallengeStatus, string> = {
  not_started: 'Não iniciado',
  active: 'Em andamento',
  completed: 'Concluído',
  ended: 'Encerrado',
}

export interface ChallengeTemplate {
  id: string
  name: string
  objective: string
  mode: ChallengeMode
  rule: string
  target: number
  durationDays: number
  days?: Weekday[]
}

export const CHALLENGE_TEMPLATES: ChallengeTemplate[] = [
  { id: 'water7', name: '7 dias bebendo água', objective: 'Cumprir um hábito de água todos os dias', mode: 'daily', rule: 'category:water', target: 7, durationDays: 7 },
  { id: 'training5', name: '5 treinos em uma semana', objective: 'Treinar 5 dias em 7 (rotina ou hábito de treino)', mode: 'total', rule: 'training.days', target: 5, durationDays: 7 },
  { id: 'nospend7', name: '7 dias sem gasto desnecessário', objective: 'Cada dia conta quando há saídas registradas e nenhuma marcada como desnecessária. Dia sem registro fica em aberto — você pode confirmar.', mode: 'daily', rule: 'finance:nospend', target: 7, durationDays: 7 },
  { id: 'studyWeekdays', name: 'Estudar todos os dias úteis', objective: 'Um hábito ou bloco de estudo de segunda a sexta', mode: 'daily', rule: 'category:study', target: 5, durationDays: 7, days: [1, 2, 3, 4, 5] },
  { id: 'sleep7', name: 'Dormir no horário por 7 dias', objective: 'Cumprir um hábito de sono todos os dias', mode: 'daily', rule: 'category:sleep', target: 7, durationDays: 7 },
  { id: 'routine80', name: 'Cumprir 80% da rotina por 7 dias', objective: 'Em cada dia, pelo menos 80% dos horários da rotina', mode: 'daily', rule: 'routine:80', target: 7, durationDays: 7 },
]

/** Daily rule fed by the Financeiro (Etapa 3). Challenges created before keep their own rule. */
export const FINANCE_NOSPEND = 'finance:nospend'

export function endDateOf(ch: Pick<Challenge, 'startDate' | 'durationDays'>): string {
  return addDaysToDate(ch.startDate, Math.max(1, ch.durationDays) - 1)
}

/** Does a day meet a daily challenge's condition? */
export function dayMeets(rule: string, day: DayFacts, challengeId: string): boolean {
  if (rule === 'manual') return day.challengeMarks.includes(challengeId)
  // Real data wins: an expense marked unnecessary means the day doesn't count, even if confirmed.
  // No expense registered is not assumed to be "no spending": it counts only if the person confirms.
  if (rule === FINANCE_NOSPEND) return day.unnecessary === 0 && (day.expenses > 0 || day.challengeMarks.includes(challengeId))
  if (rule === 'training') return day.trainingDone
  if (rule.startsWith('habit:')) return day.habitsDone.includes(rule.slice(6))
  if (rule.startsWith('category:')) {
    const cat = rule.slice(9) as HabitCategory
    if (cat === 'training') return day.trainingDone
    if (cat === 'study') return day.studyDone
    return day.categoriesDone.includes(cat)
  }
  if (rule.startsWith('routine:')) {
    const min = Number(rule.slice(8)) / 100
    return day.routine.expected > 0 && day.routine.done / day.routine.expected >= min
  }
  return false
}

export interface ChallengeState {
  status: ChallengeStatus
  value: number
  target: number
  percent: number
  endDate: string
  /** Daily mode: per-day result for the counted days of the period. */
  /** noData: finance rule, nothing registered and not confirmed (neutral, not a miss). */
  days: { date: string; met: boolean; counted: boolean; noData?: boolean; expenses?: number; unnecessary?: number }[]
}

export function challengeState(ch: Challenge, data: DataState, settings: Settings, now = new Date()): ChallengeState {
  const today = todayIn(zoneOf(settings), now)
  const end = endDateOf(ch)
  const target = ch.mode === 'daily' ? ch.target : Math.max(1, ch.target)
  if (ch.startDate > today) return { status: 'not_started', value: 0, target, percent: 0, endDate: end, days: [] }
  const m = rangeMetrics(data, settings, ch.startDate, end, now)
  let value: number
  let days: ChallengeState['days'] = []
  if (ch.mode === 'daily') {
    const wanted = (d: string) => !ch.days?.length || ch.days.includes(weekdayOfDate(d))
    days = m.days.filter((d) => wanted(d.date)).map((d) => ({
        date: d.date,
        met: dayMeets(ch.rule, d, ch.id),
        counted: d.counted,
        ...(ch.rule === FINANCE_NOSPEND ? { noData: d.counted && d.expenses === 0 && !d.challengeMarks.includes(ch.id), expenses: d.expenses, unnecessary: d.unnecessary } : {}),
      }))
    value = days.filter((d) => d.met).length
  } else {
    value = metricValue(m, ch.rule) ?? 0
  }
  const completed = value >= target
  const over = today > end || Boolean(ch.endedAt)
  const status: ChallengeStatus = completed ? 'completed' : over ? 'ended' : 'active'
  return { status, value, target, percent: Math.min(100, Math.round((value / target) * 100)), endDate: end, days }
}
