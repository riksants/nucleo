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
  /**
   * Parte 3: the line of a bank statement behind this movement — created by an import, or an existing
   * movement confirmed by the statement (`reconciled`). Missing on everything typed or created before.
   */
  bank?: BankRef
}

/** One line of an imported bank statement (CSV/OFX), as kept on the movement. */
export interface BankRef {
  /** The import (its run in automationRuns, id `import-…`). */
  importId: string
  /** The line's day, "YYYY-MM-DD", as read from the file. */
  day: string
  /** The date exactly as written in the file. */
  date: string
  /** The description exactly as written in the file (the movement's reason is a cleaned copy). */
  raw: string
  memo?: string
  /** Bank id of the line (OFX FITID or an id column), when the file has one. */
  fitid?: string
  /** Account typed/recognized at import ("Sabadell", "Wise"). */
  account?: string
  /** Name of the saved model (CSV) used to read the file. */
  template?: string
  /** The category the Núcleo applied by itself (not chosen by the person) — not counted as learning. */
  autoCategory?: string
  /** An existing movement confirmed by this line (nothing was created). */
  reconciled?: true
  /** Reconciled: the line's own id (a created movement has it as its id), so the same line is known again. */
  line?: string
  /** Created movements: how it was written (an edit afterwards changes it, and undo keeps it). */
  fp?: string
}

/** Where an automatic income came from. */
export interface ReceiptSource {
  /**
   * project: one project payment · sale: one payment of a sale · saleGeneral: a "pagamento geral" (all its pieces) ·
   * subscriber: a subscriber charge paid (automation) · tool: a tool charge paid (automation).
   */
  kind: 'project' | 'sale' | 'saleGeneral' | 'subscriber' | 'tool'
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
  /** Every N days or weeks, counted from the start date (Etapa 1 do dia a dia). */
  | { type: 'interval'; every: number; unit: 'day' | 'week' }

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
  /** Optional session length (min). A focus session that reaches it marks the day as done (evidence, not a guess). */
  minutes?: number
  /** false = no reminder for this habit (missing = reminds when it has a time). */
  remind?: boolean
  /**
   * Optional link to what usually proves it: a recurring item, or a kind of routine block. On a day when the linked
   * thing happens, Hoje and Agenda show one line, and marking that line suggests (or, with `autoFromLink`, does)
   * marking the habit too. Never marked by the clock.
   */
  link?: HabitLink
  autoFromLink?: boolean
}

export type HabitLink = { kind: 'recurring'; id: string } | { kind: 'routine'; blockKind: 'training' | 'study' }

export type HabitCategory = 'training' | 'study' | 'reading' | 'water' | 'sleep' | 'meditation' | 'food' | 'other'

export interface RecurringItem extends Entity {
  title: string
  rule: RecurrenceRule
  time: string
  notes: string
  active: boolean
  startDate: string
  /** A bill or payment (aluguel, internet): reminded earlier by default. Optional; older items are ordinary. */
  bill?: boolean
  /** Days before to remind (0 = on the day). Unset: 2 for bills, 0 for the rest. */
  remindDays?: number
  /** Occurrences moved once ("Adiar"): original date → new date. The rule itself doesn't change. */
  moved?: Record<string, string>
  /** Last day it happens ("YYYY-MM-DD", inclusive). Missing = no end. "Encerrar" sets it. */
  endDate?: string
  /** Time of one occurrence only ("só esta"): occurrence date → "HH:MM". */
  times?: Record<string, string>
  /** Items with a time: minutes before to remind (overrides the general setting). */
  remindMin?: number
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
  /** Marked together with another item (a linked habit): its key, so undoing that item undoes this one too. */
  via?: string
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
  /** A habit session (Hábitos → Iniciar); optional, older sessions don't have it. */
  habitId?: string | null
  startedAt: string
  endedAt: string
  minutes: number
}

