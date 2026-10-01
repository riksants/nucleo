import type { HabitCategory, WeeklyGoal, WeeklyGoalKind } from '../data/types'
import { metricValue, type RangeMetrics } from './metrics'

export interface GoalProgress {
  value: number
  target: number
  /** 0–100, capped. */
  percent: number
  achieved: boolean
  /** Comes from real data (not typed by the person). */
  auto: boolean
  /** No data yet for this metric (e.g. no movements this week). */
  noData: boolean
}

export function goalProgress(goal: WeeklyGoal, m: RangeMetrics | null): GoalProgress {
  const target = Math.max(goal.target, 0)
  if (goal.kind === 'manual' || !goal.metric || !m) {
    const value = goal.manualValue
    const achieved = goal.status === 'done' || (target > 0 && value >= target)
    return { value, target, percent: target ? Math.min(100, Math.round((value / target) * 100)) : achieved ? 100 : 0, achieved, auto: false, noData: false }
  }
  const raw = metricValue(m, goal.metric)
  const value = raw ?? 0
  const achieved = goal.status === 'done' || (target > 0 && raw !== null && value >= target)
  const percent = target ? Math.max(0, Math.min(100, Math.round((value / target) * 100))) : 0
  return { value, target, percent: achieved ? 100 : percent, achieved, auto: true, noData: raw === null }
}

/** Ready-made metrics offered when creating a goal, by kind. */
export interface MetricOption {
  key: string
  label: string
  kind: WeeklyGoalKind
  unit: string
}

export function metricOptions(habits: { id: string; name: string; active: boolean }[], recurring: { id: string; title: string; active: boolean }[], categories: HabitCategory[]): MetricOption[] {
  const base: MetricOption[] = [
    { key: 'training.days', label: 'Dias de treino', kind: 'quantity', unit: 'treinos' },
    { key: 'study.minutes', label: 'Minutos de estudo (rotina)', kind: 'quantity', unit: 'min' },
    { key: 'study.days', label: 'Dias com estudo', kind: 'quantity', unit: 'dias' },
    { key: 'tasks.completed', label: 'Tarefas concluídas', kind: 'quantity', unit: 'tarefas' },
    { key: 'items.done', label: 'Itens do dia concluídos', kind: 'quantity', unit: 'itens' },
    { key: 'habits.percent', label: 'Hábitos cumpridos', kind: 'percent', unit: '%' },
    { key: 'routine.percent', label: 'Rotina cumprida', kind: 'percent', unit: '%' },
    { key: 'items.percent', label: 'Itens da semana concluídos', kind: 'percent', unit: '%' },
    { key: 'finance.net', label: 'Saldo da semana (entradas − saídas)', kind: 'money', unit: '' },
  ]
  const cat: MetricOption[] = categories.map((c) => ({ key: `category:${c}`, label: `Dias com hábito de ${CATEGORY_LABEL[c].toLowerCase()}`, kind: 'frequency', unit: 'dias' }))
  const perHabit: MetricOption[] = habits.filter((h) => h.active).map((h) => ({ key: `habit:${h.id}`, label: `Hábito: ${h.name}`, kind: 'frequency', unit: 'vezes' }))
  const perRec: MetricOption[] = recurring.filter((r) => r.active).map((r) => ({ key: `recurring:${r.id}`, label: `Recorrente: ${r.title}`, kind: 'frequency', unit: 'vezes' }))
  return [...base, ...cat, ...perHabit, ...perRec]
}

export const CATEGORY_LABEL: Record<HabitCategory, string> = {
  training: 'Treino',
  study: 'Estudo',
  reading: 'Leitura',
  water: 'Água',
  sleep: 'Sono',
  meditation: 'Meditação',
  food: 'Alimentação',
  other: 'Outro',
}
