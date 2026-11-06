// Movimento no "iPhone" (390×844, 3x, toque, CPU 4x mais lenta): fluidez das animações, rolagem e toques
// DURANTE as animações (filtros, formulário, navegação, fechar no meio da abertura) e "Reduzir movimento".
// Fluidez: o quadro mediano (60 fps) decide; p95/máximo ficam no relatório (nesta máquina, com pouca memória,
// quadros longos isolados aparecem também na main). Modo local. Uso: node tests/e2e/motion-iphone.e2e.mjs
import { launch } from './cdp.mjs'
import { BASE, idb, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9418)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString()
const OUTER = '[role=dialog] > div:nth-child(2)'
/** rAF intervals while `action` runs (ms): how smooth the next `ms` milliseconds are. */
const frames = (action, ms = 700) =>
  b.eval(`new Promise((res) => { const gaps = []; let last = performance.now(); const t0 = last; ${action}; const tick = (t) => { gaps.push(t - last); last = t; if (t - t0 < ${ms}) requestAnimationFrame(tick); else { gaps.sort((a, b) => a - b); res({ n: gaps.length, p50: Math.round(gaps[Math.floor(gaps.length / 2)]), p95: Math.round(gaps[Math.floor(gaps.length * 0.95)]), max: Math.round(gaps.at(-1)) }) } }; requestAnimationFrame(tick) })`)
const touchDrag = async (x, y0, y1, ms = 240) => {
  await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] })
  for (let i = 1; i <= 8; i++) {
    await b.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / 8 }] })
    await sleep(ms / 8)
  }
  await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}