export type ToolBilling = 'monthly' | 'yearly' | 'once' | 'free'
export type ToolStatus = 'active' | 'cancelled' | 'trial' | 'free' | 'paused'

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
  /** "Considerar pago automaticamente na data da cobrança". Missing = off: the charge waits for confirmation. */
  autoPaid?: boolean
  /** Day of the month the charges keep (set by the automation), so 31 → 28 Feb → 31 Mar. */
  chargeDay?: number
  /**
   * One day after an unconfirmed charge: 'ask' (default) asks; 'presume' records "Pagamento presumido" without
   * touching the balance; 'presumeDeduct' also records the expense (the person authorized it beforehand).
   */
  afterDue?: 'ask' | 'presume' | 'presumeDeduct'
  /** Days before the charge to remind (0 = on the day). Missing = the general setting. */
  remindDays?: number
  /** Paused since (no charges, no reminders) / resumed on: charges before this date are never created afterwards. */
  pausedAt?: string
  resumedAt?: string
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
  /** Subscribers: the automation run (charge) this payment settles. Its id is the run id. */
  chargeRun?: string
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
  /**
   * Optional (older sales have none and keep `product`/`quantity`/`total` as they are). With items, `product`
   * is their summary and `total` = sum of the items − `discount`.
   */
  items?: SaleItem[]
  discount?: Cents
  /** Installments of what is owed after the down payment: amounts add up exactly; paid status is derived from payments. */
  installments?: Installment[]
  /** Contact for "Cobrar" when the buyer is not in Clients (or the client has no phone). */
  phone?: string
  /** Repeating sale: the automation creates the next charges (new pending sales); never a payment. */
  recurring?: { every: 'week' | 'month' | 'year'; status: 'active' | 'paused' | 'ended' }
  /** Next date the automation will charge (repeating sales only). */
  recurNext?: string
  /** A charge generated from a repeating sale (its id). */
  recurOf?: string
}

export interface SaleItem {
  id: string
  name: string
  quantity: number
  /** Price of one unit. */
  price: Cents
}

export interface Installment {
  id: string
  /** "YYYY-MM-DD" */
  due: string
  amount: Cents
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
  /** confirm (default): the charge becomes "A receber" · autoPaid: considered paid on the date. */
  paymentMode?: 'confirm' | 'autoPaid'
  /** Day of the month the charges keep (set by the automation). */
  chargeDay?: number
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
  /**
   * Mark a block as done by itself when there is a real record for it that day (its linked habit marked, or a
   * focus session that reached a training/study habit's goal). Off by default: then it is only suggested.
   */
  autoFromEvidence?: boolean
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
  /** Plain text; lines "- [ ] …" / "- [x] …" are a checklist, "- …" a list (older notes are plain text and stay so). */
  body: string
  pinned: boolean
  /** Optional, free text ("Trabalho", "Ideias"…). */
  category?: string
  favorite?: boolean
  /** Lines already turned into a task/reminder from this note (not suggested again). */
  acted?: string[]
}

export interface PortfolioItem extends Entity {
  name: string
  kind: ProjectKind
  clientId: string | null
  link: string
  date: string
  image: string
  notes: string
  /** Optional organisation (Etapa 2): a free category, where it stands, and the Núcleo project it came from. */
  category?: string
  status?: 'done' | 'inProgress' | 'paused'
  projectId?: string | null
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
  /** Automations on/off and since when (nothing before `since` is caught up). Missing = on, since its first run. */
  automations?: Partial<Record<AutomationId, { on: boolean; since: string }>>
  /** Parte 2: what the person did with each rule suggestion (key → state). */
  ruleSuggestions?: Record<string, InsightMark>
  /** Parte 3: saved ways of reading a bank's CSV ("Meu Sabadell"). */
  importTemplates?: ImportTemplate[]
  /** Last change, used to resolve edits made on two devices. */
  updatedAt?: string
}

/** Which column holds what, in a CSV (0-based column indexes). */
export interface CsvColumns {
  date?: number
  description?: number
  memo?: number
  /** One signed value column… */
  amount?: number
  /** …or separate debit/credit columns. */
  debit?: number
  credit?: number
  /** D/C, débito/crédito… (with an unsigned value column). */
  type?: number
  currency?: number
  balance?: number
  id?: number
}

