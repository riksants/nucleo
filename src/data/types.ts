/** ISO 4217 code ("EUR", "BRL", "AED", "USD"…). Values always keep the currency they were entered in. */
export type Currency = string

/** Currencies offered first when the person has not picked their own list yet. */
export const STARTER_CURRENCIES: Currency[] = ['BRL', 'USD', 'EUR']
/** Quick list kept for people who used the app before more currencies existed. */
export const LEGACY_CURRENCIES: Currency[] = ['EUR', 'BRL', 'AED']

/** Amounts are always integers in cents to avoid floating point drift. */
export type Cents = number

export interface Entity {
  id: string
  createdAt: string
  updatedAt: string
  /** Etapa 6: last change made by the Assistant (cleared by the next manual change). */
  changedBy?: 'assistant'
}

export type TransactionType = 'in' | 'out' | 'adjust'

export interface Transaction extends Entity {
  type: TransactionType
  /** Absolute amount in the currency it was entered in. */
  amount: Cents
  currency: Currency
  /** Signed effect on the balance, in the base currency, fixed at creation time. */
  baseAmount: Cents
  reason: string
  /** Optional category id (core/financeCategories.ts). Missing = "Sem categoria". */
  category?: string
  /** Expenses only: marked by the person as an unnecessary expense. Never set automatically. */
  unnecessary?: boolean
  /**
   * Set on the income created automatically by a received payment (project or sale). The id of
   * such a movement is fixed and derived from the payment (core: data/receipts.ts), so the same
   * payment can never become two movements. Removed when the project/sale is deleted (the money
   * stays in Financeiro, no longer linked).
   */
  source?: ReceiptSource
}

/** Where an automatic income came from. */
export interface ReceiptSource {
  /** project: one project payment · sale: one payment of a sale · saleGeneral: a "pagamento geral" (all its pieces). */
  kind: 'project' | 'sale' | 'saleGeneral'
  /** The project or sale id (for saleGeneral: the sale of its first piece). */
  parentId: string
  /** The payment id (for saleGeneral: the general payment id). */
  paymentId: string
}

export interface Goal extends Entity {
  name: string
  price: Cents
  currency: Currency
  note: string
  purchasedAt: string | null
}

export type ClientStatus = 'potential' | 'active' | 'waiting' | 'done' | 'archived'

export interface Client extends Entity {
  name: string
  company: string
  phone: string
  whatsapp: string
  email: string
  location: string
  notes: string
  status: ClientStatus
}

export type ProjectKind = 'site' | 'app' | 'other'
export type ProjectStatus = 'idea' | 'notStarted' | 'inProgress' | 'waitingClient' | 'review' | 'done' | 'paused'

export interface Project extends Entity {
  name: string
  clientId: string | null
  kind: ProjectKind
  status: ProjectStatus
  startDate: string
  dueDate: string
  endDate: string
  charged: Cents
  /**
   * Amount received before the payment history existed (typed by hand in the old form). It is not
   * in Financeiro unless the person launches it ("Lançar no Financeiro agora" turns it into a payment).
   * Total received = this + the payments.
   */
  received: Cents
  currency: Currency
  link: string
  notes: string
  /** Each payment received. Every one has its own income in Financeiro (same id base). */
  payments?: ProjectPayment[]
  /** The person said the old "received" amount is already in Financeiro: nothing is created for it. */
  legacyReceived?: 'inFinance'
}

export interface ProjectPayment {
  id: string
  /** "YYYY-MM-DD", the day the money arrived. */
  date: string
  amount: Cents
  /** Always the project's currency. */
  currency: Currency
  note: string
}

export type TaskStatus = 'todo' | 'doing' | 'done'
export type TaskPriority = 'none' | 'low' | 'medium' | 'high'

export interface Task extends Entity {
  title: string
  projectId: string | null
  dueDate: string
  priority: TaskPriority
  status: TaskStatus
  completedAt: string | null
  /** Optional "HH:MM". A dated task with a time is shown as an appointment. */
  dueTime?: string
  /** Optional free text. Older tasks simply don't have it. */
  notes?: string
  /** Etapa 4: created from a step of a personal project / objective (optional). */
  planId?: string
  stepId?: string
  /** Etapa 6: created to replace a routine block on one day (that day is marked skipped). */
  fromRoutine?: { blockId: string; date: string }
}

/* ----------------------------- Uso diário (Etapa 1) ----------------------------- */

/**
 * Repetition rule shared by habits and recurring checklist items. Occurrences
 * are computed when needed (core/recurrence.ts); nothing is stored ahead of time.
 */
