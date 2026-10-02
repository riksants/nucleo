// Etapa 6: actions applied by the Assistant through the real sync code, two devices,
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
  b.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.trim().startsWith(${JSON.stringify(labelText)})); const el = l && l.querySelector('input, textarea'); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)

const ask = async (b, text) => {
  await b.eval(`(() => { const el = document.querySelector('input[aria-label="Pergunte ao NÚCLEO"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await b.click('Enviar')
  await b.sleep(500)
}
const pressInLast = (b, label) => b.eval(`(() => { const cards = [...document.querySelectorAll('[data-proposal]')]; const c = cards[cards.length - 1]; const btn = c && [...c.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!btn) return false; btn.click(); return true })()`)

const A = await launch(9394)
const B = await launch(9395)
const idbOf = (b, store) => b.eval(`new Promise(r => indexedDB.databases().then(list => { const name = list.map(d => d.name).find(n => n.startsWith('nucleo-u-')); const q = indexedDB.open(name); q.onsuccess = () => { const g = q.result.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).getAll(); g.onsuccess = () => { q.result.close(); r(g.result) } } }))`)
try {
  for (const b of [A, B]) {
    await b.mobile()
    await b.send('Network.enable')
    await b.send('Network.setBypassServiceWorker', { bypass: true })
  }
  await signUp(A, 'eva@teste.com')
  let s = await state()
  const eva = s.users.find((u) => u.email === 'eva@teste.com').id

  // Offline: the Assistant still works (local) and its action waits in the queue
  await fetch(MOCK + '/__offline?v=1')
  await A.goto(BASE + '#/assistant')
  await A.sleep(900)
  await ask(A, 'Cria tarefa renovar seguro amanhã às 9h')
  r.check('offline: o Assistente continua respondendo com os dados locais', (await A.text()).includes('Vou criar a tarefa “Renovar seguro”'))
  await pressInLast(A, 'Criar')
  await A.sleep(2000)
  s = await state()
  r.check('offline: a ação fica na fila do aparelho', !s.records.some((x) => x.collection === 'tasks'))
  await fetch(MOCK + '/__offline?v=0')
  await syncNow(A)
  s = await state()
  const tasks = s.records.filter((x) => x.user_id === eva && x.collection === 'tasks')
  r.check('ao reconectar: sobe uma única tarefa, com o user_id certo e a marca do Assistente', tasks.length === 1 && tasks[0].data.title === 'Renovar seguro' && tasks[0].data.changedBy === 'assistant' && tasks[0].data.dueTime === '09:00')

  // Other device sees it, with the mark; a normal edit there clears the mark
  await signIn(B, 'eva@teste.com')
  await B.goto(BASE + '#/tasks')
  await B.sleep(900)
  r.check('outro aparelho mostra "Alterado pelo Assistente"', (await B.text()).includes('Renovar seguro') && (await B.text()).includes('Alterado pelo Assistente'))

  // Another account: nothing from Eva, and the Assistant answers only with its own data
  await A.goto(BASE + '#/account')
  await A.click('Sair desta conta')
  await A.click('Sair', 'button')
  await A.sleep(1500)
  await signUp(A, 'ivo@teste.com')
  await A.goto(BASE + '#/assistant')
  await A.sleep(800)
  await ask(A, 'O que tenho amanhã?')
  r.check('Assistente de outra conta não vê a tarefa de Eva', !(await A.text()).includes('Renovar seguro') && (await idbOf(A, 'tasks')).length === 0)
  const token = await A.eval(`JSON.parse(localStorage.getItem('nucleo:auth')).access_token`)
  const direct = await (await fetch(`${MOCK}/rest/v1/records?select=*`, { headers: { Authorization: `Bearer ${token}` } })).json()
  r.check('requisição direta de outra conta não traz dados de Eva (mock)', Array.isArray(direct) && direct.every((x) => x.user_id !== eva))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('assistant-sync-erro-a').catch(() => {})
  await B.shot('assistant-sync-erro-b').catch(() => {})
} finally {
  const failed = r.print(A)
  A.close()
  B.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
