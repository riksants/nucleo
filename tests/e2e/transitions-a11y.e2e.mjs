// Itens 3 e 4 da segunda análise: passos do onboarding na GPU, com direção (avançar entra pela direita, voltar
// pela esquerda) e saída rápida; "Reduzir transparência" deixa as superfícies de vidro sólidas. Modo local.
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9407)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
/** Clicks a button and reports, frame by frame, the entering step's transform animation and when its content shows. */
const stepChange = (label) =>
  b.eval(`new Promise((res) => {
    const btn = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.textContent.trim()) === ${JSON.stringify(label)})
    if (!btn) return res(null)
    btn.click()
    const t0 = performance.now(); const starts = new Set(); let enteredAt = null
    const tick = () => {
      for (const anim of document.getAnimations()) {
        const k = anim.effect && anim.effect.getKeyframes()
        const from = k && k[0] && k[0].transform
        if (!from || !/translateX/.test(from)) continue
        starts.add(from)
        // The entering step starts away from 0 and ends at 0.
        if (enteredAt === null && from.includes('16px') && String(k.at(-1).transform).includes('(0px)')) enteredAt = Math.round(performance.now() - t0)
      }
      if (performance.now() - t0 < 700) requestAnimationFrame(tick)
      else res({ starts: [...starts], enteredAt })
    }
    requestAnimationFrame(tick)
  })`)

try {
  await b.mobile()
  await b.send('Page.enable')
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  // ---------- 3) Onboarding steps
  await b.goto(BASE + 'favicon.svg')
  await b.eval(`new Promise((res) => { const q = indexedDB.deleteDatabase('nucleo'); q.onsuccess = q.onerror = q.onblocked = () => res(true) })`)
  await b.goto(BASE)
  await sleep(1500)
  const fwd = await stepChange('Começar')
  r.check('avançar: próximo passo entra pela direita, na GPU (transform)', !!fwd && fwd.starts.includes('translateX(16px)') && !fwd.starts.includes('translateX(-16px)'), JSON.stringify(fwd))
  r.check('avançar: o novo passo começa a entrar logo após a saída rápida (≤ 200 ms)', !!fwd && fwd.enteredAt !== null && fwd.enteredAt <= 200, `${fwd?.enteredAt} ms`)
  await sleep(400)
  const back = await stepChange('Voltar')
  r.check('voltar: passo anterior entra pela esquerda', !!back && back.starts.includes('translateX(-16px)') && !back.starts.includes('translateX(16px)'), JSON.stringify(back))
  await sleep(400)
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await sleep(200)
  const rm = await stepChange('Começar')
  r.check('reduzir movimento: passos só esmaecem (sem deslocar)', !!rm && rm.starts.every((x) => x === 'translateX(0px)'), JSON.stringify(rm))
  await b.send('Emulation.setEmulatedMedia', { features: [] })

  // ---------- 4) "Reduzir transparência": glass becomes solid
  // Onboarding already created the database in the current version: start from scratch for the seeded user.
  await b.goto(BASE + 'favicon.svg')
  await b.eval(`new Promise((res) => { const q = indexedDB.deleteDatabase('nucleo'); q.onsuccess = q.onerror = q.onblocked = () => res(true) })`)
  await seedExistingUser(b, {}, { baseCurrency: 'BRL', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL })
  await b.goto(BASE + '#/finance')
  await sleep(1200)
  const nav = () => b.eval(`(() => { const n = document.querySelector('nav[aria-label="Navegação principal"]'); const cs = getComputedStyle(n); return { blur: cs.backdropFilter, bg: cs.backgroundColor } })()`)
  const normal = await nav()
  r.check('normal: barra de abas com vidro (desfoque, fundo translúcido)', normal.blur.includes('blur') && /rgba|\/ 0\.|oklab|color\(/.test(normal.bg), JSON.stringify(normal))
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] })
  await sleep(200)
  const solid = await nav()
  r.check('reduzir transparência: barra de abas sólida (sem desfoque)', solid.blur === 'none' && solid.bg === 'rgb(11, 16, 13)', JSON.stringify(solid))
  // Toast too
  await b.eval(`[...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Retirar').click()`)
  await sleep(600)
  await b.eval(`(() => { const set = (sel, v) => { const el = document.querySelector(sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }; set('#tx-amount', '5'); set('#tx-reason', 'Teste') })()`)
  await b.eval(`[...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.includes('Retirar R$')).click()`)
  await sleep(400)
  const toast = await b.eval(`(() => { const t = document.querySelector('[role=status]'); if (!t) return null; const cs = getComputedStyle(t); return { blur: cs.backdropFilter, bg: cs.backgroundColor } })()`)
  r.check('reduzir transparência: aviso (toast) sólido', !!toast && toast.blur === 'none' && toast.bg === 'rgb(30, 39, 34)', JSON.stringify(toast))
  await b.send('Emulation.setEmulatedMedia', { features: [] })
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('transitions-a11y-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
