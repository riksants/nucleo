// Automações (Parte 1), modo local: ao abrir, o Núcleo cria "A receber" do assinante (sem dinheiro),
// lança a saída da ferramenta marcada "Considerar pago", reserva para a meta (sem saída, Disponível no
// card de saldo); "Feito pelo Núcleo" mostra tudo; confirmar recebimento cria a entrada; desfazer remove a
// saída; recarregar não refaz nada.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9461)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const dayIn = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const today = dayIn(new Date())
const daysAgo = (n) => dayIn(new Date(Date.now() - n * 86_400_000))
const plusMonths = (n) => dayIn(new Date(Date.now() + n * 31 * 86_400_000))
const freshRates = { values: { EUR: 1, BRL: 6, USD: 1.1, AED: 4 }, fetchedAt: new Date().toISOString(), source: 'teste' }
const since = '2026-01-01'
const automations = { subscriberCharge: { on: true, since }, toolCharge: { on: true, since }, projectClient: { on: true, since }, goalSave: { on: true, since } }
const mainText = () => b.eval(`document.querySelector('main')?.innerText ?? ''`)
const dialogText = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].map((d) => d.textContent).join('\\n')`)
const clickIn = (text) => b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = d && [...d.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true })()`)
/** Button with `label` inside the row (card child) whose text contains `rowText`. */
const clickInRow = (rowText, label) =>
  b.eval(`(() => { const rows = [...document.querySelectorAll('main .card > div')].filter((x) => x.innerText.includes(${JSON.stringify(rowText)})); for (const row of rows) { const el = [...row.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (el) { el.click(); return true } } return false })()`)
const put = (store, item) =>
  b.eval(`new Promise((res, rej) => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const tx = q.result.transaction(${JSON.stringify(store)}, 'readwrite'); tx.objectStore(${JSON.stringify(store)}).put(${JSON.stringify(item)}); tx.oncomplete = () => { q.result.close(); res(true) }; tx.onerror = () => rej(tx.error) } })`)
