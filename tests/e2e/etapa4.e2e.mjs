// Etapa 4 (modo local): Feito pelo Núcleo em abas, regras que pedem confirmação/revisão, frase → editor,
// e as larguras de celular 320/375/390 sem rolagem horizontal (temas claro e escuro).
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9481)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const freshRates = { values: { EUR: 1, BRL: 6, USD: 1.1, AED: 4 }, fetchedAt: new Date().toISOString(), source: 'teste' }
const since = '2026-01-01'
const automations = { subscriberCharge: { on: true, since }, toolCharge: { on: true, since }, projectClient: { on: true, since }, goalSave: { on: true, since }, saleRecurring: { on: true, since } }
const mainText = () => b.eval(`document.querySelector('main')?.innerText ?? ''`)
const dialog = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].at(-1)?.innerText ?? ''`)
const clickIn = (text) => b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = d && [...d.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true })()`)
const clickMain = (text) => b.eval(`(() => { const el = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true })()`)
const tab = async (label) => {
  const ok = await b.eval(`(() => { const el = [...document.querySelectorAll('main [role=radio]')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (!el) return false; el.click(); return true })()`)
  await sleep(500)
  return ok
}
const width = (w, h = 800) => b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true })
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
const putDb = (store, item) =>
  b.eval(`new Promise((res, rej) => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const tx = q.result.transaction(${JSON.stringify(store)}, 'readwrite'); tx.objectStore(${JSON.stringify(store)}).put(${JSON.stringify(item)}); tx.oncomplete = () => { q.result.close(); res(true) }; tx.onerror = () => rej(tx.error) } })`)

async function expense(value, reason) {
  await b.goto(BASE + '#/finance')
  await sleep(1200)
  await b.click('Retirar')
  await setValue(b, '#tx-amount', value)
  await setValue(b, '#tx-reason', reason)
  await sleep(200)
  if (!(await clickIn('Retirar '))) r.results.push('FAIL botão de salvar a saída não encontrado')
  await sleep(1400)
}

