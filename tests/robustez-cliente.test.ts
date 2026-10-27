/**
 * Etapa 5 (audit A6, M7, M8, B1, B2): what comes from outside the app's own code — a backup file,
 * another device, a malformed row — never breaks the screens or the sync.
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { isStorableEntity, normalizeSettings } from '../src/data/normalize'
import { mergeImport } from '../src/data/store'
import { createSyncedRepository, type RemoteApi, type RemoteRow } from '../src/data/sync'
import { COLLECTION_NAMES, type DataState, type Note } from '../src/data/types'
import { parseBackup } from '../src/lib/backup'
import { normalizeUrl, safeImage } from '../src/lib/links'
import { effectiveRates } from '../src/lib/rates'
import { createVault, unlockWithPassword } from '../src/lib/vault'

const note = (id: string, when = '2026-10-02T10:00:00.000Z'): Note => ({ id, createdAt: when, updatedAt: when, title: id, body: '', pinned: false })
const empty = () => Object.fromEntries(COLLECTION_NAMES.map((n) => [n, []])) as unknown as DataState

describe('configurações malformadas (A6)', () => {
  it('valores com o tipo errado voltam ao padrão em vez de derrubar a tela', () => {
    const s = normalizeSettings({ baseCurrency: 'EUR', initialBalance: '10', manualRates: null, rates: { values: 'x' }, onboarded: 'sim', lastBackupAt: 5 })
    expect(s.baseCurrency).toBe('EUR')
    expect(s.initialBalance).toBe(0)
    expect(s.manualRates).toEqual({})
    expect(s.rates).toBeNull()
    expect(s.onboarded).toBe(false)
    expect(s.lastBackupAt).toBeNull()
    // The screens that crashed on these values (A6) now work.
    expect(() => effectiveRates(s)).not.toThrow()
  })

  it('opcionais inválidos saem; listas ficam só com os itens válidos', () => {
    const s = normalizeSettings({
      baseCurrency: 'XYZ1',
      tabs: ['finance', 3, null],
      currencies: ['USD', 'nope', 7],
      modules: { finance: true, notes: 'yes' },
      timeZone: 'Marte/Base',
      activeHours: { start: '7h', end: '22:00' },
      reminders: { rules: { tasks: null, routine: { enabled: true } }, showDetails: 'x' },
      mealTypes: [{ id: 'a', label: 'Café', active: true }, { id: 2 }],
      financeCategories: { custom: [{ id: 'c', label: 'Casa', type: 'out' }, { id: 'x' }], hidden: 'nada' },
      automations: { toolCharge: { on: true, since: '2026-10-01' }, goalSave: 'on' },
    })
    expect(s.baseCurrency).toBe('BRL')
    expect(s.tabs).toEqual(['finance'])
    expect(s.currencies).toEqual(['USD'])
    expect(s.modules).toEqual({ finance: true })
    expect(s.timeZone).toBeUndefined()
    expect(s.activeHours).toBeUndefined()
    expect(s.reminders).toEqual({ showDetails: false, rules: { routine: { enabled: true } } })
    expect(s.mealTypes).toEqual([{ id: 'a', label: 'Café', active: true }])
    expect(s.financeCategories).toEqual({ custom: [{ id: 'c', label: 'Casa', type: 'out' }], hidden: [] })
    expect(s.automations).toEqual({ toolCharge: { on: true, since: '2026-10-01' } })
  })

  it('o que já está certo não muda, e campos de versões mais novas são mantidos', () => {
    const good = { onboarded: true, baseCurrency: 'EUR', initialBalance: 1200, startedAt: '2026-10-01', rates: { values: { EUR: 1, BRL: 6.2 }, fetchedAt: 'x', source: 'y' }, manualRates: { USD: 1.1 }, lastBackupAt: null, tabs: ['finance'], futureField: { a: 1 }, updatedAt: '2026-10-02T00:00:00.000Z' }
    expect(normalizeSettings(good)).toEqual(good)
  })

  it('o cofre nunca é descartado (sem ele as senhas ficariam inacessíveis)', () => {
    const vault = { v: 1, broken: true }
    expect(normalizeSettings({ vault }).vault).toEqual(vault)
    expect(normalizeSettings({ vault: 'texto' }).vault).toBeUndefined()
  })

  it('não é objeto: tudo no padrão', () => {
    expect(normalizeSettings(null).baseCurrency).toBe('BRL')
    expect(normalizeSettings([1, 2]).manualRates).toEqual({})
  })
})

describe('cofre com dados absurdos (A6)', () => {
  it('quantidade de iterações fora do normal é recusada com mensagem clara (não trava o aparelho)', async () => {
    const { meta } = await createVault('senha-forte-1', false)
    const absurd = { ...meta, byPassword: { ...meta.byPassword, iterations: 2_000_000_000 } }
    await expect(unlockWithPassword(absurd, 'senha-forte-1')).rejects.toThrow(/danificados/)
    const tiny = { ...meta, byPassword: { ...meta.byPassword, iterations: 1 } }
    await expect(unlockWithPassword(tiny, 'senha-forte-1')).rejects.toThrow(/danificados/)
  }, 60_000)
})

describe('sincronização com uma linha malformada no servidor (A6)', () => {
  it('a linha ruim é ignorada e o resto do download continua (o cursor não trava)', async () => {
    const rows: RemoteRow[] = [
      { collection: 'notes', id: 'ok1', data: note('ok1'), deleted: false, client_updated_at: '2026-10-02T10:00:00.000Z', server_updated_at: '2026-10-05T00:00:01.000Z' },
      { collection: 'notes', id: 'bad', data: { title: 'sem id' } as never, deleted: false, client_updated_at: '2026-10-02T10:00:00.000Z', server_updated_at: '2026-10-05T00:00:02.000Z' },
      { collection: 'notes', id: 'other', data: note('outro-id'), deleted: false, client_updated_at: '2026-10-02T10:00:00.000Z', server_updated_at: '2026-10-05T00:00:03.000Z' },
      { collection: 'notes', id: 'ok2', data: note('ok2'), deleted: false, client_updated_at: '2026-10-02T10:00:00.000Z', server_updated_at: '2026-10-05T00:00:04.000Z' },
    ]
    const remote: RemoteApi = {
      upsert: async () => {},
      fetch: async () => [],
      pullSince: async (cursor) => rows.filter((r) => !cursor || r.server_updated_at! > cursor),
      saveSettings: async () => {},
      loadSettings: async () => null,
    }
    const repo = createSyncedRepository(`bad-row-${Date.now()}`, remote, { autoSync: false })
    const { data } = await repo.load()
    expect(data.notes.map((n) => n.id).sort()).toEqual(['ok1', 'ok2'])
    repo.dispose?.()
  })

  it('isStorableEntity exige objeto com o mesmo id', () => {
    expect(isStorableEntity(note('a'), 'a')).toBe(true)
    expect(isStorableEntity(note('a'), 'b')).toBe(false)
    expect(isStorableEntity('texto', 'a')).toBe(false)
    expect(isStorableEntity(null, 'a')).toBe(false)
  })
})

describe('backup importado (A6, M7)', () => {
  const file = (data: unknown, settings?: unknown) => JSON.stringify({ app: 'nucleo', version: 1, exportedAt: 'x', settings, data })

  it('item sem data de alteração recebe a de criação (o servidor recusaria sem ela)', () => {
    const parsed = parseBackup(file({ notes: [{ id: 'n1', createdAt: '2026-10-01T00:00:00.000Z', title: 'x' }] }))
    expect(parsed.data.notes![0].updatedAt).toBe('2026-10-01T00:00:00.000Z')
  })

  it('configurações do arquivo passam pela mesma checagem', () => {
    const parsed = parseBackup(file({}, { baseCurrency: 'EUR', initialBalance: 0, manualRates: null, tabs: 'x' }))
    expect(parsed.settings!.manualRates).toEqual({})
    expect(parsed.settings!.tabs).toBeUndefined()
  })

  it('"mesclar" grava só o que o arquivo traz de novo, não o banco inteiro (M7)', () => {
    const current = { ...empty(), notes: [note('a', '2026-10-05T00:00:00.000Z'), note('b', '2026-10-01T00:00:00.000Z')] }
    const incoming = { notes: [note('a', '2026-10-01T00:00:00.000Z'), note('b', '2026-10-06T00:00:00.000Z'), note('c')] }
    const { data, changed } = mergeImport(current, incoming)
    expect(changed.notes!.map((n) => n.id)).toEqual(['b', 'c'])
    expect(Object.keys(changed)).toEqual(['notes'])
    expect(data.notes.find((n) => n.id === 'a')!.updatedAt).toBe('2026-10-05T00:00:00.000Z')
    expect(data.notes).toHaveLength(3)
  })
})

describe('links e imagens (B1, B2)', () => {
  it('só abre links da web, e-mail e telefone', () => {
    expect(normalizeUrl('site.com')).toBe('https://site.com')
    expect(normalizeUrl('http://site.com')).toBe('http://site.com')
    expect(normalizeUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(normalizeUrl('tel:+5511999')).toBe('tel:+5511999')
    expect(normalizeUrl('site.com:8080/x')).toBe('https://site.com:8080/x')
    expect(normalizeUrl('javascript:alert(1)')).not.toMatch(/^javascript:/i)
    expect(normalizeUrl('  JavaScript:alert(1)')).toMatch(/^https:\/\//)
    expect(normalizeUrl('data:text/html,<script>')).toMatch(/^https:\/\//)
    expect(normalizeUrl('')).toBe('')
  })

  it('imagem do portfólio só como foto do próprio aparelho', () => {
    expect(safeImage('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA')
    expect(safeImage('https://rastreador.example/pixel.gif')).toBeUndefined()
    expect(safeImage('data:image/svg+xml;base64,AAAA')).toBeUndefined()
    expect(safeImage(undefined)).toBeUndefined()
  })
})

describe('automações não param em silêncio (M1)', () => {
  it('itens recusados de vez não pausam as automações; o resto da fila pausa', async () => {
    const { syncAllowsAutomations, automationPause } = await import('../src/data/useAutomations')
    const base = { lastSyncAt: '2026-10-27T10:00:00.000Z', error: null }
    expect(syncAllowsAutomations(null)).toBe(true)
    expect(syncAllowsAutomations({ ...base, state: 'idle', pending: 0 })).toBe(true)
    // One image too large was refused; everything else synced.
    expect(syncAllowsAutomations({ ...base, state: 'error', pending: 1, rejected: 1, error: '1 item não pôde ser enviado' })).toBe(true)
    // Something of this device is still waiting to be sent, or the sync failed.
    expect(syncAllowsAutomations({ ...base, state: 'error', pending: 3, rejected: 1, error: 'x' })).toBe(false)
    expect(syncAllowsAutomations({ ...base, state: 'error', pending: 0, error: 'Failed to fetch' })).toBe(false)
    expect(automationPause({ ...base, state: 'error', pending: 0, error: 'Failed to fetch' })).toMatch(/pausadas.*Failed to fetch/)
    expect(automationPause({ ...base, state: 'offline', pending: 2 })).toMatch(/sem internet/)
    expect(automationPause({ ...base, state: 'syncing', pending: 2 })).toBeNull()
  })
})
