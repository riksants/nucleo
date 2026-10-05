import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { restoreBackup } from '../src/data/store'
import { createSyncedRepository, mergeSettings, type RemoteApi, type RemoteRow } from '../src/data/sync'
import type { Settings, VaultMeta } from '../src/data/types'

/** In-memory server with the same rules as the SQL: stale writes (older client_updated_at) are ignored. */
function fakeServer() {
  const rows = new Map<string, RemoteRow & { server_updated_at: string }>()
  let settings: { data: Settings; updatedAt: string } | null = null
  let clock = 0
  const api: RemoteApi = {
    async upsert(list) {
      for (const r of list) {
        const old = rows.get(`${r.collection}:${r.id}`)
        if (old && r.client_updated_at < old.client_updated_at) continue
        rows.set(`${r.collection}:${r.id}`, { ...r, server_updated_at: new Date(Date.UTC(2026, 9, 1) + ++clock * 1000).toISOString() })
      }
    },
    async fetch(collection, ids) {
      return ids.map((id) => rows.get(`${collection}:${id}`)).filter((x): x is NonNullable<typeof x> => Boolean(x))
    },
    async pullSince(cursor, limit) {
      return [...rows.values()].filter((r) => !cursor || r.server_updated_at > cursor).sort((a, b) => (a.server_updated_at < b.server_updated_at ? -1 : 1)).slice(0, limit)
    },
    async saveSettings(data, updatedAt) {
      if (!settings || settings.updatedAt <= updatedAt) settings = { data, updatedAt }
    },
    async loadSettings() {
      return settings
    },
  }
  return { api, settings: () => settings, rows }
}

const at = (day: number) => new Date(Date.UTC(2026, 9, day)).toISOString()
const base = { onboarded: true, baseCurrency: 'BRL', initialBalance: 0, startedAt: at(1), rates: null, manualRates: {}, lastBackupAt: null, updatedAt: at(1) } as Settings
const vault = { v: 1, kdf: 'PBKDF2-SHA256', createdAt: at(2), autoLockMin: 5 } as unknown as VaultMeta
let n = 0
const device = (api: RemoteApi) => createSyncedRepository(`merge-${++n}`, api, { autoSync: false })