export type RecurrenceRule =
  | { type: 'daily' }
  /** Specific weekdays (also used for "every week on Tuesday"). */
  | { type: 'weekdays'; days: Weekday[] }
  /** Day of the month; 29–31 fall on the last day in shorter months. */
  | { type: 'monthly'; dayOfMonth: number }

/** Quick capture. Stays until organized; never deleted by converting it. */
export interface InboxItem extends Entity {
  text: string
  status: 'open' | 'done'
  /** What it became, when converted (task, note, event, project…). */
  convertedTo: { collection: CollectionName; id: string } | null
  processedAt: string | null
}

export interface Habit extends Entity {
  name: string
  rule: RecurrenceRule
  /** "HH:MM" or "" (any time of the day). */
  time: string
  /** Optional free-text goal, e.g. "2 litros". */
  goal: string
  active: boolean
  /** First day it counts ("YYYY-MM-DD"). */
  startDate: string
  /** Optional: links the habit to weekly metrics (training, study…). Older habits have none. */
  category?: HabitCategory
}

export type HabitCategory = 'training' | 'study' | 'reading' | 'water' | 'sleep' | 'meditation' | 'food' | 'other'

export interface RecurringItem extends Entity {
  title: string
  rule: RecurrenceRule
  time: string
  notes: string
  active: boolean
  startDate: string
}

export type CompletionSource = 'habit' | 'recurring' | 'routine' | 'challenge'

/**
 * One record per item per day: `${source}:${sourceId}:${date}`. Marking twice,
 * or on two devices, lands on the same record. Undoing deletes it.
 */
export interface Completion extends Entity {
  source: CompletionSource
  sourceId: string
  /** Day of the occurrence, in the person's time zone. */
  date: string
  /** "skipped" is never counted as done. */
  status: 'done' | 'skipped'
}

/** Appointment with a duration. A past time does NOT mean it happened. */
export interface CalendarEvent extends Entity {
  title: string
  date: string
  start: string
  end: string
  notes: string
}

/** A finished focus session (the running timer lives on the device until then). */
export interface FocusSession extends Entity {
  taskId: string | null
  startedAt: string
  endedAt: string
  minutes: number
}

export type ToolBilling = 'monthly' | 'yearly' | 'once' | 'free'
export type ToolStatus = 'active' | 'cancelled' | 'trial' | 'free'

export interface Tool extends Entity {
  name: string
  link: string
  plan: string
  price: Cents
  currency: Currency
  billing: ToolBilling
  nextCharge: string
  notes: string
  status: ToolStatus
}

export interface Account extends Entity {
  name: string
  clientId: string | null
  projectId: string | null
  link: string
  email: string
  username: string
  /**
   * Legacy plain-text password, kept only until the vault is created. Records
   * saved through the vault have this empty and the password in `secret`.
   */
  password: string
  /** Password encrypted with the vault key (AES-GCM). */
  secret?: SealedValue | null
  notes: string
}

export interface SealedValue {
  v: 1
  /** base64 IV (12 bytes) */
  iv: string
  /** base64 ciphertext + GCM tag */
  ct: string
}

/** One partial payment. Amount is in the currency of the record it belongs to. */
export interface Payment {
  id: string
  date: string
  amount: Cents
  note: string
  /**
   * Set when this piece came from a "Pagamento geral" of the buyer, split by the
   * app across their oldest open purchases. Absent = paid on this sale directly.
   */
  generalId?: string
  /**
   * Payments recorded since the Financeiro integration: their money is (or will be, when there is a
   * rate) an income in Financeiro. Older payments don't have it and never create one by themselves.
   */
  finance?: true
}

export interface Sale extends Entity {
  clientId: string | null
  /** Used when the buyer is not (or should not be) in Clients. */
  clientName: string
  product: string
  quantity: number
  date: string
  total: Cents
  currency: Currency
  /** Deadline to be fully paid, "YYYY-MM-DD" or "". */
  dueDate: string
  payments: Payment[]
  notes: string
}

export type BillingInterval = 'monthly' | 'yearly'

/** Something the person sells by subscription: linked to a project or just a name. */
export interface Offering extends Entity {
  name: string
  projectId: string | null
  notes: string
}

export interface SubPlan extends Entity {
  offeringId: string
  name: string
  price: Cents
  currency: Currency
  interval: BillingInterval
}

export type SubscriberStatus = 'active' | 'trial' | 'paused' | 'cancelled'

export interface Subscriber extends Entity {
  offeringId: string
  planId: string
  name: string
  clientId: string | null
  email: string
  startDate: string
  nextCharge: string
  status: SubscriberStatus
  cancelledAt: string
  /** Payments received, in the plan's currency at the time (kept on each payment). */
  payments: (Payment & { currency: Currency })[]
  notes: string
}

