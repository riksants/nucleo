// Vendas por pessoa: resumo, abas Pessoas/Vendas, pagamento geral e específico, filtros, busca,
// moedas e o fluxo antigo de venda individual. Pessoa que já usava o app (vendas no formato antigo), modo local.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9384)
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'agenda', 'week']
const old = (id, over) => ({ id, clientId: null, clientName: 'Maria', product: id, quantity: 1, date: '2026-09-01', total: 10000, currency: 'BRL', dueDate: '', payments: [], notes: '', ...over })
const dialogText = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText).join('\\n')`)
/** Fills an input inside the open sheet found by its label (or aria-label). */
const fill = (label, value) =>
  b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = d.querySelector('input[aria-label=${JSON.stringify(label)}]') || [...d.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(${JSON.stringify(label)}))?.querySelector('input, textarea'); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
const clickIn = (text) => b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = [...d.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(text)} || x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.click(); return true })()`)
const closeSheet = async () => {
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await b.sleep(450)
}
const sales = () => idb(b, 'sales')
const paidOf = (s) => s.payments.reduce((t, p) => t + p.amount, 0)

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(
    b,
    {
      sales: [
        old('Produto A', { date: '2026-09-01', total: 10000, payments: [{ id: 'oa', date: '2026-09-01', amount: 10000, note: 'Pago na venda' }] }),
        old('Produto B', { date: '2026-09-03', total: 25000, payments: [{ id: 'ob', date: '2026-09-04', amount: 5000, note: '' }] }),
        old('Produto C', { date: '2026-09-05', total: 5000, clientName: ' maria ' }),
        old('Livro', { clientName: 'Bruno', total: 4000, payments: [{ id: 'ol', date: '2026-09-02', amount: 4000, note: '' }] }),
        old('Bolsa', { clientName: 'Carla', total: 2000, currency: 'EUR', date: '2026-09-07' }),
      ],
    },
    { baseCurrency: 'BRL', displayCurrency: 'BRL', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: [...ALL, 'life'] },
  )
  await b.goto(BASE + '#/sales')
  await b.sleep(1500)
  let text = await b.text()
  r.check('resumo no topo: vendido, recebido, a receber e pessoas pendentes', text.includes('Total vendido') && text.includes('Total recebido') && text.includes('Total a receber') && text.includes('Pessoas com valor pendente'))
  r.check('resumo separa moedas (R$ 440,00 vendido e € 20,00)', text.includes('R$ 440,00') && text.includes('€ 20,00'), text.slice(0, 300))
  const pending = await b.eval(`(() => { const c = document.querySelector('[aria-label="Resumo de vendas"]'); return c ? c.innerText : '' })()`)
  r.check('2 pessoas com valor pendente (Maria e Carla)', /Pessoas com valor pendente\s*2/.test(pending), pending)
  r.check('aba Pessoas é a padrão', (await b.eval(`[...document.querySelectorAll('[role=radio]')].find(x => x.textContent.trim() === 'Pessoas')?.getAttribute('aria-checked')`)) === 'true')
  r.check('Maria aparece uma vez só (nomes "Maria" e " maria " juntos), com 3 compras e R$ 250,00 pendente', (text.match(/maria/gi) ?? []).length === 1 && /Maria\s*3 compras/.test(text) && text.includes('R$ 250,00'))
  await b.shot('vendas-pessoas')
  r.check('sem rolagem horizontal (390px)', await noHorizontalScroll(b))

  // Filters and search
  await b.click('Pagos', '[role=radio], button')
  await b.sleep(300)
  text = await b.text()
  r.check('filtro Pagos mostra só Bruno', text.includes('Bruno') && !text.includes('Maria') && !text.includes('Carla'))
  await b.click('Parciais', '[role=radio], button')
  await b.sleep(300)
  text = await b.text()
  r.check('filtro Parciais mostra só Maria', text.includes('Maria') && !text.includes('Bruno') && !text.includes('Carla'))
  await b.click('Pendentes', '[role=radio], button')
  await b.sleep(300)
  text = await b.text()
  r.check('filtro Pendentes mostra só Carla (em €)', text.includes('Carla') && text.includes('€ 20,00') && !text.includes('Bruno'))
  await b.click('Todos', '[role=radio], button')
  await setValue(b, 'input[placeholder="Buscar pessoa"]', 'bru')
  await b.sleep(300)
  text = await b.text()
  r.check('busca por nome', text.includes('Bruno') && !text.includes('Maria'))
  await setValue(b, 'input[placeholder="Buscar pessoa"]', '')
  await b.sleep(300)

  // Person detail
  await b.click('Maria', 'button')
  await b.sleep(600)
  let d = await dialogText()
  r.check('detalhe: total comprado 400, pago 150, falta 250', d.includes('Total comprado') && d.includes('R$ 400,00') && d.includes('R$ 150,00') && d.includes('R$ 250,00'), d.slice(0, 400))
  r.check('detalhe lista as compras e o histórico de pagamentos', d.includes('Produto A') && d.includes('Produto C') && /histórico de pagamentos/i.test(d) && (d.match(/Pagamento específico/g) ?? []).length === 2, d.slice(0, 900).replace(/\n/g, ' | '))

  // General payment: too much is blocked, "Usar o valor que falta" fills exactly
  await clickIn('Pagamento geral')
  await b.sleep(300)
  await fill('Valor do pagamento geral', '300')
  await clickIn('Registrar pagamento geral')
  await b.sleep(300)
  d = await dialogText()
  r.check('pagamento maior que o devido é impedido', d.includes('O valor passa do que falta') && d.includes('Usar o valor que falta'))
  const before = await sales()
  r.check('nada foi salvo no pagamento recusado', before.every((s) => !s.payments.some((p) => p.generalId)))
  await clickIn('Usar o valor que falta')
  await b.sleep(200)
  r.check('"Usar o valor que falta" preenche 250', (await b.eval(`document.querySelector('input[aria-label="Valor do pagamento geral"]').value`)) === '250')
  await fill('Valor do pagamento geral', '200')
  await fill('Observação', 'Pix')
  await clickIn('Registrar pagamento geral')
  await b.sleep(700)
  d = await dialogText()
  r.check('após pagamento geral de 200: falta 50', d.includes('R$ 50,00') && d.includes('R$ 350,00'))
  r.check('histórico mostra "Pagamento geral" distribuído automaticamente (não parece escolha de produto)', d.includes('Pagamento geral') && d.includes('Distribuído automaticamente') && d.includes('Pix'))
  let all = await sales()
  const pieces = all.flatMap((s) => s.payments.filter((p) => p.generalId).map((p) => ({ product: s.product, amount: p.amount, g: p.generalId })))
  r.check('internamente: repartido nas compras mais antigas em aberto (B 200), um único pagamento geral', pieces.length === 1 && pieces[0].product === 'Produto B' && pieces[0].amount === 20000, JSON.stringify(pieces))
  r.check('total pago da Maria sem duplicidade (350)', all.filter((s) => s.clientName.trim().toLowerCase() === 'maria').reduce((t, s) => t + paidOf(s), 0) === 35000)
  await b.shot('vendas-maria')

  // Specific payment on Produto C, from the purchase
  await clickIn('Produto C')
  await b.sleep(600)
  d = await dialogText()
  r.check('abre a compra a partir da pessoa', d.includes('Produto C') && /pagamentos/i.test(d), d.slice(0, 300).replace(/\n/g, ' | '))
  await clickIn('Registrar pagamento')
  await b.sleep(300)
  r.check('formulário diz que é pagamento específico', (await dialogText()).includes('Pagamento específico desta compra'))
  await fill('Valor', '60')
  await clickIn('Adicionar')
  await b.sleep(300)
  r.check('pagamento específico acima do que falta é impedido', (await dialogText()).includes('O valor passa do que falta'))
  await clickIn('Usar o valor que falta')
  await clickIn('Adicionar')
  await b.sleep(600)
  all = await sales()
  const c = all.find((s) => s.product === 'Produto C')
  r.check('pagamento específico registrado (sem generalId)', c.payments.length === 1 && c.payments[0].amount === 5000 && !c.payments[0].generalId)
  r.check('compra mostra "Pagamento específico"', (await dialogText()).includes('Pagamento específico'))
  await clickIn('Ver todas as compras de')
  await b.sleep(600)
  d = await dialogText()
  r.check('volta para a pessoa: agora Pago', d.includes('Pago') && /Falta pagar\s*R\$ 0,00/.test(d), d.slice(0, 300))

  // Purchase that received part of a general payment shows it clearly
  await clickIn('Produto B')
  await b.sleep(600)
  d = await dialogText()
  r.check('compra com parte do geral mostra "Pagamento geral" e que foi aplicado pelo app', d.includes('Pagamento geral') && d.includes('Aplicado automaticamente pelo app') && d.includes('Pagamento específico'))
  await clickIn('Ver todas as compras de')
  await b.sleep(600)

  // New purchase for the same person (debt grows, history kept)
  await clickIn('Nova venda')
  await b.sleep(700)
  r.check('nova venda já vem com a pessoa', (await b.eval(`[...document.querySelectorAll('[role=dialog] input')].some(i => i.value === 'Maria' || i.value === ' maria ')`)))
  await fill('Produto', 'Tênis')
  await b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = [...d.querySelectorAll('label')].find(l => l.textContent.trim().startsWith('Valor total')); const i = el?.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, '300'); i.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await clickIn('Registrar venda')
  await b.sleep(800)
  text = await b.text()
  r.check('nova compra entra no total: Maria com 4 compras e R$ 300,00 pendente', /Maria\s*4 compras/.test(text) && text.includes('R$ 300,00'), text.slice(0, 700).replace(/\n/g, ' | '))
  all = await sales()
  r.check('histórico antigo mantido (pagamentos antigos intactos)', all.find((s) => s.product === 'Produto A').payments[0].id === 'oa' && all.find((s) => s.product === 'Produto B').payments.some((p) => p.id === 'ob'))

  // Avoid duplicates: typing an existing name suggests it
  await b.click('Nova', 'button')
  await b.sleep(700)
  await fill('Ou nome de quem comprou', 'mar')
  await b.sleep(200)
  d = await dialogText()
  r.check('ao digitar, sugere a pessoa existente', d.includes('Usar Maria · 4 compras'), d.slice(0, 500).replace(/\n/g, ' | '))
  await fill('Ou nome de quem comprou', 'MARIA')
  await b.sleep(200)
  r.check('nome igual com outra grafia vai para a mesma pessoa', (await dialogText()).includes('Vai para as compras de Maria'))
  await closeSheet()

  // Old individual flow still works (Vendas tab)
  await b.click('Vendas', '[role=radio]')
  await b.sleep(400)
  text = await b.text()
  r.check('aba Vendas mantém a lista individual', text.includes('Livro') && text.includes('Bolsa') && text.includes('Tênis'), text.slice(0, 600).replace(/\n/g, ' | '))
  await b.click('Nova', 'button')
  await b.sleep(600)
  await fill('Ou nome de quem comprou', 'Diego')
  await fill('Produto', 'Caneca')
  await b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = [...d.querySelectorAll('label')].find(l => l.textContent.trim().startsWith('Valor total')); const i = el?.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, '50'); i.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await fill('Já recebeu quanto?', '20')
  await clickIn('Registrar venda')
  await b.sleep(700)
  all = await sales()
  const caneca = all.find((s) => s.product === 'Caneca')
  r.check('venda individual com "já recebeu" continua igual', caneca?.clientName === 'Diego' && caneca.total === 5000 && caneca.payments[0].amount === 2000 && !caneca.payments[0].generalId)
  r.check('lista mostra a venda nova com "falta"', (await b.text()).includes('falta R$ 30,00'))

  await b.desktop()
  await b.goto(BASE + '#/sales')
  await b.sleep(1000)
  r.check('sem rolagem horizontal (1366px)', await noHorizontalScroll(b))
  await b.shot('vendas-desktop')
  await b.click('Maria', 'button')
  await b.sleep(700)
  r.check('detalhe da pessoa sem rolagem horizontal (1366px)', await noHorizontalScroll(b))
  await b.shot('vendas-maria-desktop')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('vendas-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
