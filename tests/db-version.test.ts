import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { DB_VERSION, openDatabase } from '../src/data/repository'
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