const tap = async (sel) => {
  const p = await b.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 30) } })()`)
  if (!p) return false
  await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] })
  await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  return true
}

try {
  await b.mobile()
  await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, type: 'out', amount: 1000 + i * 137, currency: 'BRL', baseAmount: -(1000 + i * 137), reason: `Compra ${i + 1}`, category: null, createdAt: ago(i % 9) }))
  await seedExistingUser(
    b,
    {
      projects: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Projeto ${i + 1}`, kind: 'site', status: i % 3 === 2 ? 'paused' : 'inProgress', clientId: null, startDate: '', dueDate: '', endDate: '', charged: 100000 * (i + 1), received: 0, currency: 'BRL', link: '', notes: '', payments: [] })),
      goals: [{ id: 'g1', name: 'Notebook novo', price: 400000, currency: 'BRL', note: '', purchasedAt: null }],
      clients: [{ id: 'c1', name: 'Ana Souza', company: 'Clínica Nova', status: 'active', email: '', phone: '', whatsapp: '', location: '', notes: '' }],
      transactions: many,
    },
    { baseCurrency: 'BRL', displayCurrency: 'BRL', initialBalance: 100000, modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })
  await b.goto(BASE + '#/projects')
  await b.waitText('Projeto 1')
  await sleep(800)
  await b.send('Emulation.setCPUThrottlingRate', { rate: 4 })

  // ---------- Smoothness (CPU 4x slower): card → detail, page change, chip slide, value roll
  const fOpen = await frames(`document.querySelector('main [data-expand]').click()`)
  r.check('abrir card: fluido (quadro mediano ≤ 20 ms = 60 fps)', fOpen.p50 <= 20, JSON.stringify(fOpen))
  await sleep(500)
  const fClose = await frames(`document.querySelector('[role=dialog] button[aria-label=Fechar]').click()`, 500)
  r.check('fechar card: fluido (quadro mediano ≤ 20 ms)', fClose.p50 <= 20, JSON.stringify(fClose))
  await sleep(500)
  const fPage = await frames(`location.hash = '/goals'`)
  r.check('trocar de página: fluido (quadro mediano ≤ 20 ms)', fPage.p50 <= 20, JSON.stringify(fPage))
  await sleep(600)
  await b.eval(`location.hash = '/projects'`)
  await b.waitText('Projeto 1')
  await sleep(600)
  const fChip = await frames(`[...document.querySelectorAll('main [aria-pressed]')].find((x) => x.textContent.trim() === 'Pausados').click()`, 500)
  r.check('trocar filtro: indicador desliza fluido (quadro mediano ≤ 20 ms)', fChip.p50 <= 20, JSON.stringify(fChip))

  // ---------- Taps DURING animations still work
  // filter tapped while the page is still entering
  await b.eval(`location.hash = '/finance'`)
  await sleep(150)
  await b.eval(`location.hash = '/projects'`)
  await sleep(60)
  const midEnter = await b.eval(`!!document.querySelector('.page-in')`)
  await b.eval(`[...document.querySelectorAll('main [aria-pressed]')].find((x) => x.textContent.trim() === 'Todos').click()`)
  await sleep(700)
  const all = await b.eval(`[...document.querySelectorAll('main [data-expand]')].length`)
  r.check('filtro tocado durante a entrada da página funciona (6 projetos)', midEnter && all === 6, `entrando: ${midEnter}, cards: ${all}`)
  // close tapped in the middle of the opening: closes cleanly, nothing left on screen
  await b.eval(`document.querySelector('main [data-expand]').click()`)
  await sleep(120)
  await b.eval(`document.querySelector('[role=dialog] button[aria-label=Fechar]').click()`)
  await sleep(1200)
  r.check('fechar no meio da abertura: fecha limpo', !(await b.eval(`!!document.querySelector('[role=dialog]')`)))
  // two quick taps on a card open ONE detail
  await b.eval(`(() => { const c = document.querySelector('main [data-expand]'); c.click(); c.click() })()`)
  await sleep(900)
  r.check('dois toques rápidos abrem um só detalhe', (await b.eval(`document.querySelectorAll('[role=dialog]').length`)) === 1)
  // form from the detail: Editar → type → save works (detail opened from a card)
  await b.eval(`[...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.trim() === 'Editar').click()`)
  await sleep(900)
  const typed = await b.eval(`(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find((x) => x.textContent.trim().startsWith('Nome')); const el = l && (l.querySelector('input') || l.parentElement.querySelector('input')); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'Projeto renomeado'); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await b.eval(`[...document.querySelectorAll('[role=dialog] button')].find((x) => /^Salvar/.test(x.textContent.trim()))?.click()`)
  await sleep(1200)
  const renamed = (await idb(b, 'projects')).some((p) => p.name === 'Projeto renomeado')
  r.check('formulário aberto a partir do detalhe salva normalmente', typed && renamed, `digitou: ${typed}, salvo: ${renamed}`)
  await b.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await sleep(800)
  // fast navigation: lands on the last page, fully visible
  for (const h of ['/finance', '/goals', '/clients', '/projects', '/finance']) {
    await b.eval(`location.hash = ${JSON.stringify(h)}`)
    await sleep(70)
  }
  await sleep(1200)
  // (the compact top band is hidden until you scroll — by design — so it's not counted)
  const landed = await b.eval(`(() => { const h = [...document.querySelectorAll('main h1, main h2')].find((x) => x.textContent.includes('Financeiro')) ?? document.querySelector('main section'); let n = h, op = 1; while (n && n !== document.body) { op *= Number(getComputedStyle(n).opacity); n = n.parentElement } return { hash: location.hash, stuck: (document.querySelector('.page-in') ? 1 : 0) + (op < 1 ? 1 : 0) + document.getAnimations().filter((a) => /page-/.test(a.animationName || '')).length, title: document.body.innerText.includes('Financeiro') } })()`)
  r.check('navegação rápida: termina na última página, sem nada preso transparente', landed.hash === '#/finance' && landed.stuck === 0 && landed.title, JSON.stringify(landed))
  // value roll ends on the exact computed amount (calculation untouched)
  await b.eval(`window.scrollTo(0, 250)`)
  await sleep(300)
  await b.eval(`[...document.querySelectorAll('[role=radiogroup][aria-label=Período] button')].find((x) => x.textContent.trim() === 'Tudo').click()`)
  await sleep(1200)
  const shown = await b.eval(`[...document.querySelectorAll('main .roll')].map((x) => x.textContent)`)
  const totalOut = many.reduce((s, t) => s + t.amount, 0)
  const expected = (totalOut / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
  r.check('valor rolado termina no total exato das saídas', shown.some((x) => x.includes(expected)), `${JSON.stringify(shown)} esperado ${expected}`)

  // ---------- Scrolling: a finger drag scrolls the page even while the page is entering
  await b.eval(`window.scrollTo(0, 0); location.hash = '/projects'`)
  await sleep(1000)
  await b.eval(`location.hash = '/finance'`)
  await sleep(50)
  await touchDrag(200, 700, 250)
  await sleep(600)
  const y = await b.eval(`window.scrollY`)
  r.check('rolagem com o dedo funciona durante a entrada da página', y > 100, `scrollY ${y}`)
  // a touch tap on a card during scroll-idle opens it (touch path, not only click)
  await b.eval(`window.scrollTo(0, 0); location.hash = '/projects'`)
  await sleep(1200)
  await tap('main [data-expand]')
  await sleep(900)
  r.check('toque (touch) num card abre o detalhe', await b.eval(`!!document.querySelector('[role=dialog]')`))
  await b.eval(`document.querySelector('[role=dialog] button[aria-label=Fechar]').click()`)
  await sleep(800)
  await b.send('Emulation.setCPUThrottlingRate', { rate: 1 })

  // ---------- Reduce motion on the "iPhone": no page/tab/value/card motion, everything still works
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await b.eval(`location.hash = '/goals'`)
  await sleep(60)
  const rmAnims = await b.eval(`document.getAnimations().filter((a) => /page-|swap-in|roll-|bar-grow|line-rise|body-rise/.test(a.animationName || '')).length`)
  r.check('reduzir movimento: nenhuma animação de página/aba/valor', rmAnims === 0, String(rmAnims))
  await b.eval(`location.hash = '/projects'`)
  await sleep(900)
  await b.eval(`document.querySelector('main [data-expand]').click()`)
  await sleep(60)
  const rmSheet = await b.eval(`(() => { const o = document.querySelector(${JSON.stringify(OUTER)}); return o ? o.getAnimations().map((a) => Object.keys(a.effect.getKeyframes()[0] || {}).join('+')) : null })()`)
  r.check('reduzir movimento: detalhe só aparece (sem crescer/deslizar)', Array.isArray(rmSheet) && !rmSheet.some((k) => /transform|clipPath/.test(k)), JSON.stringify(rmSheet))
  await sleep(400)
  r.check('reduzir movimento: detalhe aberto e utilizável', await b.eval(`!!document.querySelector('[role=dialog] button[aria-label=Fechar]')`))
} catch (e) {
  r.check('sem erro inesperado', false, e.stack)
} finally {
  b.close()
  const failed = r.print(b)
  process.exit(failed ? 1 : 0)
}
