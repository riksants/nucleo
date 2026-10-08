// Etapa 3 — Finanças: categorias opcionais, gasto desnecessário, metas com prazo, resumo mensal,
// previsão e integração com Semana/metas/desafios. Pessoa que já usava o app (banco v2), modo local.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9381)
const TZ = 'America/Sao_Paulo'
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'agenda', 'week']
const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString()

/** Chooses an option of a <select> the way React expects. */
const choose = (selector, value) =>
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
const fillIn = (labelText, value) =>
  b.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.trim().startsWith(${JSON.stringify(labelText)})); const el = l && (l.querySelector('input, textarea') || l.parentElement.querySelector('input, textarea')); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
/** Cards whose content is wider than the card (a value leaking out). */
const overflowingCards = () => b.eval(`[...document.querySelectorAll('main .card')].filter(c => c.scrollWidth > c.clientWidth + 1).length`)

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  const old = [
    { id: 'old-in', type: 'in', amount: 350000, currency: 'BRL', baseAmount: 350000, reason: 'Pagamento antigo', createdAt: ago(40), updatedAt: ago(40) },
    { id: 'old-out', type: 'out', amount: 12000, currency: 'BRL', baseAmount: -12000, reason: 'Mercado antigo', createdAt: ago(35), updatedAt: ago(35) },
    { id: 'big', type: 'in', amount: 999999999, currency: 'BRL', baseAmount: 999999999, reason: 'Valor bem grande', createdAt: ago(2), updatedAt: ago(2) },
  ]
  await seedExistingUser(b, { transactions: old }, { baseCurrency: 'BRL', displayCurrency: 'BRL', startedAt: ago(60), modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL })

  await b.goto(BASE + '#/finance')
  await b.sleep(1200)
  await b.click('Tudo', '[role=radio], button')
  let text = await b.text()
  r.check('Financeiro abre com histórico antigo e saldo, como antes', text.includes('Pagamento antigo') && text.includes('Mercado antigo') && text.includes('Adicionar') && text.includes('Retirar'))
  const v = await b.eval(`new Promise(r => { const q = indexedDB.open('nucleo'); q.onsuccess = () => { const v = q.result.version; const has = q.result.objectStoreNames.contains('financeGoals'); q.result.close(); r(v + ':' + has) } })`)
  r.check('banco do aparelho atualizado (v5 ou mais) com metas financeiras', Number(v.split(':')[0]) >= 5 && v.endsWith(':true'), v)
  const oldRec = await idb(b, 'transactions', 'old-out')
  r.check('movimentação antiga intacta (sem categoria criada sozinha)', oldRec && !('category' in oldRec) && !('unnecessary' in oldRec) && oldRec.baseAmount === -12000)

  // New expense with category + unnecessary
  await b.click('Retirar')
  await setValue(b, '#tx-amount', '25')
  await setValue(b, '#tx-reason', 'Lanche')
  await choose('#tx-category', 'food')
  await b.click('Gasto desnecessário', '[role=switch]')
  await b.click('Retirar R$ 25,00', 'button')
  await b.sleep(500)
  let all = await idb(b, 'transactions')
  const lanche = all.find((t) => t.reason === 'Lanche')
  r.check('saída com categoria e marcada como desnecessária', lanche?.category === 'food' && lanche.unnecessary === true && lanche.baseAmount === -2500)

  // New expense without category: no extra fields
  await b.click('Retirar')
  await setValue(b, '#tx-amount', '10')
  await setValue(b, '#tx-reason', 'Café')
  await b.click('Retirar R$ 10,00', 'button')
  await b.sleep(500)
  all = await idb(b, 'transactions')
  const cafe = all.find((t) => t.reason === 'Café')
  r.check('saída sem categoria continua sem campos novos (categoria é opcional)', cafe && !('category' in cafe) && !('unnecessary' in cafe))
  text = await b.text()
  r.check('lista mostra a categoria e a marcação de forma discreta', text.includes('Alimentação · desnecessário') || (text.includes('Alimentação') && text.includes('desnecessário')))

  // Edit an old movement: still no category, same base value
  await b.click('Mercado antigo', 'button')
  await setValue(b, '#tx-reason', 'Mercado (antigo)')
  await b.click('Salvar alterações', 'button')
  await b.sleep(500)
  const edited = await idb(b, 'transactions', 'old-out')
  r.check('editar movimentação antiga preserva valor e não cria categoria', edited.reason === 'Mercado (antigo)' && edited.baseAmount === -12000 && !('category' in edited) && edited.createdAt === oldRec.createdAt)

  // Filter by category
  await choose('select[aria-label="Filtrar por categoria"]', 'none')
  await b.sleep(300)
  text = await b.text()
  r.check('filtro "Sem categoria" mostra as antigas e esconde a categorizada', text.includes('Mercado (antigo)') && text.includes('Café') && !text.includes('Lanche'))
  await choose('select[aria-label="Filtrar por categoria"]', 'food')
  await b.sleep(300)
  text = await b.text()
  r.check('filtro por categoria mostra só a categoria escolhida', text.includes('Lanche') && !text.includes('Café'))
  await choose('select[aria-label="Filtrar por categoria"]', 'all')

  // This month + forecast (few movements this month → neutral message or estimate words)
  text = await b.text()
  r.check('card "Este mês" com previsão em linguagem de estimativa', /ESTE MÊS/i.test(text) && (text.includes('Ainda não há dados suficientes para uma previsão confiável.') || text.includes('estimativa')))

  // Finance goal with deadline
  await b.click('Nova meta')
  await fillIn('Nome', 'Reserva de emergência')
  await fillIn('Valor objetivo', '5000')
  await fillIn('Já guardado', '2000')
  const deadline = new Date(Date.now() + 92 * 86_400_000).toISOString().slice(0, 10)
  await fillIn('Data limite', deadline)
  await b.click('Criar meta', 'button')
  await b.sleep(500)
  let goals = await idb(b, 'financeGoals')
  r.check('meta financeira criada com valor, guardado, prazo e moeda', goals.length === 1 && goals[0].target === 500000 && goals[0].saved === 200000 && goals[0].deadline === deadline && goals[0].currency === 'BRL' && goals[0].status === 'active')
  text = await b.text()
  r.check('meta mostra quanto falta e o necessário por mês, sem tom negativo', text.includes('faltam R$ 3.000,00') && /Como alcançar\s*Guardar R\$ [\d.]+\/mês/.test(text) && !/atrasad/i.test(text))

  await b.click('Reserva de emergência', 'button')
  await fillIn('Quanto guardou', '300')
  await b.click('Salvar · R$ 2.300,00 guardados', 'button')
  await b.sleep(500)
  goals = await idb(b, 'financeGoals')
  r.check('atualizar valor guardado soma e registra o histórico', goals[0].saved === 230000 && goals[0].history.length === 2)

  // Rename
  await b.goto(BASE + '#/goals')
  await b.sleep(500)
  r.check('seção antiga agora se chama "Metas de compra"', (await b.text()).includes('Metas de compra'))

  // Week: money card + weekly "Guardar" goal + challenge
  await b.goto(BASE + '#/week')
  await b.sleep(2200)
  text = await b.text()
  r.check('Semana mostra o card Dinheiro com gasto e maior categoria', /DINHEIRO/i.test(text) && text.includes('Você gastou R$ 35,00') && text.includes('Seu maior gasto foi Alimentação: R$ 25,00.'))
  r.check('Semana mostra gasto desnecessário e o guardado na meta', text.includes('1 gasto marcado como desnecessário') && text.includes('Guardou R$ 300,00 nas metas com prazo.'))
  await b.click('Nova meta')
  await b.click('Valor', '[role=radio], button')
  await b.sleep(300)
  const metric = await b.eval(`document.querySelector('[role=dialog] select')?.value`)
  r.check('meta semanal de valor oferece "Guardar" como primeira opção', metric === 'finance.saved')
  await b.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.trim().startsWith('Alvo')); const el = l.parentElement.querySelector('input') || l.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'200'); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await b.click('Salvar', '[role=dialog] button[type=submit], [role=dialog] button')
  await b.sleep(500)
  const wg = (await idb(b, 'weeklyGoals'))[0]
  text = await b.text()
  r.check('meta "Guardar R$ 200" usa o valor registrado na meta (R$ 300 → cumprida)', wg?.metric === 'finance.saved' && wg.title === 'Guardar R$ 200,00' && /Guardar R\$ 200,00\s*Cumprida/.test(text), JSON.stringify(wg) + ' | ' + text.slice(Math.max(0, text.indexOf('Guardar')), text.indexOf('Guardar') + 160))

  await b.click('Escolher')
  await b.click('7 dias sem gasto desnecessário', 'button')
  await b.click('Começar desafio')
  await b.sleep(500)
  const ch = (await idb(b, 'challenges'))[0]
  text = await b.text()
  r.check('desafio "sem gasto desnecessário" usa a marcação real (hoje tem gasto marcado → 0)', ch?.rule === 'finance:nospend' && text.includes('0 de 7'))

  await b.click('Ver detalhes financeiros')
  await b.sleep(800)
  text = await b.text()
  r.check('"Ver detalhes" abre o resumo do mês no Financeiro', text.toUpperCase().includes('CATEGORIAS COM MAIOR GASTO') && text.includes('Alimentação') && text.toUpperCase().includes('GASTOS MARCADOS COMO DESNECESSÁRIOS'))
  r.check('resumo mensal com saldo inicial, entradas, saídas e comparação', text.includes('Entradas') && text.includes('Saídas') && /Saldo (no início do mês|ao começar)/.test(text) && text.toUpperCase().includes('COMPARAÇÃO'))
  r.check('sem rolagem horizontal no resumo (390px)', await noHorizontalScroll(b))
  r.check('valores grandes cabem nos cards (390px)', (await overflowingCards()) === 0)
  await b.shot('financas-mes')
  await b.click('Mês anterior')
  await b.sleep(500)
  r.check('mês anterior carrega sob demanda', /mês|Saídas/.test(await b.text()) && !(await b.text()).includes('mês em andamento'))

  // Custom category
  await b.goto(BASE + '#/settings')
  await b.click('Categorias financeiras')
  await b.eval(`(() => { const el = document.querySelector('input[aria-label="Nova categoria"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Pets'); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await b.click('Adicionar', '[role=dialog] button')
  await b.click('Mostrar Viagem', '[role=switch]')
  await b.sleep(400)
  await b.goto(BASE + '#/finance')
  await b.click('Retirar')
  const options = await b.eval(`[...document.querySelectorAll('#tx-category option')].map(o => o.textContent)`)
  r.check('categoria personalizada aparece e a oculta some da escolha', options.includes('Pets') && !options.includes('Viagem') && options[0] === 'Sem categoria')
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await b.sleep(400)

  await b.goto(BASE + '#/finance')
  await b.sleep(800)
  r.check('sem rolagem horizontal no Financeiro (390px)', await noHorizontalScroll(b), String(await b.eval(`(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > w + 1).slice(0, 4).map(e => e.tagName + '.' + String(e.className).slice(0, 60) + ':' + Math.round(e.getBoundingClientRect().right)).join(' ; ') })()`)))
  r.check('valores grandes cabem nos cards do Financeiro (390px)', (await overflowingCards()) === 0)
  await b.shot('financas')

  await b.desktop()
  await b.goto(BASE + '#/finance')
  await b.sleep(800)
  r.check('sem rolagem horizontal no Financeiro (1366px)', await noHorizontalScroll(b))
  r.check('valores grandes cabem nos cards (1366px)', (await overflowingCards()) === 0)
  await b.shot('financas-desktop')
  await b.goto(BASE + '#/finance?view=month')
  await b.sleep(800)
  r.check('sem rolagem horizontal no resumo do mês (1366px)', await noHorizontalScroll(b))
  await b.goto(BASE + '#/week')
  await b.sleep(800)
  r.check('sem rolagem horizontal na Semana com o card Dinheiro (1366px)', await noHorizontalScroll(b))
  const logs = b.logs.filter((l) => /R\$|\d{3,},\d\d/.test(l))
  r.check('nenhum valor financeiro no console', logs.length === 0, logs.slice(0, 2).join(' | '))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('financas-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
