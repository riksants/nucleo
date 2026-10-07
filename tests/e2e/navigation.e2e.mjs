// Revisão de organização (itens 1–3): um "+" por tela, que cria o item daquela tela (no computador vira o botão do
// topo); Início e Financeiro sem "+" flutuante (já têm Adicionar/Retirar); Início = visão geral (avisos + resumo que
// abre o Hoje), Hoje = o que fazer (sem repetir os avisos); telas fora da barra têm "‹ Mais" / "‹ Voltar". Modo local.
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9501)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const fab = () => b.eval(`(() => { const f = document.querySelector('button.fab'); return f && getComputedStyle(f).display !== 'none' ? f.getAttribute('aria-label') : null })()`)
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

  // ---------- 1) One "+" per screen
  await b.goto(BASE + '#/tasks')
  await sleep(1300)
  r.check('Tarefas: o "+" flutuante é "Nova tarefa"', (await fab()) === 'Nova tarefa', String(await fab()))
  r.check('Tarefas: sem botão "Nova" no topo no celular', (await visibleText('Nova')) === 0)
  r.check('Tarefas: envio da tarefa rápida não é outro "+" (é uma seta)', await b.eval(`!document.querySelector('form button[aria-label="Adicionar"] svg.lucide-plus')`))
  await b.click('Nova tarefa', 'button')
  await sleep(700)
  r.check('"+" abre o formulário de nova tarefa', (await dialog()).includes('Nova tarefa'))
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(500)

  await b.goto(BASE + '#/projects')
  await sleep(1000)
  r.check('Projetos: "+" é "Novo projeto" e não há "Novo" no topo', (await fab()) === 'Novo projeto' && (await visibleText('Novo')) === 0)
  await b.goto(BASE + '#/sales')
  await sleep(1000)
  r.check('Vendas: "+" é "Nova venda"', (await fab()) === 'Nova venda')
  await b.goto(BASE + '#/')
  await sleep(1000)
  r.check('Início: sem "+" flutuante (já tem Adicionar e Retirar)', (await fab()) === null)
  await b.goto(BASE + '#/finance')
  await sleep(1000)
  r.check('Financeiro: sem "+" flutuante (o cartão tem Adicionar e Retirar)', (await fab()) === null)
  await b.goto(BASE + '#/today')
  await sleep(1000)
  r.check('Hoje: o "+" continua sendo a captura rápida', (await fab()) === 'Capturar na caixa de entrada')

  // ---------- 2) Início = overview (with the suggestions), Hoje = what to do (without repeating them)
  await b.goto(BASE + '#/')
  await sleep(1500)
  const home = await b.text()
  r.check('Início mostra os avisos de atenção', /precisar da sua atenção/.test(home))
  r.check('Início resume o dia: "1 tarefa para hoje", "1 atrasada" e a próxima', home.includes('1 tarefa para hoje') && home.includes('1 atrasada') && home.includes('Próxima: Pagar contador'), home.slice(0, 600).replace(/\n/g, ' | '))
  r.check('Início não repete a lista de tarefas', !(await b.eval(`[...document.querySelectorAll('main [role=checkbox], main button[aria-label^="Concluir"]')].length`)))
  await b.click('1 tarefa para hoje', 'main button')
  await sleep(800)
  r.check('o resumo abre o Hoje', (await b.eval('location.hash')).startsWith('#/today'))
  r.check('Hoje não repete os avisos', !/precisar da sua atenção/.test(await b.text()))

  // ---------- 3) A way back on screens outside the tab bar
  await b.goto(BASE + '#/more')
  await sleep(800)
  await b.click('Vendas', 'main a')
  await sleep(900)
  r.check('Vendas (em Mais) tem "‹ Mais" no topo', (await visibleText('Mais')) >= 1)
  await b.click('Mais', 'main button')
  await sleep(700)
  r.check('"‹ Mais" volta para o Mais', (await b.eval('location.hash')) === '#/more')
  await b.goto(BASE + '#/finance')
  await sleep(700)
  r.check('abas da barra não têm botão de voltar', (await visibleText('Mais')) === 0 && (await visibleText('Voltar')) === 0)
  await b.goto(BASE + '#/')
  await sleep(700)
  await b.click('Configurações', 'button')
  await sleep(900)
  r.check('Configurações tem "‹ Voltar"', (await visibleText('Voltar')) === 1)
  await b.click('Voltar', 'main button')
  await sleep(700)
  r.check('"‹ Voltar" volta para onde estava (Início)', ['#/', ''].includes(await b.eval('location.hash')))

  // ---------- Desktop: the same action is the button at the top, no floating "+"
  await b.desktop()
  await b.goto(BASE + '#/tasks')
  await sleep(1000)
  r.check('computador: "Nova" no topo e nenhum "+" flutuante', (await visibleText('Nova')) === 1 && (await fab()) === null)
  r.check('computador: sem "‹ Mais"/"‹ Voltar" (a barra lateral orienta)', (await visibleText('Voltar')) === 0)
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('navigation-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
