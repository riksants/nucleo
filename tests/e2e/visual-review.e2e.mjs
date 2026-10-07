// Revisão visual (itens 4–6): títulos curtos que não quebram e barra compacta translúcida ao rolar; um padrão de
// seletor (sublinhado para trocar de visão); âmbar só para o que está perto do prazo, vermelho para atraso, sem
// "Hoje · hoje". Modo local.
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9521)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
// Due labels use the device's calendar day (like the app does).
const day = (n) => { const d = new Date(Date.now() + n * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const warn = () => b.eval(`(() => { const el = document.createElement('span'); el.className = 'text-warn'; document.body.appendChild(el); const c = getComputedStyle(el).color; el.remove(); return c })()`)
const P = (id, over) => ({ id, name: id, clientId: null, kind: 'site', status: 'inProgress', startDate: '2026-09-01', dueDate: '', endDate: '', charged: 0, received: 0, currency: 'EUR', link: '', notes: '', ...over })

try {
  await b.mobile()
  await seedExistingUser(
    b,
    {
      tasks: [
        { id: 't1', title: 'Atrasada', projectId: null, dueDate: day(-3), priority: 'none', status: 'todo', completedAt: null },
        { id: 't2', title: 'De hoje', projectId: null, dueDate: day(0), priority: 'none', status: 'todo', completedAt: null },
        { id: 't3', title: 'Semana que vem', projectId: null, dueDate: day(6), priority: 'none', status: 'todo', completedAt: null },
      ],
      sales: [{ id: 's1', clientId: null, clientName: 'Maria', product: 'Bolo', quantity: 1, date: day(-1), total: 5000, currency: 'EUR', dueDate: '', payments: [], notes: '' }],
      projects: Array.from({ length: 6 }, (_, i) => P(`p${i}`, { name: `Projeto ${i + 1}`, status: i === 0 ? 'review' : 'inProgress', charged: 100000, received: 20000, dueDate: day(10) })),
    },
    { baseCurrency: 'EUR', timeZone: 'Europe/Madrid', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })
  const amber = await (async () => {
    await b.goto(BASE + '#/projects')
    await sleep(1300)
    return warn()
  })()

  // ---------- 4) Short title on one line; compact bar while scrolled
  const h1 = await b.eval(`(() => { const h = document.querySelector('main h1'); return { text: h.textContent.trim(), h: Math.round(h.getBoundingClientRect().height) } })()`)
  r.check('Projetos: título curto numa linha só', h1.text === 'Projetos' && h1.h < 50, JSON.stringify(h1))
  const bar = () => b.eval(`(() => { const el = [...document.querySelectorAll('div.fixed.top-0')].find((d) => d.textContent.trim().endsWith('Projetos')); if (!el) return null; const cs = getComputedStyle(el); return { opacity: cs.opacity, blur: cs.backdropFilter, pe: cs.pointerEvents } })()`)
  let s = await bar()
  r.check('no topo da tela a barra compacta fica escondida', s && s.opacity === '0' && s.pe === 'none', JSON.stringify(s))
  await b.eval(`window.scrollTo(0, 600)`)
  await sleep(400)
  s = await bar()
  r.check('ao rolar, aparece a barra compacta translúcida com o nome da tela', s && s.opacity === '1' && s.blur.includes('blur'), JSON.stringify(s))
  await b.eval(`window.scrollTo(0, 0)`)
  await sleep(400)
  r.check('voltando ao topo, ela some de novo', (await bar()).opacity === '0')

  // ---------- 6) Colors: "Falta" and "Revisão" are not warnings
  const card = await b.eval(`(() => { const c = [...document.querySelectorAll('main .card')].find((x) => x.textContent.includes('Projeto 1')); const falta = [...c.querySelectorAll('span')].find((x) => x.textContent.startsWith('Falta')); const badge = [...c.querySelectorAll('span')].find((x) => x.textContent.trim() === 'Revisão'); return { falta: getComputedStyle(falta).color, badge: getComputedStyle(badge).color } })()`)
  r.check('Projetos: "Falta" e o status "Revisão" não usam âmbar de alerta', card.falta !== amber && card.badge !== amber, JSON.stringify({ ...card, amber }))
  r.check('resumo "A receber" não é âmbar', await b.eval(`(() => { const p = [...document.querySelectorAll('main p')].find((x) => x.previousElementSibling?.textContent === 'A receber'); return !p || getComputedStyle(p).color !== ${JSON.stringify(amber)} })()`))
  r.check('prazo em 10 dias não é âmbar', await b.eval(`(() => { const el = [...document.querySelectorAll('main span.inline-flex')].find((x) => /em \\d+ dias/.test(x.textContent)); return !!el && getComputedStyle(el).color !== ${JSON.stringify(amber)} })()`))

  // ---------- 5) + 6) Tasks: underline tabs; "Hoje" once; amber only today, red only late
  await b.goto(BASE + '#/tasks')
  await sleep(1200)
  const tabs = await b.eval(`(() => { const g = document.querySelector('[role=radiogroup][aria-label="Estado"]'); const r = g.querySelector('[role=radio]').getBoundingClientRect(); return { underline: getComputedStyle(g).borderBottomStyle === 'solid' && !g.className.includes('bg-raised'), h: Math.round(r.height) } })()`)
  r.check('Tarefas: abas sublinhadas (não pílulas), com 44 pt de toque', tabs.underline && tabs.h >= 44, JSON.stringify(tabs))
  const text = await b.text()
  r.check('sem "Hoje · hoje" repetido', !/Hoje · hoje/i.test(text) && text.includes('Hoje'))
  const colors = await b.eval(`(() => { const of = (re) => { const due = [...document.querySelectorAll('main span.inline-flex')].find((x) => re.test(x.textContent)); return due ? getComputedStyle(due).color : null }; return { late: of(/^Atrasado/), today: of(/^Hoje$/), next: of(/em \\d+ dias/) } })()`)
  r.check('atrasada em vermelho, de hoje em âmbar, semana que vem neutra', colors.today === amber && colors.late !== amber && colors.next !== amber && colors.late !== colors.next, JSON.stringify(colors))

  for (const [hash, label] of [['#/today', 'Modo do dia'], ['#/sales', 'Ver vendas por'], ['#/agenda', null]]) {
    await b.goto(BASE + hash)
    await sleep(1000)
    const ok = await b.eval(`(() => { const g = ${label ? `document.querySelector('[role=radiogroup][aria-label="${label}"]')` : `document.querySelector('main [role=radiogroup]')`}; return !!g && getComputedStyle(g).borderBottomStyle === 'solid' })()`)
    r.check(`${hash}: troca de visão com abas sublinhadas`, ok)
  }
  await b.goto(BASE + '#/settings')
  await sleep(1000)
  r.check('Configurações: escolha de tema continua em controle segmentado (é um valor, não uma visão)', await b.eval(`(() => { const g = document.querySelector('[role=radiogroup][aria-label="Tema"]'); return !!g && g.className.includes('rounded-full') })()`))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('visual-review-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
