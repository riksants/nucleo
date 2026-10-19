import type { BatchOp } from '../src/data/repository'
import type { Client, DataState, FinanceGoal, Project, Rule, RuleAction, RuleCondition, RuleTrigger, Sale, Settings, Task, Transaction } from '../src/data/types'
import type { RuleCtx } from '../src/core/rules/types'
import { makeConverter } from '../src/lib/rates'
import { baseSettings, emptyData, T } from './automation-helpers'

export { emptyData, T }

export const TODAY = '2026-10-19'
export const NOW = new Date(`${TODAY}T10:00:00.000Z`)

export const settings: Settings = { ...baseSettings, initialBalance: 0, automations: { projectClient: { on: true, since: '2026-10-01' } } }

export function ctx(over: Partial<RuleCtx> = {}): RuleCtx {
  return { settings, today: TODAY, convert: makeConverter({ EUR: 1, BRL: 6, AED: 4 }), now: NOW, ...over }
}

let order = 0
export function rule(trigger: RuleTrigger | RuleTrigger['kind'], actions: RuleAction[], conditions: RuleCondition[] = [], over: Partial<Rule> = {}): Rule {
  const id = over.id ?? `r${++order}`
  return { id, createdAt: T, updatedAt: T, name: over.name ?? `Regra ${id}`, on: true, since: '2026-10-01', order: order, trigger: typeof trigger === 'string' ? { kind: trigger } : trigger, conditions, actions, ...over }
}

export const tx = (id: string, over: Partial<Transaction> = {}): Transaction => ({
  id, createdAt: `${TODAY}T09:00:00.000Z`, updatedAt: `${TODAY}T09:00:00.000Z`, type: 'in', amount: 100000, currency: 'EUR', baseAmount: 100000, reason: 'Pagamento', ...over,
})

export const project = (id: string, over: Partial<Project> = {}): Project => ({
  id, createdAt: T, updatedAt: T, name: `Projeto ${id}`, clientId: 'c1', kind: 'site', status: 'inProgress', startDate: '', dueDate: '', endDate: '', charged: 0, received: 0, currency: 'EUR', link: '', notes: '', ...over,
})

export const client = (id = 'c1', over: Partial<Client> = {}): Client => ({ id, createdAt: T, updatedAt: T, name: 'Ana', company: '', phone: '', whatsapp: '', email: '', location: '', notes: '', status: 'active', ...over })

export const task = (id: string, over: Partial<Task> = {}): Task => ({ id, createdAt: T, updatedAt: T, title: `Tarefa ${id}`, projectId: null, dueDate: '', priority: 'none', status: 'todo', completedAt: null, ...over })

export const goal = (id: string, over: Partial<FinanceGoal> = {}): FinanceGoal => ({
  id, createdAt: T, updatedAt: T, name: `Meta ${id}`, target: 1000000, saved: 0, deadline: '2027-12-31', currency: 'EUR', note: '', status: 'active', history: [], inBalance: true, ...over,
})

export const sale = (id: string, over: Partial<Sale> = {}): Sale => ({ id, createdAt: T, updatedAt: T, clientId: null, clientName: 'Maria', product: 'Tênis', quantity: 1, date: TODAY, total: 30000, currency: 'EUR', dueDate: '', payments: [], notes: '', ...over })

export const put = (collection: BatchOp['collection'], item: object): BatchOp => ({ op: 'put', collection, item: item as never })

export function data(over: Partial<DataState> = {}): DataState {
  return { ...emptyData(), ...over }
}

export const puts = (ops: BatchOp[], collection: string) => ops.filter((o): o is Extract<BatchOp, { op: 'put' }> => o.op === 'put' && o.collection === collection).map((o) => o.item as never as Record<string, unknown>)
