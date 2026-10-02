import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createSyncedRepository, isRowRejection, PAGE, RejectedRowError, type RemoteApi, type RemoteRow } from '../src/data/sync'
import type { Note, Settings, Task } from '../src/data/types'

/** In-memory server with the SQL rules: per user, stale writes ignored. `offline` simulates no network. */
function fakeServer() {
  const rows = new Map<string, RemoteRow & { server_updated_at: string }>()
  let settings: { data: Settings; updatedAt: string } | null = null
  let clock = 0
  const state = { offline: false }
  const net = () => {
    if (state.offline) throw new TypeError('Failed to fetch')
  }
  const stamp = () => new Date(Date.UTC(2026, 9, 5) + ++clock * 1000).toISOString()
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

const note = (id: string, p: Partial<Note> = {}, when = '2026-10-02T10:00:00.000Z'): Note => ({ id, createdAt: when, updatedAt: when, title: id, body: '', pinned: false, ...p })

/** Rows straight into the server, `gapMs` apart (a bulk migration/import writes them within milliseconds). */
function seed(server: ReturnType<typeof fakeServer>, n: number, gapMs: number, start = Date.UTC(2026, 9, 1)) {
  for (let i = 0; i < n; i++) {
    const id = `n${String(i).padStart(5, '0')}`
    server.rows.set(`notes:${id}`, { collection: 'notes', id, data: note(id), deleted: false, client_updated_at: '2026-10-01T00:00:00.000Z', server_updated_at: new Date(start + Math.floor(i * gapMs)).toISOString() })
  }
}

function counting(api: RemoteApi, max = 60) {
  const calls = { pull: 0 }
  const wrapped: RemoteApi = {
    ...api,
    async pullSince(c, l) {
      if (++calls.pull > max) throw new Error('laço: chamadas demais')
      return api.pullSince(c, l)
    },
  }
  return { calls, api: wrapped }
}

describe('download (pull) sem laço infinito', () => {
  it('1.500 registros gravados em 1,5 s: termina, baixa tudo, poucas chamadas', async () => {
    const server = fakeServer()
    seed(server, 1500, 1)
    const c = counting(server.api)
    const repo = createSyncedRepository('rob-1', c.api, { autoSync: false })
    expect((await repo.load()).data.notes).toHaveLength(1500)
    expect(c.calls.pull).toBeLessThanOrEqual(3)
  })

  it('5.000 registros no mesmo segundo (vários por milissegundo): baixa todos, sem repetir páginas sem fim', async () => {
    const server = fakeServer()
    seed(server, 5000, 0.1)
    const c = counting(server.api)
    const repo = createSyncedRepository('rob-2', c.api, { autoSync: false })
    expect((await repo.load()).data.notes).toHaveLength(5000)
    expect(c.calls.pull).toBeLessThanOrEqual(8)
  })

  it('registros com o mesmo horário na virada da página não são perdidos', async () => {
    const server = fakeServer()
    seed(server, PAGE - 2, 10)
    const t = new Date(Date.UTC(2026, 9, 1) + (PAGE - 2) * 10).toISOString()
    for (let i = 0; i < 6; i++) server.rows.set(`notes:tie${i}`, { collection: 'notes', id: `tie${i}`, data: note(`tie${i}`), deleted: false, client_updated_at: '2026-10-01T00:00:00.000Z', server_updated_at: t })
    const repo = createSyncedRepository('rob-3', server.api, { autoSync: false })
    expect((await repo.load()).data.notes).toHaveLength(PAGE - 2 + 6)
  })

  it('a margem de 5 s continua valendo no início do download seguinte (gravação que chegou atrasada)', async () => {
    const server = fakeServer()
    seed(server, 3, 1000)
    const repo = createSyncedRepository('rob-4', server.api, { autoSync: false })
    await repo.load()
    // A commit that finished late: stamped 2 s before the device's cursor.
    server.rows.set('notes:late', { collection: 'notes', id: 'late', data: note('late'), deleted: false, client_updated_at: '2026-10-01T00:00:00.000Z', server_updated_at: new Date(Date.UTC(2026, 9, 1)).toISOString() })
    await repo.pull()
    expect((await repo.load()).data.notes.map((n) => n.id)).toContain('late')
  })
})

describe('um registro recusado não trava a sincronização', () => {
  /** Server that refuses notes with body "GRANDE" (like records_data_size), the way Supabase does. */
  function picky() {
    const server = fakeServer()
    const upsert = server.api.upsert
    server.api.upsert = async (list) => {
      if (list.some((r) => (r.data as Note | null)?.body === 'GRANDE')) throw new RejectedRowError('new row for relation "records" violates check constraint "records_data_size"')
      return upsert(list)
    }
    return server
  }
  const task = (id: string): Task => ({ id, createdAt: '2026-10-02T10:00:00.000Z', updatedAt: '2026-10-02T10:00:00.000Z', title: id, projectId: null, dueDate: '', priority: 'none', status: 'todo', completedAt: null })

  it('o resto sobe; o recusado fica guardado no aparelho, marcado, e não é reenviado sem mudança', async () => {
    const server = picky()
    let upserts = 0
    const inner = server.api.upsert
    server.api.upsert = async (list) => (upserts++, inner(list))
    const repo = createSyncedRepository('rob-5', server.api, { autoSync: false })
    await repo.load()
    await repo.put('notes', note('ok1'))
    await repo.put('notes', note('ruim', { body: 'GRANDE' }))
    await repo.put('notes', note('ok2'))
    await repo.put('tasks', task('t1'))
    await repo.flush()
    expect([...server.rows.keys()].sort()).toEqual(['notes:ok1', 'notes:ok2', 'tasks:t1'])
    expect(await repo.pendingCount()).toBe(1) // ainda na fila do aparelho
    expect((await repo.load()).data.notes.find((n) => n.id === 'ruim')?.body).toBe('GRANDE') // não sumiu
    const before = upserts
    await repo.flush()
    expect(upserts).toBe(before) // não fica tentando o mesmo envio recusado
  })

  it('o download não sobrescreve a versão local recusada; editar envia de novo', async () => {
    const server = picky()
    const repo = createSyncedRepository('rob-6', server.api, { autoSync: false })
    await repo.load()
    await repo.put('notes', note('x', { body: 'pequeno' }, '2026-10-02T09:00:00.000Z'))
    await repo.flush()
    await repo.put('notes', note('x', { body: 'GRANDE' }, '2026-10-02T10:00:00.000Z'))
    await repo.flush()
    await repo.pull()
    expect((await repo.load()).data.notes.find((n) => n.id === 'x')?.body).toBe('GRANDE')
    await repo.put('notes', note('x', { body: 'reduzido' }, '2026-10-02T11:00:00.000Z'))
    await repo.flush()
    expect(await repo.pendingCount()).toBe(0)
    expect((server.rows.get('notes:x')!.data as Note).body).toBe('reduzido')
  })

  it('outro aparelho continua recebendo o resto normalmente', async () => {
    const server = picky()
    const phone = createSyncedRepository('rob-8-phone', server.api, { autoSync: false })
    await phone.load()
    await phone.put('notes', note('boa'))
    await phone.put('notes', note('ruim', { body: 'GRANDE' }))
    await phone.flush()
    const pc = createSyncedRepository('rob-8-pc', server.api, { autoSync: false })
    expect((await pc.load()).data.notes.map((n) => n.id)).toEqual(['boa'])
  })

  it('falha de rede continua sendo "tentar depois" (nada é marcado como recusado)', async () => {
    const server = fakeServer()
    const repo = createSyncedRepository('rob-7', server.api, { autoSync: false })
    await repo.load()
    server.state.offline = true
    await repo.put('notes', note('a'))
    await expect(repo.flush()).rejects.toThrow()
    server.state.offline = false
    await repo.flush()
    expect(server.rows.has('notes:a')).toBe(true)
    expect(await repo.pendingCount()).toBe(0)
  })

  it('classifica corretamente o que é recusa definitiva', () => {
    expect(isRowRejection({ code: '23514', message: 'violates check constraint "records_data_size"' })).toBe(true)
    expect(isRowRejection({ code: '22001', message: 'value too long' })).toBe(true)
    expect(isRowRejection({ message: 'Payload too large' })).toBe(true)
    expect(isRowRejection({ message: 'x' }, 413)).toBe(true)
    expect(isRowRejection({ code: 'PGRST301', message: 'JWT expired' })).toBe(false)
    expect(isRowRejection({ message: 'Failed to fetch' })).toBe(false)
    expect(isRowRejection({ code: '42501', message: 'new row violates row-level security policy' })).toBe(false)
  })
})
