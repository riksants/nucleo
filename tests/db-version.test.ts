import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { isEnabled } from '../src/app/modules'
import { primarySections, secondarySections } from '../src/app/sections'
import { databaseHandle, DatabaseBlockedError, DB_VERSION, openDatabase } from '../src/data/repository'
import { COLLECTION_NAMES } from '../src/data/types'

/**
 * Guard: the device database only creates new stores when its version goes up.
 * Adding a collection without bumping DB_VERSION would leave existing users
 * without that store (the app would fail to load). Keep this table in sync.
 */
const VERSION_FOR_COLLECTION_COUNT: Record<number, number> = { 9: 1, 16: 2, 22: 3, 26: 4, 27: 5, 29: 6, 31: 7 }

describe('versão do banco no aparelho', () => {
  it('cada conjunto de coleções tem a sua versão (não esquecer de aumentar)', () => {
    expect(VERSION_FOR_COLLECTION_COUNT[COLLECTION_NAMES.length]).toBe(DB_VERSION)
  })

  it('banco da versão anterior (Etapa 1) ganha as coleções novas sem perder dados', async () => {
    const etapa1 = COLLECTION_NAMES.slice(0, 22)
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('upgrade-test', 3)
      req.onupgradeneeded = () => {
        const db = req.result
        for (const n of etapa1) db.createObjectStore(n, { keyPath: 'id' })
        db.createObjectStore('meta')
        db.createObjectStore('outbox', { keyPath: 'key' })
      }
      req.onsuccess = () => {
        const tx = req.result.transaction('habits', 'readwrite')
        tx.objectStore('habits').put({ id: 'h1', name: 'Água' })
        tx.oncomplete = () => (req.result.close(), resolve())
      }
    })
    const db = await openDatabase('upgrade-test')
    expect(db.version).toBe(DB_VERSION)
    for (const n of COLLECTION_NAMES) expect(db.objectStoreNames.contains(n)).toBe(true)
    const kept = await new Promise((r) => (db.transaction('habits').objectStore('habits').get('h1').onsuccess = (e) => r((e.target as IDBRequest).result)))
    expect(kept).toEqual({ id: 'h1', name: 'Água' })
    db.close()
  })
})

describe('atualização do app com outra aba aberta', () => {
  const rawOpen = (name: string, version: number) =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, version)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

  it('a aba com a versão atual libera o banco quando uma versão nova precisa atualizá-lo', async () => {
    const open = await openDatabase('vc-test')
    const newer = await rawOpen('vc-test', DB_VERSION + 1)
    expect(newer.version).toBe(DB_VERSION + 1)
    expect(() => open.transaction('meta')).toThrow()
    newer.close()
  })

  it('apagar o banco (sair da conta) só fecha a conexão', async () => {
    await openDatabase('del-test')
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase('del-test')
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  })

  it('versão antiga sem esse cuidado segurando o banco: aviso em vez de tela em branco, e abre depois', async () => {
    const old = await rawOpen('blocked-test', 1)
    const handle = databaseHandle('blocked-test')
    await expect(handle.get()).rejects.toBeInstanceOf(DatabaseBlockedError)
    // Trying again in the same page doesn't queue another open behind the waiting one.
    await expect(handle.get()).rejects.toBeInstanceOf(DatabaseBlockedError)
    old.close()
    await new Promise((r) => setTimeout(r, 50))
    // After the reload (a new page), the database opens and is upgraded normally.
    const db = await openDatabase('blocked-test')
    expect(db.version).toBe(DB_VERSION)
    expect(db.objectStoreNames.contains('meta')).toBe(true)
    db.close()
  })
})

describe('seção desconhecida (configurações de uma versão mais nova)', () => {
  it('fica desligada aqui em vez de derrubar o app', () => {
    const settings = { modules: { novaSecao: true, sales: true } as never, tabs: ['novaSecao', 'sales'] as never }
    expect(isEnabled(settings, 'novaSecao' as never)).toBe(false)
    expect(primarySections(settings).map((s) => s.label)).toEqual(['Início', 'Vendas'])
    expect(secondarySections(settings).some((s) => !s)).toBe(false)
  })
})
