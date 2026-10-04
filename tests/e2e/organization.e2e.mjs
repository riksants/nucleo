// Organização (passos 1–3): "Mais" agrupado por assunto com descrição de cada seção e busca no topo; nomes que
// dizem o que é ("Senhas", "Assinaturas"); barra de baixo escolhida pela pessoa; "Hoje" e "Assistente" com nome
// na Início. Nada de dados muda. Modo local.
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
  r.check('quem nunca escolheu: barra igual a antes (Financeiro, Projetos, Tarefas)', JSON.stringify(await tabs()) === JSON.stringify(['Início', 'Financeiro', 'Projetos', 'Tarefas', 'Mais']), (await tabs()).join(', '))

  // Início: "Hoje" and "Assistente" with names
  const shortcuts = await b.eval(`[...document.querySelectorAll('main button')].map((x) => x.textContent.trim()).filter((t) => t === 'Hoje' || t === 'Assistente')`)
  r.check('Início mostra "Hoje" e "Assistente" com nome', shortcuts.includes('Hoje') && shortcuts.includes('Assistente'), shortcuts.join(', '))
  await b.click('Assistente', 'main button')
  await sleep(700)
  r.check('"Assistente" abre o Assistente', (await b.eval(`location.hash`)).startsWith('#/assistant'))
  await b.goto(BASE + '#/')
  await sleep(800)
  await b.click('Hoje', 'main button')
  await sleep(700)
  r.check('"Hoje" abre o Hoje', (await b.eval(`location.hash`)).startsWith('#/today'))

  // ---------- 1) "Mais": search first, grouped sections with what each is for
  await b.goto(BASE + '#/more')
  await sleep(900)
  const mais = await b.eval(`(() => {
    const main = document.querySelector('main')
    const first = main.querySelector('a')
    const groups = [...main.querySelectorAll('section h2')].map((h) => h.textContent.trim())
    const rows = [...main.querySelectorAll('section a')].map((a) => ({ name: a.querySelector('.font-medium')?.textContent.trim(), desc: a.querySelector('.text-faint')?.textContent.trim() }))
    return { first: first.getAttribute('href') + ' ' + first.textContent.trim(), groups, rows }
  })()`)
  r.check('Mais começa pela busca', mais.first.startsWith('#/search') && mais.first.includes('Buscar em tudo'), mais.first)
  r.check('Mais agrupado por assunto', JSON.stringify(mais.groups.map((g) => g.toLowerCase())) === JSON.stringify(['dia a dia', 'dinheiro', 'trabalho', 'planejamento', 'guardados']), mais.groups.join(', '))
  r.check('cada seção no Mais tem uma linha dizendo para que serve', mais.rows.length >= 14 && mais.rows.every((x) => x.name && x.desc && x.desc.length > 8), `${mais.rows.length} seções`)
  const names = mais.rows.map((x) => x.name)
  r.check('nomes novos: "Senhas" e "Assinaturas" (sem "Contas"/"Ferramentas")', names.includes('Senhas') && names.includes('Assinaturas') && !names.includes('Contas') && !names.includes('Ferramentas'), names.join(', '))
  r.check('seções da barra não se repetem no Mais', !names.includes('Financeiro') && !names.includes('Tarefas'))
  await b.goto(BASE + '#/accounts')
  await sleep(800)
  const accTitle = await b.eval(`document.querySelector('main h1')?.textContent.trim()`)
  await b.goto(BASE + '#/tools')
  await sleep(800)
  const toolTitle = await b.eval(`document.querySelector('main h1')?.textContent.trim()`)
  r.check('títulos das telas com os nomes novos', accTitle === 'Senhas' && toolTitle === 'Assinaturas', `${accTitle} / ${toolTitle}`)
  r.check('dados preservados (Figma continua em Assinaturas)', (await b.text()).includes('Figma'))

  // "Personalizar seções" → Seções visíveis → Barra de navegação
  await b.goto(BASE + '#/more')
  await sleep(800)
  await b.click('Personalizar seções', 'main a')
  await sleep(900)
  r.check('"Personalizar seções" abre Seções visíveis', (await dialog()).includes('Seções visíveis'))
  await b.click('Barra de navegação', '[role=dialog] button')
  await sleep(700)
  let d = await dialog()
  r.check('atalho leva à escolha da barra', d.includes('Escolha até 3 seções'))
  const preview = await b.eval(`[...document.querySelectorAll('[aria-label="Prévia da barra"] span')].map((s) => ({ t: s.textContent.trim(), cut: s.scrollWidth > s.clientWidth + 1 }))`)
  r.check('prévia da barra mostra os nomes inteiros', preview.length === 5 && preview.every((p) => !p.cut) && preview[1].t === 'Financeiro', JSON.stringify(preview))

  // ---------- 3) Choose the bar: Vendas, Agenda, Anotações
  for (const name of ['Financeiro', 'Projetos de trabalho', 'Tarefas']) await toggleIn(name)
  await sleep(300)
  for (const name of ['Vendas', 'Agenda', 'Anotações']) await toggleIn(name)
  await sleep(400)
  r.check('barra muda na hora com a escolha', JSON.stringify(await tabs()) === JSON.stringify(['Início', 'Vendas', 'Agenda', 'Anotações', 'Mais']), (await tabs()).join(', '))
  await toggleIn('Hábitos')
  await sleep(600)
  d = await dialog()
  r.check('quarta seção é recusada com aviso (cabem 3)', (await tabs()).length === 5 && (await b.text()).includes('Cabem 3 seções'))
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(500)
  await b.goto(BASE + 'favicon.svg')
  await b.goto(BASE + '#/more')
  await sleep(1200)
  r.check('escolha continua depois de reabrir o app', JSON.stringify(await tabs()) === JSON.stringify(['Início', 'Vendas', 'Agenda', 'Anotações', 'Mais']), (await tabs()).join(', '))
  const maisNames = await b.eval(`[...document.querySelectorAll('main section a .font-medium')].map((x) => x.textContent.trim())`)
  r.check('Mais passa a mostrar Financeiro, Projetos e Tarefas (saíram da barra)', maisNames.includes('Financeiro') && maisNames.includes('Tarefas') && !maisNames.includes('Vendas'), maisNames.slice(0, 8).join(', '))
  await b.click('Anotações', 'nav a')
  await sleep(800)
  r.check('aba escolhida funciona (Anotações)', (await b.text()).includes('Nota guardada'))

  // Hiding a chosen section takes it out of the bar (data stays)
  await b.goto(BASE + '#/settings?painel=secoes')
  await sleep(900)
  await b.eval(`(() => { const sw = [...document.querySelectorAll('[role=dialog] [role=switch]')].find((x) => x.querySelector('.font-medium')?.textContent.trim() === 'Agenda'); sw.click() })()`)
  await sleep(500)
  r.check('esconder uma seção da barra tira ela da barra', JSON.stringify(await tabs()) === JSON.stringify(['Início', 'Vendas', 'Anotações', 'Mais']), (await tabs()).join(', '))

  // ---------- Desktop: sidebar follows the same choice
  await b.desktop()
  await b.goto(BASE + '#/')
  await sleep(1000)
  const side = await b.eval(`[...document.querySelectorAll('aside a')].map((a) => a.textContent.trim())`)
  r.check('computador: barra lateral mostra as seções com os nomes novos', side.includes('Senhas') && side.includes('Assinaturas'), side.join(', '))
  const sideGroups = await b.eval(`[...document.querySelectorAll('aside nav[aria-label]')].map((n) => n.getAttribute('aria-label'))`)
  r.check('computador: barra lateral agrupada como o Mais', JSON.stringify(sideGroups) === JSON.stringify(['Dia a dia', 'Dinheiro', 'Trabalho', 'Planejamento', 'Guardados']), sideGroups.join(', '))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('organization-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
