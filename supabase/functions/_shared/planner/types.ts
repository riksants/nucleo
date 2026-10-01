/**
 * Planner types shared by the app (Vite) and the Edge Functions (Deno).
 * Kept dependency-free so both runtimes can import this file directly.
 */

/** 0 = domingo … 6 = sábado, same as Date.getDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type PlannerMode = 'routine' | 'meals' | 'both'

export interface Commitment {
  id: string
  title: string
  kind: 'work' | 'study' | 'other'
  days: Weekday[]
  /** "HH:MM" or "" when computed from leave/arrive + commute. */
  start: string
  end: string
  away: boolean
  leaveAt: string
  arriveAt: string
  commuteMin: number
  breakStart: string
  breakEnd: string
  fixed: boolean
}

export interface Training {
  id: string
  modality: string
  days: Weekday[]
  start: string
  durationMin: number
  away: boolean
  commuteMin: number
  fixed: boolean
}

export interface WishActivity {
  id: string
  name: string
  timesPerWeek: number
  durationMin: number
  period: 'any' | 'morning' | 'afternoon' | 'evening'
  priority: 'high' | 'medium' | 'low'
}

export interface RoutineAnswers {
  wakeWeekday: string
  sleepWeekday: string
  wakeWeekend: string
  sleepWeekend: string
  commitments: Commitment[]
  trainings: Training[]
  competitions: string
  activities: WishActivity[]
  bufferMin: number
  restDays: Weekday[]
  goals: string
}

export interface MealAnswers {
  goal: 'health' | 'muscle' | 'fatloss' | 'performance' | 'practical' | 'budget'
  athlete: boolean
  modality: string
  allergies: string[]
  intolerances: string[]
  restrictions: string[]
  dislikes: string
  likes: string
  budget: 'low' | 'medium' | 'high'
  budgetNote: string
  cookMinutes: number
  equipment: string[]
  mealsPerDay: number
  mealTimes: string[]
  /** Answer to the screening question; true routes to the nutritionist flow. */
  clinical: boolean
  clinicalNote: string
  /** Asks for performance-specific strategies (cut weight, competition prep…). */
  performanceStrategy: boolean
}

export type BlockKind = 'work' | 'study' | 'commute' | 'meal' | 'training' | 'activity' | 'rest' | 'other'

export interface RoutineBlock {
  id: string
  day: Weekday
  start: string
  end: string
  title: string
  kind: BlockKind
  /** Comes from a fixed answer: generation must keep it as is. */
  fixed: boolean
}

export interface PlannedMeal {
  id: string
  day: Weekday
  time: string
  label: string
  items: string[]
  substitutions: string[]
}

export interface ShoppingItem {
  item: string
  qty: string
  checked: boolean
}

export interface MealPlanContent {
  meals: PlannedMeal[]
  shopping: ShoppingItem[]
  notes: string
}
