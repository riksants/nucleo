// Buscar universal: seções, telas e ações por nome, sinônimo, plural, erro de digitação e intenção; registros
// reais; nada de senha nos resultados; seção escondida; Enter abre o primeiro; rapidez com muitos registros.
// Celular e computador. Modo local.
import { launch } from './cdp.mjs'
import { BASE, noHorizontalScroll, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9601)
const ON = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'recurring', 'agenda', 'week', 'life']
const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString()
const SECRET = 'S3gr3doMuitoForte!'

// Many movements, so typing is measured with a realistic amount of data.
const many = Array.from({ length: 2500 }, (_, i) => ({ id: `tx${i}`, type: i % 3 ? 'out' : 'in', amount: 1000 + i, currency: 'EUR', baseAmount: i % 3 ? -(1000 + i) : 1000 + i, reason: `Lançamento ${i} mercado`, createdAt: ago(i % 200) }))

const typeSearch = (value) =>
  b.eval(`(() => { const el = document.querySelector('main input[type=search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
const groups = () => b.eval(`[...document.querySelectorAll('main section[aria-label]')].map((s) => ({ label: s.getAttribute('aria-label'), rows: [...s.querySelectorAll('.card > button')].map((x) => x.innerText.split('\\n')[0]) }))`)
const search = async (q) => {
  await typeSearch(q)
  await b.sleep(350)
  return groups()
}
const rowsOf = (gs, label) => gs.find((g) => g.label === label)?.rows ?? []
const dialogTitle = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].pop()?.innerText.split('\\n')[0] ?? ''`)
const escape = async () => {
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await b.sleep(400)
}
const openSearch = async () => {
  await b.goto(BASE + '#/search')
  await b.sleep(700)
}

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(
    b,
    {
      clients: [{ id: 'c1', name: 'João Pereira', company: 'Padaria Sol', phone: '+351 912 345 678', whatsapp: '', email: 'joao@padariasol.pt', location: 'Lisboa', notes: '', status: 'active' }],
      projects: [{ id: 'p1', name: 'Site da Padaria', clientId: 'c1', kind: 'site', status: 'inProgress', startDate: '', dueDate: '', endDate: '', charged: 120000, received: 20000, currency: 'EUR', link: '', notes: '' }],
      tasks: [{ id: 'k1', title: 'Enviar orçamento', projectId: 'p1', dueDate: '', priority: 'none', status: 'todo', completedAt: null }],
      tools: [{ id: 'o1', name: 'Netflix', link: '', plan: 'Padrão', price: 1399, currency: 'EUR', billing: 'monthly', nextCharge: '', notes: '', status: 'active' }],
      transactions: [{ id: 't1', type: 'out', amount: 85000, currency: 'EUR', baseAmount: -85000, reason: 'Pagamento do aluguel', createdAt: ago(2) }, ...many],
      notes: [{ id: 'n1', title: 'Ideias de logo', body: 'Cores quentes para a padaria', pinned: false }],
      accounts: [{ id: 'a1', name: 'Gmail pessoal', clientId: null, projectId: null, link: 'https://mail.google.com', email: 'eu@exemplo.com', username: '', password: SECRET, notes: 'PIN do cartão 4321' }],
    },
    { modules: { ...Object.fromEntries(ON.map((m) => [m, true])), habits: false }, modulesSeen: [...ON, 'habits'], startedAt: ago(90) },
  )

  // ---------- Empty search: suggestions, no "Nada encontrado"
  await openSearch()
  let text = await b.text()
  await b.shot('busca-vazia')
  r.check('busca vazia mostra sugestões', text.includes('Experimente') && text.includes('Registrar pagamento') && !text.includes('Nada encontrado'))
  await b.click('Quanto tenho para receber?', 'button')
  await b.sleep(400)
  let gs = await groups()
  r.check('tocar numa sugestão preenche a busca e mostra o resultado', rowsOf(gs, 'Ir para').includes('A receber em projetos'), JSON.stringify(gs))

  // ---------- Sections and screens by name, plural, accent and typo
  await openSearch()
  gs = await search('clientes')
  r.check('"clientes" → seção Clientes primeiro', rowsOf(gs, 'Ir para')[0] === 'Clientes', JSON.stringify(gs))
  await b.click('Clientes', 'main .card > button')
  await b.sleep(700)
  r.check('abre a seção Clientes', (await b.eval('location.hash')) === '#/clients')

  await openSearch()
  gs = await search('portifolio')
  r.check('"portifolio" (erro de digitação) → Portfólio', rowsOf(gs, 'Ir para')[0] === 'Portfólio', JSON.stringify(gs))
  gs = await search('Alimentação')
  r.check('"Alimentação" → seção Alimentação', rowsOf(gs, 'Ir para')[0] === 'Alimentação', JSON.stringify(gs))
  gs = await search('contas')
  const contas = rowsOf(gs, 'Ir para')
  r.check('"contas" → Conta, Senhas e Recorrentes', ['Conta', 'Senhas', 'Recorrentes'].every((x) => contas.includes(x)), JSON.stringify(contas))
  gs = await search('assinaturas')
  r.check('"assinaturas" → seção e ação "Nova assinatura" + o registro', rowsOf(gs, 'Ir para')[0] === 'Assinaturas' && rowsOf(gs, 'Fazer agora').includes('Nova assinatura'), JSON.stringify(gs))
  gs = await search('pagamento')
  r.check('"pagamento" → Financeiro, ação de registrar e a movimentação real', rowsOf(gs, 'Ir para').includes('Financeiro') && rowsOf(gs, 'Fazer agora').includes('Registrar saída') && rowsOf(gs, 'Movimentações').includes('Pagamento do aluguel'), JSON.stringify(gs))
  gs = await search('backup')
  r.check('configurações também aparecem ("backup")', rowsOf(gs, 'Ir para')[0] === 'Backup', JSON.stringify(gs))
  gs = await search('cli')
  r.check('resultado já enquanto digita ("cli")', rowsOf(gs, 'Ir para')[0] === 'Clientes', JSON.stringify(gs))

  // ---------- Intent
  gs = await search('Quero adicionar um cliente')
  r.check('"Quero adicionar um cliente" → "Novo cliente" primeiro', gs[0]?.label === 'Fazer agora' && gs[0].rows[0] === 'Novo cliente', JSON.stringify(gs))
  await b.shot('busca-intencao')
  await b.click('Novo cliente', 'main .card > button')
  await b.sleep(900)
  r.check('a ação abre o formulário de cliente', (await b.eval('location.hash')) === '#/clients' && (await dialogTitle()).includes('Novo cliente'), await dialogTitle())
  await escape()

  await openSearch()
  gs = await search('Registrar pagamento')
  r.check('"Registrar pagamento" → "Registrar saída"', gs[0]?.rows[0] === 'Registrar saída', JSON.stringify(gs))
  await b.click('Registrar saída', 'main .card > button')
  await b.sleep(900)
  r.check('abre "Retirar dinheiro" no Financeiro', (await b.eval('location.hash')) === '#/finance' && (await dialogTitle()).includes('Retirar dinheiro'), await dialogTitle())
  await escape()

  await openSearch()
  gs = await search('Criar meta')
  r.check('"Criar meta" → "Nova meta de compra"', gs[0]?.rows[0] === 'Nova meta de compra', JSON.stringify(gs))
  await b.click('Nova meta de compra', 'main .card > button')
  await b.sleep(900)
  r.check('abre o formulário de meta', (await dialogTitle()).includes('Nova meta'), await dialogTitle())
  await escape()

  await openSearch()
  gs = await search('novo objetivo')
  await b.click('Novo objetivo', 'main .card > button')
  await b.sleep(900)
  r.check('"novo objetivo" abre o formulário dentro de Vida', (await b.eval('location.hash')) === '#/life' && (await dialogTitle()).includes('Novo objetivo'), await dialogTitle())
  await escape()

  await openSearch()
  gs = await search('Quanto tenho para receber?')
  text = await b.text()
  r.check('"Quanto tenho para receber?" → valor real a receber dos projetos', rowsOf(gs, 'Ir para')[0]?.startsWith('A receber') && /1\.000,00|1 000,00|1000,00/.test(text), JSON.stringify(gs))
  await b.shot('busca-pergunta')
  gs = await search('Minhas tarefas')
  r.check('"Minhas tarefas" → Tarefas', rowsOf(gs, 'Ir para')[0] === 'Tarefas', JSON.stringify(gs))

  // ---------- Real records
  gs = await search('joao')
  r.check('registro: cliente sem acento', rowsOf(gs, 'Clientes').includes('João Pereira'), JSON.stringify(gs))
  gs = await search('padaria')
  r.check('registro: empresa, projeto ligado ao cliente e nota', rowsOf(gs, 'Clientes').includes('João Pereira') && rowsOf(gs, 'Projetos de trabalho').includes('Site da Padaria') && rowsOf(gs, 'Anotações').includes('Ideias de logo'), JSON.stringify(gs))
  gs = await search('orcamneto')
  r.check('registro com erro de digitação ("orcamneto")', rowsOf(gs, 'Tarefas').includes('Enviar orçamento'), JSON.stringify(gs))
  await search('joao')
  await b.click('João Pereira', 'main .card > button')
  await b.sleep(900)
  r.check('abre o cliente direto', (await b.eval('location.hash')) === '#/clients' && (await b.text()).includes('Padaria Sol') && (await b.eval(`!!document.querySelector('[role=dialog]')`)))
  await escape()

  // ---------- Sensitive data
  await openSearch()
  gs = await search(SECRET)
  text = await b.text()
  r.check('a senha não é pesquisável', !gs.length && text.includes('Nada encontrado'), JSON.stringify(gs))
  gs = await search('4321')
  r.check('as notas de um acesso não são pesquisáveis', !gs.length, JSON.stringify(gs))
  gs = await search('gmail')
  text = await b.text()
  r.check('acesso aparece só com nome e e-mail, sem a senha', rowsOf(gs, 'Senhas').includes('Gmail pessoal') && !text.includes(SECRET) && !text.includes('4321'))

  // ---------- Hidden section, nothing found, Enter
  gs = await search('hábitos')
  text = await b.text()
  r.check('seção escondida aparece como "Seção escondida", sem ações dela', rowsOf(gs, 'Ir para').includes('Hábitos') && text.includes('Seção escondida') && !rowsOf(gs, 'Fazer agora').includes('Novo hábito'), JSON.stringify(gs))
  await b.click('Hábitos', 'main .card > button')
  await b.sleep(900)
  r.check('e leva a Personalizar seções', (await b.eval('location.hash')).startsWith('#/settings'))
  await escape()
  await openSearch()
  gs = await search('qwrtzxv')
  text = await b.text()
  r.check('"Nada encontrado" só sem resultados, com saída para o Assistente', !gs.length && text.includes('Nada encontrado') && text.includes('Perguntar ao Assistente'))
  await search('agenda')
  await b.eval(`document.querySelector('main input[type=search]').focus()`)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await b.sleep(700)
  r.check('Enter abre o primeiro resultado', (await b.eval('location.hash')) === '#/agenda', await b.eval('location.hash'))

  // ---------- Speed with ~2.500 records (phone)
  await openSearch()
  const ms = await b.eval(`new Promise((resolve) => {
    const el = document.querySelector('main input[type=search]')
    const t0 = performance.now()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, 'mercad')
    el.dispatchEvent(new Event('input',{bubbles:true}))
    const tick = () => document.querySelector('main section[aria-label="Movimentações"]') ? resolve(Math.round(performance.now() - t0)) : performance.now() - t0 > 5000 ? resolve(-1) : requestAnimationFrame(tick)
    tick()
  })`)
  r.check('resultados com 2.500 movimentações aparecem rápido (< 800 ms aqui)', ms > 0 && ms < 800, `${ms} ms`)
  r.check('celular sem rolagem horizontal', await noHorizontalScroll(b), await b.eval(`document.documentElement.scrollWidth + '/' + document.documentElement.clientWidth + '/' + innerWidth + ' ' + [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 4).map((e) => e.tagName + '.' + String(e.className).slice(0, 60)).join(' | ')`))
  await search('padaria')
  await b.shot('busca-celular')

  // ---------- Computer
  await b.desktop()
  await openSearch()
  gs = await search('clientes')
  r.check('computador: "clientes" → Clientes', rowsOf(gs, 'Ir para')[0] === 'Clientes')
  r.check('computador sem rolagem horizontal', await noHorizontalScroll(b))
  await search('padaria')
  await b.shot('busca-computador')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('busca-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
