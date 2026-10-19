/**
 * The actions of a rule. Each one is done, or not done with the reason; one that can't be done
 * never stops the others. None of them creates money, marks anything as paid or removes a record:
 * - reserving adds to the goal's saved amount (no movement, the money stays in the balance),
 *   limited to what is missing and to the Disponível, like "Guardar todo mês";
 * - a category is only applied to a movement that has none;
 * - statuses change only on the project/client of the event, to the status the rule names.
 */
import type { AutomationRun, Client, FinanceGoal, InboxItem, Note, Project, Rule, RuleAction, Task } from '../../data/types'
import { balanceOf } from '../../data/selectors'
import { CLIENT_STATUS, PROJECT_STATUS } from '../../data/labels'
import { formatMoney } from '../../lib/money'
import { projectClientPlan } from '../automation/projectClient'
import { findCategory } from '../financeCategories'
import { withSaved } from '../financeGoals'
import { addDaysToDate } from '../period'
import { reserveSummary } from '../reserved'
import { fillTokens } from './text'
import type { RuleCtx, RuleEvent } from './types'
import type { Work } from './work'

export interface ActionsPlan {
  results: { text: string; ok: boolean }[]
  created: AutomationRun['created']
  changed: AutomationRun['changed']
}

/** What a record looks like for "was it edited after the rule created it?" (dates and marks left out). */
export function fingerprint(item: object): string {
  const { id: _i, createdAt: _c, updatedAt: _u, changedBy: _b, ...rest } = item as Record<string, unknown>
  void _i, _c, _u, _b
  return JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]]))
}

