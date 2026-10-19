import type { RoutePath } from '../../app/router'
import type { AutomationRun, CollectionName } from '../../data/types'

/** Where the item that originated a run lives (opened with ?open=id where the page supports it). */
export const ORIGIN_PATH: Partial<Record<CollectionName, RoutePath>> = {
  subscribers: '/subscribers',
  tools: '/tools',
  financeGoals: '/finance',
  clients: '/clients',
  projects: '/projects',
  tasks: '/tasks',
  sales: '/sales',
  transactions: '/finance',
}

/** Charges waiting for the person (A receber / A pagar), oldest first. */
export function pendingRuns(runs: AutomationRun[], originId?: string): AutomationRun[] {
  return runs.filter((r) => r.status === 'pending' && (!originId || r.origin.id === originId)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Everything else, newest first. */
export function historyRuns(runs: AutomationRun[]): AutomationRun[] {
  return runs.filter((r) => r.status !== 'pending').sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
}

export const isIncome = (run: AutomationRun) => run.automation === 'subscriberCharge'
