/**
 * Automations — shared shapes.
 *
 * Rule for every automation: the Núcleo may automate actions, but never invents facts.
 * It may create a charge, reserve money, change a status by an objective rule. It never says
 * someone paid, or that an expense was paid, without the person's confirmation or the item's
 * explicit "Considerar pago automaticamente". It never creates money or fictitious movements;
 * reserving money for a goal never creates an expense.
 *
 * Planning is pure: (data, settings, today) → what should exist. The executor
 * (data/useAutomations.ts) writes what is missing in one device transaction.
 */
import type { BatchOp } from '../../data/repository'
import type { AutomationRun, DataState, Settings } from '../../data/types'
import type { Converter } from '../../lib/rates'

export type { BatchOp }

export interface AutomationCtx {
  data: DataState
  settings: Settings
  /** "YYYY-MM-DD" in the person's time zone. */
  today: string
  convert: Converter
  now: Date
}

/** What one item (subscriber, tool, goal, client) gets in one pass. `ops` include the runs. */
export interface ItemPlan {
  runs: AutomationRun[]
  ops: BatchOp[]
}

/** Safety net against odd data: at most this many runs per item in one pass. */
export const MAX_RUNS_PER_ITEM = 36

export function makeRun(fields: Omit<AutomationRun, 'createdAt' | 'updatedAt'>, now: Date): AutomationRun {
  const at = now.toISOString()
  return { ...fields, createdAt: at, updatedAt: at }
}

export const runPut = (run: AutomationRun): BatchOp => ({ op: 'put', collection: 'automationRuns', item: run })

/** Ids of runs already written (any status): never planned again. */
export function knownRuns(data: Pick<DataState, 'automationRuns'>): Set<string> {
  return new Set(data.automationRuns.map((r) => r.id))
}