const ddmm = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`
const labelOf = (list: { value: string; label: string }[], v: string) => list.find((o) => o.value === v)?.label ?? v

class NotDone extends Error {}
const fail = (reason: string): never => {
  throw new NotDone(reason)
}

/** Disponível now (base currency), from the working copy: the movement of this event included. */
function availableBase(work: Work, ctx: RuleCtx): number {
  const balance = balanceOf(ctx.settings, work.list('transactions'))
  return reserveSummary(work.list('financeGoals'), balance, ctx.settings.baseCurrency, ctx.convert).available
}

/** Short name of an action, used when it could not be done ("Reservar para Impostos: …"). */
export function actionName(a: RuleAction, work: Pick<Work, 'get'>): string {
  switch (a.kind) {
    case 'reserveFixed':
    case 'reservePercent':
      return `Reservar para ${work.get('financeGoals', a.goalId)?.name ?? 'a meta'}`
    case 'createTask':
      return 'Criar a tarefa'
    case 'projectStatus':
      return 'Mudar o status do projeto'
    case 'clientStatus':
      return 'Mudar o status do cliente'
    case 'setCategory':
      return 'Aplicar a categoria'
    case 'createNote':
      return 'Criar a nota'
    case 'addInbox':
      return 'Adicionar ao Inbox'
  }
}

function reserve(a: Extract<RuleAction, { kind: 'reserveFixed' | 'reservePercent' }>, ev: RuleEvent, work: Work, ctx: RuleCtx, plan: ActionsPlan): string {
  const g = work.get('financeGoals', a.goalId)
  if (!g) return fail('a meta não existe mais')
  if (g.status !== 'active') return fail(`a meta ${g.name} está arquivada`)
  if (!g.inBalance) return fail(`a meta ${g.name} não está marcada como “Este dinheiro está no meu saldo”`)
  const missing = g.target - g.saved
  if (missing <= 0) return fail(`a meta ${g.name} já foi atingida`)
  const m = (c: number, cur = g.currency) => formatMoney(c, cur)

  let planned: number
  let how = ''
  if (a.kind === 'reserveFixed') planned = a.amount
  else {
    if (ev.amount === undefined || !ev.currency) return fail('este acontecimento não tem valor')
    const raw = Math.floor((ev.amount * a.percent) / 100)
    const converted = ev.currency === g.currency ? raw : ctx.convert(raw, ev.currency, g.currency)
    if (converted === null) return fail(`sem cotação para converter ${ev.currency} em ${g.currency}`)
    planned = Math.floor(converted)
    how = ` (${a.percent}% de ${m(ev.amount, ev.currency)})`
  }
  if (planned <= 0) return fail('o valor a reservar é zero')

  const base = ctx.settings.baseCurrency
  const free = ctx.convert(Math.max(availableBase(work, ctx), 0), base, g.currency)
  if (free === null) return fail(`sem cotação de ${g.currency} para calcular o disponível`)
  const reserved = Math.max(0, Math.min(planned, missing, Math.floor(free)))
  if (reserved <= 0) return fail('saldo disponível insuficiente')

  const saved = g.saved + reserved
  const next: FinanceGoal = { ...g, saved, history: withSaved(g, saved, ctx.today) }
  work.put('financeGoals', next)
  plan.changed.push({ collection: 'financeGoals', id: g.id, field: 'saved', before: g.saved, after: saved, delta: reserved })
  const limit = reserved < planned ? ` — previsto ${m(planned)}, ${reserved === missing ? 'só faltava isso para a meta' : 'faltou saldo disponível'}` : ''
  return `reservou ${m(reserved)} para ${g.name}${how}${limit}`
}

function one(rule: Rule, a: RuleAction, ev: RuleEvent, work: Work, ctx: RuleCtx, newId: () => string, plan: ActionsPlan): string {
  const at = ctx.now.toISOString()
  switch (a.kind) {
    case 'reserveFixed':
    case 'reservePercent':
      return reserve(a, ev, work, ctx, plan)

    case 'createTask': {
      const title = fillTokens(a.title, ev.names) || 'Tarefa'
      const dueDate = a.dueDays === null ? '' : addDaysToDate(ctx.today, Math.max(0, a.dueDays))
      const projectId = a.linkProject && ev.projectId && work.get('projects', ev.projectId) ? ev.projectId : null
      const task: Task = { id: newId(), createdAt: at, updatedAt: at, title, projectId, dueDate, priority: a.priority, status: 'todo', completedAt: null, notes: `Criada pela regra “${rule.name}”.` }
      work.put('tasks', task)
      plan.created.push({ collection: 'tasks', id: task.id, fp: fingerprint(task) })
      return `criou a tarefa “${title}”${dueDate ? ` para ${ddmm(dueDate)}` : ''}`
    }

    case 'createNote': {
      const note: Note = { id: newId(), createdAt: at, updatedAt: at, title: fillTokens(a.title, ev.names) || 'Nota', body: fillTokens(a.body, ev.names), pinned: false }
      work.put('notes', note)
      plan.created.push({ collection: 'notes', id: note.id, fp: fingerprint(note) })
      return `criou a nota “${note.title}”`
    }

    case 'addInbox': {
      const text = fillTokens(a.text, ev.names) || 'Item da regra'
      const item: InboxItem = { id: newId(), createdAt: at, updatedAt: at, text, status: 'open', convertedTo: null, processedAt: null }
      work.put('inbox', item)
      plan.created.push({ collection: 'inbox', id: item.id, fp: fingerprint(item) })
      return `adicionou “${text}” ao Inbox`
    }

    case 'projectStatus': {
      if (!ev.projectId) return fail('este acontecimento não tem projeto')
      const p = work.get('projects', ev.projectId)
      if (!p) return fail('o projeto não existe mais')
      const label = labelOf(PROJECT_STATUS, a.status).toLowerCase()
      if (p.status === a.status) return fail(`o projeto ${p.name} já estava ${label}`)
      const next: Project = { ...p, status: a.status, endDate: a.status === 'done' && !p.endDate ? ctx.today : p.endDate }
      // The projeto → cliente automation (Parte 1) follows, exactly as when the person saves the project.
      const snap = work.snapshot()
      const pc = projectClientPlan(p, next, snap, ctx.settings, ctx.now)
      work.put('projects', next)
      if (pc) work.apply(pc.ops)
      plan.changed.push({ collection: 'projects', id: p.id, field: 'status', before: p.status, after: a.status })
      return `mudou o projeto ${p.name} para ${label}`
    }

    case 'clientStatus': {
      if (!ev.clientId) return fail('este acontecimento não tem cliente')
      const c = work.get('clients', ev.clientId)
      if (!c) return fail('o cliente não existe mais')
      const label = labelOf(CLIENT_STATUS, a.status).toLowerCase()
      if (c.status === a.status) return fail(`o cliente ${c.name} já estava ${label}`)
      const next: Client = { ...c, status: a.status }
      work.put('clients', next)
      plan.changed.push({ collection: 'clients', id: c.id, field: 'status', before: c.status, after: a.status })
      return `mudou o cliente ${c.name} para ${label}`
    }

    case 'setCategory': {
      if (!ev.txId) return fail('este acontecimento não é uma movimentação')
      const tx = work.get('transactions', ev.txId)
      if (!tx) return fail('a movimentação não existe mais')
      if (tx.category) return fail('a movimentação já tinha categoria')
      const cat = findCategory(ctx.settings, a.category)
      if (!cat || cat.type !== tx.type) return fail('a categoria não combina com esta movimentação')
      work.put('transactions', { ...tx, category: cat.id })
      plan.changed.push({ collection: 'transactions', id: tx.id, field: 'category', before: undefined, after: cat.id })
      return `aplicou a categoria ${cat.label}`
    }
  }
}

/** Plans every action of `rule` for `ev` on the working copy; created records get ids `<runId>-<n>`. */
export function planActions(rule: Rule, ev: RuleEvent, work: Work, ctx: RuleCtx, runId: string): ActionsPlan {
  const plan: ActionsPlan = { results: [], created: [], changed: [] }
  let n = 0
  const newId = () => `${runId}-${++n}`
  for (const a of rule.actions) {
    try {
      plan.results.push({ text: one(rule, a, ev, work, ctx, newId, plan), ok: true })
    } catch (err) {
      const reason = err instanceof NotDone ? err.message : 'erro inesperado'
      if (!(err instanceof NotDone)) console.error('Regras: falha numa ação', err)
      plan.results.push({ text: `${actionName(a, work)}: ${reason}`, ok: false })
    }
  }
  return plan
}
