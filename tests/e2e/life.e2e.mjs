// Etapa 4 — Vida: Calendário de Vida (camada de visualização), projetos pessoais, objetivos, etapas,
// tarefas vinculadas, conversão, Caixa de Entrada, Busca, "O que mudou?". Pessoa que já usava o app, modo local.
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9385)
const TZ = 'America/Sao_Paulo'
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'agenda', 'week', 'life']
const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10)
const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString()

const fillIn = (labelText, value) =>
  b.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find(x => x.textContent.trim().startsWith(${JSON.stringify(labelText)})); const el = l && l.querySelector('input, textarea, select'); if (!el) return false; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input',{bubbles:true})); return true })()`)
const typeInto = (selector, value) =>
  b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true})); return true })()`)
const dialogFits = () => b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].pop(); if (!d) return false; const r = d.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.height <= innerHeight + 1 })()`)
const planByTitle = async (title) => (await idb(b, 'lifePlans')).find((p) => p.title === title)

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await b.goto(BASE + 'favicon.svg')
  const today = await b.eval(`(() => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:${JSON.stringify(TZ)},year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value])); return p.year+'-'+p.month+'-'+p.day })()`)
  // A day of this month other than today (for the task) and a deadline later this month when possible.
  const taskDay = today.slice(8) === '01' ? addDays(today, 1) : `${today.slice(0, 7)}-01`
  await seedExistingUser(
    b,
    {
      tasks: [{ id: 'tk1', title: 'Renovar passaporte', projectId: null, dueDate: taskDay, priority: 'none', status: 'todo', completedAt: null }],
      inbox: [{ id: 'in1', text: 'Me mudar para Barcelona', status: 'open', convertedTo: null, processedAt: null }],
    },
    { modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL, startedAt: ago(90) },
  )

  // Navigation: "Vida" in Mais, not a new bottom tab; work projects renamed visually
  await b.goto(BASE + '#/more')
  await b.sleep(800)
  let text = await b.text()
  const tabs = await b.eval(`[...document.querySelectorAll('nav[aria-label="Navegação principal"] a')].map(a => a.textContent.trim())`)
  r.check('"Vida" fica em Mais e não vira aba nova na barra inferior', text.includes('Vida') && !tabs.includes('Vida') && tabs.length === 5, tabs.join(','))
  await b.goto(BASE + '#/projects')
  await b.sleep(500)
  r.check('Projetos (de trabalho) com título curto e o "de trabalho" no subtítulo', (await b.text()).includes('De trabalho') && (await b.eval(`document.querySelector('main h1')?.textContent.trim()`)) === 'Projetos' && tabs.includes('Projetos'))

  // Calendar: month view, indicators, tap a day, edit the ORIGINAL task
  await b.goto(BASE + '#/life')
  await b.sleep(1200)
  const label = await b.eval(`[...document.querySelectorAll('[role=gridcell]')].find(c => c.getAttribute('aria-label').includes('1 tarefa'))?.getAttribute('aria-label') ?? ''`)
  r.check('calendário mostra o mês com indicador curto no dia da tarefa', label.includes('1 tarefa'), label)
  await b.eval(`[...document.querySelectorAll('[role=gridcell]')].find(c => c.getAttribute('aria-label').includes('1 tarefa')).click()`)
  await b.sleep(300)
  r.check('tocar no dia lista os itens daquele dia', (await b.text()).includes('Renovar passaporte'))
  await b.click('Renovar passaporte', 'button')
  await b.sleep(400)
  await fillIn('Título', 'Renovar passaporte (urgente)')
  await b.click('Salvar', '[role=dialog] button[type=submit]')
  await b.sleep(500)
  const tasksAfter = await idb(b, 'tasks')
  r.check('editar pelo calendário altera a tarefa original (sem cópia)', tasksAfter.length === 1 && tasksAfter[0].id === 'tk1' && tasksAfter[0].title === 'Renovar passaporte (urgente)')
  await b.click('Próximo mês')
  await b.sleep(300)
  const nextMonthCells = await b.eval(`document.querySelectorAll('[role=gridcell]').length`)
  await b.click('Hoje', 'button')
  await b.sleep(300)
  const todaySel = await b.eval(`document.querySelector('[role=gridcell][aria-selected=true]')?.getAttribute('aria-label') ?? ''`)
  r.check('troca de mês e "Hoje" voltam ao dia atual', (nextMonthCells === 35 || nextMonthCells === 42 || nextMonthCells === 28) && todaySel.length > 0)
  r.check('calendário sem rolagem horizontal e sem dias cortados (390px)', (await noHorizontalScroll(b)) && (await b.eval(`[...document.querySelectorAll('[role=gridcell]')].every(c => c.getBoundingClientRect().right <= innerWidth)`)))
  await b.shot('vida-calendario')

  // Personal project with suggested + manual steps
  await b.click('Projetos pessoais', '[role=radio]')
  await b.click('Novo projeto')
  await fillIn('Nome', 'Viagem para Itália')
  await fillIn('Categoria', 'travel')
  await fillIn('Prazo', addDays(today, 3))
  await b.click('Criar', '[role=dialog] button[type=submit]')
  await b.sleep(500)
  const viagem = await planByTitle('Viagem para Itália')
  r.check('projeto pessoal criado (coleção própria, não mistura com Projetos de trabalho)', viagem?.kind === 'project' && viagem.category === 'travel' && (await idb(b, 'projects')).length === 0)
  await b.click('Viagem para Itália', 'button')
  await b.click('Sugerir etapas')
  await b.click('Comprar transporte', '[aria-pressed]')
  await b.click('Reservar hospedagem', '[aria-pressed]')
  await b.click('Adicionar 2', 'button')
  await b.sleep(400)
  await typeInto('input[aria-label="Nova etapa"]', 'Preparar documentos')
  await b.click('Adicionar etapa')
  await b.sleep(400)
  let steps = (await idb(b, 'planSteps')).sort((a, c) => a.order - c.order)
  r.check('sugestões só quando pedidas; etapas criadas na ordem', steps.length === 3 && steps.map((s) => s.title).join('|') === 'Comprar transporte|Reservar hospedagem|Preparar documentos')
  await b.click('Subir Preparar documentos')
  await b.sleep(400)
  steps = (await idb(b, 'planSteps')).sort((a, c) => a.order - c.order)
  r.check('mover para cima reordena as etapas', steps.map((s) => s.title).join('|') === 'Comprar transporte|Preparar documentos|Reservar hospedagem')
  await b.click('Concluir etapa Comprar transporte')
  await b.sleep(400)
  text = await b.text()
  r.check('progresso automático pelas etapas (1 de 3 · 33%)', text.includes('1 de 3 etapas · 33%') && text.includes('(pelas etapas)'))
  await b.click('Virar tarefa: Reservar hospedagem')
  await b.sleep(500)
  const linked = (await idb(b, 'tasks')).find((t) => t.title === 'Reservar hospedagem')
  const hosp = (await idb(b, 'planSteps')).find((s) => s.title === 'Reservar hospedagem')
  r.check('etapa vira tarefa no sistema de Tarefas existente, com vínculo', linked?.planId === viagem.id && linked.stepId === hosp.id && hosp.taskId === linked.id && linked.status === 'todo')
  r.check('modal de detalhe cabe na tela (390px)', await dialogFits())
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await b.sleep(400)

  // Complete the linked task from Tarefas → step counts as done, step record untouched
  await b.goto(BASE + '#/tasks')
  await b.sleep(600)
  await b.eval(`[...document.querySelectorAll('[aria-label="Concluir tarefa"]')].find((btn) => btn.parentElement.textContent.includes('Reservar hospedagem')).click()`)
  await b.sleep(500)
  await b.goto(BASE + '#/life?view=projects')
  await b.sleep(800)
  text = await b.text()
  const hosp2 = (await idb(b, 'planSteps')).find((s) => s.title === 'Reservar hospedagem')
  r.check('concluir a tarefa original conclui a etapa (uma só fonte de verdade)', text.includes('2 de 3 etapas · 67%') && hosp2.status === 'todo', JSON.stringify((await idb(b, 'tasks')).map((t) => [t.title, t.status])))

  // Objective from the Inbox, with steps, then converted into a personal project (same record)
  await b.goto(BASE + '#/inbox')
  await b.sleep(600)
  await b.click('Me mudar para Barcelona', 'button')
  await b.click('Objetivo', '[role=dialog] button')
  await b.sleep(400)
  await b.click('Criar', '[role=dialog] button[type=submit]')
  await b.sleep(500)
  const obj = await planByTitle('Me mudar para Barcelona')
  const inboxItem = await idb(b, 'inbox', 'in1')
  r.check('Caixa de Entrada vira Objetivo, com rastreio nos dois lados', obj?.kind === 'objective' && obj.fromInbox === 'in1' && inboxItem.status === 'done' && inboxItem.convertedTo?.collection === 'lifePlans' && inboxItem.convertedTo.id === obj.id)
  await b.goto(BASE + '#/life?view=objectives')
  await b.sleep(700)
  await b.click('Me mudar para Barcelona', 'button')
  await typeInto('input[aria-label="Nova etapa"]', 'Tirar visto')
  await b.click('Adicionar etapa')
  await b.sleep(300)
  await b.click('Transformar em projeto pessoal')
  await typeInto('input[aria-label="Nome do projeto pessoal"]', 'Mudança para Barcelona')
  await b.click('Transformar', '[role=dialog] button')
  await b.sleep(500)
  const conv = (await idb(b, 'lifePlans')).filter((p) => p.id === obj.id)
  const allPlans = await idb(b, 'lifePlans')
  r.check('objetivo → projeto pessoal: mesmo registro, sem cópia, etapa continua ligada', conv.length === 1 && conv[0].kind === 'project' && conv[0].convertedFrom === 'objective' && conv[0].title === 'Mudança para Barcelona' && allPlans.length === 2 && (await idb(b, 'planSteps')).some((s) => s.planId === obj.id && s.title === 'Tirar visto'))
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await b.sleep(300)

  // Archive / reopen / conclude
  await b.click('Projetos pessoais', '[role=radio]')
  await b.click('Mudança para Barcelona', 'button')
  await b.click('Arquivar', '[role=dialog] button')
  await b.sleep(300)
  r.check('arquivar muda só o status', (await planByTitle('Mudança para Barcelona')).status === 'archived')

  // Deadline shows in the calendar
  await b.click('Calendário', '[role=radio]')
  await b.sleep(500)
  const deadlineCell = await b.eval(`[...document.querySelectorAll('[role=gridcell]')].map(c => c.getAttribute('aria-label')).filter(l => l.includes('prazo')).length`)
  r.check('prazo do projeto pessoal aparece no calendário', deadlineCell >= 1 || addDays(today, 3).slice(0, 7) !== today.slice(0, 7))

  // Search
  await b.goto(BASE + '#/search')
  await typeInto('input', 'Itália')
  await b.sleep(400)
  text = await b.text()
  r.check('busca encontra projeto pessoal', text.includes('Viagem para Itália') && text.toUpperCase().includes('PROJETOS PESSOAIS'))
  await b.click('Viagem para Itália', 'button')
  await b.sleep(900)
  r.check('resultado abre o projeto dentro de Vida', (await b.text()).toUpperCase().includes('ETAPAS'))
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await b.sleep(300)

  // "O que mudou?" from Semana
  await b.goto(BASE + '#/week')
  await b.sleep(1500)
  await b.click('O que mudou?')
  await b.sleep(800)
  text = await b.text()
  r.check('Semana leva ao "O que mudou?" sem duplicar conteúdo', text.includes('Semana × anterior') && /Comparação até/.test(text))
  r.check('mostra mudanças reais ou "Dados insuficientes", nunca 0% sem dados', (text.includes('Você concluiu') || text.includes('Dados insuficientes')) && !/(^|[^0-9])0%/.test(text))
  await b.click('Mês × anterior', '[role=radio]')
  await b.sleep(400)
  r.check('comparação do mês avisa o período parcial', /Comparação até o dia \d+/.test(await b.text()))
  await b.shot('vida-mudancas')

  await b.desktop()
  await b.goto(BASE + '#/life')
  await b.sleep(800)
  await b.click('Calendário', '[role=radio]')
  await b.sleep(400)
  r.check('calendário sem rolagem horizontal (1366px)', await noHorizontalScroll(b))
  await b.shot('vida-calendario-desktop')
  await b.click('Projetos pessoais', '[role=radio]')
  await b.sleep(300)
  r.check('projetos pessoais sem rolagem horizontal (1366px)', await noHorizontalScroll(b))
  await b.click('Viagem para Itália', 'button')
  await b.sleep(400)
  r.check('detalhe cabe na tela (1366px)', await dialogFits())
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('vida-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
