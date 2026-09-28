export const CURRENCIES = ['EUR', 'BRL', 'AED'] as const
export type Currency = (typeof CURRENCIES)[number]

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
  password: string
  notes: string
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
]

export type DataState = { [K in CollectionName]: Collections[K][] }
