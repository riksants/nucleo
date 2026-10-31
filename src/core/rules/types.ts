/**
 * Rules (Automações Parte 2) — shared shapes.
 *
 * "Quando X → se Y → faça Z". The same rule as every automation: the Núcleo may automate actions,
 * but never invents facts — no rule creates income or expenses, marks anything as paid or deletes
 * the person's records. Reserving for a goal is not an expense.
 *
 * What a rule does never triggers another rule (nor itself) — except a rule with `chain` on (2.1), whose
 * own writes may reach other rules under the guards of engine.ts (depth 3, no rule twice, budget per write).
 * Undos never produce events.
 */
import type { CollectionName, Cents, Currency, MoneyOrigin, Settings, TaskPriority } from '../../data/types'
import type { Converter } from '../../lib/rates'

/** Who made a write. Only person / assistant / automation produce events for the rules. */
export type WriteActor = 'person' | 'assistant' | 'automation' | 'rule' | 'undo'

export const EVENT_ACTORS = new Set<WriteActor>(['person', 'assistant', 'automation'])

export type EventKind =
  | 'moneyIn'
  | 'moneyOut'
  | 'saleCreated'
  | 'projectCreated'
  | 'projectStatus'
  | 'taskCreated'
  | 'taskDone'
  | 'taskOverdue'
  | 'clientCreated'
  | 'clientStatus'
  | 'goalSaved'
  | 'goalReached'
  | 'date'
  | 'projectTasksDone'
  | 'habitDone'
  | 'toolDue'

/** Names offered as {marcadores} in the texts of actions. */
export interface EventNames {
  cliente?: string
  projeto?: string
  tarefa?: string
  venda?: string
  descricao?: string
  valor?: string
}

/** Something that happened, as the rules see it (never stored; its `key` is). */
export interface RuleEvent {
  /** Stable: the same happening always has the same key (part of the run id). */
  key: string
  kind: EventKind
  /** "YYYY-MM-DD" in the person's zone. */
  date: string
  origin: { collection: CollectionName; id: string; label: string }
  /** How the history says what happened ("Pagamento de projeto: Site da Ana"). */
  label: string
  amount?: Cents
  currency?: Currency
  category?: string
  moneyOrigin?: MoneyOrigin
  /** The movement in Financeiro, for money events. */
  txId?: string
  clientId?: string | null
  projectId?: string | null
  goalId?: string
  /** Searched by "texto contém" (description, title, name, product). */
  text?: string
  status?: string
  statusBefore?: string
  priority?: TaskPriority
  names: EventNames
}

export interface RuleCtx {
  settings: Settings
  /** "YYYY-MM-DD" in the person's zone. */
  today: string
  convert: Converter
  now: Date
}

/** Safety limit: a rule that runs this many times in one day is turned off (paused). */
export const MAX_RUNS_PER_RULE_PER_DAY = 30
export const MAX_ACTIONS = 5
