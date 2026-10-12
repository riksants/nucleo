/**
 * Projeto concluído → cliente. Runs inside the save of the project (same device transaction).
 * - The last open project of an active/waiting client is done → the client becomes done.
 * - A project leaves done for an open status → the client goes back to active, but only when
 *   its current "done" was set by the Núcleo (a run that was not undone). A status the person
 *   chose by hand is never overwritten; potential and archived clients are never touched.
 */
import { ACTIVE_PROJECT_STATUSES } from '../../data/selectors'
import type { AutomationRun, Client, DataState, Project, Settings } from '../../data/types'
import { todayIn, zoneOf } from '../period'
import { automationSince } from './engine'
import { type ItemPlan, makeRun, runPut } from './types'

const CLOSABLE = new Set<Client['status']>(['active', 'waiting'])

/** The latest projectClient run of this client. */
function lastRun(runs: AutomationRun[], clientId: string): AutomationRun | undefined {
  return runs.filter((r) => r.automation === 'projectClient' && r.origin.id === clientId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).at(-1)
}

export function projectClientPlan(before: Project | undefined, next: Project, data: Pick<DataState, 'clients' | 'projects' | 'automationRuns'>, settings: Settings, now: Date): ItemPlan | null {
  if (!automationSince(settings, 'projectClient') || !next.clientId) return null
  const client = data.clients.find((c) => c.id === next.clientId)
  if (!client) return null
  const wasDone = before?.status === 'done'
  const isDone = next.status === 'done'

  let to: Client['status'] | null = null
  let summary = ''
  let detail = ''
  if (!wasDone && isDone && CLOSABLE.has(client.status)) {
    const otherOpen = data.projects.some((p) => p.id !== next.id && p.clientId === client.id && ACTIVE_PROJECT_STATUSES.has(p.status))
    if (otherOpen) return null
    to = 'done'
    summary = `Cliente ${client.name} foi marcado como Concluído`
    detail = `Último projeto em aberto concluído: ${next.name}`
  } else if (wasDone && ACTIVE_PROJECT_STATUSES.has(next.status) && client.status === 'done') {
    const last = lastRun(data.automationRuns, client.id)
    const byNucleo = last?.status === 'done' && last.changed.some((c) => c.field === 'status' && c.after === 'done')
    if (!byNucleo) return null
    to = 'active'
    summary = `Cliente ${client.name} voltou para Ativo`
    detail = `Projeto reaberto: ${next.name}`
  }
  if (!to) return null

  const run = makeRun(
    {
      id: `auto-client-${client.id}-${now.getTime()}`,
      automation: 'projectClient',
      date: todayIn(zoneOf(settings), now),
      summary,
      detail,
      origin: { collection: 'clients', id: client.id, label: client.name },
      created: [],
      changed: [{ collection: 'clients', id: client.id, field: 'status', before: client.status, after: to }],
      status: 'done',
    },
    now,
  )
  const item: Client = { ...client, status: to }
  return { runs: [run], ops: [{ op: 'put', collection: 'clients', item }, runPut(run)] }
}
