// Regras (Automações Parte 2.0), modo local: "Minhas regras" começa sem regra ligada, com modelos;
// ativar "Guarde parte do que recebe" escolhendo a meta; registrar uma entrada pela tela → a regra
// reserva 10% (sem criar saída) e aparece em "Feito pelo Núcleo"; desfazer devolve a reserva e mantém
// a entrada; recarregar não roda de novo; regra desligada não roda.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9467)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'inbox']
const freshRates = { values: { EUR: 1, BRL: 6, USD: 1.1 }, fetchedAt: new Date().toISOString(), source: 'teste' }
const since = '2026-01-01'
const automations = { subscriberCharge: { on: true, since }, toolCharge: { on: true, since }, projectClient: { on: true, since }, goalSave: { on: true, since } }
const mainText = () => b.eval(`document.querySelector('main')?.innerText ?? ''`)
const dialog = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].at(-1)?.innerText ?? ''`)
/** Last open dialog: clicks the first button whose text starts with `text`. */
const clickIn = (text) => b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = d && [...d.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true })()`)
/** Selects a value in the n-th <select> of the last dialog, the way React expects. */
const chooseIn = (value, nth = 0) =>
  b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = d && d.querySelectorAll('select')[${nth}]; if (!el) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
async function waitFor(check, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await b.eval(check).catch(() => false)) return true
    await sleep(500)
  }
  r.results.push('WAIT timeout: ' + label)
  return false
}
const dbReady = `indexedDB.databases().then((l) => l.some((d) => d.name === 'nucleo' && d.version >= 9))`
const T = new Date().toISOString()

