// Etapa 5 data (meals, shopping list state, manual items) through the real sync code, two devices,
// offline and a second account — against the LOCAL mock of Supabase (tests/e2e/mock-supabase.mjs), never the real project.
// Needs a build made with VITE_SUPABASE_URL=http://localhost:54399 in dist-e2e-cloud.
import { spawn } from 'node:child_process'
import { launch } from './cdp.mjs'
import { reporter, setValue } from './helpers.mjs'

const BASE = 'http://localhost:4318/nucleo/'
const MOCK = 'http://localhost:54399'
const r = reporter()
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const procs = [spawn(process.execPath, ['tests/e2e/mock-supabase.mjs'], { stdio: 'ignore' }), spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist-e2e-cloud', '--port', '4318', '--strictPort'], { stdio: 'ignore' })]
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(BASE)).ok && (await fetch(MOCK + '/__state')).ok) break
  } catch {}
  await sleep(500)
}
const state = async () => (await fetch(MOCK + '/__state')).json()

async function signUp(b, email) {
  await b.goto(BASE)
  await b.click('Entrar ou criar conta')
  await b.click('Criar conta')
  await b.fill('E-mail', email)
  await b.fill('Senha', 'senha1234')
  await b.fill('Repita a senha', 'senha1234')
  await b.click('Criar conta', 'button[type=submit]')
  await b.sleep(800)
  await b.fill('Código do e-mail', '123456')
  await b.click('Confirmar', 'button[type=submit]')
  await b.sleep(2500)
  await b.click('Configurar minha conta')
  await b.click('Continuar')
  await b.click('Continuar')
  await b.click('Entrar')
  await b.sleep(1500)
}

async function signIn(b, email) {
  await b.goto(BASE)
  await b.click('Entrar ou criar conta')
  await b.fill('E-mail', email)
  await b.fill('Senha', 'senha1234')
  await b.click('Entrar', 'button[type=submit]')
  await b.sleep(3000)
}

async function syncNow(b) {
  await b.goto(BASE + '#/account')
  await b.click('Agora')
  await b.sleep(1500)
}

const choose = (b, selector, value) =>
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
const fillIn = (b, labelText, value) =>
  b.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.trim().startsWith(${JSON.stringify(labelText)})); const el = l && l.querySelector('input, textarea'); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)

const typeInto = (b, selector, value) =>
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)

async function enableMeals(b) {
  await b.goto(BASE + '#/settings')
  await b.click('Seções visíveis')
  await b.eval(`(() => { const sw = [...document.querySelectorAll('[role=dialog] [role=switch]')].find((x) => x.textContent.includes('Alimentação')); if (sw && sw.getAttribute('aria-checked') !== 'true') sw.click() })()`)
  await b.sleep(400)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await b.sleep(300)
}

