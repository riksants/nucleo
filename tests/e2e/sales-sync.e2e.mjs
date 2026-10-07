// Vendas por pessoa pelo código real de sincronização: venda, pagamento geral e específico offline,
// reconexão sem duplicar, segundo aparelho e outra conta — contra o mock LOCAL do Supabase, nunca o projeto real.
// Needs a build made with VITE_SUPABASE_URL=http://localhost:54399 in dist-e2e-cloud (and NUCLEO_BASE=/nucleo/).
import { spawn } from 'node:child_process'
import { launch } from './cdp.mjs'
import { reporter } from './helpers.mjs'

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
async function enableSales(b) {
  await b.goto(BASE + '#/settings')
  await b.sleep(600)
  await b.click('Seções visíveis')
  await b.eval(`(() => { const sw = [...document.querySelectorAll('[role=dialog] [role=switch]')].find((x) => x.querySelector('.font-medium')?.textContent.trim() === 'Vendas'); if (sw && sw.getAttribute('aria-checked') !== 'true') sw.click() })()`)
  await b.sleep(400)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await b.sleep(300)
}
const fill = (b, label, value) =>
  b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = d.querySelector('input[aria-label=${JSON.stringify(label)}]') || [...d.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input, textarea'); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
const clickIn = (b, text) => b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = [...d.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.click(); return true })()`)
async function newSale(b, who, product, total, received = '') {
  await b.goto(BASE + '#/sales')
  await b.sleep(700)
  await b.click('Nova venda', 'button')
  await b.sleep(600)
  await fill(b, 'Ou nome de quem comprou', who)
  await fill(b, 'Produto', product)
  await fill(b, 'Valor total', total)
  if (received) await fill(b, 'Já recebeu quanto?', received)
  await clickIn(b, 'Registrar venda')
  await b.sleep(700)
}
async function openPerson(b, name) {
  await b.goto(BASE + '#/sales')
  await b.sleep(800)
  await b.click(name, 'button')
  await b.sleep(600)
}
const idbOf = (b, store) => b.eval(`new Promise(r => indexedDB.databases().then(list => { const name = list.map(d => d.name).find(n => n.startsWith('nucleo-u-')); const q = indexedDB.open(name); q.onsuccess = () => { const g = q.result.transaction(${JSON.stringify(store)}).objectStore(${JSON.stringify(store)}).getAll(); g.onsuccess = () => { q.result.close(); r(g.result) } } }))`)
const paid = (list) => list.reduce((t, s) => t + s.payments.reduce((x, p) => x + p.amount, 0), 0)

const A = await launch(9386)
const B = await launch(9387)
try {
  for (const b of [A, B]) {
    await b.mobile()
    await b.send('Network.enable')
    await b.send('Network.setBypassServiceWorker', { bypass: true })
  }
  await signUp(A, 'ana@vendas.com')
  await enableSales(A)
  await newSale(A, 'Maria', 'Tênis', '300', '50')
  await syncNow(A)
  let s = await state()
  const ana = s.users.find((u) => u.email === 'ana@vendas.com').id
  r.check('venda chega ao servidor com o user_id certo', s.records.some((x) => x.collection === 'sales' && x.user_id === ana && x.data.product === 'Tênis'))

  // Offline: new purchase, general payment and specific payment
  await fetch(MOCK + '/__offline?v=1')
  await newSale(A, 'Maria', 'Bolsa', '200')
  await openPerson(A, 'Maria')
  await clickIn(A, 'Pagamento geral')
  await A.sleep(300)
  await fill(A, 'Valor do pagamento geral', '100')
  await clickIn(A, 'Registrar pagamento geral')
  await A.sleep(700)
  await clickIn(A, 'Bolsa')
  await A.sleep(600)
  await clickIn(A, 'Registrar pagamento')
  await A.sleep(300)
  await fill(A, 'Valor', '30')
  await clickIn(A, 'Adicionar')
  await A.sleep(2000)
  s = await state()
  r.check('offline: nada novo sobe sem conexão', !s.records.some((x) => x.data.product === 'Bolsa') && !s.records.some((x) => x.data.payments?.some((p) => p.generalId)))
  await openPerson(A, 'Maria')
  let d = await A.eval(`[...document.querySelectorAll('[role=dialog]')].map(x => x.innerText).join(' ')`)
  r.check('offline: o aparelho já mostra a pessoa com tudo (500 comprado, 180 pago, 320 falta)', d.includes('R$ 500,00') && d.includes('R$ 180,00') && d.includes('R$ 320,00'), d.slice(0, 300))
  await fetch(MOCK + '/__offline?v=0')
  await syncNow(A)
  await syncNow(A)
  s = await state()
  const mine = s.records.filter((x) => x.user_id === ana && x.collection === 'sales')
  r.check('ao reconectar: sobem a venda nova e os dois pagamentos, sem duplicar', mine.length === 2 && paid(mine.map((x) => x.data)) === 18000, `${mine.length} vendas, pago ${paid(mine.map((x) => x.data))}`)
  const generalPieces = mine.flatMap((x) => x.data.payments.filter((p) => p.generalId))
  r.check('pagamento geral no servidor: um único geral (100) aplicado na compra mais antiga', generalPieces.length === 1 && generalPieces[0].amount === 10000 && mine.find((x) => x.data.product === 'Tênis').data.payments.some((p) => p.generalId))

  // Second device
  await signIn(B, 'ana@vendas.com')
  await openPerson(B, 'Maria')
  d = await B.eval(`[...document.querySelectorAll('[role=dialog]')].map(x => x.innerText).join(' ')`)
  r.check('outro aparelho: mesma pessoa, mesmos totais e histórico com geral e específico', d.includes('R$ 500,00') && d.includes('R$ 180,00') && d.includes('R$ 320,00') && d.includes('Pagamento geral') && d.includes('Pagamento específico'), d.slice(0, 300))

  // Both devices pay at the same time on different purchases → both kept
  await clickIn(B, 'Tênis')
  await B.sleep(500)
  await clickIn(B, 'Registrar pagamento')
  await fill(B, 'Valor', '20')
  await clickIn(B, 'Adicionar')
  await B.sleep(500)
  await openPerson(A, 'Maria')
  await clickIn(A, 'Bolsa')
  await A.sleep(500)
  await clickIn(A, 'Registrar pagamento')
  await fill(A, 'Valor', '10')
  await clickIn(A, 'Adicionar')
  await A.sleep(500)
  await syncNow(B)
  await syncNow(A)
  await syncNow(B)
  const la = await idbOf(A, 'sales')
  const lb = await idbOf(B, 'sales')
  r.check('dois aparelhos pagando compras diferentes: nada se perde (210 nos dois)', paid(la) === 21000 && paid(lb) === 21000, `${paid(la)} / ${paid(lb)}`)

  // Another account sees nothing
  await A.goto(BASE + '#/account')
  await A.click('Sair desta conta')
  await A.click('Sair', 'button')
  await A.sleep(1500)
  await signUp(A, 'rui@vendas.com')
  await enableSales(A)
  await A.goto(BASE + '#/sales')
  await A.sleep(800)
  const text = await A.text()
  const local = await idbOf(A, 'sales')
  r.check('outra conta não vê vendas, pessoas nem valores de Ana', !text.includes('Maria') && !text.includes('Tênis') && local.length === 0)
  const token = await A.eval(`JSON.parse(localStorage.getItem('nucleo:auth')).access_token`)
  const direct = await (await fetch(`${MOCK}/rest/v1/records?select=*&collection=eq.sales`, { headers: { Authorization: `Bearer ${token}` } })).json()
  r.check('requisição direta de outra conta não traz vendas de Ana (mock)', Array.isArray(direct) && direct.every((x) => x.user_id !== ana))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await A.shot('sales-sync-erro-a').catch(() => {})
  await B.shot('sales-sync-erro-b').catch(() => {})
} finally {
  const failed = r.print(A)
  A.close()
  B.close()
  for (const p of procs) p.kill()
  process.exit(failed ? 1 : 0)
}
