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
  received: Cents
  currency: Currency
  link: string
  notes: string
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

import type { MealAnswers, PlannedMeal, PlannerMode, RoutineAnswers, RoutineBlock, ShoppingItem } from '../../supabase/functions/_shared/planner/types.ts'
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
  /** Last change, used to resolve edits made on two devices. */
  updatedAt?: string
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
]

export type DataState = { [K in CollectionName]: Collections[K][] }