async function addIncome(value, reason) {
  await b.goto(BASE + '#/finance')
  await sleep(1200)
  await b.click('Adicionar')
  await setValue(b, '#tx-amount', value)
  await setValue(b, '#tx-reason', reason)
  await sleep(200)
  const ok = await clickIn('Adicionar ')
  if (!ok) r.results.push('FAIL botão de salvar a entrada não encontrado')
  await sleep(1200)
}

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(b, {}, { baseCurrency: 'EUR', displayCurrency: 'EUR', initialBalance: 100000, rates: freshRates, timeZone: 'Europe/Madrid', automations, modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL })
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  await b.goto(BASE + '#/rules')
  await waitFor(dbReady, 'banco v9')
  await sleep(1000)
  // Goal written once the app upgraded the database (a reload makes the app read it).
  await b.eval(`new Promise((res) => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const tx = q.result.transaction('financeGoals', 'readwrite'); tx.objectStore('financeGoals').put(${JSON.stringify({ id: 'g1', createdAt: T, updatedAt: T, name: 'Impostos', target: 1000000, saved: 0, deadline: '2027-12-31', currency: 'EUR', note: '', status: 'active', history: [], inBalance: true })}); tx.oncomplete = () => { q.result.close(); res(true) } } })`)
  await b.eval('location.reload()').catch(() => {})
  await sleep(2500)

  let text = await mainText()
  r.check('Minhas regras abre com modelos prontos e nenhuma regra', text.includes('Minhas regras') && text.includes('Modelos prontos') && text.includes('Nenhuma regra ainda') && text.includes('Separe para impostos') && text.includes('Treinos') && text.includes('Alimentação'), text.slice(0, 300).replace(/\n/g, ' | '))
  r.check('nenhuma regra pronta vem ligada', (await idb(b, 'rules')).length === 0)
  r.check('sem rolagem horizontal no celular', await noHorizontalScroll(b))

  // ---------- Template → choose the goal → save and turn on
  await b.click('Guarde parte do que recebe')
  await sleep(600)
  let d = await dialog()
  r.check('modelo abre o editor com QUANDO / FAÇA em linguagem humana', d.includes('Nova regra') && d.includes('Quando') && /entrar dinheiro/i.test(d) && d.includes('reservar 10% para uma meta') && /em resumo/i.test(d), d.slice(0, 300).replace(/\n/g, ' | '))
  await clickIn('Salvar e ligar')
  await sleep(500)
  r.check('sem meta escolhida, não salva', (await idb(b, 'rules')).length === 0)
  await clickIn('reservar 10% para uma meta')
  await sleep(300)
  await chooseIn('g1')
  await sleep(300)
  d = await dialog()
  r.check('resumo mostra a meta escolhida e que reservar não cria saída', d.includes('reservar 10% para Impostos') && d.includes('Reservar não cria saída'), d.replace(/\n/g, ' | ').slice(0, 600))
  await clickIn('Salvar e ligar')
  await sleep(800)
  let rules = await idb(b, 'rules')
  r.check('regra salva e ligada, desde hoje', rules.length === 1 && rules[0].on === true && rules[0].actions[0].goalId === 'g1' && /^\d{4}-\d{2}-\d{2}$/.test(rules[0].since), JSON.stringify(rules))
  text = await mainText()
  r.check('cartão da regra com resumo e "Ainda não rodou"', text.includes('Guarde parte do que recebe') && text.includes('Ainda não rodou'))

  // ---------- Money comes in: the rule reserves 10%, no expense
  await addIncome('250', 'Freela site')
  let txs = await idb(b, 'transactions')
  let goal = await idb(b, 'financeGoals', 'g1')
  let runs = await idb(b, 'automationRuns')
  const ruleRun = runs.find((x) => x.automation === 'rule')
  r.check('entrada registrada', txs.some((t) => t.reason === 'Freela site' && t.amount === 25000))
  r.check('regra reservou 10% (€25) para Impostos', goal.saved === 2500, String(goal.saved))
  r.check('nenhuma saída criada pela regra', txs.filter((t) => t.type === 'out').length === 0 && txs.length === 1)
  r.check('execução gravada junto, com id fixo e a causa', ruleRun?.status === 'done' && ruleRun.id.startsWith('rule-') && ruleRun.cause?.txId === txs[0].id, JSON.stringify(ruleRun))

  await b.goto(BASE + '#/automations')
  await sleep(1200)
  text = await mainText()
  r.check('"Feito pelo Núcleo" mostra a regra e o que ela fez', text.includes('Regra “Guarde parte do que recebe”') && /reservou €\s?25,00 para Impostos/i.test(text) && text.includes('Por causa de'), text.slice(0, 500).replace(/\n/g, ' | '))

  // ---------- Reload: nothing runs again
  await b.eval('location.reload()').catch(() => {})
  await sleep(3000)
  runs = await idb(b, 'automationRuns')
  goal = await idb(b, 'financeGoals', 'g1')
  r.check('recarregar não roda a regra de novo', runs.filter((x) => x.automation === 'rule').length === 1 && goal.saved === 2500)

  // ---------- Undo: reservation back, income stays
  await b.click('Desfazer')
  await sleep(400)
  await clickIn('Desfazer')
  await sleep(1000)
  goal = await idb(b, 'financeGoals', 'g1')
  txs = await idb(b, 'transactions')
  runs = await idb(b, 'automationRuns')
  r.check('desfazer devolve a reserva e mantém a entrada (fato real)', goal.saved === 0 && txs.length === 1 && runs.find((x) => x.automation === 'rule')?.status === 'undone', `${goal.saved} ${txs.length}`)

  // ---------- Turned off: does not run
  await b.goto(BASE + '#/rules')
  await sleep(1200)
  await b.click('Desligar', '[role=switch]')
  await sleep(600)
  rules = await idb(b, 'rules')
  r.check('regra desligada pelo cartão', rules[0].on === false)
  await addIncome('100', 'Outro freela')
  runs = await idb(b, 'automationRuns')
  goal = await idb(b, 'financeGoals', 'g1')
  r.check('regra desligada não roda', runs.filter((x) => x.automation === 'rule').length === 1 && goal.saved === 0)

  await b.goto(BASE + '#/settings')
  await sleep(1200)
  r.check('Configurações tem "Minhas regras"', (await mainText()).includes('Minhas regras'))
  r.check('sem erros no console', !b.logs.some((l) => l.startsWith('EXC') || l.startsWith('error')), b.logs.slice(0, 5).join(' / '))
} catch (err) {
  r.results.push('FAIL exceção: ' + (err?.stack ?? err))
} finally {
  const failed = r.print(b)
  await b.close()
  process.exit(failed ? 1 : 0)
}
