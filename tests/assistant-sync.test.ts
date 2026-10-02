import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { runIntent } from '../src/core/assistant/actions'
import { applyProposal, undoApplied, type ApplyIO } from '../src/core/assistant/proposal'
import { readIntent } from '../src/core/assistant/intents'
import type { Repository } from '../src/data/repository'
import { createSyncedRepository, type RemoteApi, type RemoteRow } from '../src/data/sync'
import type { CollectionName, DataState, Entity, Settings, Task } from '../src/data/types'

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

const settings = { onboarded: true, baseCurrency: 'BRL', initialBalance: 0, startedAt: '2026-07-01T12:00:00Z', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'America/Sao_Paulo', modules: { tasks: true } } as Settings
const NOW = new Date('2026-10-06T13:00:00Z') // terça 10:00 em SP
const task = (id: string, p: Partial<Task>): Task => ({ id, createdAt: '2026-10-01T12:00:00.000Z', updatedAt: '2026-10-01T12:00:00.000Z', title: id, projectId: null, dueDate: '', priority: 'none', status: 'todo', completedAt: null, ...p })

/** Same rules as the app's save: a normal save clears the mark; the Assistant sets it. */
async function ioFor(repo: Repository): Promise<{ io: ApplyIO; data: () => Promise<DataState> }> {
  let clock = Date.parse('2026-10-06T13:00:00.000Z')
  const data = async () => (await repo.load()).data
  let cache = await data()
  const io: ApplyIO = {
    async save(c, r, o) {
      const { changedBy, ...rest } = r
      const mark = o.by ?? (o.keepMark ? changedBy : undefined)
      const item = { ...rest, ...(mark ? { changedBy: mark } : {}), createdAt: r.createdAt ?? new Date(clock).toISOString(), updatedAt: new Date((clock += 1000)).toISOString() } as Entity
      await repo.put(c as never, item as never)
      cache = await data()
      return item
    },
    async remove(c, id) {
      await repo.remove(c as never, id)
      cache = await data()
    },
    current: (c, id) => (cache[c as CollectionName] as Entity[]).find((x) => x.id === id),
  }
  return { io, data }
}

describe('Assistente: mesmas regras de sincronização do app', () => {
  it('proposta aplicada offline (organizar semana) sobe ao reconectar, sem duplicar, marcada como do Assistente', async () => {
    const server = fakeServer()
    const phone = createSyncedRepository('as-u1', server.api, { autoSync: false })
    await phone.load()
    for (let i = 0; i < 5; i++) await phone.put('tasks', task(`sexta${i}`, { dueDate: '2026-10-09' }))
    await phone.flush()
    server.state.offline = true
    const { io, data } = await ioFor(phone)
    const reply = runIntent(readIntent('Organiza minha semana', '2026-10-06'), { data: await data(), settings, now: NOW })
    const p = reply.proposal!
    expect(p.changes.length).toBeGreaterThan(0)
    const applied = await applyProposal(p, new Set(p.changes.map((c) => c.id)), io)
    expect(server.rows.size).toBe(5) // nada saiu ainda
    server.state.offline = false
    await phone.flush()
    expect(await phone.pendingCount()).toBe(0)
    expect(server.rows.size).toBe(5) // mesmas tarefas, só com nova data
    const moved = [...server.rows.values()].filter((r) => (r.data as Task).dueDate !== '2026-10-09')
    expect(moved.length).toBe(applied.entries.length)
    expect(moved.every((r) => (r.data as Entity).changedBy === 'assistant')).toBe(true)
  })

  it('desfazer volta o que mudou; se a pessoa alterou depois, não sobrescreve', async () => {
    const server = fakeServer()
    const repo = createSyncedRepository('as-u2', server.api, { autoSync: false })
    await repo.load()
    await repo.put('tasks', task('a', { dueDate: '2026-10-09' }))
    await repo.put('tasks', task('b', { dueDate: '2026-10-09' }))
    const { io, data } = await ioFor(repo)
    const pa = runIntent(readIntent('move a tarefa a para quarta', '2026-10-06'), { data: await data(), settings, now: NOW }).proposal!
    const pb = runIntent(readIntent('move a tarefa b para quarta', '2026-10-06'), { data: await data(), settings, now: NOW }).proposal!
    const aa = await applyProposal(pa, new Set(pa.changes.map((c) => c.id)), io)
    const ab = await applyProposal(pb, new Set(pb.changes.map((c) => c.id)), io)
    // a pessoa mexe na tarefa b depois (edição normal limpa a marca)
    await io.save('tasks', { ...(io.current('tasks', 'b') as Task), title: 'b editada' } as never, {})
    expect(io.current('tasks', 'b')!.changedBy).toBeUndefined()
    expect(await undoApplied(aa, io)).toEqual({ restored: 1, skipped: 0 })
    expect(await undoApplied(ab, io)).toEqual({ restored: 0, skipped: 1 })
    const d = await data()
    expect(d.tasks.find((t) => t.id === 'a')).toMatchObject({ dueDate: '2026-10-09' })
    expect(d.tasks.find((t) => t.id === 'b')).toMatchObject({ dueDate: '2026-10-07', title: 'b editada' })
    await repo.flush()
    expect((server.rows.get('tasks:a')!.data as Task).dueDate).toBe('2026-10-09')
  })

  it('o Assistente só enxerga os dados do aparelho/conta em uso', async () => {
    const server = fakeServer()
    const ana = createSyncedRepository('as-ana', server.api, { autoSync: false })
    await ana.load()
    await ana.put('tasks', task('segredo', { title: 'Tarefa da Ana', dueDate: '2026-10-06' }))
    const bruno = createSyncedRepository('as-bruno', fakeServer().api, { autoSync: false }) // outra conta, outro servidor/linhas
    const d = (await bruno.load()).data
    const reply = runIntent(readIntent('O que tenho hoje?', '2026-10-06'), { data: d, settings, now: NOW })
    expect(JSON.stringify(reply)).not.toMatch(/Tarefa da Ana/)
  })
})
