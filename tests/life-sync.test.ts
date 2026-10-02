import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { convertToProject, moveStep, planProgress, stepsOf } from '../src/core/plans'
import { createSyncedRepository, type RemoteApi, type RemoteRow } from '../src/data/sync'
import type { LifePlan, PlanStep, Settings } from '../src/data/types'

/** In-memory server with the SQL rules: per user, stale writes ignored. `offline` simulates no network. */
function fakeServer() {
  const rows = new Map<string, RemoteRow & { server_updated_at: string }>()
  let settings: { data: Settings; updatedAt: string } | null = null
  let clock = 0
  const state = { offline: false }
  const net = () => {
    if (state.offline) throw new TypeError('Failed to fetch')
  }
  const stamp = () => new Date(Date.UTC(2026, 9, 1) + ++clock * 1000).toISOString()
  const api: RemoteApi = {
    async upsert(list) {
      net()
      for (const r of list) {
        const key = `${r.collection}:${r.id}`
        const old = rows.get(key)
        if (old && r.client_updated_at < old.client_updated_at) continue
        rows.set(key, { ...r, server_updated_at: stamp() })
      }
    },
    async fetch(collection, ids) {
      net()
      return ids.map((id) => rows.get(`${collection}:${id}`)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    },
    async pullSince(cursor, limit) {
      net()
      return [...rows.values()].filter((r) => !cursor || r.server_updated_at > cursor).sort((a, b) => (a.server_updated_at < b.server_updated_at ? -1 : 1)).slice(0, limit)
    },
    async saveSettings(data, updatedAt) {
      net()
      if (!settings || settings.updatedAt <= updatedAt) settings = { data, updatedAt }
    },
    async loadSettings() {
      net()
      return settings
    },
  }
  return { api, rows, state }
}

const at = (h: number) => `2026-10-15T${String(h).padStart(2, '0')}:00:00.000Z`
const plan = (p: Partial<LifePlan>, when = at(9)): LifePlan => ({ id: 'p1', createdAt: at(8), updatedAt: when, kind: 'objective', title: 'Aprender inglês', description: '', category: 'language', startDate: '2026-10-15', deadline: '', status: 'active', notes: '', ...p })
const step = (id: string, order: number, p: Partial<PlanStep> = {}, when = at(9)): PlanStep => ({ id, createdAt: at(8), updatedAt: when, planId: 'p1', title: id, deadline: '', status: 'todo', doneAt: null, order, notes: '', ...p })

describe('projetos pessoais e objetivos: offline e sincronização', () => {
  it('criar, editar, concluir etapa e reordenar offline; sobe ao reconectar sem duplicar', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('life-u1', server.api, { autoSync: false })
    await phone.load()
    server.state.offline = true
    await phone.put('lifePlans', plan({}))
    for (const [i, id] of ['basico', 'cursoA', 'conversar'].entries()) await phone.put('planSteps', step(id, i))
    await phone.put('lifePlans', plan({ title: 'Inglês fluente' }, at(10)))
    await phone.put('planSteps', step('basico', 0, { status: 'done', doneAt: at(10) }, at(10)))
    const steps = (await phone.load()).data.planSteps
    for (const s of moveStep(steps, 'p1', 'conversar', -1)) await phone.put('planSteps', { ...s, updatedAt: at(11) })
    await phone.flush().catch(() => {})
    expect(server.rows.size).toBe(0)
    server.state.offline = false
    await phone.flush()
    expect(await phone.pendingCount()).toBe(0)
    expect([...server.rows.keys()].filter((k) => k.startsWith('lifePlans')).length).toBe(1)
    expect([...server.rows.keys()].filter((k) => k.startsWith('planSteps')).length).toBe(3)
    expect(server.rows.get('lifePlans:p1')!.data).toMatchObject({ title: 'Inglês fluente' })
    const pc = createSyncedRepository('life-u1-pc', server.api, { autoSync: false })
    const remote = (await pc.load()).data
    expect(stepsOf(remote.planSteps, 'p1').map((s) => s.id)).toEqual(['basico', 'conversar', 'cursoA'])
    expect(planProgress(remote.lifePlans[0], remote.planSteps, []).percent).toBe(33)
  })

  it('celular conclui uma etapa e computador edita o título: as duas mudanças ficam', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('life-u2-phone', server.api, { autoSync: false })
    await phone.load()
    await phone.put('lifePlans', plan({}))
    await phone.put('planSteps', step('basico', 0))
    await phone.flush()
    const pc = createSyncedRepository('life-u2-pc', server.api, { autoSync: false })
    await pc.load()
    await phone.put('planSteps', step('basico', 0, { status: 'done', doneAt: at(10) }, at(10)))
    await pc.put('lifePlans', plan({ title: 'Inglês para o trabalho' }, at(11)))
    await phone.flush()
    await pc.flush()
    await phone.pull()
    await pc.pull()
    for (const repo of [phone, pc]) {
      const d = (await repo.load()).data
      expect(d.lifePlans[0].title).toBe('Inglês para o trabalho')
      expect(d.planSteps[0].status).toBe('done')
    }
  })

  it('objetivo → projeto pessoal no mesmo registro: o outro aparelho recebe a conversão e as etapas continuam ligadas', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('life-u3-phone', server.api, { autoSync: false })
    await phone.load()
    await phone.put('lifePlans', plan({}))
    await phone.put('planSteps', step('basico', 0, { status: 'done', doneAt: at(9) }))
    await phone.put('lifePlans', { ...convertToProject(plan({}), 'Curso de inglês', new Date(at(10))), updatedAt: at(10) })
    await phone.flush()
    const pc = createSyncedRepository('life-u3-pc', server.api, { autoSync: false })
    const d = (await pc.load()).data
    expect(d.lifePlans).toHaveLength(1)
    expect(d.lifePlans[0]).toMatchObject({ id: 'p1', kind: 'project', convertedFrom: 'objective', title: 'Curso de inglês' })
    expect(d.planSteps[0].planId).toBe('p1')
  })
})