const T = new Date().toISOString()
/** Waits (slow machine) until the app upgraded the device database and the engine wrote its first runs. */
async function waitFor(check, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await b.eval(check).catch(() => false)) return true
    await sleep(500)
  }
  r.results.push('WAIT timeout: ' + label)
  return false
}
const dbReady = `indexedDB.databases().then((l) => l.some((d) => d.name === 'nucleo' && d.version >= 8))`
const hasRuns = (n) => `new Promise((res) => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const db = q.result; if (!db.objectStoreNames.contains('automationRuns')) { db.close(); return res(false) } const g = db.transaction('automationRuns').objectStore('automationRuns').getAll(); g.onsuccess = () => { db.close(); res(g.result.length >= ${n}) } } })`

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(
    b,
    {
      offerings: [{ id: 'o1', name: 'App', projectId: null, notes: '' }],
      subPlans: [{ id: 'p1', offeringId: 'o1', name: 'Pro', price: 5000, currency: 'EUR', interval: 'monthly' }],
      subscribers: [{ id: 's1', offeringId: 'o1', planId: 'p1', name: 'Ana', clientId: null, email: '', startDate: '2026-01-01', nextCharge: daysAgo(2), status: 'active', cancelledAt: '', payments: [], notes: '' }],
      tools: [{ id: 't1', name: 'Figma', link: '', plan: '', price: 2000, currency: 'EUR', billing: 'monthly', nextCharge: daysAgo(1), notes: '', status: 'active', autoPaid: true }],
    },
    { baseCurrency: 'EUR', displayCurrency: 'EUR', initialBalance: 100000, rates: freshRates, timeZone: 'Europe/Madrid', automations, modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  // ---------- Opening the app: the engine acts by itself
  await b.goto(BASE + '#/')
  await waitFor(dbReady, 'banco v8')
  await waitFor(hasRuns(2), 'primeiras execuções')
  await sleep(800)
  let runs = await idb(b, 'automationRuns')
  let txs = await idb(b, 'transactions')
  const subRun = runs.find((x) => x.automation === 'subscriberCharge')
  const toolRun = runs.find((x) => x.automation === 'toolCharge')
  r.check('assinante em "Confirmar recebimento": cobrança "A receber" criada', subRun?.status === 'pending' && subRun.date === daysAgo(2), JSON.stringify(subRun))
  r.check('nunca inventa fato: nenhuma entrada do assinante sem confirmação', !txs.some((t) => t.source?.kind === 'subscriber'))
  r.check('ferramenta "Considerar pago": saída lançada na data da cobrança', toolRun?.status === 'done' && txs.some((t) => t.id === `tx-${toolRun.id}` && t.baseAmount === -2000), JSON.stringify(txs))
  const sub1 = await idb(b, 'subscribers', 's1')
  const tool1 = await idb(b, 'tools', 't1')
  r.check('próximas cobranças avançaram um mês', sub1.nextCharge > today && tool1.nextCharge > today, `${sub1.nextCharge} ${tool1.nextCharge}`)
  let home = await mainText()
  r.check('Início mostra "Esperando você" com a cobrança da Ana', home.includes('Esperando você') && home.includes('Ana') && /a receber/i.test(home), home.slice(0, 400).replace(/\n/g, ' | '))
  r.check('Início mostra "Feito pelo Núcleo"', home.includes('Feito pelo Núcleo'))

  // ---------- Goal reservation: no expense, Disponível on the balance card
  await put('financeGoals', { id: 'g1', createdAt: T, updatedAt: T, name: 'Viagem', target: 100000, saved: 0, deadline: plusMonths(6), currency: 'EUR', note: '', status: 'active', history: [], inBalance: true, autoSave: { day: Number(today.slice(8, 10)), mode: 'fixed', amount: 20000, since: today } })
  // Written straight to the device database: a real reload makes the app read it.
  await b.goto(BASE + '#/finance')
  await b.eval('location.reload()').catch(() => {})
  await waitFor(dbReady, 'recarregar')
  await waitFor(hasRuns(3), 'reserva da meta')
  await sleep(1200)
  const g1 = await idb(b, 'financeGoals', 'g1')
  txs = await idb(b, 'transactions')
  r.check('meta: €200 reservados no dia escolhido', g1.saved === 20000, JSON.stringify(g1))
  r.check('reservar não cria saída no Financeiro', txs.length === 1)
  const fin = await mainText()
  r.check('card de saldo: Reservado para metas €200 e Disponível €780', /Reservado para metas\s*€\s?200,00/.test(fin) && /Disponível\s*€\s?780,00/.test(fin), fin.slice(0, 300).replace(/\n/g, ' | '))

  // ---------- Feito pelo Núcleo
  await b.goto(BASE + '#/automations')
  await sleep(1800)
  let page = await mainText()
  r.check('"Feito pelo Núcleo": pendência, pagamento automático e reserva', page.includes('Esperando você') && page.includes('Pagamento automático de Figma') && page.includes('Núcleo reservou') && page.includes('Viagem'), page.slice(0, 500).replace(/\n/g, ' | '))
  const figmaRow = await b.eval(`[...document.querySelectorAll('main .card > div')].find((x) => x.innerText.includes('Pagamento automático de Figma'))?.innerText ?? ''`)
  r.check('valor aparece uma vez só na linha do histórico', (figmaRow.match(/20,00/g) || []).length === 1, figmaRow.replace(/\n/g, ' | '))
  r.check('interruptores das 5 automações (com Vendas recorrentes)', (await b.eval(`document.querySelectorAll('main [role=switch]').length`)) === 5)
  r.check('sem rolagem horizontal em Feito pelo Núcleo (390px)', await noHorizontalScroll(b))

  // Confirm the receivable: only now the income exists
  r.check('abre "Confirmar recebimento"', await clickInRow('Ana', 'Confirmar recebimento'))
  await sleep(700)
  const d = await dialogText()
  r.check('folha com valor e data', d.includes('Valor recebido') && d.includes('Data do recebimento'), d.slice(0, 200))
  await clickIn('Confirmar recebimento')
  await sleep(1200)
  txs = await idb(b, 'transactions')
  runs = await idb(b, 'automationRuns')
  const income = txs.find((t) => t.source?.kind === 'subscriber')
  r.check('confirmado: entrada de €50 com a data de hoje', income?.amount === 5000 && income.baseAmount === 5000, JSON.stringify(income))
  r.check('execução vira "feita" e o pagamento fica no assinante', runs.find((x) => x.id === subRun.id)?.status === 'done' && (await idb(b, 'subscribers', 's1')).payments.length === 1)

  // Undo the tool expense
  r.check('desfazer a saída da Figma', await clickInRow('Pagamento automático de Figma', 'Desfazer'))
  await sleep(600)
  await clickIn('Desfazer')
  await sleep(1200)
  txs = await idb(b, 'transactions')
  runs = await idb(b, 'automationRuns')
  r.check('saída removida do Financeiro', !txs.some((t) => t.id === `tx-${toolRun.id}`))
  const toolAfter = await idb(b, 'tools', 't1')
  r.check('execução marcada como desfeita e próxima cobrança de volta', runs.find((x) => x.id === toolRun.id)?.status === 'undone' && toolAfter.nextCharge === daysAgo(1), `${runs.find((x) => x.id === toolRun.id)?.status} ${toolAfter.nextCharge} ${daysAgo(1)}`)

  // Reload: nothing is redone
  await b.goto(BASE + '#/automations')
  await sleep(4500)
  const after = await idb(b, 'automationRuns')
  txs = await idb(b, 'transactions')
  r.check('recarregar não refaz nada (mesmas execuções, saída continua fora)', after.length === runs.length && !txs.some((t) => t.id === `tx-${toolRun.id}`), `${after.length} vs ${runs.length}`)

  await b.desktop()
  await b.goto(BASE + '#/automations')
  await sleep(1500)
  r.check('sem rolagem horizontal em Feito pelo Núcleo (1366px)', await noHorizontalScroll(b))
  await b.shot('automacoes-desktop').catch(() => {})
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('automacoes-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
