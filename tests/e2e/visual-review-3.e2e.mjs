// Revisão visual (itens 10–13): barras translúcidas (abas e topo); dinheiro numa fonte só e o resumo da Semana
// sem quebrar nem cortar; telas vazias menores e com uma ação; uma regra só de ícones. Modo local.
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9523)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const now = new Date().toISOString()
const tx = (id, type, amount, reason) => ({ id, type, amount, currency: 'EUR', baseAmount: type === 'in' ? amount : -amount, reason, category: type === 'in' ? 'freelance' : 'food', createdAt: now, updatedAt: now })
const family = (sel) => `getComputedStyle(${sel}).fontFamily`

try {
  await b.mobile()
  await seedExistingUser(
    b,
    {
      transactions: [tx('t1', 'in', 120000, 'Pagamento'), tx('t2', 'out', 4590, 'Mercado')],
      projects: [{ id: 'p1', name: 'Antigo', clientId: null, kind: 'site', status: 'done', startDate: '2026-01-01', dueDate: '', endDate: '2026-02-01', charged: 0, received: 0, currency: 'EUR', link: '', notes: '' }],
    },
    { baseCurrency: 'EUR', displayCurrency: 'EUR', initialBalance: 100000, timeZone: 'Europe/Madrid', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('nucleo:theme', '"dark"'); document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  // ---------- 10) Translucent bars
  await b.goto(BASE + '#/')
  await sleep(1500)
  const nav = await b.eval(`(() => { const n = document.querySelector('nav[aria-label="Navegação principal"]'); const cs = getComputedStyle(n); const a = cs.backgroundColor.match(/[\\d.]+/g); return { bg: cs.backgroundColor, alpha: a.length > 3 ? Number(a[3]) : 1, blur: cs.backdropFilter } })()`)
  r.check('barra de abas translúcida (fundo ≤ 80% + desfoque)', nav.alpha <= 0.8 && nav.blur.includes('blur'), JSON.stringify(nav))
  r.check('faixa desfocada sob a barra de status do celular', await b.eval(`(() => { const el = document.querySelector('[data-status-blur]'); return !!el && getComputedStyle(el).position === 'fixed' && getComputedStyle(el).backdropFilter.includes('blur') })()`))
  const tabIcons = await b.eval(`[...document.querySelectorAll('nav[aria-label="Navegação principal"] svg')].map((s) => Math.round(s.getBoundingClientRect().width))`)
  r.check('ícones das abas todos do mesmo tamanho (24)', tabIcons.length >= 4 && tabIcons.every((w) => w === 24), JSON.stringify(tabIcons))

  // ---------- 11) Money in one font
  const fonts = await b.eval(`(() => {
    const tile = [...document.querySelectorAll('main .card p')].find((p) => p.previousElementSibling?.textContent.startsWith('Entrou em'))
    const hero = [...document.querySelectorAll('main span')].find((s) => /font-display/.test(s.className) && /\\d/.test(s.textContent))
    const row = [...document.querySelectorAll('main .num')].find((x) => /€/.test(x.textContent) && !x.closest('.grid-cols-2'))
    return { tile: tile && ${family('tile')}, hero: hero && ${family('hero')}, row: row && ${family('row')} }
  })()`)
  r.check('só o saldo grande usa a fonte de destaque', /Bricolage/.test(fonts.hero ?? ''), JSON.stringify(fonts))
  r.check('valores dos blocos usam a mesma fonte das listas', fonts.tile && fonts.row && fonts.tile === fonts.row && !/Bricolage/.test(fonts.tile), JSON.stringify(fonts))

  await b.goto(BASE + '#/week')
  await sleep(1600)
  const week = await b.eval(`(() => {
    const label = [...document.querySelectorAll('main p')].find((p) => p.textContent.trim() === 'Saldo da semana')
    if (!label) return null
    const v = label.nextElementSibling
    const lh = parseFloat(getComputedStyle(v).lineHeight)
    const labels = [...label.parentElement.querySelectorAll('p.text-\\\\[13px\\\\]')]
    return { value: v.textContent, h: Math.round(v.getBoundingClientRect().height), lh: Math.round(lh), cut: labels.filter((l) => l.scrollWidth > l.clientWidth).map((l) => l.textContent), font: getComputedStyle(v).fontFamily }
  })()`)
  r.check('Semana: "+€ 1.154,10" numa linha só', week && week.value.includes('1.154,10') && week.h <= week.lh + 2, JSON.stringify(week))
  r.check('Semana: rótulos inteiros (nada de "saldo da sema…")', week && week.cut.length === 0, JSON.stringify(week?.cut))
  r.check('Semana: mesma fonte dos outros valores', week && week.font === fonts.row, week?.font)
  await b.shot('visual-review-3-week')

  // ---------- 12) Empty states
  await b.goto(BASE + '#/tasks')
  await sleep(1300)
  const empty = await b.eval(`(() => { const e = document.querySelector('main [data-empty]'); if (!e) return null; const cs = getComputedStyle(e); const btn = e.querySelector('button'); return { h: Math.round(e.getBoundingClientRect().height), dashed: cs.borderStyle.includes('dashed'), btn: btn?.textContent, btnBg: btn && getComputedStyle(btn).backgroundColor, btnH: btn && Math.round(btn.getBoundingClientRect().height) } })()`)
  r.check('tela vazia menor (≤ 240 px) e sem caixa tracejada', empty && empty.h <= 240 && !empty.dashed, JSON.stringify(empty))
  r.check('tela vazia tem uma ação, em botão suave (o "+" é o principal)', empty && empty.btn === 'Adicionar tarefa' && empty.btnBg !== 'rgb(109, 59, 255)' && empty.btnH >= 44, JSON.stringify(empty))
  await b.click('Adicionar tarefa', 'main [data-empty] button')
  await sleep(700)
  r.check('a ação abre o formulário', await b.eval(`!!document.querySelector('[role=dialog]')`))
  await b.shot('visual-review-3-empty')

  await b.goto(BASE + '#/projects')
  await sleep(1300)
  r.check('lista filtrada vazia oferece "Ver todos"', (await b.text()).includes('Nada por aqui'))
  await b.click('Ver todos', 'main [data-empty] button')
  await sleep(700)
  r.check('"Ver todos" mostra o projeto escondido pelo filtro', (await b.text()).includes('Antigo'))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('visual-review-3-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
