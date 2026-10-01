// Etapa 3 data (categorised movements, unnecessary mark, finance goals) through the real sync code, two devices,
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

async function expense(b, amount, reason, { category, unnecessary } = {}) {
  await b.goto(BASE + '#/finance')
  await b.click('Retirar')
  await setValue(b, '#tx-amount', amount)
  await setValue(b, '#tx-reason', reason)
  if (category) await choose(b, '#tx-category', category)
  if (unnecessary) await b.click('Gasto desnecessário', '[role=switch]')
  await b.click(`Retirar R$ ${amount},00`, 'button')
  await b.sleep(500)
}

const A = await launch(9383)
const B = await launch(9384)
const idbOf = (b, store) => b.eval(`new Promise(r => indexedDB.databases().then(list => { const name = list.map(d => d.name).find(n => n.startsWith('nucleo-u-')); const q = indexedDB.open(name); q.onsuccess = () => { const g = q.result.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).getAll(); g.onsuccess = () => { q.result.close(); r(g.result) } } }))`)
try {
  for (const b of [A, B]) {
    await b.mobile()
    await b.send('Network.enable')
    await b.send('Network.setBypassServiceWorker', { bypass: true })
  }
  await signUp(A, 'ana@teste.com')
  await expense(A, '40', 'Mercado', { category: 'food' })
  await syncNow(A)
  let s = await state()
  const ana = s.users.find((u) => u.email === 'ana@teste.com').id
  const mercado = s.records.find((x) => x.collection === 'transactions' && x.data.reason === 'Mercado')
  r.check('movimentação com categoria chega ao servidor com o user_id certo', mercado?.user_id === ana && mercado.data.category === 'food')

  // A offline: new expense marked unnecessary, edit the old one, create a finance goal
  await fetch(MOCK + '/__offline?v=1')
  await expense(A, '15', 'Doce', { unnecessary: true })
  await A.goto(BASE + '#/finance')
  await A.click('Mercado', 'button')
  await setValue(A, '#tx-reason', 'Mercado do mês')
  await A.click('Salvar alterações', 'button')
  await A.sleep(400)
  await A.click('Nova meta')
  await fillIn(A, 'Nome', 'Viagem')
  await fillIn(A, 'Valor objetivo', '3000')
  await fillIn(A, 'Já guardado', '500')
  await fillIn(A, 'Data limite', new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10))
  await A.click('Criar meta', 'button')
  await A.sleep(2500)
  s = await state()
  r.check('offline: nada novo sobe enquanto não há conexão', !s.records.some((x) => x.data.reason === 'Doce' || x.collection === 'financeGoals' || x.data.reason === 'Mercado do mês'))
  r.check('offline: o aparelho já mostra tudo', (await A.text()).includes('Viagem') && (await A.text()).includes('Doce'))
  await fetch(MOCK + '/__offline?v=0')
  await syncNow(A)
  s = await state()
  const tx = s.records.filter((x) => x.user_id === ana && x.collection === 'transactions')
  r.check('ao reconectar: sobe a saída desnecessária, a edição e a meta, sem duplicar', tx.length === 2 && tx.some((x) => x.data.reason === 'Doce' && x.data.unnecessary === true) && tx.some((x) => x.data.reason === 'Mercado do mês' && x.data.category === 'food') && s.records.filter((x) => x.collection === 'financeGoals').length === 1)

  // Device B sees the same; both update the goal → last write wins on both
  await signIn(B, 'ana@teste.com')
  await B.goto(BASE + '#/finance')
  await B.sleep(800)
  let text = await B.text()
  r.check('outro aparelho mostra categoria, marcação e a meta', text.includes('Mercado do mês') && text.includes('desnecessário') && text.includes('Viagem'))
  await B.click('Viagem', 'button')
  await fillIn(B, 'Quanto guardou', '100')
  await B.click('Salvar · R$ 600,00 guardados', 'button')
  await B.sleep(400)
  await A.goto(BASE + '#/finance')
  await A.click('Viagem', 'button')
  await fillIn(A, 'Quanto guardou', '250')
  await A.click('Salvar · R$ 750,00 guardados', 'button')
  await A.sleep(400)
  await syncNow(B)
  await syncNow(A)
  await syncNow(B)
  const ga = (await idbOf(A, 'financeGoals'))[0]
  const gb = (await idbOf(B, 'financeGoals'))[0]
  r.check('conflito entre dois aparelhos: os dois ficam com a última gravação', ga?.saved === 75000 && gb?.saved === 75000)

  // Another account sees nothing
  await A.goto(BASE + '#/account')
  await A.click('Sair desta conta')
  await A.click('Sair', 'button')
  await A.sleep(1500)
  await signUp(A, 'rui@teste.com')
  await A.goto(BASE + '#/finance')
  text = await A.text()
  // Ignore the category <select> (it lists the default "Viagem" category by name).
  text = await A.eval(`[...document.querySelectorAll('main')].map((m) => { const c = m.cloneNode(true); c.querySelectorAll('select').forEach((s) => s.remove()); return c.textContent }).join(' ')`)
  const local = { tx: await idbOf(A, 'transactions'), goals: await idbOf(A, 'financeGoals') }
  r.check('outra conta não vê movimentações nem metas de Ana', !text.includes('Mercado do mês') && !text.includes('Viagem') && !text.includes('Doce') && local.tx.length === 0 && local.goals.length === 0, `${local.tx.length} mov, ${local.goals.length} metas`)
  const token = await A.eval(`JSON.parse(localStorage.getItem('nucleo:auth')).access_token`)
  const direct = await (await fetch(`${MOCK}/rest/v1/records?select=*&collection=in.(transactions,financeGoals)`, { headers: { Authorization: `Bearer ${token}` } })).json()
  r.check('requisição direta de outra conta não traz dados financeiros de Ana (mock)', Array.isArray(direct) && direct.every((x) => x.user_id !== ana))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('finance-sync-erro-a').catch(() => {})
  await B.shot('finance-sync-erro-b').catch(() => {})
} finally {
  const failed = r.print(A)
  A.close()
  B.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
