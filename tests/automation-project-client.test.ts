import { describe, expect, it } from 'vitest'
import { projectClientPlan } from '../src/core/automation/projectClient'
import type { BatchOp } from '../src/core/automation/types'
import type { Client, ClientStatus, Project, Settings } from '../src/data/types'
import { baseSettings, emptyData, T } from './automation-helpers'

const settings: Settings = { ...baseSettings, automations: { projectClient: { on: true, since: '2026-10-01' } } }
const now = new Date('2026-10-12T10:00:00.000Z')
const client = (status: ClientStatus = 'active'): Client => ({ id: 'c1', createdAt: T, updatedAt: T, name: 'Perfect Clean', status } as Client)
const project = (id: string, status: Project['status']): Project => ({
  id, createdAt: T, updatedAt: T, name: `Projeto ${id}`, clientId: 'c1', kind: 'site', status, startDate: '', dueDate: '', endDate: '', charged: 0, received: 0, currency: 'EUR', link: '', notes: '',
})
const data = (projects: Project[], c: Client = client(), runs = emptyData().automationRuns) => ({ ...emptyData(), clients: [c], projects, automationRuns: runs })
const clientPut = (ops: BatchOp[]) => ops.find((o) => o.op === 'put' && o.collection === 'clients') as Extract<BatchOp, { op: 'put' }> | undefined

describe('projeto concluído → cliente', () => {
  it('último projeto em aberto concluído: cliente vira Concluído, com registro', () => {
    const before = project('a', 'review')
    const plan = projectClientPlan(before, { ...before, status: 'done' }, data([before]), settings, now)!
    expect((clientPut(plan.ops)!.item as Client).status).toBe('done')
    expect(plan.runs[0]).toMatchObject({ automation: 'projectClient', status: 'done', summary: 'Cliente Perfect Clean foi marcado como Concluído', changed: [{ collection: 'clients', id: 'c1', field: 'status', before: 'active', after: 'done' }] })
  })

  it('cliente "aguardando" também conclui', () => {
    const before = project('a', 'inProgress')
    expect(projectClientPlan(before, { ...before, status: 'done' }, data([before], client('waiting')), settings, now)).not.toBeNull()
  })

  it('outro projeto ainda em andamento: nada muda', () => {
    const before = project('a', 'review')
    expect(projectClientPlan(before, { ...before, status: 'done' }, data([before, project('b', 'inProgress')]), settings, now)).toBeNull()
  })

  it('projeto pausado ou ideia não conta como em aberto', () => {
    const before = project('a', 'review')
    expect(projectClientPlan(before, { ...before, status: 'done' }, data([before, project('b', 'paused'), project('c', 'idea')]), settings, now)).not.toBeNull()
  })

  it('cliente potencial ou arquivado nunca é tocado', () => {
    const before = project('a', 'review')
    expect(projectClientPlan(before, { ...before, status: 'done' }, data([before], client('potential')), settings, now)).toBeNull()
    expect(projectClientPlan(before, { ...before, status: 'done' }, data([before], client('archived')), settings, now)).toBeNull()
  })

  it('reaberto depois que o Núcleo concluiu: cliente volta para Ativo', () => {
    const before = project('a', 'review')
    const closed = projectClientPlan(before, { ...before, status: 'done' }, data([before]), settings, now)!
    const doneP = { ...before, status: 'done' as const }
    const reopen = projectClientPlan(doneP, { ...doneP, status: 'inProgress' }, data([doneP], client('done'), closed.runs), settings, new Date('2026-10-13T10:00:00.000Z'))!
    expect((clientPut(reopen.ops)!.item as Client).status).toBe('active')
    expect(reopen.runs[0].summary).toBe('Cliente Perfect Clean voltou para Ativo')
  })

  it('cliente concluído à mão: reabrir projeto não muda o cliente', () => {
    const doneP = project('a', 'done')
    expect(projectClientPlan(doneP, { ...doneP, status: 'inProgress' }, data([doneP], client('done')), settings, now)).toBeNull()
  })

  it('conclusão do Núcleo desfeita: reabrir não mexe no cliente', () => {
    const before = project('a', 'review')
    const closed = projectClientPlan(before, { ...before, status: 'done' }, data([before]), settings, now)!
    const doneP = { ...before, status: 'done' as const }
    const undone = [{ ...closed.runs[0], status: 'undone' as const }]
    expect(projectClientPlan(doneP, { ...doneP, status: 'inProgress' }, data([doneP], client('done'), undone), settings, now)).toBeNull()
  })

  it('automação desligada: nada', () => {
    const before = project('a', 'review')
    const off = { ...settings, automations: { projectClient: { on: false, since: '2026-10-01' } } }
    expect(projectClientPlan(before, { ...before, status: 'done' }, data([before]), off, now)).toBeNull()
  })
})
