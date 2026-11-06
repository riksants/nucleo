// Organização (redesenho 2026-11): menu ☰ com a busca no topo e todas as seções agrupadas pelo que fazem (Dia a dia,
// Finanças, Trabalho, Planejamento, Guardados, Ferramentas, Ajustes); nomes que dizem o que é ("Senhas", "Assinaturas");
// barra flutuante Início · 3 escolhidas · Assistente; atalhos Entrada/Saída/Tarefa/Novo no Início. Nada de dados muda.
// Modo local.
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9409)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const tabs = () => b.eval(`[...document.querySelectorAll('nav[aria-label="Navegação principal"] a')].map((a) => a.textContent.trim())`)
const toggleIn = (label) => b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = [...d.querySelectorAll('button[aria-pressed]')].find((x) => x.querySelector('.font-medium')?.textContent.trim() === ${JSON.stringify(label)}); if (!el) return false; el.click(); return true })()`)
const dialog = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].map((d) => d.innerText).join(' ')`)

try {
  await b.mobile()
  await b.send('Page.enable')
  await seedExistingUser(
    b,
    { notes: [{ id: 'n1', title: 'Nota guardada', body: '', pinned: false }], tools: [{ id: 'f1', name: 'Figma', plan: '', price: 5000, currency: 'BRL', billing: 'monthly', nextCharge: '', link: '', notes: '' }] },
    { baseCurrency: 'BRL', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  // ---------- 3) Default tab bar unchanged for someone who never chose
  await b.goto(BASE + '#/')
  await sleep(1300)
  r.check('quem nunca escolheu: barra padrão (Agenda, Finanças, Projetos) com o Assistente', JSON.stringify(await tabs()) === JSON.stringify(['Início', 'Agenda', 'Finanças', 'Projetos', 'Assistente']), (await tabs()).join(', '))

  // Início: the shortcuts on the band; the Assistente is a tab; "Hoje" lives in the Agenda
  const shortcuts = await b.eval(`[...document.querySelectorAll('nav[aria-label="Atalhos"] button')].map((x) => x.textContent.trim())`)
  r.check('Início mostra os atalhos Entrada, Saída, Tarefa e Novo', JSON.stringify(shortcuts) === JSON.stringify(['Entrada', 'Saída', 'Tarefa', 'Novo']), shortcuts.join(', '))
  await b.click('Assistente', 'nav[aria-label="Navegação principal"] a')
  await sleep(700)
  r.check('"Assistente" (aba) abre o Assistente', (await b.eval(`location.hash`)).startsWith('#/assistant'))
  await b.goto(BASE + '#/today')
  await sleep(900)
  r.check('link antigo de "Hoje" abre a Agenda', (await b.eval(`location.hash`)).startsWith('#/agenda'))

  // ---------- 1) Side menu: search first, grouped sections, then automations and account/preferences
  const menuRows = `[...document.querySelectorAll('[role=dialog][aria-label="Menu"] section a')].map((a) => a.querySelector('.truncate')?.textContent.trim())`
  await b.goto(BASE + '#/more')
  await sleep(900)
  const mais = await b.eval(`(() => {
    const menu = document.querySelector('[role=dialog][aria-label="Menu"]')
    const search = menu.querySelector('input[type=search]')
    const firstGroup = menu.querySelector('section')
    const groups = [...menu.querySelectorAll('section h2')].map((h) => h.textContent.trim())
    return { first: search && firstGroup && search.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING ? search.placeholder : '', groups, rows: ${menuRows} }
  })()`)
  r.check('menu começa pela busca', mais.first === 'Buscar em tudo', mais.first)
  r.check('menu agrupado por assunto', JSON.stringify(mais.groups.map((g) => g.toLowerCase())) === JSON.stringify(['dia a dia', 'finanças', 'trabalho', 'planejamento', 'guardados', 'ferramentas', 'ajustes']), mais.groups.join(', '))
  r.check('todas as seções e ferramentas estão no menu, uma linha cada', mais.rows.length >= 20 && mais.rows.every(Boolean), `${mais.rows.length} linhas`)
  const names = mais.rows
  r.check('nomes novos: "Senhas" e "Assinaturas" (sem "Contas"/"Ferramentas")', names.includes('Senhas') && names.includes('Assinaturas') && !names.includes('Contas') && !names.includes('Ferramentas'), names.join(', '))
  r.check('menu mostra também as seções da barra (Finanças, Agenda)', names.includes('Finanças') && names.includes('Agenda') && names.includes('Tarefas'))
  r.check('menu tem Assistente, Automações, Importar, Notificações e lembretes e Personalizar', ['Assistente', 'Automações', 'Importar', 'Notificações e lembretes', 'Personalizar'].every((n) => names.includes(n)), names.slice(-6).join(', '))
  r.check('menu tem "Você" no topo', await b.eval(`[...document.querySelectorAll('[role=dialog][aria-label="Menu"] a')].some((a) => a.textContent.includes('Você'))`))
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(500)
  await b.goto(BASE + '#/accounts')
  await sleep(800)
  const accTitle = await b.eval(`document.querySelector('main h1')?.textContent.trim()`)
  await b.goto(BASE + '#/tools')
  await sleep(800)
  const toolTitle = await b.eval(`document.querySelector('main h1')?.textContent.trim()`)
  r.check('títulos das telas com os nomes novos', accTitle === 'Senhas' && toolTitle === 'Assinaturas', `${accTitle} / ${toolTitle}`)
  r.check('dados preservados (Figma continua em Assinaturas)', (await b.text()).includes('Figma'))

  // "Personalizar" → Seções visíveis → Barra inferior
  await b.goto(BASE + '#/more')
  await sleep(900)
  await b.click('Personalizar', '[role=dialog] a')
  await sleep(900)
  r.check('"Personalizar" abre Seções visíveis', (await dialog()).includes('Seções visíveis'))
  await b.click('Barra inferior', '[role=dialog] button')
  await sleep(700)
  let d = await dialog()
  r.check('atalho leva à escolha da barra', d.includes('Escolha até 3 seções'))
  const preview = await b.eval(`[...document.querySelectorAll('[aria-label="Prévia da barra"] span')].map((s) => ({ t: s.textContent.trim(), cut: s.scrollWidth > s.clientWidth + 1 }))`)
  r.check('prévia da barra mostra os nomes inteiros, com o Assistente no fim', preview.length === 5 && preview.every((p) => !p.cut) && preview[2].t === 'Finanças' && preview[4].t === 'Assistente', JSON.stringify(preview))

  // ---------- 3) Choose the bar: Vendas, Tarefas, Anotações
  for (const name of ['Agenda', 'Finanças', 'Projetos']) await toggleIn(name)
  await sleep(300)
  for (const name of ['Vendas', 'Tarefas', 'Anotações']) await toggleIn(name)
  await sleep(400)
  r.check('barra muda na hora com a escolha', JSON.stringify(await tabs()) === JSON.stringify(['Início', 'Vendas', 'Tarefas', 'Anotações', 'Assistente']), (await tabs()).join(', '))
  await toggleIn('Hábitos')
  await sleep(600)
  d = await dialog()
  r.check('quarta seção é recusada com aviso (cabem 3)', (await tabs()).length === 5 && (await b.text()).includes('Cabem 3 seções'))
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(500)
  await b.goto(BASE + 'favicon.svg')
  await b.goto(BASE + '#/more')
  await sleep(1300)
  r.check('escolha continua depois de reabrir o app', JSON.stringify(await tabs()) === JSON.stringify(['Início', 'Vendas', 'Tarefas', 'Anotações', 'Assistente']), (await tabs()).join(', '))
  const maisNames = await b.eval(menuRows)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(500)
  r.check('menu continua com todas as seções (Finanças, Projetos, Vendas)', maisNames.includes('Finanças') && maisNames.includes('Projetos') && maisNames.includes('Vendas'), maisNames.slice(0, 8).join(', '))
  await b.click('Anotações', 'nav a')
  await sleep(800)
  r.check('aba escolhida funciona (Anotações)', (await b.text()).includes('Nota guardada'))

  // Hiding a chosen section takes it out of the bar (data stays)
  await b.goto(BASE + '#/settings?painel=secoes')
  await sleep(900)
  await b.eval(`(() => { const sw = [...document.querySelectorAll('[role=dialog] [role=switch]')].find((x) => x.querySelector('.font-medium')?.textContent.trim() === 'Tarefas'); sw.click() })()`)
  await sleep(500)
  r.check('esconder uma seção da barra tira ela da barra', JSON.stringify(await tabs()) === JSON.stringify(['Início', 'Vendas', 'Anotações', 'Assistente']), (await tabs()).join(', '))

  // ---------- Desktop: sidebar follows the same choice
  await b.desktop()
  await b.goto(BASE + '#/')
  await sleep(1000)
  const side = await b.eval(`[...document.querySelectorAll('aside a')].map((a) => (a.querySelector('.truncate') ?? a).textContent.trim())`)
  r.check('computador: barra lateral mostra as seções com os nomes novos', side.includes('Senhas') && side.includes('Assinaturas'), side.join(', '))
  const sideGroups = await b.eval(`[...document.querySelectorAll('aside nav[aria-label]')].map((n) => n.getAttribute('aria-label'))`)
  r.check('computador: barra lateral agrupada como o menu', JSON.stringify(sideGroups) === JSON.stringify(['Dia a dia', 'Finanças', 'Trabalho', 'Planejamento', 'Guardados', 'Ferramentas', 'Ajustes']), sideGroups.join(', '))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('organization-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