describe('configurações entre aparelhos', () => {
  it('aparelho desatualizado que atualiza as cotações não apaga o cofre criado em outro', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    const laptop = device(s.api)
    await phone.saveSettings(base)
    await phone.flush()
    await laptop.load()

    await phone.saveSettings({ ...base, vault, updatedAt: at(2) }, ['vault'])
    await phone.flush()

    // The laptop still has the old settings in memory and refreshes the rates (only "rates" changed).
    await laptop.saveSettings({ ...base, rates: { base: 'USD', values: {}, fetchedAt: at(3) } as never, updatedAt: at(3) }, ['rates'])
    await laptop.syncNow!()

    expect(s.settings()!.data.vault).toEqual(vault)
    expect(s.settings()!.data.rates).toBeTruthy()
    // The laptop now has the vault too (the screen reloads it).
    const local = (await laptop.load()).settings!
    expect(local.vault).toEqual(vault)
    expect(local.rates).toBeTruthy()
  })

  it('mudanças em configurações diferentes nos dois aparelhos ficam as duas', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    const laptop = device(s.api)
    await phone.saveSettings(base)
    await phone.flush()
    await laptop.load()

    await phone.saveSettings({ ...base, tabs: ['sales'], updatedAt: at(2) }, ['tabs'])
    await phone.flush()
    await laptop.saveSettings({ ...base, modules: { meals: true }, updatedAt: at(3) }, ['modules'])
    await laptop.flush()
    await phone.pull()

    expect(s.settings()!.data.tabs).toEqual(['sales'])
    expect(s.settings()!.data.modules).toEqual({ meals: true })
    expect((await phone.load()).settings!.modules).toEqual({ meals: true })
  })

  it('a mesma configuração mudada nos dois: vale a última', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    const laptop = device(s.api)
    await phone.saveSettings(base)
    await phone.flush()
    await laptop.load()
    await phone.saveSettings({ ...base, tabs: ['sales'], updatedAt: at(2) }, ['tabs'])
    await phone.flush()
    await laptop.saveSettings({ ...base, tabs: ['notes'], updatedAt: at(3) }, ['tabs'])
    await laptop.flush()
    expect(s.settings()!.data.tabs).toEqual(['notes'])
  })

  it('tirar uma configuração (ex.: escolha da barra) também vale', () => {
    const merged = mergeSettings({ ...base, updatedAt: at(5) }, ['tabs'], { data: { ...base, tabs: ['sales'], vault }, updatedAt: at(4) })
    expect('tabs' in merged).toBe(false)
    expect(merged.vault).toEqual(vault)
  })

  it('carimbo sempre mais novo que o do servidor (relógio do aparelho atrasado)', () => {
    const merged = mergeSettings({ ...base, updatedAt: at(1) }, ['tabs'], { data: base, updatedAt: at(4) })
    expect(merged.updatedAt! > at(4)).toBe(true)
  })

  it('várias edições antes de enviar: todas as chaves alteradas vão', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    const laptop = device(s.api)
    await phone.saveSettings(base)
    await phone.flush()
    await laptop.load()
    await phone.saveSettings({ ...base, vault, updatedAt: at(2) }, ['vault'])
    await phone.flush()
    await laptop.saveSettings({ ...base, tabs: ['notes'], updatedAt: at(3) }, ['tabs'])
    await laptop.saveSettings({ ...base, tabs: ['notes'], hideScore: true, updatedAt: at(4) }, ['hideScore'])
    await laptop.flush()
    expect(s.settings()!.data).toMatchObject({ tabs: ['notes'], hideScore: true, vault })
  })

  it('sem lista de chaves (versão anterior do app): o aparelho envia tudo, como antes', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    await phone.saveSettings({ ...base, tabs: ['sales'], updatedAt: at(2) })
    await phone.flush()
    await phone.saveSettings({ ...base, updatedAt: at(3) })
    await phone.flush()
    expect(s.settings()!.data.tabs).toBeUndefined()
  })

  it('configuração mudada durante o download não é sobrescrita pela da nuvem', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    const laptop = device(s.api)
    await phone.saveSettings(base)
    await phone.flush()
    await laptop.load()
    await phone.saveSettings({ ...base, vault, updatedAt: at(2) }, ['vault'])
    await phone.flush()
    await laptop.saveSettings({ ...base, tabs: ['notes'], updatedAt: at(3) }, ['tabs'])
    expect(await laptop.pull()).toBe(false)
    expect((await laptop.load()).settings!.tabs).toEqual(['notes'])
    await laptop.flush()
    expect(s.settings()!.data).toMatchObject({ tabs: ['notes'], vault })
  })
})

describe('restaurar backup com a conta conectada', () => {
  it('o backup antigo substitui de verdade (registros e configurações)', async () => {
    const s = fakeServer()
    const phone = device(s.api)
    await phone.load()
    await phone.put('notes', { id: 'n1', title: 'Editada depois do backup', body: '', pinned: false, createdAt: at(1), updatedAt: at(5) } as never)
    await phone.saveSettings({ ...base, tabs: ['sales'], updatedAt: at(5) }, ['tabs'])
    await phone.flush()

    const backup = { notes: [{ id: 'n1', title: 'Do backup', body: '', pinned: false, createdAt: at(1), updatedAt: at(2) }] }
    const restored = restoreBackup(backup as never, { ...base, tabs: ['notes'], updatedAt: at(2) }, at(9))
    await phone.bulkWrite(restored.data, restored.settings, true)
    await phone.flush()
    await phone.pull()

    const { data, settings } = await phone.load()
    expect((data.notes[0] as { title: string }).title).toBe('Do backup')
    expect(settings!.tabs).toEqual(['notes'])
    expect((s.rows.get('notes:n1')!.data as { title: string }).title).toBe('Do backup')
    expect(s.settings()!.data.tabs).toEqual(['notes'])
  })

  it('restaurar marca tudo como a versão mais nova e sempre conclui o início do app', () => {
    const r = restoreBackup({ tasks: [{ id: 't', createdAt: at(1), updatedAt: at(1) }] } as never, { ...base, onboarded: false }, at(9))
    expect(r.data.tasks[0].updatedAt).toBe(at(9))
    expect(r.data.tasks[0].createdAt).toBe(at(1))
    expect(r.settings).toMatchObject({ onboarded: true, updatedAt: at(9) })
    expect(restoreBackup({}, null, at(9)).settings).toBeNull()
  })
})
