/**
 * Meals on real dates (Etapa 5). Organisation only: no nutrition maths, no
 * clinical advice. The AI weekly template (mealPlans 'meals-current') stays as
 * a model; a week with real meals uses them instead of the model, so nothing
 * shows twice.
 */
import { activeRules, violations } from '../../supabase/functions/_shared/planner/foodSafety.ts'
import { toMinutes, isTime } from '../../supabase/functions/_shared/planner/time.ts'
import type { DataState, MealAnswers, MealEntry, MealPlan, MealType, Settings, WeekId } from '../data/types'
import { addDaysToDate, weekStart } from './period'

export const DEFAULT_MEAL_TYPES: MealType[] = [
  { id: 'breakfast', label: 'Café da manhã', active: true },
  { id: 'morningSnack', label: 'Lanche da manhã', active: true },
  { id: 'lunch', label: 'Almoço', active: true },
  { id: 'afternoonSnack', label: 'Lanche da tarde', active: true },
  { id: 'dinner', label: 'Jantar', active: true },
  { id: 'supper', label: 'Ceia', active: true },
]

/** The person's types in their order; defaults that are missing are appended. */
export function mealTypes(settings: Pick<Settings, 'mealTypes'>): MealType[] {
  const saved = settings.mealTypes ?? []
  const ids = new Set(saved.map((t) => t.id))
  return [...saved, ...DEFAULT_MEAL_TYPES.filter((t) => !ids.has(t.id))]
}

export function typeLabel(settings: Pick<Settings, 'mealTypes'>, id: string): string {
  return mealTypes(settings).find((t) => t.id === id)?.label ?? ''
}

/** What to call a meal when it has no name: its type. */
export function mealTitle(settings: Pick<Settings, 'mealTypes'>, m: Pick<MealEntry, 'name' | 'type'>): string {
  return m.name.trim() || typeLabel(settings, m.type) || 'Refeição'
}

const timeKey = (t: string) => (isTime(t) ? toMinutes(t) : 24 * 60)

export function sortMeals(list: MealEntry[], settings: Pick<Settings, 'mealTypes'>): MealEntry[] {
  const order = new Map(mealTypes(settings).map((t, i) => [t.id, i]))
  return [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : timeKey(a.time) - timeKey(b.time) || (order.get(a.type) ?? 99) - (order.get(b.type) ?? 99) || a.createdAt.localeCompare(b.createdAt)))
}

export const weekDays = (week: WeekId) => Array.from({ length: 7 }, (_, i) => addDaysToDate(week, i))

export function mealsOfWeek(meals: MealEntry[], week: WeekId): MealEntry[] {
  const end = addDaysToDate(week, 6)
  return meals.filter((m) => m.date >= week && m.date <= end)
}

export function mealsOn(meals: MealEntry[], date: string): MealEntry[] {
  return meals.filter((m) => m.date === date)
}

/** Weeks (Monday ids) that have real meals — those don't show the AI model. */
const weeksCache = new WeakMap<MealEntry[], { n: number; weeks: Set<WeekId> }>()
export function weeksWithMeals(meals: MealEntry[]): Set<WeekId> {
  // Once per version of the list (the agenda asks for it on every build).
  const hit = weeksCache.get(meals)
  if (hit && hit.n === meals.length) return hit.weeks
  const weeks = new Set(meals.map((m) => weekStart(m.date)))
  weeksCache.set(meals, { n: meals.length, weeks })
  return weeks
}

type NewMeal = Omit<MealEntry, 'id' | 'createdAt' | 'updatedAt'>

/** Copy of a week into another: new records, same days of the week, never "done". */
export function copyWeek(meals: MealEntry[], from: WeekId, to: WeekId): NewMeal[] {
  const shift = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
  return mealsOfWeek(meals, from).map((m) => ({ date: addDaysToDate(m.date, shift), type: m.type, name: m.name, time: m.time, description: m.description, ingredients: [...m.ingredients], notes: m.notes, done: false, doneAt: null }))
}

/** Same meal on other dates (new records, not done). */
export function duplicateTo(meal: MealEntry, dates: string[]): NewMeal[] {
  return dates.filter((d) => d !== meal.date).map((date) => ({ date, type: meal.type, name: meal.name, time: meal.time, description: meal.description, ingredients: [...meal.ingredients], notes: meal.notes, done: false, doneAt: null }))
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** The AI model as real meals of one week (explicit action, after confirmation). */
export function fromTemplate(plan: Pick<MealPlan, 'meals'>, week: WeekId, settings: Pick<Settings, 'mealTypes'>): NewMeal[] {
  const types = mealTypes(settings)
  return plan.meals.map((m) => {
    const date = addDaysToDate(week, (m.day + 6) % 7) // Weekday 0 = Sunday
    const type = types.find((t) => norm(t.label) === norm(m.label))?.id ?? ''
    return { date, type, name: type ? '' : m.label, time: m.time, description: '', ingredients: [...m.items], notes: '', done: false, doneAt: null }
  })
}

/** Same allergy/restriction check the AI plan already uses (by words; not clinical). */
export function foodSafetyProblem(lines: string[], answers: MealAnswers): string | null {
  const rules = activeRules(answers)
  for (const t of lines) {
    const v = violations(t, rules)
    if (v.length) return `“${t}” não combina com: ${v.map((r) => r.label).join(', ')}`
  }
  return null
}

export interface MealCounts {
  planned: number
  done: number
  /** Days with at least one planned meal. */
  days: number
}

/** Own counters for Semana/Noite — never part of "itens concluídos" or the Score. */
export function mealCounts(meals: MealEntry[], from: string, to: string): MealCounts {
  const inRange = meals.filter((m) => m.date >= from && m.date <= to)
  return { planned: inRange.length, done: inRange.filter((m) => m.done).length, days: new Set(inRange.map((m) => m.date)).size }
}

export function hasRealMeals(data: Pick<DataState, 'meals'>, date: string): boolean {
  const week = weekStart(date)
  return data.meals.some((m) => weekStart(m.date) === week)
}
