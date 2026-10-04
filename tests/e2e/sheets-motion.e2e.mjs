// Sugestões 7, 8 e 9 da análise: arrastar folhas para fechar (topo ou conteúdo no topo, gesto curto, volta com
// mola, resistência para cima), movimento de folhas/avisos na GPU (transform via WAAPI) com "reduzir movimento",
// e barras de progresso sem animação ao abrir. Modo local, toques reais (touchstart/move/end).
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9403)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const OUTER = '[role=dialog] > div:nth-child(2)'
const PANEL = OUTER + ' > div'
const isOpen = () => b.eval(`!!document.querySelector('[role=dialog]')`)
const center = (sel) => b.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 30)) } })()`)
async function openSheet() {
  await b.goto(BASE + '#/finance')
  await sleep(900)
  await b.eval(`[...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Adicionar').click()`)
  await sleep(700)
}
/** A finger drag: `steps` moves of `dy` total over `ms`, then lift. Returns the panel transform seen mid-drag. */
async function drag(sel, dy, ms, { lift = true } = {}) {
  const p = await center(sel)
  await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] })
  const steps = 8
  let mid = null
  for (let i = 1; i <= steps; i++) {
    await b.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y + Math.round((dy * i) / steps) }] })
    await sleep(ms / steps)
    if (i === steps) mid = await b.eval(`document.querySelector(${JSON.stringify(PANEL)})?.style.transform ?? null`)
  }
  if (lift) await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  return mid
}

