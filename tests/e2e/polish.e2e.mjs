// Acabamento (análise com as skills apple-design / review / improve / find / animate):
// 1) "reduzir movimento" vale para o app inteiro; 2) troca de seção instantânea; 3) feedback de toque nas linhas
// e áreas de toque ≥ 44 pt; 4) logo nova no onboarding e na barra lateral; 5) botão "+" some ao rolar. Modo local.
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9401)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ago = (d) => new Date(Date.now() - d * 86400000).toISOString()
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const transactions = Array.from({ length: 40 }, (_, i) => ({ id: 't' + i, type: i % 3 ? 'out' : 'in', amount: 1000 + i * 37, currency: 'BRL', baseAmount: i % 3 ? -(1000 + i * 37) : 1000 + i * 37, reason: 'Movimentação ' + i, createdAt: ago(i), updatedAt: ago(i) }))
/** Is the point inside the element's touch area (the element or one of its children answers there)? */
const hits = (sel, dx, dy) => b.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); const x = r.left + r.width / 2 + ${dx}, y = r.top + r.height / 2 + ${dy}; const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)) })()`)
/** Opens "Adicionar dinheiro" and records the sheet panel's top on every frame for 600 ms. */
const sheetFrames = () =>
  b.eval(`new Promise((res) => {
    const out = []
    ;[...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Adicionar').click()
    const t0 = performance.now()
    const tick = () => {
      const d = document.querySelector('[role=dialog] > div:nth-child(2)')
      if (d) out.push(Math.round(d.getBoundingClientRect().top))
      if (performance.now() - t0 < 600) requestAnimationFrame(tick)
      else res(out)
    }
    requestAnimationFrame(tick)
  })`)
const box = (sel) => b.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })()`)

