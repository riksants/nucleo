/**
 * What happened in one write, found by comparing each saved record with what it was before.
 * Only writes made on this device go through here (changes from another device, backups and the
 * move to an account never do), so the same happening is never seen twice.
 */
import type { BatchOp } from '../../data/repository'
import type { Client, CollectionName, Completion, DataState, Entity, FinanceGoal, Habit, MoneyOrigin, Project, Sale, Subscriber, Task, Transaction } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { dayOf } from '../indexes'
import { zoneOf } from '../period'
import type { RuleCtx, RuleEvent } from './types'

const ORIGIN_OF: Record<NonNullable<Transaction['source']>['kind'], MoneyOrigin> = {
  project: 'project',
  sale: 'sale',
  saleGeneral: 'sale',
  subscriber: 'subscriber',
  tool: 'tool',
}

/** Records of `before` by id, built per collection only when asked (a big write stays linear). */
function indexer(before: DataState) {
  const maps = new Map<CollectionName, Map<string, Entity>>()
  return (collection: CollectionName, id: string): Entity | undefined => {
    let m = maps.get(collection)
    if (!m) {
      m = new Map((before[collection] as Entity[]).map((x) => [x.id, x]))
      maps.set(collection, m)
    }
    return m.get(id)
  }
}

/** Looks a record up in the write first (its newest version), then in the data before it. */
function finder(before: DataState, ops: BatchOp[], prevOf = indexer(before)) {
  const written = new Map<string, Entity>()
  for (const o of ops) if (o.op === 'put') written.set(`${o.collection}:${o.item.id}`, o.item)
  return <T extends Entity>(collection: CollectionName, id: string | null | undefined): T | undefined => {
    if (!id) return undefined
    return (written.get(`${collection}:${id}`) ?? prevOf(collection, id)) as T | undefined
  }
}

const buyerName = (sale: Sale, client: Client | undefined) => (sale.clientId ? (client?.name ?? '') : sale.clientName).trim()

function moneyEvent(tx: Transaction, find: ReturnType<typeof finder>, ctx: RuleCtx): RuleEvent | null {
  // A transfer between own accounts is not money coming in or going out: no rule reacts to it.
  if ((tx.type !== 'in' && tx.type !== 'out') || tx.transfer) return null
  const origin: MoneyOrigin = tx.source ? ORIGIN_OF[tx.source.kind] : tx.bank && !tx.bank.reconciled ? 'import' : 'manual'
  let clientId: string | null = null
  let projectId: string | null = null
  let cliente: string | undefined
  let projeto: string | undefined
  if (tx.source?.kind === 'project') {
    const p = find<Project>('projects', tx.source.parentId)
    projectId = tx.source.parentId
    projeto = p?.name
    clientId = p?.clientId ?? null
    cliente = find<Client>('clients', clientId)?.name
  } else if (tx.source?.kind === 'sale' || tx.source?.kind === 'saleGeneral') {
    const s = find<Sale>('sales', tx.source.parentId)
    if (s) {
      clientId = s.clientId
      cliente = buyerName(s, find<Client>('clients', s.clientId))
    }
  } else if (tx.source?.kind === 'subscriber') {
    const s = find<Subscriber>('subscribers', tx.source.parentId)
    clientId = s?.clientId ?? null
    cliente = s?.name
  }
  const valor = formatMoney(tx.amount, tx.currency)
  return {
    key: `tx:${tx.id}`,
    kind: tx.type === 'in' ? 'moneyIn' : 'moneyOut',
    date: dayOf(tx.createdAt, zoneOf(ctx.settings)),
    origin: { collection: 'transactions', id: tx.id, label: tx.reason || (tx.type === 'in' ? 'Entrada' : 'Saída') },
    label: `${tx.type === 'in' ? 'Entrada' : 'Saída'} de ${valor}${tx.reason ? ` · ${tx.reason}` : ''}`,
    amount: tx.amount,
    currency: tx.currency,
    category: tx.category,
    moneyOrigin: origin,
    txId: tx.id,
    clientId,
    projectId,
    text: tx.reason,
    names: { valor, descricao: tx.reason, cliente, projeto },
  }
}

