// Itens 1 e 2 da segunda análise: a Início não "pula" (cartão de atenção já no lugar ao voltar; quando chega
// depois, abre suave em vez de empurrar) e o interruptor anda por transform, sem quique. Modo local.
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9406)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString()
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const SHIFTS = `window.__shift = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__shift.push({ v: e.value, t: e.startTime }) }).observe({ type: 'layout-shift', buffered: true })`
const card = `[...document.querySelectorAll('main button')].find((x) => /precisar da sua atenção/.test(x.textContent))`

try {
  await b.mobile()
  await b.send('Page.enable')
  // An overdue task guarantees a suggestion on any day of the week (the card used to rely on Sunday's "preparar a próxima semana").
  await seedExistingUser(b, { transactions: [{ id: 't1', type: 'out', amount: 900, currency: 'BRL', baseAmount: -900, reason: 'Café', createdAt: ago(0), updatedAt: ago(0) }], tasks: [{ id: 'late', title: 'Tarefa antiga', projectId: null, dueDate: '2026-01-05', priority: 'none', status: 'todo', completedAt: null }] }, { baseCurrency: 'BRL', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL })
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: SHIFTS + `; document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  // ---------- First open: the card arrives a moment later — it opens smoothly instead of jumping in
  await b.goto(BASE + '#/')
  let opened = null
  for (let i = 0; i < 80 && !opened; i++) {
    opened = await b.eval(`(() => { const c = ${card}; if (!c) return null; const w = c.parentElement; return { animating: w.getAnimations().length > 0 || w.style.height !== '', height: w.style.height } })()`).catch(() => null)
    if (!opened) await sleep(25)
  }
  r.check('primeira abertura: o cartão de atenção entra abrindo suave (não aparece de repente)', !!opened && opened.animating, JSON.stringify(opened))
  await sleep(800)
  r.check('cartão de atenção visível na Início', await b.eval(`!!(${card})`))

  // ---------- Coming back to Início: already in place on the first frame, zero layout shift
  await b.eval(`location.hash = '/finance'`)
  await sleep(700)
  await b.eval(`window.__shift = []`)
  const back = await b.eval(`new Promise((res) => {
    location.hash = '/'
    const t0 = performance.now(); const frames = []
    const tick = () => {
      frames.push(!!(${card}))
      if (performance.now() - t0 < 1200) requestAnimationFrame(tick)
      else res({ frames, shift: window.__shift.reduce((s, e) => s + e.v, 0) })
    }
    requestAnimationFrame(tick)
  })`)
  const firstFrameWithHome = back.frames.findIndex((x) => x)
  r.check('voltando para a Início: cartão já no lugar desde o primeiro quadro', firstFrameWithHome >= 0 && back.frames.slice(firstFrameWithHome).every(Boolean) && firstFrameWithHome <= 2, `primeiro quadro com cartão: ${firstFrameWithHome}`)
  r.check('voltando para a Início: a tela não pula (deslocamento 0)', back.shift < 0.001, `deslocamento ${back.shift.toFixed(4)}`)
  for (let i = 0; i < 3; i++) {
    await b.eval(`location.hash = '/tasks'`)
    await sleep(400)
    await b.eval(`window.__shift = []; location.hash = '/'`)
    await sleep(900)
  }
  const repeat = await b.eval(`window.__shift.reduce((s, e) => s + e.v, 0)`)
  r.check('várias idas e voltas: nenhum pulo', repeat < 0.001, repeat.toFixed(4))

  // ---------- 2) Switch: moves with transform (GPU), settles without overshooting
  await b.goto(BASE + '#/settings')
  await sleep(900)
  const knob = `document.querySelector('main [role=switch] span.rounded-full span')`
  const run = await b.eval(`new Promise((res) => {
    const sw = document.querySelector('main [role=switch]')
    const k = ${knob}
    const x0 = k.getBoundingClientRect().left
    const wasOn = sw.getAttribute('aria-checked') === 'true'
    sw.click()
    const xs = []; let keys = null; const t0 = performance.now()
    const tick = () => {
      const kk = ${knob}
      xs.push(kk.getBoundingClientRect().left - x0)
      if (!keys && kk.getAnimations().length) keys = Object.keys(kk.getAnimations()[0].effect.getKeyframes()[0] || {})
      if (performance.now() - t0 < 600) requestAnimationFrame(tick)
      else res({ xs: xs.map((v) => Math.round(v * 10) / 10), keys, wasOn, left: kk.style.left })
    }
    requestAnimationFrame(tick)
  })`)
  const final = run.xs.at(-1)
  const overshoot = run.wasOn ? Math.min(...run.xs) < final - 0.5 : Math.max(...run.xs) > final + 0.5
  r.check('interruptor anda por transform (GPU), não por "left"', Array.isArray(run.keys) && run.keys.includes('transform') && !run.left, JSON.stringify(run.keys))
  r.check('interruptor para sem quicar (não passa do ponto)', Math.abs(final) >= 19 && !overshoot, `trajeto ${run.xs.slice(0, 10).join(' → ')} … final ${final}`)

  // ---------- Reduced motion: card appears without animating; switch jumps
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await b.goto(BASE + 'favicon.svg')
  await b.goto(BASE + '#/')
  let rm = null
  for (let i = 0; i < 80 && !rm; i++) {
    rm = await b.eval(`(() => { const c = ${card}; if (!c) return null; const w = c.parentElement; return { anims: w.getAnimations().length, height: w.style.height } })()`).catch(() => null)
    if (!rm) await sleep(25)
  }
  r.check('reduzir movimento: cartão aparece sem animar', !!rm && rm.anims === 0, JSON.stringify(rm))
  await b.goto(BASE + '#/settings')
  await sleep(900)
  const rmSwitch = await b.eval(`new Promise((res) => { document.querySelector('main [role=switch]').click(); requestAnimationFrame(() => requestAnimationFrame(() => res((${knob}).getAnimations().length))) })`)
  r.check('reduzir movimento: interruptor muda sem animar', rmSwitch === 0, String(rmSwitch))
  await b.send('Emulation.setEmulatedMedia', { features: [] })
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('home-switch-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
