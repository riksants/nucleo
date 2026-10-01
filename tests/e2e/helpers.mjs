// Shared helpers for browser tests. Builds used here never point at the real Supabase project.
export const BASE = process.env.E2E_BASE || 'http://localhost:4317/nucleo/'

export function reporter() {
  const results = []
  return {
    results,
    check(name, ok, extra = '') {
      results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`)
    },
    print(b) {
      console.log(results.join('\n'))
      const failed = results.filter((r) => !r.startsWith('PASS')).length
      console.log(`\n${results.length - failed}/${results.length} ok`)
      if (b?.logs.length) console.log('Console:\n' + b.logs.slice(0, 15).join('\n'))
      return failed
    },
  }
}

/** Reads one record (or all) from the device database. */
export function idb(b, store, id) {
  return b.eval(`new Promise(r => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const s = q.result.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}); const g = ${id ? `s.get(${JSON.stringify(id)})` : 's.getAll()'}; g.onsuccess = () => { q.result.close(); r(g.result ?? null) } } })`)
}

/** Sets an input/textarea value the way React expects. */
export function setValue(b, selector, value) {
  return b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
}

/**
 * A person who used the app before Etapa 1: database v2 with the 16 stores,
 * sections reviewed once. `extra` lets a test add records.
 */
export async function seedExistingUser(b, extra = {}, settings = {}) {
  await b.goto(BASE + 'favicon.svg')
  await b.eval(`new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('seed timeout')), 15000)
    const v2 = ['transactions','goals','clients','projects','tasks','tools','accounts','notes','portfolio','sales','offerings','subPlans','subscribers','plannerProfiles','routinePlans','mealPlans']
    const v3 = ['inbox','habits','recurring','completions','events','focusSessions']
    // Records of the new collections only exist after the app upgraded the database to v3.
    const upgraded = Object.keys(${JSON.stringify(extra)}).some((n) => v3.includes(n))
    const names = upgraded ? [...v2, ...v3] : v2
    const req = indexedDB.open('nucleo', upgraded ? 3 : 2)
    req.onupgradeneeded = () => { const db = req.result; for (const n of names) db.createObjectStore(n, { keyPath: 'id' }); db.createObjectStore('meta'); db.createObjectStore('outbox', { keyPath: 'key' }) }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction([...names, 'meta'], 'readwrite')
      const now = new Date().toISOString()
      tx.objectStore('meta').put(Object.assign({ onboarded: true, modulesReviewed: true, baseCurrency: 'EUR', initialBalance: 100000, startedAt: now, rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'America/Sao_Paulo' }, ${JSON.stringify(settings)}), 'settings')
      const extra = ${JSON.stringify(extra)}
      for (const [store, items] of Object.entries(extra)) for (const it of items) tx.objectStore(store).put(Object.assign({ createdAt: now, updatedAt: now }, it))
      tx.oncomplete = () => { db.close(); resolve(true) }
      tx.onerror = () => reject(tx.error)
    }
  })`)
}

export async function noHorizontalScroll(b) {
  return !(await b.eval(`document.documentElement.scrollWidth > document.documentElement.clientWidth + 1`))
}