/* ----------------------------- Rotina e alimentação ----------------------------- */

import type { MealAnswers, PlannedMeal, PlannerMode, RoutineAnswers, RoutineBlock, ShoppingItem, Weekday } from '../../supabase/functions/_shared/planner/types.ts'
export type {
  BlockKind,
  Commitment,
  MealAnswers,
  MealPlanContent,
  PlannedMeal,
  PlannerMode,
  RoutineAnswers,
  RoutineBlock,
  ShoppingItem,
  Training,
  Weekday,
  WishActivity,
} from '../../supabase/functions/_shared/planner/types.ts'

export interface PlannerProfile extends Entity {
  mode: PlannerMode
  routine: RoutineAnswers
  meals: MealAnswers
}



export interface RoutinePlan extends Entity {
  status: 'draft' | 'approved'
  source: 'ai' | 'manual'
  blocks: RoutineBlock[]
  notes: string
  /** Completed block ids per date ("YYYY-MM-DD"). */
  done: Record<string, string[]>
}



export interface MealPlan extends Entity {
  status: 'draft' | 'approved'
  source: 'ai' | 'manual'
  meals: PlannedMeal[]
  shopping: ShoppingItem[]
  notes: string
  /** Items the safety check removed, kept visible so nothing disappears silently. */
  removed: string[]
}

export interface Note extends Entity {
  title: string
  body: string
  pinned: boolean
}

export interface PortfolioItem extends Entity {
  name: string
  kind: ProjectKind
  clientId: string | null
  link: string
  date: string
  image: string
  notes: string
}

export interface Rates {
  /** Units of each currency per 1 EUR. */
  values: Record<Currency, number>
  fetchedAt: string
  source: string
}

export interface Settings {
  onboarded: boolean
  baseCurrency: Currency
  initialBalance: Cents
  startedAt: string
  rates: Rates | null
  manualRates: Partial<Record<Currency, number>>
  lastBackupAt: string | null
  /** Main currency for viewing totals. Changing it never rewrites stored values. */
  displayCurrency?: Currency
  /** Currencies offered first in pickers. */
  currencies?: Currency[]
  /** Visible sections. Missing keys fall back to the defaults in app/modules.ts. */
  modules?: Partial<Record<ModuleId, boolean>>
  /** True once the person has seen the "choose your sections" setup. */
  modulesReviewed?: boolean
  vault?: VaultMeta | null
  reminders?: ReminderPrefs
  /** IANA zone used for routine times and reminders. */
  timeZone?: string
  /** Opens Morning mode once per day before noon (off by default). */
  morningAutoOpen?: boolean
  /** Hide the NÚCLEO Score everywhere (it is still never stored as the source of truth). */
  hideScore?: boolean
  /** Sections already announced to this person, so new ones are announced once. */
  modulesSeen?: ModuleId[]
  /** The sections in the tab bar after Início, in order (up to 3), chosen by the person. Missing = default order. */
  tabs?: ModuleId[]
  /** Etapa 6: what the person did with each suggestion (key → state). Pruned after 30 days, max 200. */
  insightState?: Record<string, InsightMark>
  /** Etapa 6: hours used to suggest times ("HH:MM"). Missing = routine wake/sleep, else 07:00–22:00. */
  activeHours?: { start: string; end: string }
  /** Etapa 6: optional AI interpreter for free sentences. Off by default; needs consent. */
  assistantAi?: { enabled: boolean; consentAt: string | null }
  /** Meal types in the person's order (on/off, renamed, personal). Missing = defaults. */
  mealTypes?: MealType[]
  /** Personal finance categories and hidden default ones. Missing = defaults only. */
  financeCategories?: FinanceCategorySettings
  /** Last change, used to resolve edits made on two devices. */
  updatedAt?: string
}

export interface FinanceCategory {
  id: string
  label: string
  type: 'in' | 'out'
  /** Fixed expense (housing, bills, subscriptions): not extrapolated in the month forecast. */
  fixed?: boolean
}

export interface FinanceCategorySettings {
  custom: FinanceCategory[]
  /** Default or custom ids hidden from the pickers. Records keep using them. */
  hidden: string[]
}

export type ModuleId =
  | 'today'
  | 'finance'
  | 'tasks'
  | 'clients'
  | 'projects'
  | 'goals'
  | 'tools'
  | 'accounts'
  | 'notes'
  | 'portfolio'
  | 'routine'
  | 'meals'
  | 'sales'
  | 'subscribers'
  | 'inbox'
  | 'habits'
  | 'recurring'
  | 'agenda'
  | 'week'
  | 'life'

