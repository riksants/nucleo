/**
 * NÚCLEO Score — formula v1 (approved). Personal only: compares the person
 * with themselves, never with others. Computed from real records every time;
 * a closed week's snapshot keeps the result together with SCORE_VERSION.
 *
 * Areas (0–100 each, rounded) and weights:
 *   productivity 25 — tasks due this week (so far) that were completed        (min 3 tasks)
 *   habits       20 — habit occurrences done ÷ expected, no skipped,
 *                     WITHOUT training-category habits                          (min 3)
 *   routine      15 — routine blocks done ÷ expected, no commute/meal/skipped,
 *                     WITHOUT training blocks                                   (min 3)
 *   training     15 — training days done ÷ planned days, max 100, 1 per day    (min 1 planned day)
 *   organization 10 — recurring done ÷ expected, no skipped                     (min 2)
 *   goals        15 — average progress of the week's goals, each capped at 100% (min 1 goal)
 * A training action counts only in "training" — never also in habits/routine.
 * Overall = Σ(score × weight) ÷ Σ(weights of valid areas), rounded; needs ≥ 2 valid areas.
 * An area without enough data is "insufficient": it is left out, never zero.
 */
import type { WeeklyGoal } from '../data/types'
import type { RangeMetrics, Tally } from './metrics'
import { goalProgress } from './weekGoals'

export const SCORE_VERSION = 1

export type ScoreArea = 'productivity' | 'habits' | 'routine' | 'training' | 'organization' | 'goals'

export const SCORE_AREAS: { id: ScoreArea; label: string; weight: number; min: number; explain: string }[] = [
  { id: 'productivity', label: 'Produtividade', weight: 25, min: 3, explain: 'Tarefas com prazo na semana que você concluiu' },
  { id: 'habits', label: 'Hábitos', weight: 20, min: 3, explain: 'Hábitos feitos dos esperados (treino conta só em Treino)' },
  { id: 'routine', label: 'Rotina', weight: 15, min: 3, explain: 'Horários da rotina cumpridos (sem deslocamentos, refeições e treino)' },
  { id: 'training', label: 'Treino', weight: 15, min: 1, explain: 'Dias de treino feitos dos planejados, 1 por dia' },
  { id: 'organization', label: 'Organização', weight: 10, min: 2, explain: 'Itens recorrentes cumpridos' },
  { id: 'goals', label: 'Metas', weight: 15, min: 1, explain: 'Média do progresso das metas da semana' },
]

export const MIN_VALID_AREAS = 2

export interface AreaResult {
  score: number | null
  /** e.g. "8/10" — what the number is made of. */
  detail: string
}

export interface ScoreResult {
  version: number
  overall: number | null
  areas: Record<ScoreArea, AreaResult>
  validAreas: number
}

function ratio(t: Tally, min: number): AreaResult {
  if (t.expected < min) return { score: null, detail: t.expected ? `${t.done}/${t.expected}` : 'sem dados' }
  return { score: Math.round((t.done / t.expected) * 100), detail: `${t.done}/${t.expected}` }
}

export function computeScore(m: RangeMetrics, goals: WeeklyGoal[]): ScoreResult {
  const weekGoals = goals.filter((g) => g.status !== 'archived')
  const goalPercents = weekGoals.map((g) => goalProgress(g, m).percent)
  const areas: Record<ScoreArea, AreaResult> = {
    productivity: ratio(m.tasks.due, 3),
    habits: ratio(m.habitsNoTraining, 3),
    routine: ratio(m.routineNoTraining, 3),
    training:
      m.training.planned >= 1
        ? { score: Math.min(100, Math.round((m.training.done / m.training.planned) * 100)), detail: `${m.training.done}/${m.training.planned} dias` }
        : { score: null, detail: m.training.done ? `${m.training.done} sem planejamento` : 'sem dados' },
    organization: ratio(m.recurring, 2),
    goals: goalPercents.length >= 1 ? { score: Math.round(goalPercents.reduce((a, b) => a + b, 0) / goalPercents.length), detail: `${weekGoals.length} meta${weekGoals.length > 1 ? 's' : ''}` } : { score: null, detail: 'sem metas' },
  }
  let sum = 0
  let weights = 0
  let valid = 0
  for (const a of SCORE_AREAS) {
    const s = areas[a.id].score
    if (s === null) continue
    sum += s * a.weight
    weights += a.weight
    valid++
  }
  return { version: SCORE_VERSION, overall: valid >= MIN_VALID_AREAS ? Math.round(sum / weights) : null, areas, validAreas: valid }
}

/** Snapshot form: flat numbers (null = insufficient data). */
export function scoreToRecord(r: ScoreResult): Record<string, number | null> {
  return { overall: r.overall, ...Object.fromEntries(SCORE_AREAS.map((a) => [a.id, r.areas[a.id].score])) }
}

/** Neutral wording for the change vs. a previous value of the same person. */
export function describeChange(current: number | null, previous: number | null): string | null {
  if (current === null || previous === null) return null
  const d = current - previous
  if (Math.abs(d) <= 2) return 'parecido com a semana passada'
  return d > 0 ? `+${d} em relação à semana passada` : `${d} em relação à semana passada`
}
