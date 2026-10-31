/**
 * Importação inteligente (Etapa 4) — step 3: the chosen items become records, in ONE write, only after the
 * person confirms. Ids come from the content (`in-<hash>`): the same document imported again finds its records
 * and writes nothing twice (also from another device). Each record keeps its fingerprint in the import's run,
 * so "Desfazer importação" removes only what is still exactly as imported (an edit afterwards is kept).
 * The document itself is never stored — only the records and, if the person wants, a note with the lines
 * that were not recognised.
 */
import type { BatchOp } from '../../data/repository'
import type { AutomationRun, CalendarEvent, Currency, DataState, Entity, MealEntry, Note, Project, RecurringItem, ShoppingEntry, SmartImportInfo, Task } from '../../data/types'
import { makeRun, runPut } from '../automation/types'
import { undoRun } from '../automation/undo'
import { weekStart } from '../period'
import { fingerprint } from '../rules/actions'
import { hash16 } from '../rules/hash'
import { TARGET_LABEL, type IntakeItem, type Proposal, type Unrecognised } from './detect'

export interface IntakeMeta {
  /** File name or "Texto colado". */
  source: string
  hash: string
  today: string
  now: Date
  baseCurrency: Currency
}

export interface IntakePlan {
  ops: BatchOp[]
  run: AutomationRun
  created: number
  duplicates: number
}

const TARGET_SHORT: Record<Proposal['target'], string> = { meals: 'Alimentação', training: 'Treino', schedule: 'Agenda e rotina', finance: 'Financeiro', project: 'Projetos', shopping: 'Lista de compras', note: 'Anotações' }

export const itemId = (hash: string, target: string, key: string) => `in-${hash16(`${hash}|${target}|${key}`)}`

/** An import of the same content to the same place that is still in effect (not undone). */
export function previousImport(data: Pick<DataState, 'automationRuns'>, hash: string, target: string): AutomationRun | null {
  return data.automationRuns.find((r) => r.automation === 'smartImport' && r.status === 'done' && r.smartImport?.hash === hash && r.smartImport.target === TARGET_SHORT[target as Proposal['target']]) ?? null
}

export function planIntake(proposal: Proposal, items: IntakeItem[], keep: { unrecognised: boolean }, data: DataState, meta: IntakeMeta): IntakePlan | string {
  const chosen = items.filter((x) => x.include)
  if (!chosen.length && !(keep.unrecognised && proposal.unrecognised.length)) return 'Escolha pelo menos um item para importar.'
  const at = meta.now.toISOString()
  const exists = new Set<string>()
  for (const name of ['meals', 'recurring', 'events', 'tasks', 'notes', 'shoppingItems', 'projects'] as const) for (const x of data[name] as Entity[]) exists.add(`${name}:${x.id}`)
  const ops: BatchOp[] = []
  const created: AutomationRun['created'] = []
  let duplicates = 0
  const put = (collection: BatchOp['collection'], item: Entity) => {
    if (exists.has(`${collection}:${item.id}`)) {
      duplicates++
      return false
    }
    ops.push({ op: 'put', collection, item } as BatchOp)
    created.push({ collection, id: item.id, fp: fingerprint(item) })
    return true
  }
  const id = (key: string) => itemId(meta.hash, proposal.target, key)
  const base = { createdAt: at, updatedAt: at }
  const from = (source: string) => (source ? `Do documento “${meta.source}”: ${source}` : `Do documento “${meta.source}”.`)

  // A project first: its tasks point to it.
  const project = chosen.find((x) => x.kind === 'project')
  const projectId = project ? id(project.key) : null
  for (const it of chosen) {
    switch (it.kind) {
      case 'meal':
        put('meals', { id: id(it.key), ...base, date: it.date, type: it.type, name: it.name, time: it.time, description: '', ingredients: it.ingredients, notes: from(it.source), done: false, doneAt: null } as MealEntry)
        break
      case 'recurring':
        put('recurring', { id: id(it.key), ...base, title: it.title.trim() || 'Recorrente', rule: it.rule, time: it.time, notes: it.notes, active: true, startDate: meta.today } as RecurringItem)
        break
      case 'event':
        put('events', { id: id(it.key), ...base, title: it.title.trim() || 'Compromisso', date: it.date, start: it.start, end: it.end, notes: from(it.source) } as CalendarEvent)
        break
      case 'task':
        put('tasks', { id: id(it.key), ...base, title: it.title.trim() || 'Tarefa', projectId: projectId && proposal.target === 'project' ? projectId : null, dueDate: it.dueDate, ...(it.dueTime ? { dueTime: it.dueTime } : {}), priority: 'none', status: 'todo', completedAt: null, notes: it.notes || from(it.source) } as Task)
        break
      case 'note':
        put('notes', { id: id(it.key), ...base, title: it.title.trim() || 'Documento importado', body: it.body, pinned: false, category: 'Importado' } as Note)
        break
      case 'shopping':
        put('shoppingItems', { id: id(it.key), ...base, week: weekStart(meta.today), kind: 'manual', name: it.name.trim(), qty: it.qty, unit: it.unit, category: 'Outros', checked: false, note: '' } as ShoppingEntry)
        break
      case 'project':
        put('projects', { id: id(it.key), ...base, name: it.name.trim() || 'Projeto importado', clientId: null, kind: 'other', status: 'notStarted', startDate: meta.today, dueDate: it.dueDate, endDate: '', charged: 0, received: 0, currency: meta.baseCurrency, link: '', notes: it.notes || from('') } as Project)
        break
    }
  }
  // "Nunca descartar em silêncio": what was not recognised can be kept, as written.
  const left: Unrecognised[] = proposal.unrecognised
  if (keep.unrecognised && left.length) put('notes', { id: id('unrecognised'), ...base, title: `Não reconhecido — ${meta.source}`.slice(0, 120), body: left.map((u) => u.line).join('\n'), pinned: false, category: 'Importado' } as Note)

  const info: SmartImportInfo = { source: meta.source, hash: meta.hash, target: TARGET_SHORT[proposal.target], created: created.length, unrecognised: left.length, skipped: items.length - chosen.length, duplicates }
  const run = makeRun(
    {
      id: `intake-${hash16(`${meta.hash}|${proposal.target}|${at}`)}`,
      automation: 'smartImport',
      date: meta.today,
      summary: created.length ? `Importação de “${meta.source}”: ${created.length} ${created.length === 1 ? 'registro criado' : 'registros criados'} (${TARGET_LABEL[proposal.target].split(' → ')[0]})` : `Importação de “${meta.source}”: nada novo`,
      ...(duplicates ? { detail: `${duplicates} já ${duplicates === 1 ? 'existia' : 'existiam'} (importado antes) e não foi criado de novo.` } : {}),
      origin: { collection: 'notes', id: '', label: TARGET_SHORT[proposal.target] },
      created,
      changed: [],
      status: created.length ? 'done' : 'skipped',
      smartImport: info,
    },
    meta.now,
  )
  ops.push(runPut(run))
  return { ops, run, created: created.length, duplicates }
}

/** "Desfazer importação": what is still as imported goes; what the person edited stays (and is reported). */
export function undoIntake(run: AutomationRun, data: DataState, today: string): { ops: BatchOp[]; partial: boolean } | null {
  if (run.automation !== 'smartImport' || run.status !== 'done') return null
  const { ops, partial } = undoRun(run, data, today)
  return { ops: ops.map((o) => (o.op === 'put' && o.collection === 'automationRuns' && o.item.id === run.id ? runPut({ ...(o.item as AutomationRun), smartImport: { ...run.smartImport!, undone: true } }) : o)), partial }
}
