// Metas com prazo → "Como alcançar": cenários calculados sobre o que falta e o tempo até o prazo (guardar,
// vendas, recorrência, serviços); atualizam quando o valor guardado muda; adaptam a prazos curtos; somem com a
// meta alcançada. A folha continua abrindo em "Atualizar". Modo local.
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9524)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const TZ = 'Europe/Madrid'
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const plus = (n) => new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10)
const at = new Date().toISOString()
const G = (id, name, target, saved, deadline) => ({ id, name, target, saved, deadline, currency: 'BRL', note: '', status: 'active', history: [{ date: plus(-1), saved }], createdAt: at, updatedAt: at })
const view = () => b.eval(`document.querySelector('[role=dialog]')?.innerText ?? ''`)
const open = async (name) => {
  await b.goto(BASE + '#/finance')
  await sleep(1300)
  await b.click(name, 'main button')
  await sleep(700)
}

try {
  await b.mobile()
  await seedExistingUser(b, {}, { baseCurrency: 'BRL', displayCurrency: 'BRL', timeZone: TZ, modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL })
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('nucleo:theme', '"dark"'); document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })
  // Finance goals live in a newer store: let the app upgrade the database first, then add them.
  await b.goto(BASE + '#/finance')
  await sleep(1500)
  const goals = [
    G('g1', 'Reserva', 1000000, 250000, plus(152)), // meta 10.000, tem 2.500 → falta 7.500 em 5 meses
    G('g2', 'Viagem curta', 500000, 0, plus(17)),
    G('g3', 'Notebook', 300000, 300000, plus(60)),
  ]
  await b.eval(`new Promise((res, rej) => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const db = q.result; const tx = db.transaction('financeGoals', 'readwrite'); for (const g of ${JSON.stringify(goals)}) tx.objectStore('financeGoals').put(g); tx.oncomplete = () => { db.close(); res(true) }; tx.onerror = () => rej(tx.error) }; q.onerror = () => rej(q.error) })`)
  await b.eval(`location.reload()`)
  await sleep(1800)

  await open('Reserva')
  r.check('a folha da meta abre em "Atualizar" (como antes)', await b.eval(`!!document.querySelector('[role=dialog] input[inputmode=decimal]') && [...document.querySelectorAll('[role=dialog] [role=radio]')].some((x) => x.textContent === 'Atualizar' && x.getAttribute('aria-checked') === 'true')`))
  await b.click('Como alcançar', '[role=dialog] [role=radio]')
  await sleep(500)
  let t = await view()
  r.check('mostra o que falta e o tempo: "Faltam R$ 7.500 · 5 meses"', /Faltam R\$ 7\.500 · 5 meses até/.test(t), t.slice(0, 200))
  r.check('Guardar: R$ 1.502 por mês (igual à frase de cima), por semana e por dia', /R\$ 1\.502\s*por mês/.test(t) && /R\$ 346\s*por semana/.test(t) &&/R\$ 50\s*por dia/.test(t))
  r.check('Vendas: total e por mês (Produto de R$ 100 → 75 vendas · 15 por mês)', /Produto de R\$ 100\s*75 vendas\s*15 por mês/.test(t), (t.match(/VENDAS[\s\S]{0,200}/) || [''])[0])
  r.check('Recorrência: pessoas pagando por mês, até o prazo', /RECORRÊNCIA/.test(t) && /Mensalidade paga por 5 meses/.test(t) && /\d+ pessoas pagando\s*R\$ [\d.]+\/mês/.test(t))
  r.check('Serviços: 1/2/4 por mês e o preço de cada', /1 serviço por mês\s*R\$ 1\.500 cada/.test(t) && /2 serviços por mês\s*R\$ 750 cada/.test(t) && /4 serviços por mês\s*R\$ 380 cada/.test(t))
  r.check('nesta aba não aparece o botão Salvar', !(await b.eval(`[...document.querySelectorAll('[role=dialog] button')].some((x) => x.textContent.startsWith('Salvar'))`)))
  r.check('nada vaza para os lados (390px)', await b.eval(`(() => { const d = document.querySelector('[role=dialog] .bg-sheet'); return [...d.querySelectorAll('.card')].every((c) => c.scrollWidth <= c.clientWidth + 1) && d.scrollWidth <= d.clientWidth + 1 })()`))
  await b.shot('metas-como-alcancar')

  // ---------- Updates with the goal
  await b.click('Atualizar', '[role=dialog] [role=radio]')
  await sleep(400)
  await b.eval(`(() => { const el = document.querySelector('[role=dialog] input[inputmode=decimal]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2500'); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await b.click('Salvar', '[role=dialog] button')
  await sleep(900)
  await open('Reserva')
  r.check('ao reabrir, volta para "Atualizar"', await b.eval(`!!document.querySelector('[role=dialog] input[inputmode=decimal]')`))
  await b.click('Como alcançar', '[role=dialog] [role=radio]')
  await sleep(500)
  t = await view()
  r.check('guardou R$ 2.500 → recalcula sobre os R$ 5.000 que faltam', /Faltam R\$ 5\.000/.test(t) && /R\$ 1\.002\s*por mês/.test(t), t.slice(0, 160))

  // ---------- Visible right on the goal in the list
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(700)
  r.check('(folha anterior fechada antes de testar a prévia)', !(await b.eval(`!!document.querySelector('[role=dialog]')`)))
  const teaser = await b.eval(`(() => [...document.querySelectorAll('main [data-strategy-teaser]')].map((x) => x.innerText.replace(/\\s+/g, ' ').trim()))()`)
  r.check('na lista, cada meta em andamento mostra "Como alcançar" com o principal cenário', teaser.length === 2 && teaser.some((t) => /^Como alcançar Guardar R\$ 1\.002\/mês ou \d+ vendas de R\$ [\d.]+\/mês$/.test(t)) && teaser.some((t) => /\/semana ou \d+ vendas de R\$ [\d.]+\/semana$/.test(t)), JSON.stringify(teaser))
  r.check('o cartão não repete a frase "seriam necessários" (está na prévia)', !/seriam necessários/.test(await b.eval(`[...document.querySelectorAll('main .card')].find((c) => c.textContent.includes('Reserva'))?.innerText ?? ''`)))
  await b.click('Como alcançar', 'main [data-strategy-teaser]')
  await sleep(700)
  r.check('tocar na prévia abre a folha direto em "Como alcançar"', await b.eval(`[...document.querySelectorAll('[role=dialog] [role=radio]')].some((x) => x.textContent === 'Como alcançar' && x.getAttribute('aria-checked') === 'true') && !!document.querySelector('[role=dialog] [data-strategies]')`))
  await b.shot('metas-lista-previa')

  // ---------- Short deadline
  await open('Viagem curta')
  await b.click('Como alcançar', '[role=dialog] [role=radio]')
  await sleep(500)
  t = await view()
  r.check('prazo curto (17 dias): conta em semanas, sem "por mês" nem recorrência', /2 semanas até/.test(t) && !/por mês/.test(t) && !/RECORRÊNCIA/.test(t) && /por semana/.test(t), t.slice(0, 200))

  // ---------- Reached
  await open('Notebook')
  t = await view()
  r.check('meta alcançada: sem "Como alcançar"', /Meta alcançada/.test(t) && !/Como alcançar/.test(t))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('metas-como-alcancar-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