/** The events of one write (`ops`), given the data just before it. */
export function detectEvents(before: DataState, ops: BatchOp[], ctx: RuleCtx): RuleEvent[] {
  const prevOf = indexer(before)
  const find = finder(before, ops, prevOf)
  const ms = ctx.now.getTime()
  const today = ctx.today
  const out: RuleEvent[] = []
  const projectsDone = new Set<string>()
  // The last put of each record is what it became.
  const last = new Map<string, Extract<BatchOp, { op: 'put' }>>()
  for (const o of ops) if (o.op === 'put') last.set(`${o.collection}:${o.item.id}`, o)

  for (const o of last.values()) {
    const prev = prevOf(o.collection, o.item.id)
    switch (o.collection) {
      case 'transactions': {
        if (prev) break
        const ev = moneyEvent(o.item as Transaction, find, ctx)
        if (ev) out.push(ev)
        break
      }
      case 'sales': {
        if (prev) break
        const s = o.item as Sale
        const cliente = buyerName(s, find<Client>('clients', s.clientId))
        out.push({
          key: `sale:${s.id}`,
          kind: 'saleCreated',
          date: today,
          origin: { collection: 'sales', id: s.id, label: s.product || 'Venda' },
          label: `Venda registrada: ${s.product}${cliente ? ` · ${cliente}` : ''}`,
          amount: s.total,
          currency: s.currency,
          clientId: s.clientId,
          text: s.product,
          names: { venda: s.product, cliente, valor: formatMoney(s.total, s.currency) },
        })
        break
      }
      case 'projects': {
        const p = o.item as Project
        const was = prev as Project | undefined
        const cliente = find<Client>('clients', p.clientId)?.name
        const base = { origin: { collection: 'projects' as const, id: p.id, label: p.name }, date: today, clientId: p.clientId, projectId: p.id, text: p.name, names: { projeto: p.name, cliente } }
        if (!was) out.push({ ...base, key: `project:${p.id}`, kind: 'projectCreated', label: `Projeto criado: ${p.name}`, status: p.status })
        else if (was.status !== p.status) out.push({ ...base, key: `pstatus:${p.id}:${p.status}:${ms}`, kind: 'projectStatus', label: `Projeto ${p.name} mudou de status`, status: p.status, statusBefore: was.status })
        break
      }
      case 'tasks': {
        const t = o.item as Task
        const was = prev as Task | undefined
        const projeto = find<Project>('projects', t.projectId)?.name
        const base = { origin: { collection: 'tasks' as const, id: t.id, label: t.title }, date: today, projectId: t.projectId, priority: t.priority, text: t.title, names: { tarefa: t.title, projeto } }
        if (!was) {
          if (!t.fromRoutine) out.push({ ...base, key: `task:${t.id}`, kind: 'taskCreated', label: `Tarefa criada: ${t.title}` })
        } else if (was.status !== 'done' && t.status === 'done') {
          out.push({ ...base, key: `taskdone:${t.id}:${t.completedAt ?? ms}`, kind: 'taskDone', label: `Tarefa concluída: ${t.title}` })
          // Etapa 4: that was the last open task of its project.
          if (t.projectId && !projectsDone.has(t.projectId)) {
            const tasks = [...before.tasks.filter((x) => x.projectId === t.projectId && !last.has(`tasks:${x.id}`)), ...[...last.values()].filter((x) => x.collection === 'tasks' && (x.item as Task).projectId === t.projectId).map((x) => x.item as Task)]
            if (tasks.length && tasks.every((x) => x.status === 'done')) {
              projectsDone.add(t.projectId)
              const p = find<Project>('projects', t.projectId)
              const cliente = find<Client>('clients', p?.clientId)?.name
              out.push({
                key: `ptasks:${t.projectId}:${t.id}:${t.completedAt ?? ms}`, kind: 'projectTasksDone', date: today,
                origin: { collection: 'projects', id: t.projectId, label: p?.name ?? 'Projeto' }, label: `Todas as tarefas de ${p?.name ?? 'um projeto'} concluídas`,
                clientId: p?.clientId ?? null, projectId: t.projectId, text: p?.name, names: { projeto: p?.name, cliente, tarefa: t.title },
              })
            }
          }
        }
        break
      }
      case 'completions': {
        const c = o.item as Completion
        const was = prev as Completion | undefined
        if (c.source !== 'habit' || c.status !== 'done' || was?.status === 'done') break
        const h = find<Habit>('habits', c.sourceId)
        if (!h) break
        out.push({ key: `habit:${c.id}`, kind: 'habitDone', date: c.date, origin: { collection: 'habits', id: h.id, label: h.name }, label: `Hábito feito: ${h.name}`, category: h.category, text: h.name, names: {} })
        break
      }
      case 'clients': {
        const c = o.item as Client
        const was = prev as Client | undefined
        const base = { origin: { collection: 'clients' as const, id: c.id, label: c.name }, date: today, clientId: c.id, text: c.name, names: { cliente: c.name } }
        if (!was) out.push({ ...base, key: `client:${c.id}`, kind: 'clientCreated', label: `Cliente cadastrado: ${c.name}`, status: c.status })
        else if (was.status !== c.status) out.push({ ...base, key: `cstatus:${c.id}:${c.status}:${ms}`, kind: 'clientStatus', label: `Cliente ${c.name} mudou de status`, status: c.status, statusBefore: was.status })
        break
      }
      case 'financeGoals': {
        const g = o.item as FinanceGoal
        const was = prev as FinanceGoal | undefined
        if (!was || g.saved <= was.saved) break
        const base = { origin: { collection: 'financeGoals' as const, id: g.id, label: g.name }, date: today, goalId: g.id, text: g.name, currency: g.currency }
        const delta = g.saved - was.saved
        out.push({ ...base, key: `gsave:${g.id}:${ms}`, kind: 'goalSaved', label: `${g.name} recebeu ${formatMoney(delta, g.currency)}`, amount: delta, names: { valor: formatMoney(delta, g.currency) } })
        if (g.target > 0 && was.saved < g.target && g.saved >= g.target) out.push({ ...base, key: `greach:${g.id}:${g.target}`, kind: 'goalReached', label: `Meta ${g.name} atingida`, amount: g.saved, names: { valor: formatMoney(g.saved, g.currency) } })
        break
      }
    }
  }
  return out
}