const A = await launch(9389)
const B = await launch(9390)
const idbOf = (b, store) => b.eval(`new Promise(r => indexedDB.databases().then(list => { const name = list.map(d => d.name).find(n => n.startsWith('nucleo-u-')); const q = indexedDB.open(name); q.onsuccess = () => { const g = q.result.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).getAll(); g.onsuccess = () => { q.result.close(); r(g.result) } } }))`)
const rowChecked = (b, name) => b.eval(`[...document.querySelectorAll('[role=checkbox]')].find(c => c.textContent.startsWith(${JSON.stringify(name)}))?.getAttribute('aria-checked') ?? 'missing'`)
const rowText = (b, name) => b.eval(`[...document.querySelectorAll('[role=checkbox]')].find(c => c.textContent.startsWith(${JSON.stringify(name)}))?.textContent ?? ''`)
try {
  for (const b of [A, B]) {
    await b.mobile()
    await b.send('Network.enable')
    await b.send('Network.setBypassServiceWorker', { bypass: true })
  }
  await signUp(A, 'lu@teste.com')
  await enableMeals(A)
  let s = await state()
  const lu = s.users.find((u) => u.email === 'lu@teste.com').id

  // Offline: meal with ingredients, done, manual item, bought auto item
  await fetch(MOCK + '/__offline?v=1')
  await A.goto(BASE + '#/meals')
  await A.sleep(800)
  await A.click('Refeição', 'button')
  await A.click('Almoço', '[role=radio]')
  await fillIn(A, 'Ingredientes', '3 bananas\nArroz')
  await A.click('Adicionar', '[role=dialog] button[type=submit]')
  await A.sleep(400)
  await A.click('Marcar Almoço como realizada')
  await A.click('Lista de compras', '[role=radio]')
  await A.sleep(400)
  await typeInto(A, 'input[aria-label="Adicionar item à lista"]', 'Sabão')
  await A.click('Adicionar item')
  await A.click('Marcar Arroz')
  await A.sleep(2000)
  s = await state()
  r.check('offline: nada sobe enquanto não há conexão', !s.records.some((x) => x.collection === 'meals' || x.collection === 'shoppingItems'))
  await fetch(MOCK + '/__offline?v=0')
  await syncNow(A)
  s = await state()
  const meals = s.records.filter((x) => x.user_id === lu && x.collection === 'meals')
  const items = s.records.filter((x) => x.user_id === lu && x.collection === 'shoppingItems')
  r.check('ao reconectar: sobe 1 refeição (realizada), 1 item manual e o estado de 1 item automático, sem duplicar', meals.length === 1 && meals[0].data.done === true && items.length === 2 && items.some((x) => x.data.kind === 'manual' && x.data.name === 'Sabão') && items.some((x) => x.data.kind === 'auto' && x.data.checked && x.id.endsWith(':arroz')))

  // Device B: same list; then conflict — A buys bananas, B changes the meal quantity
  await signIn(B, 'lu@teste.com')
  await B.goto(BASE + '#/meals?view=shopping')
  await B.sleep(900)
  r.check('outro aparelho vê a lista com o mesmo estado', (await rowChecked(B, 'Arroz')) === 'true' && (await rowChecked(B, 'Sabão')) === 'false' && (await rowText(B, 'Bananas')).includes('3 un'))
  await A.goto(BASE + '#/meals?view=shopping')
  await A.sleep(600)
  await A.click('Marcar Bananas (3 un)')
  await A.sleep(300)
  await B.goto(BASE + '#/meals?view=week')
  await B.sleep(600)
  await B.click('Almoço', 'button')
  await fillIn(B, 'Ingredientes', '6 bananas\nArroz')
  await B.click('Salvar', '[role=dialog] button[type=submit]')
  await B.sleep(400)
  await syncNow(A)
  await syncNow(B)
  await syncNow(A)
  for (const [dev, label] of [[A, 'A'], [B, 'B']]) {
    await dev.goto(BASE + '#/meals?view=shopping')
    await dev.sleep(700)
  }
  const ra = [await rowChecked(A, 'Bananas'), await rowText(A, 'Bananas')]
  const rb = [await rowChecked(B, 'Bananas'), await rowText(B, 'Bananas')]
  r.check('banana comprada num aparelho e quantidade mudada no outro: as duas mudanças ficam', ra[0] === 'true' && ra[1].includes('6 un') && rb[0] === 'true' && rb[1].includes('6 un'), JSON.stringify([ra, rb]))

  // Another account sees nothing
  await A.goto(BASE + '#/account')
  await A.click('Sair desta conta')
  await A.click('Sair', 'button')
  await A.sleep(1500)
  await signUp(A, 'teo@teste.com')
  r.check('outra conta não recebe refeições nem lista de Lu', (await idbOf(A, 'meals')).length === 0 && (await idbOf(A, 'shoppingItems')).length === 0)
  const token = await A.eval(`JSON.parse(localStorage.getItem('nucleo:auth')).access_token`)
  const direct = await (await fetch(`${MOCK}/rest/v1/records?select=*`, { headers: { Authorization: `Bearer ${token}` } })).json()
  r.check('requisição direta de outra conta não traz dados de Lu (mock)', Array.isArray(direct) && direct.every((x) => x.user_id !== lu))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('meals-sync-erro-a').catch(() => {})
  await B.shot('meals-sync-erro-b').catch(() => {})
} finally {
  const failed = r.print(A)
  A.close()
  B.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
