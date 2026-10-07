// Recebimentos → Financeiro pela sincronização real (mock local do Supabase, nunca o projeto real):
// pagamento offline entra no Financeiro do aparelho e sobe uma vez ao reconectar; o outro aparelho vê a
// mesma entrada; edição num aparelho e exclusão offline no outro; sync repetido não duplica; venda com
// pagamento; outra conta não vê nada. Precisa do build dist-e2e-cloud (VITE_SUPABASE_URL=http://localhost:54399).
import { spawn } from 'node:child_process'
import { launch } from './cdp.mjs'
import { reporter, setValue } from './helpers.mjs'

const BASE = 'http://localhost:4318/nucleo/'
const MOCK = 'http://localhost:54399'
const r = reporter()
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const env = { ...process.env, NUCLEO_BASE: '/nucleo/' }
const procs = [spawn(process.execPath, ['tests/e2e/mock-supabase.mjs'], { stdio: 'ignore' }), spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', 'dist-e2e-cloud', '--port', '4318', '--strictPort'], { stdio: 'ignore', env })]
for (let i = 0; i < 40; i++) {
  try {
    if ((await fetch(BASE)).ok && (await fetch(MOCK + '/__state')).ok) break
  } catch {}
  await sleep(500)
}
const state = async () => (await fetch(MOCK + '/__state')).json()
const live = (s, user, collection) => s.records.filter((x) => x.user_id === user && x.collection === collection && !x.deleted)

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
const fillIn = (b, labelText, value) =>
  b.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.trim().toLowerCase().startsWith(${JSON.stringify(labelText.toLowerCase())})); const el = l && l.querySelector('input, textarea'); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
const receiveOnCard = (b, name) => b.eval(`(() => { const card = [...document.querySelectorAll('main .card')].find((c) => c.querySelector('h3')?.textContent.trim() === ${JSON.stringify(name)}); const btn = card && [...card.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Registrar pagamento'); if (!btn) return false; btn.click(); return true })()`)
const idbOf = (b, store) => b.eval(`new Promise(r => indexedDB.databases().then(list => { const name = list.map(d => d.name).find(n => n.startsWith('nucleo-u-')); const q = indexedDB.open(name); q.onsuccess = () => { const g = q.result.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).getAll(); g.onsuccess = () => { q.result.close(); r(g.result) } } }))`)
const confirmDanger = (b, label) => b.eval(`(() => { const btn = [...document.querySelectorAll('[role=dialog] button, [role=alertdialog] button')].reverse().find((x) => x.textContent.trim() === ${JSON.stringify(label)}); btn?.click(); return !!btn })()`)