export interface WrappedKey {
  salt: string
  iterations: number
  iv: string
  ct: string
}

export interface VaultMeta {
  v: 1
  kdf: 'PBKDF2-SHA256'
  /** Data key wrapped with the key derived from the vault password. */
  byPassword: WrappedKey
  /** Same data key wrapped with the one-time recovery code (optional). */
  byRecovery: WrappedKey | null
  createdAt: string
  autoLockMin: number
}

export type ReminderKind = 'tasks' | 'routine' | 'meals' | 'deadlines' | 'payments'

export interface ReminderRule {
  enabled: boolean
  /** Minutes before items that have a time (tasks with time, routine, meals). */
  leadMin: number
  /** For date-only items: days before and the time of day to remind. */
  daysBefore: number
  at: string
}

export interface ReminderPrefs {
  rules: Record<ReminderKind, ReminderRule>
  /** Show titles on the lock screen. Off by default; amounts and health data are never sent. */
  showDetails: boolean
}

export interface Collections {
  transactions: Transaction
  goals: Goal
  clients: Client
  projects: Project
  tasks: Task
  tools: Tool
  accounts: Account
  notes: Note
  portfolio: PortfolioItem
  sales: Sale
  offerings: Offering
  subPlans: SubPlan
  subscribers: Subscriber
  plannerProfiles: PlannerProfile
  routinePlans: RoutinePlan
  mealPlans: MealPlan
  inbox: InboxItem
  habits: Habit
  recurring: RecurringItem
  completions: Completion
  events: CalendarEvent
  focusSessions: FocusSession
  weeklyGoals: WeeklyGoal
  challenges: Challenge
  weekCheckins: WeekCheckin
  weekSnapshots: WeekSnapshot
  financeGoals: FinanceGoal
  lifePlans: LifePlan
  planSteps: PlanStep
  meals: MealEntry
  shoppingItems: ShoppingEntry
}

export type CollectionName = keyof Collections

export const COLLECTION_NAMES: CollectionName[] = [
  'transactions',
  'goals',
  'clients',
  'projects',
  'tasks',
  'tools',
  'accounts',
  'notes',
  'portfolio',
  'sales',
  'offerings',
  'subPlans',
  'subscribers',
  'plannerProfiles',
  'routinePlans',
  'mealPlans',
  'inbox',
  'habits',
  'recurring',
  'completions',
  'events',
  'focusSessions',
  'weeklyGoals',
  'challenges',
  'weekCheckins',
  'weekSnapshots',
  'financeGoals',
  'lifePlans',
  'planSteps',
  'meals',
  'shoppingItems',
]

export type DataState = { [K in CollectionName]: Collections[K][] }

/* ----------------------------- Uso semanal (Etapa 2) ----------------------------- */

/** Week id = the Monday of the week, "YYYY-MM-DD", in the person's time zone. */
export type WeekId = string

export type WeeklyGoalKind = 'quantity' | 'money' | 'frequency' | 'percent' | 'manual'

/**
 * A goal for one week. Progress is computed from real data through `metric`
 * (see core/metrics.ts); only `manual` goals store a value.
 */
export interface WeeklyGoal extends Entity {
  week: WeekId
  title: string
  kind: WeeklyGoalKind
  /** Metric key (e.g. "training.days", "habit:<id>") or null for manual goals. */
  metric: string | null
  target: number
  manualValue: number
  status: 'active' | 'done' | 'archived'
  /** Same key across weeks ("repeat next week"), used for weekly streaks. */
  repeatKey: string
}

export type ChallengeMode = 'daily' | 'total'

export interface Challenge extends Entity {
  /** Suggested template id, or null when personalized. */
  template: string | null
  name: string
  objective: string
  /** daily: every day must meet the condition; total: the sum over the period reaches the target. */
  mode: ChallengeMode
  /** daily: condition key ("habit:<id>", "category:<cat>", "training", "routine:80", "manual"); total: metric key. */
  rule: string
  target: number
  startDate: string
  durationDays: number
  /** Set when the person ends it early. */
  endedAt: string | null
  /** Daily mode: only these weekdays count (e.g. weekdays only). Empty = every day. */
  days?: Weekday[]
}

export type CheckinTopic = 'energy' | 'productivity' | 'food' | 'training' | 'sleep' | 'mood' | 'organization'

/** One per week (id = week). Every answer is optional. */
export interface WeekCheckin extends Entity {
  week: WeekId
  answers: Partial<Record<CheckinTopic, 1 | 2 | 3 | 4 | 5>>
  note: string
}

/**
 * How a closed week looked when it was closed. Never rewritten automatically;
 * carries the versions of the formulas used.
 */