try {
  await b.mobile()
  await b.send('Page.enable')
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })

  // ---------- 4) New logo in onboarding (fresh device)
  await b.goto(BASE + 'favicon.svg')
  await b.eval(`indexedDB.deleteDatabase('nucleo')`)
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })
  await b.goto(BASE)
  await sleep(1500)
  const onboardLogo = await b.eval(`(() => { const svgs = [...document.querySelectorAll('#root svg[viewBox="-500 -500 1000 1000"]')]; return { count: svgs.length, pieces: svgs[0]?.querySelectorAll('path').length ?? 0, oldRing: !!document.querySelector('#root svg circle[r="15"]') } })()`)
  r.check('onboarding mostra a logo nova (4 peças), não o círculo antigo', onboardLogo.count >= 1 && onboardLogo.pieces === 4 && !onboardLogo.oldRing, JSON.stringify(onboardLogo))

  // Onboarding already created the database in the current version: start from scratch for the seeded user.
  await b.goto(BASE + 'favicon.svg')
  await b.eval(`new Promise((res) => { const q = indexedDB.deleteDatabase('nucleo'); q.onsuccess = q.onerror = q.onblocked = () => res(true) })`)
  await seedExistingUser(b, { transactions }, { baseCurrency: 'BRL', displayCurrency: 'BRL', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL })

  // ---------- 2) Instant section switching
  await b.goto(BASE + '#/')
  await sleep(1200)
  await b.eval(`location.hash = '/notes'`)
  await sleep(40)
  const switched = await b.eval(`(() => { const wrap = document.querySelector('main > div'); return { text: document.querySelector('main').innerText.includes('Anotações'), opacity: wrap ? getComputedStyle(wrap).opacity : null, anims: wrap ? wrap.getAnimations().length : -1, transform: wrap ? getComputedStyle(wrap).transform : null } })()`)
  r.check('troca de seção é instantânea (sem fade nem deslocamento)', switched.text && switched.opacity === '1' && switched.anims === 0 && switched.transform === 'none', JSON.stringify(switched))

  // ---------- 3a) Touch feedback on a row (Configurações rows use the new shared style)
  await b.goto(BASE + '#/settings')
  await sleep(1200)
  const rowSel = 'main button.tap'
  const before = await b.eval(`getComputedStyle(document.querySelector(${JSON.stringify(rowSel)})).boxShadow`)
  const rc = await b.eval(`(() => { const r = document.querySelector(${JSON.stringify(rowSel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  // Same :active state a finger produces on iOS (React registers touch listeners, which iOS needs for :active).
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rc.x, y: rc.y })
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rc.x, y: rc.y, button: 'left', clickCount: 1 })
  await sleep(30)
  const pressed = await b.eval(`getComputedStyle(document.querySelector(${JSON.stringify(rowSel)})).boxShadow`)
  // Release outside the row, so the press doesn't open anything.
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, button: 'left' })
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 2, y: 2, button: 'left', clickCount: 1 })
  await sleep(250)
  const released = await b.eval(`getComputedStyle(document.querySelector(${JSON.stringify(rowSel)})).boxShadow`)
  r.check('linha reage ao toque na hora e volta ao soltar', before === 'none' && pressed.includes('inset') && released === 'none', `${before} → ${pressed.slice(0, 40)} → ${released}`)
  const rows = await b.eval(`document.querySelectorAll('main .tap').length`)
  r.check('linhas da tela com feedback de toque', rows >= 3, String(rows))

  // ---------- 3b) Touch areas ≥ 44 pt (measured before: 32–36 pt and 20 pt text links)
  await b.goto(BASE + '#/finance')
  await sleep(1200)
  const small = [
    ['seletor de moeda (32 pt)', '[aria-label="Moeda de exibição"] [role=radio]'],
    ['período Hoje/7 dias/Mês (32 pt)', 'main [role=radiogroup] [role=radio]:not([aria-label="Moeda de exibição"] *)'],
  ]
  for (const [name, sel] of small) {
    const bx = await box(sel)
    const ok = bx && (await hits(sel, 0, 21)) && (await hits(sel, 0, -21))
    r.check(`área de toque ≥ 44 pt: ${name}`, !!ok, JSON.stringify(bx))
  }
  await b.goto(BASE + '#/')
  await sleep(1200)
  const verTudo = 'main button.hit'
  const vt = await b.eval(`(() => { const el = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Ver tudo'); if (!el) return null; el.id = 'vt'; const r = el.getBoundingClientRect(); return Math.round(r.height) })()`)
  r.check('área de toque ≥ 44 pt: "Ver tudo" (20 pt de altura visual)', vt !== null && (await hits('#vt', 0, 21)) && (await hits('#vt', 0, -21)), `altura visual ${vt}`)
  await b.goto(BASE + '#/finance')
  await sleep(900)
  await b.click('Adicionar')
  await sleep(700)
  const close = '[role=dialog] button[aria-label="Fechar"]'
  r.check('área de toque ≥ 44 pt: "Fechar" das folhas (36 pt visual)', (await hits(close, 0, 21)) && (await hits(close, 21, 0)) && (await hits(close, -21, 0)), JSON.stringify(await box(close)))
  r.check('visual dos botões não mudou (Fechar continua 36 pt)', JSON.stringify(await box(close)) === '{"w":36,"h":36}')
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(500)

  // ---------- 5) "+" hides while scrolling down, comes back on scroll up
  await b.goto(BASE + '#/finance')
  await sleep(1200)
  const fab = 'button[aria-label="Capturar na caixa de entrada"]'
  const state = () => b.eval(`(() => { const el = document.querySelector(${JSON.stringify(fab)}); const cs = getComputedStyle(el); return { hidden: el.dataset.hidden, opacity: cs.opacity, pe: cs.pointerEvents } })()`)
  r.check('"+" visível no topo', (await state()).hidden === 'false')
  for (let i = 0; i < 6; i++) {
    await b.eval(`window.scrollBy(0, 120)`)
    await sleep(60)
  }
  await sleep(300)
  const down = await state()
  r.check('"+" some ao rolar para baixo (e não recebe toques)', down.hidden === 'true' && down.opacity === '0' && down.pe === 'none', JSON.stringify(down))
  for (let i = 0; i < 3; i++) {
    await b.eval(`window.scrollBy(0, -80)`)
    await sleep(60)
  }
  await sleep(300)
  const up = await state()
  r.check('"+" volta ao rolar para cima', up.hidden === 'false' && up.opacity === '1', JSON.stringify(up))
  await b.eval(`window.scrollBy(0, 400)`)
  await sleep(300)
  await b.eval(`location.hash = '/notes'`)
  await sleep(500)
  r.check('"+" reaparece ao trocar de seção', (await state()).hidden === 'false')

  // ---------- 1) Reduced motion: sheets appear without sliding
  await b.goto(BASE + '#/finance')
  await sleep(1000)
  const normalFrames = await sheetFrames()
  const settled = normalFrames.at(-1)
  const sliding = Math.max(...normalFrames)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(600)
  r.check('movimento normal: a folha sobe deslizando', normalFrames.length > 3 && sliding > settled + 40, `${sliding} → ${settled} (${normalFrames.length} quadros)`)
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await b.goto(BASE + '#/finance')
  await sleep(1000)
  const reducedFrames = await sheetFrames()
  const reducedTop = Math.max(...reducedFrames)
  r.check('reduzir movimento: a folha aparece no lugar, sem deslizar', reducedFrames.length > 3 && Math.abs(reducedTop - settled) <= 2, `maior posição ${reducedTop} vs final ${settled}`)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(400)
  for (let i = 0; i < 6; i++) {
    await b.eval(`window.scrollBy(0, 120)`)
    await sleep(60)
  }
  await sleep(300)
  const fabReduced = await b.eval(`(() => { const el = document.querySelector(${JSON.stringify(fab)}); const cs = getComputedStyle(el); return { hidden: el.dataset.hidden, transform: cs.transform, opacity: cs.opacity } })()`)
  r.check('reduzir movimento: "+" só esmaece (sem deslizar)', fabReduced.hidden === 'true' && fabReduced.transform === 'none' && fabReduced.opacity === '0', JSON.stringify(fabReduced))
  await b.send('Emulation.setEmulatedMedia', { features: [] })

  // ---------- 4) New logo in the desktop sidebar
  await b.desktop()
  await b.goto(BASE + '#/')
  await sleep(1200)
  const side = await b.eval(`(() => { const s = document.querySelector('aside svg[viewBox="-500 -500 1000 1000"]'); return { pieces: s ? s.querySelectorAll('path').length : 0, oldRing: !!document.querySelector('aside svg circle[r="15"]') } })()`)
  r.check('barra lateral (computador) com a logo nova', side.pieces === 4 && !side.oldRing, JSON.stringify(side))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('polish-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
