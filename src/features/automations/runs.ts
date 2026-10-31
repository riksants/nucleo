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

/** Where a record the Núcleo created opens ("Ver registro"), with ?open=id. */
export const RECORD_PATH: Partial<Record<CollectionName, RoutePath>> = {
  transactions: '/finance',
  tasks: '/tasks',
  notes: '/notes',
  inbox: '/inbox',
  sales: '/sales',
  events: '/agenda',
  recurring: '/recurring',
  habits: '/habits',
  meals: '/meals',
  projects: '/projects',
  clients: '/clients',
  lifePlans: '/life',
  financeGoals: '/finance',
}

/**
 * Charges waiting for the person (A receber / A pagar), oldest first. Only charges (a rule waiting for
 * confirmation is not a charge). With `today`, those put off ("Adiar") stay out until their day.
 */
export function pendingRuns(runs: AutomationRun[], originId?: string, today?: string): AutomationRun[] {
  return runs
    .filter((r) => r.status === 'pending' && (r.automation === 'subscriberCharge' || r.automation === 'toolCharge') && (!originId || r.origin.id === originId) && !(today && r.snoozedUntil && r.snoozedUntil > today) && !r.dismissedAt)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Everything else, newest first. */
export function historyRuns(runs: AutomationRun[]): AutomationRun[] {
  return runs.filter((r) => r.status !== 'pending').sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1))
}

export const isIncome = (run: AutomationRun) => run.automation === 'subscriberCharge'