try {
  await b.mobile()
  await b.send('Page.enable')
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(
    b,
    { goals: [{ id: 'g1', name: 'Notebook novo', price: 400000, currency: 'BRL', note: '', purchasedAt: null }] },
    { baseCurrency: 'BRL', displayCurrency: 'BRL', initialBalance: 100000, modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  // ---------- 8) The sheet slides in on the GPU (WAAPI transform), not via main-thread "y"
  await b.goto(BASE + '#/finance')
  await sleep(900)
  const gpu = await b.eval(`new Promise((res) => {
    [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Adicionar').click()
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const outer = document.querySelector(${JSON.stringify(OUTER)})
      const anims = outer ? outer.getAnimations().map((a) => Object.keys(a.effect.getKeyframes()[0] || {}).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k))) : []
      res({ anims, inline: outer ? outer.style.transform : null })
    }))
  })`)
  r.check('folha sobe com transform na GPU (animação WAAPI)', gpu.anims.some((k) => k.includes('transform')), JSON.stringify(gpu))
  await sleep(600)

  // ---------- 7) Drag from the header past 110 px: closes
  let mid = await drag('[role=dialog] header', 200, 320)
  await sleep(700)
  r.check('arrastar pelo topo para baixo fecha a folha', mid?.startsWith('translateY(') && !(await isOpen()), `durante: ${mid}`)

  // From the content while it is at the top: closes
  await openSheet()
  mid = await drag('[role=dialog] header + div', 180, 320)
  await sleep(700)
  r.check('arrastar pelo conteúdo (no topo) também fecha', mid?.startsWith('translateY(') && !(await isOpen()), `durante: ${mid}`)

  // A short, quick flick: closes on velocity
  await openSheet()
  mid = await drag('[role=dialog] header + div', 50, 60)
  await sleep(700)
  r.check('gesto curto e rápido (50 px) fecha pela velocidade', !(await isOpen()), `durante: ${mid}`)

  // A slow, short drag: springs back
  await openSheet()
  mid = await drag('[role=dialog] header', 70, 900)
  await sleep(900)
  const back = await b.eval(`document.querySelector(${JSON.stringify(PANEL)})?.style.transform ?? 'closed'`)
  r.check('arrasto curto e lento volta para o lugar com mola', (await isOpen()) && mid?.startsWith('translateY(') && (back === '' || back === 'translateY(0px)' || back === 'none'), `durante: ${mid} → depois: "${back}"`)

  // Dragging up: rubber band (resists), then returns
  mid = await drag('[role=dialog] header', -200, 400)
  const up = Number((mid || '').match(/-?\d+(\.\d+)?/)?.[0])
  await sleep(900)
  r.check('arrastar para cima resiste (elástico) e volta', up < 0 && up > -110 && (await isOpen()), `deslocou ${up}px para 200px de dedo`)

  // Content scrolled down: pulling down scrolls the content, never drags the sheet
  await b.eval(`(() => { const s = document.querySelector('[role=dialog] header + div'); s.style.paddingBottom = '900px'; s.scrollTop = 200 })()`)
  await sleep(100)
  mid = await drag('[role=dialog] header + div', 150, 300)
  await sleep(500)
  r.check('com o conteúdo rolado, puxar para baixo não arrasta a folha', (await isOpen()) && !mid, `transform: ${mid}`)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(500)

  // ---------- 8) Toast on the GPU too
  await b.goto(BASE + '#/finance')
  await sleep(900)
  await b.eval(`[...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Retirar').click()`)
  await sleep(600)
  await b.eval(`(() => { const set = (sel, v) => { const el = document.querySelector(sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }; set('#tx-amount', '12'); set('#tx-reason', 'Café') })()`)
  const toast = await b.eval(`new Promise((res) => {
    [...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.includes('Retirar R$')).click()
    const t0 = performance.now()
    const look = () => {
      const t = document.querySelector('[role=status]')
      if (t && t.getAnimations().length) return res(t.getAnimations().map((a) => Object.keys(a.effect.getKeyframes()[0] || {})).flat())
      if (performance.now() - t0 > 1500) return res(null)
      requestAnimationFrame(look)
    }
    look()
  })`)
  r.check('aviso (toast) entra com transform na GPU', Array.isArray(toast) && toast.includes('transform'), JSON.stringify(toast))

  // ---------- 9) Progress bar: value shown right away, animated only when it changes (clip-path, 300 ms)
  await b.goto(BASE + '#/goals')
  await sleep(150)
  const bar = await b.eval(`(() => { const fill = document.querySelector('[role=progressbar] > div'); if (!fill) return null; const cs = getComputedStyle(fill); return { clip: fill.style.clipPath, anims: fill.getAnimations().length, prop: cs.transitionProperty, dur: cs.transitionDuration, width: Math.round(fill.getBoundingClientRect().width), track: Math.round(fill.parentElement.getBoundingClientRect().width), now: fill.parentElement.getAttribute('aria-valuenow') } })()`)
  r.check('barra de progresso já abre no valor (sem animar a largura)', !!bar && bar.anims === 0 && bar.width === bar.track && /inset\(0(px)? \d/.test(bar.clip), JSON.stringify(bar))
  r.check('mudança de valor anima por clip-path em 300 ms', !!bar && bar.prop.includes('clip-path') && bar.dur.startsWith('0.3s'), `${bar?.prop} ${bar?.dur}`)

  // ---------- Reduced motion: sheet and toast only fade; progress bar doesn't animate
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await b.goto(BASE + '#/finance')
  await sleep(900)
  const rm = await b.eval(`new Promise((res) => {
    [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Adicionar').click()
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const outer = document.querySelector(${JSON.stringify(OUTER)})
      const keys = outer ? outer.getAnimations().map((a) => Object.keys(a.effect.getKeyframes()[0] || {})).flat() : []
      res({ keys, transform: outer ? getComputedStyle(outer).transform : null })
    }))
  })`)
  r.check('reduzir movimento: folha só esmaece (sem transform)', !rm.keys.includes('transform') && (rm.transform === 'none' || rm.transform === 'matrix(1, 0, 0, 1, 0, 0)'), JSON.stringify(rm))
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(400)
  await b.goto(BASE + '#/goals')
  await sleep(300)
  const rmBar = await b.eval(`getComputedStyle(document.querySelector('[role=progressbar] > div')).transitionProperty`)
  r.check('reduzir movimento: barra de progresso sem transição', rmBar === 'none' || rmBar === 'all' ? rmBar === 'none' : !rmBar.includes('clip-path'), rmBar)
  await b.send('Emulation.setEmulatedMedia', { features: [] })
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('sheets-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
