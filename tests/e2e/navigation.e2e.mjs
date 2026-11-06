// Navegação (redesenho 2026-11): a ação principal de cada tela é um botão com nome no topo ("Nova tarefa", "Novo
// projeto"), sem "+" flutuante; Início e Finanças têm as próprias ações (Entrada/Saída, Nova entrada/Nova saída);
// Hoje vive na Agenda (o resumo do dia abre a Agenda; #/today leva para lá); seções têm o menu (☰), telas internas
// "‹ Voltar". Modo local.
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9501)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const fab = () => b.eval(`(() => { const f = document.querySelector('button.fab'); return f && getComputedStyle(f).display !== 'none' ? f.getAttribute('aria-label') : null })()`)
const headerActions = () => b.eval(`[...document.querySelectorAll('main header button.band-pill')].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim())`)
const visibleText = (t) => b.eval(`[...document.querySelectorAll('main button, main a')].filter((e) => e.offsetParent !== null && e.textContent.trim() === ${JSON.stringify(t)}).length`)
const dialog = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].map((d) => d.textContent).join(' ')`)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

try {
  await b.mobile()
  await seedExistingUser(
    b,
    {
      tasks: [
        { id: 't1', title: 'Pagar contador', projectId: null, dueDate: '2026-01-05', priority: 'none', status: 'todo', completedAt: null },
        { id: 't2', title: 'Enviar proposta', projectId: null, dueDate: today, priority: 'none', status: 'todo', completedAt: null },
      ],
    },
    { baseCurrency: 'EUR', timeZone: 'Europe/Madrid', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  // ---------- 1) One main action per screen, by name, at the top (no floating "+")
  await b.goto(BASE + '#/tasks')
  await sleep(1300)
  r.check('Tarefas: a ação do topo é "Nova tarefa"', JSON.stringify(await headerActions()) === '["Nova tarefa"]', JSON.stringify(await headerActions()))
  r.check('Tarefas: sem "+" flutuante', (await fab()) === null)
  r.check('Tarefas: envio da tarefa rápida não é outro "+" (é uma seta)', await b.eval(`!document.querySelector('form button[aria-label="Adicionar"] svg.lucide-plus')`))
  await b.click('Nova tarefa', 'button')
  await sleep(700)
  r.check('"+" abre o formulário de nova tarefa', (await dialog()).includes('Nova tarefa'))
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(500)

  await b.goto(BASE + '#/projects')
  await sleep(1000)
  r.check('Projetos: a ação do topo é "Novo projeto"', (await headerActions()).includes('Novo projeto') && (await fab()) === null)
  await b.goto(BASE + '#/sales')
  await sleep(1000)
  r.check('Vendas: a ação do topo é "Nova venda"', (await headerActions()).includes('Nova venda'))
  await b.goto(BASE + '#/')
  await sleep(1000)
  r.check('Início: sem "+" flutuante; atalhos Entrada e Saída no topo', (await fab()) === null && (await b.text()).includes('Entrada') && (await b.text()).includes('Saída'))
  await b.goto(BASE + '#/finance')
  await sleep(1000)
  r.check('Finanças: sem "+" flutuante (o cartão tem Nova entrada e Nova saída)', (await fab()) === null && (await visibleText('Nova entrada')) === 1 && (await visibleText('Nova saída')) === 1)
  await b.goto(BASE + '#/today')
  await sleep(1200)
  r.check('Hoje: o link antigo abre a Agenda, com "Nova tarefa" no topo', (await b.eval('location.hash')) === '#/agenda' && (await headerActions()).includes('Nova tarefa'), await b.eval('location.hash'))

  // ---------- 2) Início = overview (with the suggestions), Hoje = what to do (without repeating them)
  await b.goto(BASE + '#/')
  await sleep(1500)
  const home = await b.text()
  r.check('Início mostra os avisos de atenção', /precisar da sua atenção/.test(home))
  r.check('Início resume o dia: "1 tarefa para hoje", "1 atrasada" e o que importa agora', home.includes('1 tarefa para hoje') && home.includes('1 atrasada') && home.includes('Pagar contador'), home.slice(0, 600).replace(/\n/g, ' | '))
  r.check('Início não repete a lista de tarefas (só o destaque tem "Feito")', (await b.eval(`[...document.querySelectorAll('main [role=checkbox], main button[aria-label^="Concluir"]')].length`)) <= 1)
  await b.eval(`[...document.querySelectorAll('section[aria-label="Agora"] button')].find((x) => / hoje$/.test(x.textContent.trim()))?.click()`)
  await sleep(800)
  r.check('o resumo do dia abre a Agenda', (await b.eval('location.hash')).startsWith('#/agenda'))
  r.check('a Agenda não repete os avisos', !/precisar da sua atenção/.test(await b.text()))

  // ---------- 3) Side menu (☰) on top-level screens, "‹ Voltar" on inner ones
  const menuBtn = () => b.eval(`(() => { const e = document.querySelector('main button[aria-label="Abrir menu"]'); return !!e && e.offsetParent !== null })()`)
  const menu = () => b.eval(`document.querySelector('[role=dialog][aria-label="Menu"]')?.innerText ?? null`)
  const openIt = () => b.eval(`document.querySelector('main button[aria-label="Abrir menu"]').click()`)
  await b.goto(BASE + '#/finance')
  await sleep(700)
  r.check('abas da barra têm o menu (☰) e nenhum "Voltar"', (await menuBtn()) && (await visibleText('Voltar')) === 0)
  r.check('barra inferior sem "Mais"', !(await b.eval(`[...document.querySelectorAll('nav[aria-label="Navegação principal"] a')].some((a) => a.textContent.trim() === 'Mais')`)))
  await openIt()
  await sleep(700)
  r.check('☰ abre o menu lateral', ((await menu()) ?? '').includes('Vendas'))
  r.check('o foco vai para dentro do menu', await b.eval(`document.querySelector('[role=dialog][aria-label="Menu"]').contains(document.activeElement)`))
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(600)
  r.check('Esc fecha o menu', (await menu()) === null)
  await openIt()
  await sleep(700)
  // A tap outside (on the dim, right of the panel) closes it.
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 375, y: 400, button: 'left', clickCount: 1 })
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 375, y: 400, button: 'left', clickCount: 1 })
  await sleep(600)
  r.check('toque fora fecha o menu', (await menu()) === null)
  await openIt()
  await sleep(700)
  r.check('o "X" do menu tem nome acessível', await b.eval(`!!document.querySelector('[aria-label="Menu"] button[aria-label="Fechar menu"]')`))
  await b.click('Vendas', '[role=dialog] a')
  await sleep(900)
  r.check('escolher no menu abre a seção e fecha o menu', (await b.eval('location.hash')) === '#/sales' && (await menu()) === null)
  r.check('Vendas (do menu) também tem o ☰', (await menuBtn()) && (await visibleText('Voltar')) === 0)
  // Swipe left on the panel closes it.
  await openIt()
  await sleep(700)
  for (const [type, x] of [['touchStart', 250], ['touchMove', 235], ['touchMove', 200], ['touchMove', 150], ['touchMove', 90], ['touchMove', 50], ['touchEnd', 50]]) {
    await b.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: 560 }] })
    await sleep(25)
  }
  await sleep(700)
  r.check('deslizar para a esquerda fecha o menu', (await menu()) === null)
  // Old links to #/more land on Início with the menu open.
  await b.goto(BASE + '#/more')
  await sleep(900)
  r.check('link antigo #/more abre Início com o menu', ['#/', ''].includes(await b.eval('location.hash')) && (await menu()) !== null)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(500)
  // A view inside a section goes back to the section.
  await b.goto(BASE + '#/finance?view=month')
  await sleep(900)
  r.check('Resumo do mês tem "‹ Voltar" (e não o ☰)', (await visibleText('Voltar')) === 1 && !(await menuBtn()))
  await b.click('Voltar', 'main button')
  await sleep(700)
  r.check('"‹ Voltar" do Resumo volta para o Financeiro', (await b.eval('location.hash')) === '#/finance')
  await b.goto(BASE + '#/')
  await sleep(700)
  await b.click('Você: conta, avisos e ajustes', 'a')
  await sleep(900)
  r.check('a inicial no Início abre "Você"', (await b.eval('location.hash')) === '#/settings' && (await b.text()).includes('Do seu jeito'))
  r.check('"Você" tem o menu (☰), como as outras áreas do menu', (await menuBtn()) && (await visibleText('Voltar')) === 0)
  await b.goto(BASE + '#/reminders')
  await sleep(900)
  r.check('Lembretes (dentro de Você) tem "‹ Voltar"', (await visibleText('Voltar')) === 1)

  // ---------- Desktop: the same action is the button at the top, no floating "+"
  await b.desktop()
  await b.goto(BASE + '#/tasks')
  await sleep(1000)
  r.check('computador: "Nova tarefa" no topo e nenhum "+" flutuante', (await headerActions()).includes('Nova tarefa') && (await fab()) === null)
  r.check('computador: sem ☰ nem "‹ Voltar" (a barra lateral orienta)', (await visibleText('Voltar')) === 0 && !(await menuBtn()))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('navigation-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
