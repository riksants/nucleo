// Etapa 2 data (weekly goals, check-ins) through the real sync code, two devices, offline — against the LOCAL mock
// of Supabase (tests/e2e/mock-supabase.mjs), never the real project.
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
  // new account onboarding: defaults (BRL, suggested sections incl. Caixa de entrada, Hábitos, Agenda)
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

const A = await launch(9381)
const B = await launch(9382)
const idbOf = (b, store) => b.eval(`new Promise(r => indexedDB.databases().then(list => { const name = list.map(d => d.name).find(n => n.startsWith('nucleo-u-')); const q = indexedDB.open(name); q.onsuccess = () => { const g = q.result.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).getAll(); g.onsuccess = () => { q.result.close(); r(g.result) } } }))`)
try {
  for (const b of [A, B]) {
    await b.mobile()
    await b.send('Network.enable')
    await b.send('Network.setBypassServiceWorker', { bypass: true })
  }
  await signUp(A, 'lia@teste.com')
  // Treinar (preset = training category) done today + weekly goal
  await A.goto(BASE + '#/habits')
  await A.click('Criar hábito')
  await A.click('Treinar', 'button')
  await A.click('Criar hábito', 'button[type=submit]')
  await A.sleep(400)
  await A.click('Concluir Treinar')
  await A.goto(BASE + '#/week')
  await A.click('Nova meta')
  await A.click('Salvar', 'button[type=submit]')
  await A.sleep(500)
  await syncNow(A)
  let s = await state()
  const lia = s.users.find((u) => u.email === 'lia@teste.com').id
  r.check('meta semanal e hábito com categoria chegam ao servidor', s.records.some((x) => x.user_id === lia && x.collection === 'weeklyGoals') && s.records.some((x) => x.collection === 'habits' && x.data.category === 'training'))

  await signIn(B, 'lia@teste.com')
  await B.goto(BASE + '#/week')
  let text = await B.text()
  r.check('outro aparelho mostra a meta com o progresso real (1 / 4)', text.includes('1 / 4'))

  // B offline: check-in
  await fetch(MOCK + '/__offline?v=1')
  await B.click('Como foi sua semana?')
  await B.eval(`[...document.querySelectorAll('[role=radiogroup][aria-label="Como ficou seu humor?"] [role=radio]')][4].click()`)
  await B.click('Salvar', '[role=dialog] button')
  await B.sleep(2500)
  s = await state()
  r.check('offline: check-in fica na fila do aparelho', !s.records.some((x) => x.collection === 'weekCheckins'))
  await fetch(MOCK + '/__offline?v=0')
  await syncNow(B)
  s = await state()
  const checkins = s.records.filter((x) => x.collection === 'weekCheckins')
  r.check('ao reconectar, sobe um único check-in (id = semana), sem duplicar', checkins.length === 1 && checkins[0].data.answers.mood === 5)

  await syncNow(A)
  const aCheckins = await idbOf(A, 'weekCheckins')
  r.check('aparelho A recebe o check-in feito offline no B', aCheckins.length === 1 && aCheckins[0].answers.mood === 5)

  // Another account sees nothing
  await A.goto(BASE + '#/account')
  await A.click('Sair desta conta')
  await A.click('Sair', 'button')
  await A.sleep(1500)
  await signUp(A, 'noa@teste.com')
  await A.goto(BASE + '#/week')
  text = await A.text()
  r.check('outra conta não vê metas nem check-ins de Lia', text.includes('Nenhuma meta para esta semana') && text.includes('Como foi sua semana?'))
  const token = await A.eval(`JSON.parse(localStorage.getItem('nucleo:auth')).access_token`)
  const direct = await (await fetch(`${MOCK}/rest/v1/records?select=*&collection=eq.weeklyGoals`, { headers: { Authorization: `Bearer ${token}` } })).json()
  r.check('requisição direta de outra conta não traz metas de Lia (mock)', Array.isArray(direct) && direct.length === 0)
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('week-sync-erro-a').catch(() => {})
  await B.shot('week-sync-erro-b').catch(() => {})
} finally {
  const failed = r.print(A)
  A.close()
  B.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
