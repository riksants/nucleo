// Recebimentos → Financeiro (Projetos e Vendas), modo local: "Registrar pagamento" separado de "Editar projeto",
// pagamentos parciais com histórico, acima do restante, quitação, valor antigo ("Já está no Financeiro" /
// "Lançar no Financeiro agora" com a data real), editar/excluir refletindo no Financeiro, sem duplicar ao
// recarregar, moeda sem cotação (entra depois), Vendas (específico e geral), excluir mantém as entradas.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9451)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
// textContent: labels styled as uppercase in CSS are compared as written in the code.
const dialogText = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].map((d) => d.textContent).join('\\n')`)
const clickIn = (text) => b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = d && [...d.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)} || x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.click(); return true })()`)
const fill = (label, value) =>
  b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = d.querySelector('input[aria-label=${JSON.stringify(label)}]') || [...d.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input, textarea'); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const closeSheet = async () => {
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(450)
}
/** "Registrar pagamento" on the card of a project. */
const receiveOnCard = (name) => b.eval(`(() => { const card = [...document.querySelectorAll('main .card')].find((c) => c.querySelector('h3')?.textContent.trim() === ${JSON.stringify(name)}); const btn = card && [...card.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Registrar pagamento'); if (!btn) return false; btn.click(); return true })()`)
const cardText = (name) => b.eval(`[...document.querySelectorAll('main .card')].find((c) => c.querySelector('h3')?.textContent.trim() === ${JSON.stringify(name)})?.innerText ?? ''`)
const txs = () => idb(b, 'transactions')
const project = async (id) => idb(b, 'projects', id)
const balance = (list) => list.reduce((t, x) => t + x.baseAmount, 0)
const dayIn = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const today = dayIn(new Date().toISOString())
const freshRates = { values: { EUR: 1, BRL: 6, USD: 1.1, AED: 4 }, fetchedAt: new Date().toISOString(), source: 'teste' }
const P = (id, over) => ({ id, name: id, clientId: null, kind: 'site', status: 'inProgress', startDate: '2026-09-01', dueDate: '', endDate: '', charged: 0, received: 0, currency: 'EUR', link: '', notes: '', ...over })
const S = (id, over) => ({ id, clientId: null, clientName: 'Maria', product: id, quantity: 1, date: '2026-09-01', total: 10000, currency: 'EUR', dueDate: '', payments: [], notes: '', ...over })

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(
    b,
    {
      projects: [
        P('pc', { name: 'Perfect Clean', status: 'done', endDate: '2026-09-30', charged: 40000, received: 20000 }),
        P('br', { name: 'Loja BR', charged: 600000, currency: 'BRL' }),
        P('jp', { name: 'Tóquio', charged: 100000, currency: 'JPY' }),
        P('old', { name: 'Antigo', charged: 50000, received: 10000 }),
      ],
      sales: [S('Bolo', { total: 30000, payments: [{ id: 'velho', date: '2026-09-02', amount: 5000, note: '' }] }), S('Doce', { date: '2026-09-03', total: 10000 })],
    },
    { baseCurrency: 'EUR', displayCurrency: 'EUR', initialBalance: 0, rates: freshRates, timeZone: 'Europe/Madrid', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  // ---------- Card: discreet summary + its own "Registrar pagamento" (not "Editar projeto")
  await b.goto(BASE + '#/projects')
  await sleep(1300)
  await b.click('Todos', '[role=radio], button')
  await sleep(500)
  let card = await cardText('Perfect Clean')
  r.check('card: "Recebido €200 de €400", "Falta €200" e "Registrar pagamento" (projeto concluído)', /Recebido\s*€\s?200,00/.test(card) && /de\s*€\s?400,00/.test(card) && /Falta\s*€\s?200,00/.test(card) && card.includes('Registrar pagamento') && card.includes('Concluído'), card.replace(/\n/g, ' | '))
  r.check('nada entrou no Financeiro só por existir o valor do projeto', (await txs()).length === 0)
  r.check('sem rolagem horizontal em Projetos (390px)', await noHorizontalScroll(b))

  // ---------- Over the remaining → message + "Usar €200"; double tap confirms once
  await receiveOnCard('Perfect Clean')
  await sleep(700)
  let d = await dialogText()
  r.check('abre "Registrar pagamento" direto (valor, data, observação), sem a edição do projeto', d.includes('Registrar pagamento') && d.includes('Valor recebido') && d.includes('Data') && d.includes('Observação') && d.includes('Confirmar recebimento') && !d.includes('Valor do projeto'), d.slice(0, 200).replace(/\n/g, ' | '))
  await setValue(b, '#project-payment-amount', '300')
  await clickIn('Confirmar recebimento')
  await sleep(400)
  d = await dialogText()
  r.check('acima do restante: "O valor informado é maior que o valor restante." com "Usar €200"', d.includes('O valor informado é maior que o valor restante.') && /Usar\s*€\s?200,00/.test(d))
  r.check('nada foi salvo com valor acima', ((await project('pc')).payments ?? []).length === 0 && (await txs()).length === 0)
  await clickIn('Usar')
  await sleep(200)
  await setValue(b, '#project-payment-note', 'restante')
  await b.eval(`(() => { const btn = [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.trim() === 'Confirmar recebimento'); btn.click(); btn.click(); setTimeout(() => btn.click(), 120) })()`)
  await sleep(1300)
  let pc = await project('pc')
  let all = await txs()
  r.check('um pagamento salvo (toque duplo não duplica), com id, valor, moeda, data e observação', pc.payments?.length === 1 && pc.payments[0].amount === 20000 && pc.payments[0].currency === 'EUR' && pc.payments[0].date === today && pc.payments[0].note === 'restante' && Boolean(pc.payments[0].id), JSON.stringify(pc.payments))
  const pcTx = all.find((t) => t.id === `rcv-project-${pc.payments?.[0]?.id}`)
  r.check('uma entrada no Financeiro: + €200, "Perfect Clean · Pagamento de projeto", Freelance, vinculada', all.length === 1 && pcTx && pcTx.type === 'in' && pcTx.amount === 20000 && pcTx.currency === 'EUR' && pcTx.baseAmount === 20000 && pcTx.reason === 'Perfect Clean · Pagamento de projeto' && pcTx.category === 'freelance' && pcTx.source?.paymentId === pc.payments[0].id, JSON.stringify(all))
  card = await cardText('Perfect Clean')
  r.check('card: quitado, falta zero e sem botão de receber; status operacional continua "Concluído"', card.includes('Quitado') && !card.includes('Falta') && !card.includes('Registrar pagamento') && pc.status === 'done', card.replace(/\n/g, ' | '))

  // ---------- Details: history + old amount with explicit buttons; "Lançar agora" asks the real date
  await b.click('Perfect Clean', 'main button')
  await sleep(700)
  d = await dialogText()
  r.check('detalhes: histórico "Pagamentos" com o novo e a linha do valor antigo', d.includes('Pagamentos') && d.includes('restante') && /registrados antes do histórico/.test(d) && d.includes('Já está no Financeiro') && d.includes('Lançar no Financeiro agora'))
  r.check('detalhes: "Quitado" separado do status (Concluído)', d.includes('Quitado') && d.includes('Concluído'))
  await clickIn('Lançar no Financeiro agora')
  await sleep(600)
  d = await dialogText()
  r.check('"Lançar no Financeiro agora" pede a data real (não assume hoje)', d.includes('Data em que foi pago') && (await b.eval(`document.querySelector('#project-payment-date').value`)) === '')
  await clickIn('Lançar')
  await sleep(400)
  r.check('sem data: não lança e avisa', (await dialogText()).includes('Informe a data') && (await txs()).length === 1)
  await setValue(b, '#project-payment-date', '2026-09-15')
  await clickIn('Lançar')
  await sleep(1000)
  pc = await project('pc')
  all = await txs()
  const legacyTx = all.find((t) => t.id !== pcTx.id)
  r.check('valor antigo lançado: vira pagamento de 15/09 com entrada nesse dia', pc.received === 0 && pc.payments.length === 2 && all.length === 2 && legacyTx?.amount === 20000 && dayIn(legacyTx.createdAt) === '2026-09-15', JSON.stringify({ received: pc.received, n: pc.payments.length, day: legacyTx && dayIn(legacyTx.createdAt) }))
  await closeSheet()

  // "Já está no Financeiro": nothing is created
  await b.click('Antigo', 'main button')
  await sleep(700)
  await clickIn('Já está no Financeiro')
  await sleep(700)
  r.check('"Já está no Financeiro": marca e não cria entrada', (await project('old')).legacyReceived === 'inFinance' && (await txs()).length === 2 && (await dialogText()).includes('já estão no Financeiro'))
  await closeSheet()

  // ---------- Partial payments (BRL), edit and delete through the history
  for (const v of ['1000', '1000']) {
    await receiveOnCard('Loja BR')
    await sleep(700)
    await setValue(b, '#project-payment-amount', v)
    await clickIn('Confirmar recebimento')
    await sleep(900)
  }
  let br = await project('br')
  all = await txs()
  let brTx = all.filter((t) => t.source?.parentId === 'br')
  card = await cardText('Loja BR')
  r.check('vários pagamentos (R$ 1.000 + R$ 1.000): recebido R$ 2.000, falta R$ 4.000', br.payments.length === 2 && /Recebido\s*R\$\s?2\.000,00/.test(card) && /Falta\s*R\$\s?4\.000,00/.test(card), card.replace(/\n/g, ' | '))
  r.check('BRL: cada entrada em BRL, saldo com o valor convertido (1 EUR = 6 BRL)', brTx.length === 2 && brTx.every((t) => t.currency === 'BRL' && t.amount === 100000 && t.baseAmount === 16667), JSON.stringify(brTx.map((t) => [t.amount, t.baseAmount])))
  await b.click('Loja BR', 'main button')
  await sleep(700)
  await b.eval(`[...document.querySelectorAll('[role=dialog] [aria-label="Pagamentos"] button')][0].click()`)
  await sleep(600)
  r.check('tocar no pagamento abre "Editar pagamento"', (await dialogText()).includes('Editar pagamento'))
  const editedId = await b.eval(`null`)
  await setValue(b, '#project-payment-amount', '800')
  await clickIn('Salvar pagamento')
  await sleep(900)
  br = await project('br')
  all = await txs()
  brTx = all.filter((t) => t.source?.parentId === 'br')
  r.check('editar 1.000 → 800: a MESMA entrada passa a 800 (sem entrada nova)', brTx.length === 2 && brTx.some((t) => t.amount === 80000) && br.payments.some((p) => p.amount === 80000), JSON.stringify(brTx.map((t) => t.amount)))
  void editedId
  await b.eval(`[...document.querySelectorAll('[role=dialog] [aria-label="Pagamentos"] button')][0].click()`)
  await sleep(600)
  await b.click('Excluir pagamento', '[role=dialog] button')
  await sleep(500)
  r.check('excluir pede confirmação e explica o efeito no Financeiro', (await dialogText()).includes('sai do Financeiro'))
  await b.eval(`(() => { const btn = [...document.querySelectorAll('[role=dialog] button, [role=alertdialog] button')].reverse().find((x) => x.textContent.trim() === 'Excluir'); btn?.click() })()`)
  await sleep(900)
  br = await project('br')
  all = await txs()
  r.check('excluído: sai do projeto e do Financeiro', br.payments.length === 1 && all.filter((t) => t.source?.parentId === 'br').length === 1)
  r.check('sem rolagem horizontal nos detalhes (390px)', await noHorizontalScroll(b))
  await closeSheet()
  await closeSheet()

  // ---------- Financeiro: balance from the single source; linked income opens the project
  const expected = balance(await txs())
  await b.goto(BASE + '#/finance')
  await sleep(1200)
  const fin = await b.text()
  // 200 + 200 (Perfect Clean) + R$ 1.000 → €166,67 (Loja BR; the edited R$ 800 was then deleted) = €566,67; initial balance 0.
  const shown = `${Math.floor(expected / 100)},${String(expected % 100).padStart(2, '0')}`
  r.check('Financeiro mostra as entradas e o saldo = soma das movimentações (€566,67)', fin.includes('Perfect Clean · Pagamento de projeto') && fin.includes('Loja BR · Pagamento de projeto') && expected === 56667 && fin.includes(shown), `${expected} / ${shown}`)
  await b.click('Perfect Clean · Pagamento de projeto', 'button')
  await sleep(700)
  d = await dialogText()
  r.check('entrada vinculada: "veio de um pagamento" e "Abrir projeto" (não edita o valor aqui)', d.includes('Recebimento') && d.includes('Abrir projeto') && !d.includes('Salvar alterações'))
  await clickIn('Abrir projeto')
  await sleep(900)
  r.check('"Abrir projeto" leva ao projeto', (await b.eval('location.hash')).startsWith('#/projects') && (await dialogText()).includes('Perfect Clean'))

  // ---------- Reload: nothing duplicates
  const before = (await txs()).length
  await b.goto(BASE + 'favicon.svg')
  await b.goto(BASE + '#/finance')
  await sleep(3500)
  r.check('recarregar o app não duplica entradas', (await txs()).length === before, `${before} → ${(await txs()).length}`)

  // ---------- No rate (JPY): payment saved, income waits; created once the rate exists (once)
  await b.goto(BASE + '#/projects')
  await sleep(1200)
  await b.click('Todos', '[role=radio], button')
  await receiveOnCard('Tóquio')
  await sleep(700)
  r.check('sem cotação: avisa que entra no saldo quando houver cotação', (await dialogText()).includes('Sem cotação de JPY'))
  await setValue(b, '#project-payment-amount', '500')
  await clickIn('Confirmar recebimento')
  await sleep(2500)
  const jp = await project('jp')
  r.check('pagamento salvo; entrada ainda não existe', jp.payments?.length === 1 && !(await txs()).some((t) => t.currency === 'JPY'))
  await b.click('Tóquio', 'main button')
  await sleep(700)
  r.check('histórico marca "aguardando cotação"', (await dialogText()).includes('aguardando cotação'))
  await closeSheet()
  await b.eval(`new Promise((res) => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const tx = q.result.transaction('meta', 'readwrite'); const s = tx.objectStore('meta'); const g = s.get('settings'); g.onsuccess = () => { s.put({ ...g.result, manualRates: { JPY: 160 } }, 'settings') }; tx.oncomplete = () => { q.result.close(); res(true) } } })`)
  await b.goto(BASE + 'favicon.svg')
  await b.goto(BASE + '#/projects')
  await sleep(3500)
  let jpTx = (await txs()).filter((t) => t.currency === 'JPY')
  r.check('com cotação: a entrada aparece sozinha (JPY 500 → €3,13)', jpTx.length === 1 && jpTx[0].id === `rcv-project-${jp.payments[0].id}` && jpTx[0].amount === 50000 && jpTx[0].baseAmount === 313, JSON.stringify(jpTx))
  await b.goto(BASE + 'favicon.svg')
  await b.goto(BASE + '#/projects')
  await sleep(3000)
  jpTx = (await txs()).filter((t) => t.currency === 'JPY')
  r.check('e continua uma só depois de recarregar', jpTx.length === 1)

  // ---------- Vendas: specific and general payments become incomes; old payments don't
  await b.goto(BASE + '#/sales')
  await sleep(1200)
  await b.click('Maria', 'button')
  await sleep(700)
  await clickIn('Pagamento geral')
  await sleep(300)
  await fill('Valor do pagamento geral', '150')
  await clickIn('Registrar pagamento geral')
  await sleep(1000)
  let sales = await idb(b, 'sales')
  all = await txs()
  const general = all.filter((t) => t.source?.kind === 'saleGeneral')
  r.check('pagamento geral (€150 em 2 compras): UMA entrada "Pagamento de venda — Maria", categoria Vendas', general.length === 1 && general[0].amount === 15000 && general[0].reason === 'Pagamento de venda — Maria' && general[0].category === 'sales', JSON.stringify(general))
  r.check('pagamento antigo da venda (€50) não virou entrada', !all.some((t) => t.source?.paymentId === 'velho') && sales.find((s) => s.id === 'Bolo').payments.some((p) => p.id === 'velho' && !p.finance))
  await clickIn('Doce')
  await sleep(600)
  await clickIn('Registrar pagamento')
  await sleep(300)
  await fill('Valor', '30')
  await clickIn('Adicionar')
  await sleep(1000)
  sales = await idb(b, 'sales')
  all = await txs()
  const specific = all.filter((t) => t.source?.kind === 'sale')
  r.check('pagamento específico: uma entrada "Pagamento de venda — Maria · Doce"', specific.length === 1 && specific[0].amount === 3000 && specific[0].reason === 'Pagamento de venda — Maria · Doce')

  // Deleting the sale keeps the incomes (money received), unlinked — after a warning
  const nBefore = all.length
  await b.click('Editar venda', '[role=dialog] button')
  await sleep(700)
  await b.click('Excluir', '[role=dialog] button')
  await sleep(500)
  d = await dialogText()
  r.check('excluir venda avisa que as entradas continuam no Financeiro sem vínculo', d.includes('continua') && d.includes('sem vínculo'))
  await b.eval(`(() => { const btn = [...document.querySelectorAll('[role=dialog] button, [role=alertdialog] button')].reverse().find((x) => x.textContent.trim() === 'Excluir'); btn?.click() })()`)
  await sleep(1000)
  all = await txs()
  r.check('venda excluída: entradas ficam, sem vínculo', !(await idb(b, 'sales')).some((s) => s.id === 'Doce') && all.length === nBefore && all.filter((t) => t.reason.includes('Doce')).every((t) => !t.source))
  await closeSheet()
  await closeSheet()

  // Deleting a project: same rule
  await b.goto(BASE + '#/projects')
  await sleep(1200)
  await b.click('Todos', '[role=radio], button')
  await b.click('Loja BR', 'main button')
  await sleep(700)
  await clickIn('Editar')
  await sleep(700)
  r.check('"Editar projeto" não tem mais o campo "Valor recebido"', !(await dialogText()).includes('Valor recebido') && (await dialogText()).includes('Valor do projeto'))
  r.check('moeda travada depois de registrar pagamentos', (await dialogText()).includes('não muda depois de registrar pagamentos'))
  await b.click('Excluir', '[role=dialog] button')
  await sleep(500)
  r.check('excluir projeto avisa que a entrada continua no Financeiro sem vínculo', (await dialogText()).includes('sem vínculo com o projeto'))
  await b.eval(`(() => { const btn = [...document.querySelectorAll('[role=dialog] button, [role=alertdialog] button')].reverse().find((x) => x.textContent.trim() === 'Excluir'); btn?.click() })()`)
  await sleep(1000)
  all = await txs()
  r.check('projeto excluído: entrada continua (R$ 1.000), sem vínculo', !(await project('br')) && all.filter((t) => t.reason.startsWith('Loja BR')).length === 1 && all.filter((t) => t.reason.startsWith('Loja BR')).every((t) => !t.source))

  // ---------- Desktop
  await b.desktop()
  await b.goto(BASE + '#/projects')
  await sleep(1200)
  r.check('sem rolagem horizontal em Projetos (1366px)', await noHorizontalScroll(b))
  await b.goto(BASE + '#/finance')
  await sleep(1000)
  r.check('sem rolagem horizontal no Financeiro (1366px)', await noHorizontalScroll(b))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('receipts-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