export interface CsvMapping {
  delimiter: string
  /** Row index of the header (-1 = the file has no header). */
  headerRow: number
  columns: CsvColumns
  decimal: ',' | '.'
  dateOrder: 'dmy' | 'mdy' | 'ymd'
  /** Positive values are money going out (credit card statements). */
  invert?: boolean
}

/** A CSV model saved by the person; applied by itself when a file with the same header comes. */
export interface ImportTemplate extends CsvMapping {
  id: string
  name: string
  /** Normalized header (or the column count, for files without header). */
  signature: string
  currency?: Currency
  account?: string
  createdAt: string
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

/** payments = a pagar (assinaturas, ferramentas) · receivables = a receber (vendas, assinantes) · focus = fim da sessão. */
export type ReminderKind = 'tasks' | 'routine' | 'meals' | 'deadlines' | 'payments' | 'habits' | 'recurring' | 'events' | 'receivables' | 'focus'

/** Antes do horário, exatamente no horário, ou os dois. */
export type ReminderWhen = 'before' | 'at' | 'both'

/** What the person chose for one kind (advanced settings). Only what was chosen is stored. */
export interface ReminderKindPref {
  enabled?: boolean
  when?: ReminderWhen
  /** Items with a time: minutes before. */
  leadMin?: number
  /** Items with only a date: days before, and the time of day for date-only reminders. */
  daysBefore?: number
  at?: string
}

export interface ReminderRule {
  enabled: boolean
  /** Minutes before items that have a time (tasks with time, routine, meals). */
  leadMin: number
  /** For date-only items: days before and the time of day to remind. */
  daysBefore: number
  at: string
  /** Date-only items reminded days before: also on the day itself (at the same time). */
  onDay?: boolean
}

export interface ReminderPrefs {
  /** Old per-kind settings (before 2026-10-30). Kept as they are; still read for what the person changed. */
  rules: Partial<Record<ReminderKind, ReminderRule>>
  /** The main switch. Missing = the old behaviour (per-kind switches above) until it is first turned on. */
  on?: boolean
  /** When to remind, for everything (a kind can override it). Missing = before. */
  when?: ReminderWhen
  /** One more reminder later for what stayed pending (overdue task, unpaid bill…). Missing = on. */
  followUp?: boolean
  /** Advanced, per kind; overrides the general choice. */
  kinds?: Partial<Record<ReminderKind, ReminderKindPref>>
  /** Show titles on the lock screen. Off by default; amounts and health data are never sent. */
  showDetails: boolean
  /** Quiet hours ("22:00" → "07:00"): a reminder that falls inside waits until the end. */
  quiet?: { from: string; to: string } | null
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
  automationRuns: AutomationRun
  rules: Rule
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
  'automationRuns',
  'rules',
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
  /** "Este dinheiro está no meu saldo": the saved amount counts as Reservado. Missing = no. */
  inBalance?: boolean
  /** "Guardar todo mês" (needs inBalance). Missing = off. */
  autoSave?: GoalAutoSave
}

export interface GoalAutoSave {
  /** Day of the month (29–31 fall on the last day of shorter months). */
  day: number
  /** calculated: what is missing ÷ reservation days left until the deadline · fixed: `amount`. */
  mode: 'calculated' | 'fixed'
  amount: Cents
  /** "YYYY-MM-DD": first day it may act (nothing before it is caught up). */
  since: string
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

/* ----------------------------- Automações ----------------------------- */

/** `rule`: a run of one of the person's rules (Parte 2); it has no on/off of its own in settings. */
export type AutomationId = 'subscriberCharge' | 'toolCharge' | 'projectClient' | 'goalSave' | 'rule' | 'bankImport' | 'saleRecurring'
export type AutomationRunStatus = 'pending' | 'done' | 'undone' | 'skipped'

/**
 * One thing the Núcleo did (or prepared) by itself. The id is fixed and derived from what it
 * refers to, so two devices land on the same record and a run is never done twice — a run
 * that was undone or skipped stays, so it is not done again either.
 */
export interface AutomationRun extends Entity {
  automation: AutomationId
  /** "YYYY-MM-DD": the day it refers to (charge date, reservation day). */
  date: string
  /** What the Núcleo did, as shown ("Núcleo reservou €100 para Meta Viagem"). */
  summary: string
  /** Extra line (e.g. reserved less than planned). */
  detail?: string
  origin: { collection: CollectionName; id: string; label: string }
  amount?: Cents
  currency?: Currency
  /** Records it created (removed by undo; with `fp`, only while still exactly as created). */
  created: { collection: CollectionName; id: string; fp?: string; action?: number }[]
  /** Fields it changed (restored by undo only if they still hold `after`; `delta`: amount added to a goal). */
  changed: { collection: CollectionName; id: string; field: string; before: unknown; after: unknown; delta?: Cents; action?: number }[]
  /** pending: waiting for the person (A receber / A pagar). */
  status: AutomationRunStatus
  /** Confirmed by the person from "A receber"/"A pagar": undoing takes it back to pending. */
  fromPending?: true
  /** Tools: "Pagamento presumido" (the person allowed it for this tool): never shown as a proven payment. */
  presumed?: true
  /** Tools: the person said "Ainda não paguei" after the due date: not presumed again, no more assisted prompt. */
  presumeDeclined?: true
  /** Tools: settled without a movement in Financeiro ("Confirmar sem descontar"). */
  noExpense?: true
  /** Rules: which rule ran. */
  rule?: { id: string; name: string }
  /**
   * Rules: the event that made it run (`txId` when it was a movement in Financeiro). 2.1: its value
   * (to try a reservation again with the same numbers) and, when a value condition converted it,
   * exactly how (so the history stays explainable after the rate changes).
   */
  cause?: { key: string; label: string; txId?: string; amount?: Cents; currency?: Currency; conversion?: RunConversion }
  /** Rules: each action, done or not (with the reason). 2.1 runs carry the rest (older ones only text/ok). */
  actions?: RunAction[]
  /** 2.1: run started by another rule's action ("Permitir que ações desta regra ativem outras regras"). */
  chain?: { rootRunId: string; path: { id: string; name: string }[]; depth: number }
  /** Parte 3: an import of a bank statement (its movements carry `bank.importId` = this run's id). */
  bankImport?: BankImportInfo
}

export interface BankImportInfo {
  file: string
  format: 'csv' | 'ofx'
  template?: string
  account?: string
  /** Lines read from the file. */
  lines: number
  /** Movements created. */
  created: number
  /** Already in the Núcleo (same line imported before): ignored. */
  duplicates: number
  /** "Possível duplicada" left out by the person. */
  possible: number
  /** Existing movements confirmed by the statement (nothing created). */
  reconciled: number
  /** …of which reconciled by the Núcleo itself (very high confidence). */
  autoReconciled: number
  /** Created movements with a category. */
  categorized: number
  /** …of which with the category the Núcleo suggested by itself. */
  autoCategorized: number
  /** Lines that needed review and were left out (or could not be read). */
  review: number
  errors: number
  /** First and last day of the lines. */
  from?: string
  to?: string
  undone?: { at: string; removed: number; unlinked: number; rules: number; kept: { id: string; label: string; why: string }[] }
}

/** Why an action was not done. Only the `retryable` ones offer "Tentar de novo". */
export type ActionCode = 'noRate' | 'noAvailable' | 'goalNotInBalance' | 'final'

export interface RunAction {
  text: string
  ok: boolean
  /** 2.1: the action as it was in the rule when it ran (a later edit of the rule never changes a retry). */
  def?: RuleAction
  code?: ActionCode
  /** 2.1: undone alone ("Desfazer só esta ação"). */
  undone?: boolean
  /** 2.1: "Tentar de novo", each with a fixed id (the same attempt is never applied twice). */
  attempts?: { id: string; at: string; ok: boolean; text: string }[]
}

export interface RunConversion {
  from: Currency
  amount: Cents
  to: Currency
  converted: Cents
  /** Units of `to` per 1 `from`. */
  rate: number
  /** When that rate was obtained (ISO), or "manual" for a rate typed by the person. */
  rateAt: string
}

/* ----------------------------- Regras (Automações Parte 2) ----------------------------- */

/** Where money came from (or went to): typed by hand, or a payment recorded elsewhere in the app. */
export type MoneyOrigin = 'manual' | 'project' | 'sale' | 'subscriber' | 'tool' | 'import'

export type RuleTriggerKind =
  | 'moneyIn'
  | 'moneyOut'
  | 'projectPayment'
  | 'salePayment'
  | 'subscriberPaid'
  | 'toolPaid'
  | 'saleCreated'
  | 'projectCreated'
  | 'projectStatus'
  | 'projectDone'
  | 'taskCreated'
  | 'taskDone'
  | 'taskOverdue'
  | 'clientCreated'
  | 'clientStatus'
  | 'goalSaved'
  | 'goalReached'
  | 'monthDay'
  | 'weekDay'

export interface RuleTrigger {
  kind: RuleTriggerKind
  /** monthDay: 1–31 (29–31 fall on the last day of shorter months). */
  day?: number
  /** weekDay: the days of the week. */
  weekdays?: Weekday[]
}

/** Every condition must hold (AND). Several values in one condition mean "any of them" (OR). */
export type RuleCondition =
  /** Only events in this same currency can match (never converted). */
  /**
   * Only events in this same currency can match (never converted) — unless `compare: 'base'`
   * (2.1, opt-in): other currencies are converted to `currency` with the app's rates; no rate → the
   * rule does not run for that event and says why.
   */
  | { field: 'amount'; op: 'gt' | 'lt' | 'between'; value: Cents; value2?: Cents; currency: Currency; compare?: 'same' | 'base' }
  | { field: 'currency'; values: Currency[] }
  | { field: 'category'; values: string[] }
  | { field: 'origin'; values: MoneyOrigin[] }
  | { field: 'client'; values: string[] }
  | { field: 'project'; values: string[] }
  | { field: 'text'; contains: string }
  | { field: 'status'; values: string[] }
  | { field: 'statusBefore'; values: string[] }
  | { field: 'priority'; values: TaskPriority[] }
  | { field: 'goal'; values: string[] }
  | { field: 'weekday'; values: Weekday[] }

export type RuleConditionField = RuleCondition['field']

/** Texts may carry {cliente} {projeto} {valor} {tarefa} {venda} {descricao}. */
export type RuleAction =
  | { kind: 'reserveFixed'; goalId: string; amount: Cents }
  | { kind: 'reservePercent'; goalId: string; percent: number }
  /** dueDays: null = no date; 0 = the event's day; n = n days after it. */
  | { kind: 'createTask'; title: string; dueDays: number | null; linkProject: boolean; priority: TaskPriority }
  | { kind: 'projectStatus'; status: ProjectStatus }
  | { kind: 'clientStatus'; status: ClientStatus }
  | { kind: 'setCategory'; category: string }
  | { kind: 'createNote'; title: string; body: string }
  | { kind: 'addInbox'; text: string }

export type RuleActionKind = RuleAction['kind']

/**
 * "Quando X → se Y → faça Z". What a rule does never triggers another rule (nor itself).
 * Last run and how many times are computed from automationRuns (no counter is stored).
 */
export interface Rule extends Entity {
  name: string
  on: boolean
  /** "YYYY-MM-DD": the day it was turned on (turning it back on = that day; nothing before is caught up). */
  since: string
  /** Position in "Minhas regras" (smaller first): rules answering the same event run in this order. */
  order: number
  trigger: RuleTrigger
  conditions: RuleCondition[]
  /** 1 to 5, applied in order. */
  actions: RuleAction[]
  /** Ready-made model it came from. */
  template?: string
  /** Turned off by the safety limit (too many runs in one day). */
  paused?: { at: string; reason: string }
  /** 2.1: "Permitir que ações desta regra ativem outras regras". Missing = off (every older rule). */
  chain?: boolean
}
