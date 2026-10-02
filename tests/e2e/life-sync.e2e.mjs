// Etapa 4 data (personal projects, objectives, steps) through the real sync code, two devices,
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

const typeInto = (b, selector, value) =>
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)

async function enableLife(b) {
  await b.goto(BASE + '#/settings')
  await b.click('Seções visíveis')
  await b.click('Vida', '[role=switch], button')
  await b.sleep(400)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await b.sleep(300)
}

const A = await launch(9386)
const B = await launch(9387)
const idbOf = (b, store) => b.eval(`new Promise(r => indexedDB.databases().then(list => { const name = list.map(d => d.name).find(n => n.startsWith('nucleo-u-')); const q = indexedDB.open(name); q.onsuccess = () => { const g = q.result.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).getAll(); g.onsuccess = () => { q.result.close(); r(g.result) } } }))`)
try {
  for (const b of [A, B]) {
    await b.mobile()
    await b.send('Network.enable')
    await b.send('Network.setBypassServiceWorker', { bypass: true })
  }
  await signUp(A, 'bia@teste.com')
  await enableLife(A)
  let s = await state()
  const bia = s.users.find((u) => u.email === 'bia@teste.com').id

  // Offline: create objective, steps, finish one, reorder
  await fetch(MOCK + '/__offline?v=1')
  await A.goto(BASE + '#/life?view=objectives')
  await A.sleep(800)
  await A.click('Novo objetivo')
  await fillIn(A, 'Objetivo', 'Aprender inglês')
  await A.click('Criar', '[role=dialog] button[type=submit]')
  await A.sleep(500)
  await A.click('Aprender inglês', 'button')
  for (const t of ['Estudar o básico', 'Terminar curso A', 'Conversar 15 minutos']) {
    await typeInto(A, 'input[aria-label="Nova etapa"]', t)
    await A.click('Adicionar etapa')
    await A.sleep(300)
  }
  await A.click('Concluir etapa Estudar o básico')
  await A.click('Subir Conversar 15 minutos')
  await A.sleep(2000)
  s = await state()
  r.check('offline: nada sobe enquanto não há conexão', !s.records.some((x) => x.collection === 'lifePlans' || x.collection === 'planSteps'))
  r.check('offline: o aparelho já mostra o progresso', (await A.text()).includes('1 de 3 etapas · 33%'))
  await fetch(MOCK + '/__offline?v=0')
  await syncNow(A)
  s = await state()
  const plans = s.records.filter((x) => x.user_id === bia && x.collection === 'lifePlans')
  const steps = s.records.filter((x) => x.user_id === bia && x.collection === 'planSteps')
  const order = [...steps].sort((a, c) => a.data.order - c.data.order).map((x) => x.data.title).join('|')
  r.check('ao reconectar: sobe 1 objetivo e 3 etapas (sem duplicar), na ordem nova', plans.length === 1 && steps.length === 3 && order === 'Estudar o básico|Conversar 15 minutos|Terminar curso A', order)

  // Two devices: phone finishes a step, computer edits the title → both kept
  await signIn(B, 'bia@teste.com')
  await B.goto(BASE + '#/life?view=objectives')
  await B.sleep(1000)
  let text = await B.text()
  r.check('outro aparelho mostra o objetivo com o mesmo progresso', text.includes('Aprender inglês') && text.includes('1 de 3 etapas · 33%'))
  await A.goto(BASE + '#/life?view=objectives')
  await A.sleep(600)
  await A.click('Aprender inglês', 'button')
  await A.click('Concluir etapa Terminar curso A')
  await A.sleep(300)
  await B.click('Aprender inglês', 'button')
  await B.click('Editar', '[role=dialog] button')
  await B.sleep(300)
  await fillIn(B, 'Objetivo', 'Inglês para o trabalho')
  await B.click('Salvar', '[role=dialog] button[type=submit]')
  await B.sleep(400)
  await syncNow(A)
  await syncNow(B)
  await syncNow(A)
  const pa = (await idbOf(A, 'lifePlans'))[0]
  const pb = (await idbOf(B, 'lifePlans'))[0]
  const sa = (await idbOf(A, 'planSteps')).filter((x) => x.status === 'done').length
  const sb = (await idbOf(B, 'planSteps')).filter((x) => x.status === 'done').length
  r.check('etapa concluída num aparelho e título editado no outro: as duas mudanças ficam', pa?.title === 'Inglês para o trabalho' && pb?.title === 'Inglês para o trabalho' && sa === 2 && sb === 2, `${pa?.title} ${sa} / ${pb?.title} ${sb}`)

  // Another account sees nothing
  await A.goto(BASE + '#/account')
  await A.click('Sair desta conta')
  await A.click('Sair', 'button')
  await A.sleep(1500)
  await signUp(A, 'gil@teste.com')
  const local = { plans: await idbOf(A, 'lifePlans'), steps: await idbOf(A, 'planSteps') }
  r.check('outra conta não recebe objetivos nem etapas de Bia', local.plans.length === 0 && local.steps.length === 0)
  const token = await A.eval(`JSON.parse(localStorage.getItem('nucleo:auth')).access_token`)
  const direct = await (await fetch(`${MOCK}/rest/v1/records?select=*`, { headers: { Authorization: `Bearer ${token}` } })).json()
  r.check('requisição direta de outra conta não traz dados de Bia (mock)', Array.isArray(direct) && direct.every((x) => x.user_id !== bia))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('life-sync-erro-a').catch(() => {})
  await B.shot('life-sync-erro-b').catch(() => {})
} finally {
  const failed = r.print(A)
  A.close()
  B.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