const A = await launch(9461)
const B = await launch(9462)
try {
  for (const b of [A, B]) {
    await b.mobile()
    await b.send('Network.enable')
    await b.send('Network.setBypassServiceWorker', { bypass: true })
  }
  await signUp(A, 'lia@teste.com')
  let s = await state()
  const lia = s.users.find((u) => u.email === 'lia@teste.com').id

  // A creates the project (R$ 400) while online
  await A.goto(BASE + '#/projects')
  await A.sleep(800)
  await A.click('Novo projeto', 'button')
  await A.sleep(600)
  await fillIn(A, 'Nome do projeto', 'Perfect Clean')
  await fillIn(A, 'Valor do projeto', '400')
  await A.click('Criar projeto', 'button')
  await A.sleep(800)
  await syncNow(A)
  r.check('projeto criado sobe sem nenhuma entrada no Financeiro', live(await state(), lia, 'projects').length === 1 && live(await state(), lia, 'transactions').length === 0)

  // Offline: receive R$ 200 → income on the device right away, nothing on the server
  await fetch(MOCK + '/__offline?v=1')
  await A.goto(BASE + '#/projects')
  await A.sleep(800)
  await receiveOnCard(A, 'Perfect Clean')
  await A.sleep(600)
  await setValue(A, '#project-payment-amount', '200')
  await A.click('Confirmar recebimento', 'button')
  await A.sleep(1500)
  let localTx = await idbOf(A, 'transactions')
  r.check('offline: entrada já está no Financeiro do aparelho', localTx.length === 1 && localTx[0].amount === 20000 && localTx[0].source?.kind === 'project')
  s = await state()
  r.check('offline: nada sobe enquanto não há conexão', live(s, lia, 'transactions').length === 0)
  await fetch(MOCK + '/__offline?v=0')
  await syncNow(A)
  await syncNow(A)
  await syncNow(A)
  s = await state()
  let tx = live(s, lia, 'transactions')
  const project = live(s, lia, 'projects')[0]
  r.check('ao reconectar (e sincronizando 3 vezes): sobe UMA entrada, ligada ao pagamento do projeto', tx.length === 1 && tx[0].id === `rcv-project-${project.data.payments[0].id}` && tx[0].data.amount === 20000)

  // Device B: same income; edits the payment to R$ 150 → the same income changes on both
  await signIn(B, 'lia@teste.com')
  await B.goto(BASE + '#/finance')
  await B.sleep(1000)
  r.check('outro aparelho vê a entrada "Perfect Clean · Pagamento de projeto"', (await B.text()).includes('Perfect Clean · Pagamento de projeto'))
  await B.goto(BASE + '#/projects')
  await B.sleep(800)
  await B.click('Perfect Clean', 'main button')
  await B.sleep(700)
  await B.eval(`[...document.querySelectorAll('[role=dialog] [aria-label="Pagamentos"] button')][0].click()`)
  await B.sleep(600)
  await setValue(B, '#project-payment-amount', '150')
  await B.click('Salvar pagamento', 'button')
  await B.sleep(800)
  await syncNow(B)
  await syncNow(A)
  s = await state()
  tx = live(s, lia, 'transactions')
  localTx = await idbOf(A, 'transactions')
  r.check('edição em outro aparelho: a mesma entrada vira R$ 150 no servidor e no aparelho A', tx.length === 1 && tx[0].data.amount === 15000 && localTx.length === 1 && localTx[0].amount === 15000)

  // A offline deletes the payment → after reconnecting, gone everywhere
  await fetch(MOCK + '/__offline?v=1')
  await A.goto(BASE + '#/projects')
  await A.sleep(800)
  await A.click('Perfect Clean', 'main button')
  await A.sleep(700)
  await A.eval(`[...document.querySelectorAll('[role=dialog] [aria-label="Pagamentos"] button')][0].click()`)
  await A.sleep(600)
  await A.click('Excluir pagamento', '[role=dialog] button')
  await A.sleep(400)
  await confirmDanger(A, 'Excluir')
  await A.sleep(1000)
  r.check('exclusão offline: some do Financeiro do aparelho na hora', (await idbOf(A, 'transactions')).length === 0)
  await fetch(MOCK + '/__offline?v=0')
  await syncNow(A)
  await syncNow(B)
  s = await state()
  r.check('ao reconectar: a entrada sai do servidor e do outro aparelho', live(s, lia, 'transactions').length === 0 && (await idbOf(B, 'transactions')).length === 0)

  // Sales: B registers a sale already paid (R$ 30) → one income, synced once. (Vendas starts hidden for a new account.)
  await B.goto(BASE + '#/settings?painel=secoes')
  await B.sleep(900)
  await B.eval(`(() => { const sw = [...document.querySelectorAll('[role=dialog] [role=switch]')].find((x) => x.querySelector('.font-medium')?.textContent.trim() === 'Vendas'); if (sw && sw.getAttribute('aria-checked') !== 'true') sw.click() })()`)
  await B.sleep(500)
  await B.goto(BASE + '#/sales')
  await B.sleep(800)
  await B.click('Nova venda', 'button')
  await B.sleep(600)
  await fillIn(B, 'Ou nome de quem comprou', 'Maria')
  await fillIn(B, 'Produto', 'Bolo')
  await fillIn(B, 'Valor total', '50')
  await fillIn(B, 'Já recebeu quanto?', '30')
  await B.click('Registrar venda', '[role=dialog] button')
  await B.sleep(800)
  await syncNow(B)
  await syncNow(B)
  await syncNow(A)
  s = await state()
  tx = live(s, lia, 'transactions')
  const aTx = await idbOf(A, 'transactions')
  r.check('venda com pagamento: UMA entrada "Pagamento de venda — Maria · Bolo" no servidor e nos dois aparelhos', tx.length === 1 && tx[0].data.reason === 'Pagamento de venda — Maria · Bolo' && tx[0].data.amount === 3000 && aTx.length === 1, JSON.stringify({ server: tx.map((x) => x.data), a: aTx.length, sales: live(s, lia, 'sales').map((x) => x.data.payments) }))

  // Another account sees none of it
  await A.goto(BASE + '#/account')
  await A.click('Sair desta conta')
  await A.click('Sair', 'button')
  await A.sleep(1500)
  await signUp(A, 'teo@teste.com')
  await A.goto(BASE + '#/finance')
  await A.sleep(1000)
  r.check('outra conta: Financeiro e Projetos sem nada da primeira', !(await A.text()).includes('Pagamento de venda') && (await idbOf(A, 'transactions')).length === 0 && (await idbOf(A, 'projects')).length === 0)
  const token = await A.eval(`JSON.parse(localStorage.getItem('nucleo:auth')).access_token`)
  const direct = await (await fetch(`${MOCK}/rest/v1/records?select=*`, { headers: { Authorization: `Bearer ${token}` } })).json()
  r.check('requisição direta de outra conta não traz pagamentos nem entradas da primeira (mock)', Array.isArray(direct) && direct.every((x) => x.user_id !== lia))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('receipts-sync-erro-a').catch(() => {})
  await B.shot('receipts-sync-erro-b').catch(() => {})
} finally {
  const failed = r.print(A)
  A.close()
  B.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
