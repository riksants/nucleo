// Regras 2.1, modo local: o Assistente entende a frase, pergunta o que falta (meta), mostra a prévia
// QUANDO/FAÇA e só cria a regra ao confirmar; "Testar esta regra" mostra a simulação sem alterar nada;
// a opção de cadeia vem desligada e mostra aviso ao ligar; uma reserva que falhou (meta fora do saldo)
// é feita com "Tentar de novo" sem repetir a outra ação; "Desfazer só esta" desfaz só a tarefa.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9469)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'notes', 'sales', 'subscribers', 'inbox']
const freshRates = { values: { EUR: 1, BRL: 6, USD: 1.1 }, fetchedAt: new Date().toISOString(), source: 'teste' }
const since = '2026-01-01'
const automations = { subscriberCharge: { on: true, since }, toolCharge: { on: true, since }, projectClient: { on: true, since }, goalSave: { on: true, since } }
const mainText = () => b.eval(`document.querySelector('main')?.innerText ?? ''`)
const dialog = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].at(-1)?.innerText ?? ''`)
const clickIn = (text) => b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = d && [...d.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true })()`)
const clickMain = (text) => b.eval(`(() => { const el = [...document.querySelectorAll('main button')].reverse().find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true })()`)
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
const putAll = (store, items) => b.eval(`new Promise((res) => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const tx = q.result.transaction(${JSON.stringify(store)}, 'readwrite'); for (const it of ${JSON.stringify(items)}) tx.objectStore(${JSON.stringify(store)}).put(it); tx.oncomplete = () => { q.result.close(); res(true) } } })`)
const goal = (id, name, inBalance = true) => ({ id, createdAt: T, updatedAt: T, name, target: 1000000, saved: 0, deadline: '2027-12-31', currency: 'EUR', note: '', status: 'active', history: [], inBalance })
async function ask(text) {
  await setValue(b, 'input[aria-label="Pergunte ao NÚCLEO"]', text)
  await b.eval(`document.querySelector('input[aria-label="Pergunte ao NÚCLEO"]').form.requestSubmit()`)
  await sleep(900)
}

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString()
  await seedExistingUser(
    b,
    {
      clients: [{ id: 'c1', name: 'Ana', company: '', phone: '', whatsapp: '', email: '', location: '', notes: '', status: 'active' }],
      projects: [{ id: 'p1', name: 'Site da Ana', clientId: 'c1', kind: 'site', status: 'inProgress', startDate: '', dueDate: '', endDate: '', charged: 0, received: 0, currency: 'EUR', link: '', notes: '' }],
      transactions: [
        { id: 'rcv-project-old1', type: 'in', amount: 120000, currency: 'EUR', baseAmount: 120000, reason: 'Site · Pagamento de projeto', category: 'freelance', source: { kind: 'project', parentId: 'p1', paymentId: 'old1' }, createdAt: day(10), updatedAt: day(10) },
        { id: 'rcv-project-old2', type: 'in', amount: 30000, currency: 'EUR', baseAmount: 30000, reason: 'Site · Pagamento de projeto', category: 'freelance', source: { kind: 'project', parentId: 'p1', paymentId: 'old2' }, createdAt: day(3), updatedAt: day(3) },
      ],
    },
    { baseCurrency: 'EUR', displayCurrency: 'EUR', initialBalance: 100000, rates: freshRates, timeZone: 'Europe/Madrid', automations, modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })
  await b.goto(BASE + '#/assistant')
  await waitFor(dbReady, 'banco v9')
  await sleep(800)
  await putAll('financeGoals', [goal('imp', 'Impostos'), goal('via', 'Viagem')])
  await b.eval('location.reload()').catch(() => {})
  await sleep(2500)

  // ---------- Assistente: ambígua → pergunta; escolha → prévia; nada antes de confirmar
  await ask('Guarda 20% quando eu receber de um projeto')
  let text = await mainText()
  r.check('frase ambígua: pergunta a meta, com as opções', text.includes('Para qual meta você quer reservar os 20%?') && text.includes('Impostos') && text.includes('Viagem'), text.slice(-300).replace(/\n/g, ' | '))
  r.check('nada foi criado ainda', (await idb(b, 'rules')).length === 0)
  await clickMain('Impostos')
  await sleep(700)
  text = await mainText()
  r.check('prévia completa QUANDO / FAÇA e botão de confirmar', text.includes('Entendi. Vou criar esta regra:') && /quando/i.test(text) && /eu receber pagamento de um projeto/i.test(text) && /reservar 20% para Impostos/i.test(text) && text.includes('Confirmar e criar regra'), text.slice(-500).replace(/\n/g, ' | '))
  r.check('prévia não grava nada', (await idb(b, 'rules')).length === 0)
  await clickMain('Confirmar e criar regra')
  await sleep(900)
  let rules = await idb(b, 'rules')
  r.check('confirmar cria a regra ligada, igual à do editor, sem cadeia', rules.length === 1 && rules[0].on === true && rules[0].trigger.kind === 'projectPayment' && rules[0].actions[0].goalId === 'imp' && rules[0].actions[0].percent === 20 && !('chain' in rules[0]), JSON.stringify(rules))
  r.check('sem rolagem horizontal no Assistente', await noHorizontalScroll(b))

  // ---------- Editor: testar (simulação) e cadeia desligada
  await b.goto(BASE + '#/rules')
  await sleep(1500)
  await b.click(rules[0].name)
  await sleep(700)
  let d = await dialog()
  r.check('editor mostra “Testar” e “Permitir que ações desta regra ativem outras regras” (desligada)', d.includes('Testar esta regra') && d.includes('Permitir que ações desta regra ativem outras regras') && (await b.eval(`[...document.querySelectorAll('[role=dialog] [role=switch]')].at(-1)?.getAttribute('aria-checked')`)) === 'false')
  const savedBefore = (await idb(b, 'financeGoals', 'imp')).saved
  const runsBefore = (await idb(b, 'automationRuns')).length
  await clickIn('Testar esta regra')
  await sleep(900)
  d = await dialog()
  r.check('simulação: teria rodado 2 vezes, com valores marcados como estimativa', /teria rodado 2 vezes/.test(d) && d.includes('estimativa') && d.includes('nada foi criado, reservado ou alterado'), d.replace(/\n/g, ' | ').slice(0, 900))
  r.check('simulação não alterou nada', (await idb(b, 'financeGoals', 'imp')).saved === savedBefore && (await idb(b, 'automationRuns')).length === runsBefore && (await idb(b, 'tasks')).length === 0)
  await clickIn('Permitir que ações desta regra ativem outras regras')
  await sleep(300)
  d = await dialog()
  r.check('ligar a cadeia mostra o aviso', d.includes('poderá iniciar outras regras'))
  await clickIn('Permitir que ações desta regra ativem outras regras')
  await sleep(200)
  await b.eval(`document.querySelector('[role=dialog] [aria-label="Fechar"]')?.click()`)
  await sleep(500)

  // ---------- Retry: a meta fora do saldo; a tarefa sai, a reserva falha; tentar de novo faz só a reserva
  await putAll('rules', [{ ...rules[0], actions: [{ kind: 'reservePercent', goalId: 'via', percent: 10 }, { kind: 'createTask', title: 'Enviar recibo a {cliente}', dueDays: 0, linkProject: true, priority: 'none' }], updatedAt: new Date().toISOString() }])
  await putAll('financeGoals', [goal('via', 'Viagem', false)])
  await b.eval('location.reload()').catch(() => {})
  await sleep(2500)
  await b.goto(BASE + '#/projects?open=p1')
  await sleep(1500)
  r.check('detalhe do projeto aberto', await clickIn('Registrar pagamento'))
  await sleep(700)
  await setValue(b, '#project-payment-amount', '500')
  await sleep(200)
  await clickIn('Confirmar recebimento')
  await sleep(1800)
  let runs = (await idb(b, 'automationRuns')).filter((x) => x.automation === 'rule')
  let run = runs[0]
  r.check('pagamento registrado pela tela: a regra rodou (tarefa feita, reserva não por meta fora do saldo)', run && run.actions[0].ok === false && run.actions[0].code === 'goalNotInBalance' && run.actions[1].ok === true, JSON.stringify(run?.actions))
  await putAll('financeGoals', [{ ...(await idb(b, 'financeGoals', 'via')), inBalance: true, updatedAt: new Date().toISOString() }])
  await b.eval('location.reload()').catch(() => {})
  await sleep(2500)
  await b.goto(BASE + '#/automations')
  await sleep(1500)
  await clickMain('Tentar de novo')
  await sleep(1200)
  run = (await idb(b, 'automationRuns')).find((x) => x.id === run.id)
  const via = await idb(b, 'financeGoals', 'via')
  const tasks = await idb(b, 'tasks')
  r.check('tentar de novo fez só a reserva (10% de €500 = €50) e registrou a tentativa', via.saved === 5000 && tasks.length === 1 && run.actions[0].ok === true && run.actions[0].attempts?.length === 1, `${via.saved} ${tasks.length} ${JSON.stringify(run.actions[0])}`)
  await b.eval('location.reload()').catch(() => {})
  await sleep(2500)
  text = await mainText()
  r.check('depois de recarregar não há mais “Tentar de novo” nem reserva repetida', !text.includes('Tentar de novo') && (await idb(b, 'financeGoals', 'via')).saved === 5000)

  // ---------- Desfazer só a tarefa
  await clickMain('Desfazer só esta')
  await sleep(400)
  await clickIn('Desfazer')
  await sleep(1000)
  r.check('desfazer só uma ação: tarefa sai, reserva fica', (await idb(b, 'tasks')).length === 0 && (await idb(b, 'financeGoals', 'via')).saved === 5000)
  r.check('sem rolagem horizontal em Feito pelo Núcleo', await noHorizontalScroll(b))
  r.check('sem erros no console', !b.logs.some((l) => l.startsWith('EXC') || l.startsWith('error')), b.logs.slice(0, 5).join(' / '))
} catch (err) {
  r.results.push('FAIL exceção: ' + (err?.stack ?? err))
} finally {
  const failed = r.print(b)
  await b.close()
  process.exit(failed ? 1 : 0)
}
