// Etapa 5 — Alimentação: semana com datas reais, refeição rápida, realizada, lista de compras consolidada
// (automática + manual, comprado, limpar), copiar semana, plano da IA, Agenda/Manhã/Noite/Semana, Caixa de Entrada, Busca.
// Pessoa que já usava o app (banco v2 com plano da IA), modo local.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9388)
const TZ = 'America/Sao_Paulo'
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'agenda', 'week', 'life']
const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10)
const weekday = (d) => new Date(`${d}T12:00:00Z`).getUTCDay()
const monday = (d) => addDays(d, -((weekday(d) + 6) % 7))
const DAY_NAME = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

const fillIn = (labelText, value) =>
  b.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.trim().startsWith(${JSON.stringify(labelText)})); const el = l && l.querySelector('input, textarea'); if (!el) return false; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
const dialogFits = () => b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].pop(); if (!d) return false; const r = d.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.height <= innerHeight + 1 })()`)
const escape = async () => {
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await b.sleep(350)
}

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await b.goto(BASE + 'favicon.svg')
  const today = await b.eval(`(() => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:${JSON.stringify(TZ)},year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value])); return p.year+'-'+p.month+'-'+p.day })()`)
  const week = monday(today)
  const other = today === week ? addDays(week, 1) : week // another day of this week
  const template = { id: 'meals-current', status: 'approved', source: 'ai', notes: '', removed: [], shopping: [{ item: 'Café em pó', qty: '1', checked: false }, { item: 'Detergente', qty: '', checked: false }], meals: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ id: `t${d}`, day: d, time: '12:00', label: 'Marmita da IA', items: ['Arroz'], substitutions: [] })) }
  await seedExistingUser(b, { mealPlans: [template], inbox: [{ id: 'in1', text: 'Comprar pilhas', status: 'open', convertedTo: null, processedAt: null }] }, { modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL, startedAt: new Date(Date.now() - 30 * 86_400_000).toISOString() })

  // Before planning: the AI model shows in the Agenda as today
  await b.goto(BASE + '#/agenda')
  await b.sleep(900)
  r.check('sem refeições reais na semana, a Agenda continua mostrando o modelo da IA', (await b.text()).includes('Marmita da IA'))

  await b.goto(BASE + '#/meals')
  await b.sleep(900)
  let text = await b.text()
  r.check('Alimentação abre com Semana · Lista de compras · Plano com IA', text.includes('Semana') && text.includes('Lista de compras') && text.includes('Plano com IA') && text.includes('Usar plano da IA'))
  r.check('a semana mostra os 7 dias com datas reais', (await b.eval(`document.querySelectorAll('section[aria-label]').length`)) === 7)

  // Quick meal: type → name → time → ingredients
  await b.click('Refeição', 'button')
  await b.sleep(300)
  await b.click('Almoço', '[role=radio]')
  await fillIn('Nome', 'Frango com arroz')
  await fillIn('Horário', '12:30')
  await fillIn('Ingredientes', '200 g de frango\nArroz\n3 bananas')
  r.check('formulário de refeição cabe na tela (390px)', await dialogFits())
  await b.click('Adicionar', '[role=dialog] button[type=submit]')
  await b.sleep(400)
  await b.click(`Adicionar refeição em ${DAY_NAME[weekday(other)]}`)
  await b.click('Jantar', '[role=radio]')
  await fillIn('Ingredientes', '200 g frango\n2 bananas')
  await b.click('Adicionar', '[role=dialog] button[type=submit]')
  await b.sleep(400)
  let meals = await idb(b, 'meals')
  const lunch = meals.find((m) => m.name === 'Frango com arroz')
  r.check('refeições salvas na data real (dia certo no fuso), com tipo e ingredientes como digitados', meals.length === 2 && lunch?.date === today && lunch.type === 'lunch' && lunch.time === '12:30' && lunch.ingredients.length === 3 && meals.some((m) => m.date === other && m.type === 'dinner' && m.name === ''))
  await b.click('Marcar Frango com arroz como realizada')
  await b.sleep(300)
  r.check('marcar como realizada grava no próprio registro', (await idb(b, 'meals', lunch.id)).done === true)

  // Shopping list: consolidated, nothing invented
  await b.click('Lista de compras', '[role=radio]')
  await b.sleep(500)
  text = await b.text()
  r.check('lista consolidada: Frango 400 g e Bananas 5 un (um item cada)', text.includes('Frango') && text.includes('400 g') && text.includes('Bananas') && text.includes('5 un') && (text.match(/Frango/g) || []).length === 1)
  r.check('item sem quantidade não ganha quantidade inventada', (await b.eval(`[...document.querySelectorAll('[role=checkbox]')].find(c => c.textContent.startsWith('Arroz'))?.textContent`)) === 'Arroz')
  const box = await b.eval(`(() => { const s = document.querySelector('[role=checkbox] > span').getBoundingClientRect(); const row = document.querySelector('[role=checkbox]').getBoundingClientRect(); return [s.width, row.height] })()`)
  r.check('caixa de marcar e linha grandes o suficiente para tocar', box[0] >= 28 && box[1] >= 56, JSON.stringify(box))
  await b.click('Marcar Bananas (5 un)')
  await b.sleep(300)
  await b.eval(`(() => { const el = document.querySelector('input[aria-label="Adicionar item à lista"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Detergente'); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await b.click('Adicionar item')
  await b.sleep(300)
  let items = await idb(b, 'shoppingItems')
  r.check('comprado grava só o estado do item automático (id fixo) e o manual fica separado', items.some((i) => i.id === `auto:${week}:bananas` && i.checked && i.kind === 'auto') && items.some((i) => i.kind === 'manual' && i.name === 'Detergente') && items.length === 2)

  // Change a meal: list updates, bought state preserved, manual untouched
  await b.click('Semana', '[role=radio]')
  await b.sleep(300)
  await b.click('Frango com arroz', 'button')
  await fillIn('Ingredientes', '200 g de frango\nArroz\n6 bananas')
  await b.click('Salvar', '[role=dialog] button[type=submit]')
  await b.sleep(400)
  await b.click('Lista de compras', '[role=radio]')
  await b.sleep(400)
  r.check('mudar a refeição atualiza a quantidade e mantém "comprado" e o item manual', (await b.eval(`[...document.querySelectorAll('[role=checkbox]')].find(c => c.textContent.startsWith('Bananas'))?.getAttribute('aria-checked')`)) === 'true' && (await b.text()).includes('8 un') && (await b.text()).includes('Detergente'))
  r.check('lista de compras sem rolagem horizontal (390px)', await noHorizontalScroll(b))
  await b.shot('alimentacao-lista')
  await b.click('Limpar comprados (1)')
  await b.click('Limpar', '[role=dialog] button')
  await b.sleep(400)
  text = await b.text()
  items = await idb(b, 'shoppingItems')
  r.check('"Limpar comprados" (com confirmação) tira só os comprados', !text.includes('Bananas') && text.includes('Frango') && text.includes('Detergente') && items.find((i) => i.id === `auto:${week}:bananas`)?.cleared === true)

  // Agenda / Calendar / Morning / Night / Week use the real meals
  await b.goto(BASE + '#/agenda')
  await b.sleep(900)
  text = await b.text()
  r.check('com refeições reais, a Agenda mostra a refeição original e não repete o modelo da IA', text.includes('Frango com arroz') && !text.includes('Marmita da IA'))
  await b.goto(BASE + '#/life')
  await b.sleep(800)
  r.check('Calendário de Vida lista a refeição no dia', (await b.text()).includes('Frango com arroz'))
  await b.goto(BASE + '#/today?mode=morning')
  await b.sleep(900)
  r.check('Modo Manhã mostra o resumo das refeições do dia', /Hoje você tem 1 refeição planejada/.test(await b.text()))
  await b.goto(BASE + '#/today?mode=night')
  await b.sleep(900)
  r.check('Modo Noite: quantas foram marcadas, sem julgamento', (await b.text()).includes('1 de 1 refeição planejada foi marcada como realizada.'))
  await b.goto(BASE + '#/week')
  await b.sleep(1800)
  text = await b.text()
  r.check('Semana tem contagem própria de refeições (sem nota nutricional)', text.toUpperCase().includes('ALIMENTAÇÃO') && text.includes('1 de 2 refeições planejadas marcadas') && text.includes('2 dias com planejamento') && !/caloria|nutricional/i.test(text))

  // Copy week (confirmation; new records; not done)
  await b.goto(BASE + '#/meals')
  await b.sleep(700)
  await b.click('Próxima semana')
  await b.sleep(300)
  await b.click('Copiar semana anterior')
  await b.click('Copiar', '[role=dialog] button')
  await b.sleep(500)
  meals = await idb(b, 'meals')
  const next = meals.filter((m) => m.date >= addDays(week, 7))
  r.check('copiar semana anterior cria novas refeições, sem "realizada", e não muda a antiga', next.length === 2 && next.every((m) => !m.done) && meals.length === 4 && meals.find((m) => m.id === lunch.id).done === true)

  // AI plan tab: its own list + copy without obvious duplicates
  await b.click('Esta semana')
  await b.click('Plano com IA', '[role=radio]')
  await b.sleep(400)
  text = await b.text()
  r.check('Plano com IA continua igual, com "Lista sugerida pelo plano"', text.toUpperCase().includes('LISTA SUGERIDA PELO PLANO') && text.includes('Marmita da IA'))
  await b.click('Copiar para Lista de compras')
  await b.click('Copiar', '[role=dialog] button')
  await b.sleep(500)
  items = await idb(b, 'shoppingItems')
  r.check('copiar a lista do plano adiciona só o que falta (Detergente já estava)', items.filter((i) => i.kind === 'manual' && /detergente/i.test(i.name)).length === 1 && items.some((i) => i.name === 'Café em pó' && i.origin === 'plan'))

  // Inbox → shopping item
  await b.goto(BASE + '#/inbox')
  await b.sleep(600)
  await b.click('Comprar pilhas', 'button')
  await b.click('Item da lista de compras', '[role=dialog] button')
  await b.sleep(500)
  items = await idb(b, 'shoppingItems')
  const inboxItem = await idb(b, 'inbox', 'in1')
  r.check('Caixa de Entrada vira item da lista de compras, com rastreio', items.some((i) => i.name === 'Comprar pilhas' && i.origin === 'inbox' && i.week === week) && inboxItem.convertedTo?.collection === 'shoppingItems')

  // Search
  await b.goto(BASE + '#/search')
  await b.eval(`(() => { const el = document.querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Frango com arroz'); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await b.sleep(400)
  text = await b.text()
  r.check('busca encontra a refeição (não os ingredientes soltos)', text.toUpperCase().includes('REFEIÇÕES') && text.includes('Frango com arroz'))
  await b.click('Frango com arroz', 'button')
  await b.sleep(900)
  r.check('resultado abre a refeição na Alimentação', (await b.text()).includes('Editar refeição'))
  await escape()
  await b.shot('alimentacao-semana')

  await b.desktop()
  await b.goto(BASE + '#/meals')
  await b.sleep(800)
  r.check('Semana sem rolagem horizontal (1366px)', await noHorizontalScroll(b))
  await b.shot('alimentacao-desktop')
  await b.click('Lista de compras', '[role=radio]')
  await b.sleep(300)
  r.check('Lista de compras sem rolagem horizontal (1366px)', await noHorizontalScroll(b))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('alimentacao-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