/** Every width the person asked for, in both themes: no horizontal scroll. */
async function widths(path, label) {
  for (const theme of ['dark', 'light']) {
    await b.eval(`localStorage.setItem('nucleo:theme', ${JSON.stringify(JSON.stringify(theme))})`)
    for (const w of [320, 375, 390]) {
      await width(w)
      await b.goto(BASE + path)
      await sleep(900)
      r.check(`${label}: sem rolagem horizontal em ${w}px (${theme === 'dark' ? 'escuro' : 'claro'})`, await noHorizontalScroll(b))
    }
  }
  await b.eval(`localStorage.setItem('nucleo:theme', '"dark"')`)
  await b.mobile()
}

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(b, {}, { baseCurrency: 'EUR', displayCurrency: 'EUR', currencies: ['EUR', 'BRL'], initialBalance: 500000, startedAt: '2026-01-01T00:00:00.000Z', rates: freshRates, timeZone: 'Europe/Madrid', automations, modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL })
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })
  await b.goto(BASE + '#/rules')
  await waitFor(dbReady, 'banco v9')
  await sleep(800)

  // Two rules written once the database exists: one asks for confirmation, one only asks for a review.
  await putDb('rules', { id: 'rc', createdAt: T, updatedAt: T, name: 'Tarefa de conferência', on: true, since, order: 0, confirm: true, trigger: { kind: 'moneyOut' }, conditions: [{ field: 'amount', op: 'gt', value: 10000, currency: 'EUR' }], actions: [{ kind: 'createTask', title: 'Conferir {descricao}', dueDays: 0, linkProject: false, priority: 'none' }] })
  await putDb('rules', { id: 'rv', createdAt: T, updatedAt: T, name: 'Despesa grande', on: true, since, order: 1, trigger: { kind: 'moneyOut' }, conditions: [{ field: 'amount', op: 'gt', value: 50000, currency: 'EUR' }], actions: [{ kind: 'askReview', text: 'Conferir: {descricao} ({valor})' }] })
  await b.eval('location.reload()').catch(() => {})
  await sleep(2500)

  // ---------- Minhas regras: frase → editor preenchido (nada salvo)
  let text = await mainText()
  r.check('Minhas regras mostra “Descreva sua regra” e o aviso de confirmação na regra', text.includes('Descreva sua regra') && text.includes('Pede sua confirmação antes de fazer'), text.slice(0, 400).replace(/\n/g, ' | '))
  await setValue(b, 'input[aria-label="Descreva sua regra em uma frase"]', 'Quando eu concluir todas as tarefas de um projeto, me avisar')
  await clickMain('Entender')
  await sleep(900)
  let d = await dialog()
  r.check('frase abre o editor já preenchido (todas as tarefas → me avisar)', /todas as tarefas de um projeto forem concluídas/.test(d) && /me avisar/.test(d), d.slice(0, 300).replace(/\n/g, ' | '))
  r.check('nada foi salvo ao entender a frase', (await idb(b, 'rules')).length === 2)
  await b.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(600)
  await setValue(b, 'input[aria-label="Descreva sua regra em uma frase"]', 'Quando uma despesa passar de 500, destacar para revisão')
  await clickMain('Entender')
  await sleep(700)
  text = await mainText()
  r.check('valor sem moeda: pergunta a moeda com botões', text.includes('Em qual moeda') && text.includes('BRL'), text.slice(0, 600).replace(/\n/g, ' | '))

  // ---------- A saída de €600: uma regra pergunta, a outra pede revisão
  await expense('600', 'Mercado grande')
  const tx = (await idb(b, 'transactions')).find((t) => t.reason === 'Mercado grande')
  let runs = await idb(b, 'automationRuns')
  const waiting = runs.find((x) => x.id.startsWith('rule-rc-'))
  const review = runs.find((x) => x.id.startsWith('rule-rv-'))
  r.check('regra com confirmação NÃO criou tarefa sozinha (fica esperando)', waiting?.status === 'pending' && (await idb(b, 'tasks')).length === 0, JSON.stringify(waiting?.status))
  r.check('pedir revisão não mudou a movimentação', review?.notice?.kind === 'review' && tx && tx.amount === 60000 && !tx.category)

  await b.goto(BASE + '#/automations')
  await sleep(1500)
  text = await mainText()
  r.check('Pendências mostram o pedido de confirmação e a revisão', text.includes('Pendências (2)') && text.includes('Quer que eu faça') && text.includes('Conferir: Mercado grande'), text.slice(0, 600).replace(/\n/g, ' | '))
  r.check('frase da semana conta itens reais', text.includes('Existem 2 itens esperando uma decisão sua'))
  await clickMain('Confirmar')
  await sleep(1500)
  const tasks = await idb(b, 'tasks')
  runs = await idb(b, 'automationRuns')
  r.check('confirmar revalida e cria a tarefa uma vez', tasks.length === 1 && tasks[0].title === 'Conferir Mercado grande' && runs.find((x) => x.id === waiting?.id)?.status === 'done', JSON.stringify(tasks.map((t) => t.title)))
  await clickMain('Visto')
  await sleep(1200)
  text = await mainText()
  r.check('revisão marcada como vista sai de Pendências', !text.includes('Conferir: Mercado grande') && text.includes('Nada esperando você'), text.slice(0, 400).replace(/\n/g, ' | '))
  await tab('Atividade')
  text = await mainText()
  r.check('Atividade mostra a regra confirmada com “Ver registro”', text.includes('Tarefa de conferência') && text.includes('Ver registro'), text.slice(0, 600).replace(/\n/g, ' | '))
  await b.eval('location.reload()').catch(() => {})
  await sleep(3000)
  r.check('recarregar não refaz a tarefa', (await idb(b, 'tasks')).length === 1)
  await b.shot('etapa4-feito-390').catch(() => {})

  // ---------- 4.4 Importar extrato: texto colado → prévia com totais por moeda e transferência → importar
  const dd = (n) => { const x = new Date(Date.now() - n * 86_400_000); return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}` }
  await b.goto(BASE + '#/import')
  await sleep(1000)
  await b.click('Colar texto do extrato')
  await sleep(500)
  await setValue(b, 'textarea[aria-label="Texto do extrato"]', [`${dd(3)} Mercadona -45,20`, `${dd(2)} Salário +2.500,00`, `${dd(2)} Transf. entre contas proprias -300,00`, `${dd(1)} Sem sinal 30,00`].join('\n'))
  await clickIn('Ler o texto')
  await sleep(1500)
  text = await mainText()
  if (text.includes('Escolha a moeda')) {
    await clickMain('EUR')
    await sleep(1200)
    text = await mainText()
  }
  r.check('texto colado vira prévia com totais por moeda', text.includes('Texto colado') && /Entradas\s*€\s?2\.500,00/.test(text) && /Saídas\s*€\s?45,20/.test(text) && text.includes('1 transferência entre contas (fora dos totais)'), text.slice(0, 900).replace(/\n/g, ' | '))
  r.check('linha sem sinal não é adivinhada', text.includes('sem sinal'))
  r.check('sem rolagem horizontal na prévia (390px)', await noHorizontalScroll(b))
  await b.shot('etapa4-import-preview').catch(() => {})
  await clickMain('Importar 3')
  await sleep(700)
  await clickIn('Importar')
  await sleep(2000)
  const all = await idb(b, 'transactions')
  const transfer = all.find((t) => t.reason?.includes('entre contas'))
  r.check('importou 3 movimentações; a transferência ficou marcada e preservada', all.filter((t) => t.bank).length === 3 && transfer?.transfer && transfer.type === 'out' && transfer.amount === 30000, JSON.stringify(all.map((t) => [t.reason, t.type, t.amount, Boolean(t.transfer)])))

  await widths('#/automations', 'Feito pelo Núcleo')
  await widths('#/import', 'Importar extrato')
  await widths('#/rules', 'Minhas regras')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('etapa4-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