export interface WeekSnapshot extends Entity {
  week: WeekId
  timeZone: string
  closedAt: string
  metricsVersion: number
  metrics: Record<string, number | null>
  goals: { id: string; title: string; target: number; value: number; achieved: boolean }[]
  challenges: { id: string; name: string; status: string; progress: number }[]
  /** Filled only once a Score formula is approved and versioned. */
  scoreVersion?: number
  score?: Record<string, number | null>
  /** Metrics v2+: biggest expense category of the week (base currency cents). */
  financeTop?: { category: string; amount: number } | null
}

/* ----------------------------- Finanças (Etapa 3) ----------------------------- */

/**
 * "Quero juntar R$ 5.000 até dezembro." The saved amount is updated by the
 * person (never guessed from the balance). `history` keeps the saved value at
 * the end of each day it changed, so progress over time and "guardado na
 * semana" come from what was really registered.
 */
export interface FinanceGoal extends Entity {
  name: string
  target: Cents
  saved: Cents
  /** "YYYY-MM-DD" */
  deadline: string
  currency: Currency
  note: string
  status: 'active' | 'archived'
  history: { date: string; saved: Cents }[]
}

/* ----------------------------- Planejamento pessoal (Etapa 4) ----------------------------- */

export type PlanKind = 'project' | 'objective'
export type PlanStatus = 'planning' | 'active' | 'done' | 'paused' | 'archived'

/**
 * A personal project ("Viagem para Itália") or a big objective ("Aprender
 * inglês"). Same shape, different use — `kind` tells them apart. Work projects
 * (clients, values) stay in `projects`, untouched.
 */
export interface LifePlan extends Entity {
  kind: PlanKind
  title: string
  description: string
  /** Template id (travel, move, study…) or ''. */
  category: string
  /** "YYYY-MM-DD" or "" */
  startDate: string
  deadline: string
  /** Objectives only (optional). */
  priority?: 'low' | 'medium' | 'high'
  status: PlanStatus
  notes: string
  /** 0–100, only used while the plan has no steps. */
  manualProgress?: number | null
  /** Set when an objective was turned into a personal project (same record). */
  convertedFrom?: 'objective'
  convertedAt?: string
  /** Inbox item it came from (traceability). */
  fromInbox?: string
}

/**
 * One step of a plan, its own record so that finishing a step on one device
 * and editing the plan on another never overwrite each other.
 */
export interface PlanStep extends Entity {
  planId: string
  title: string
  /** "YYYY-MM-DD" or "" */
  deadline: string
  status: 'todo' | 'done'
  /** When it was marked done (for "O que mudou?"). */
  doneAt: string | null
  order: number
  notes: string
  /** Task created from this step (the task's completion also completes the step). */
  taskId?: string | null
}

/* ----------------------------- Alimentação (Etapa 5) ----------------------------- */

export interface MealType {
  id: string
  label: string
  active: boolean
}

/**
 * A meal on a real date ("segunda 05/10" ≠ "segunda 12/10"). Done is stored
 * here only. Ingredients are kept as typed, one per line; the shopping list
 * interprets them when it is built. Organisation only — no nutrition data.
 */
export interface MealEntry extends Entity {
  /** "YYYY-MM-DD" in the person's time zone. */
  date: string
  /** Meal type id ('' = none). */
  type: string
  name: string
  /** "HH:MM" or "". */
  time: string
  description: string
  ingredients: string[]
  notes: string
  done: boolean
  doneAt: string | null
}

/**
 * Shopping list record, per week (Monday id):
 * - manual: an item the person added (never touched by the automatic part);
 * - auto: only the state (bought, category, note) of an item computed from
 *   the meals; its id is fixed (`auto:<week>:<ingredient>`) so devices converge.
 */
export interface ShoppingEntry extends Entity {
  week: WeekId
  kind: 'manual' | 'auto'
  /** auto: normalized ingredient key. */
  key?: string
  /** manual: what to buy. */
  name: string
  qty: string
  unit: string
  category: string
  checked: boolean
  /** auto only: bought and cleared with "Limpar comprados". */
  cleared?: boolean
  note: string
  /** Where a manual item came from ('inbox', 'plan'), for traceability. */
  origin?: string
}

/* ----------------------------- Inteligência (Etapa 6) ----------------------------- */

/** State of one suggestion: dismissed, snoozed until a date, or accepted. */
export interface InsightMark {
  s: 'dismissed' | 'snoozed' | 'accepted'
  /** snoozed: hidden until this date ("YYYY-MM-DD"). */
  until?: string
  /** When it was set (for pruning). */
  at: string
}
