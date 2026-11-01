// Vermilion header bands: in the DARK theme every text and icon sitting on the vermilion is white, and anything on
// a pill/control inside the band stays readable (≥ 3:1 against what is really behind it). In the LIGHT theme the
// colors are dumped (E2E_DUMP=<file>) so they can be compared with another build — they must not change.
import { writeFileSync } from 'node:fs'
import { launch } from './cdp.mjs'
import { BASE, noHorizontalScroll, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9385)
const THEME = process.env.E2E_THEME || 'dark'
const DUMP = process.env.E2E_DUMP
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'life', 'week', 'agenda']
const SCREENS = ['/', '/finance', '/projects', '/tasks', '/today', '/routine', '/sales', '/agenda', '/habits', '/recurring', '/tools', '/subscribers', '/clients', '/life', '/week', '/meals', '/inbox', '/notes', '/goals', '/accounts', '/portfolio', '/automations', '/rules', '/imports', '/intake', '/reminders', '/notifications', '/settings', '/search']

// Runs in the page: every visible text/icon inside visible .band elements, with its color and the real color behind it.
const PROBE = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true })
  // Any CSS color (rgb, oklab, color-mix results...) to RGBA, by letting the browser paint one pixel.
  const parse = (c) => { if (!c || c === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }; cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: Math.round((d[3] / 255) * 100) / 100 } }
  const blend = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 })
  const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const out = []
  for (const band of document.querySelectorAll('.band')) {
    const br = band.getBoundingClientRect()
    if (br.height < 4 || br.bottom <= 0 || getComputedStyle(band).opacity === '0' || band.closest('[aria-hidden=true]')) continue
    const brand = parse(getComputedStyle(band).backgroundColor)
    for (const el of band.querySelectorAll('*')) {
      const rect = el.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1 || rect.right <= 0 || rect.left >= innerWidth) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue
      const isIcon = el.tagName.toLowerCase() === 'svg'
      // The section's large watermark mark (decorative, a few % opacity) is not content.
      if (isIcon && parse(cs.color).a < 0.2) continue
      // The chosen option of a selector sits on its own pill (a sibling layer): its dark text is by design.
      const chosen = !!el.closest('[aria-checked=true], [aria-pressed=true], [aria-selected=true]')
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      if (!isIcon && !hasText) continue
      if (el.closest('svg') && !isIcon) continue
      // What is really behind it: the band's vermilion, with every fill from the band down to the element on top.
      const chain = []
      for (let p = el; p && p !== band; p = p.parentElement) chain.unshift(p)
      let bg = brand
      let onPill = false
      for (const p of chain) { const c = parse(getComputedStyle(p).backgroundColor); if (c && c.a > 0) { bg = blend(c, bg); if (c.a >= 0.5) onPill = true } }
      const fg0 = parse(isIcon ? (cs.color) : cs.color)
      const fg = blend(fg0, bg)
      const label = (isIcon ? 'ícone ' + (el.closest('[aria-label]')?.getAttribute('aria-label') || el.parentElement?.textContent.trim().slice(0, 20) || '') : el.textContent.trim().slice(0, 30)).replace(/\\s+/g, ' ')
      out.push({ label, color: cs.color, white: fg0.r === 255 && fg0.g === 255 && fg0.b === 255 && fg0.a === 1, onPill: onPill || chosen, chosen, contrast: Math.round(ratio(fg, bg) * 100) / 100, size: parseFloat(cs.fontSize), path: chain.map((p) => p.tagName.toLowerCase()).join('>').slice(-60) })
    }
  }
  return out
})()`

const dump = {}
try {
  await b.mobile()
  await seedExistingUser(
    b,
    {
      tasks: [{ id: 't1', title: 'Entregar o site', projectId: null, dueDate: '2026-12-01', dueTime: '15:00', priority: 'high', status: 'todo', completedAt: null }],
      sales: [{ id: 's1', clientId: null, clientName: 'Maria', product: 'Bolo', quantity: 1, date: '2026-10-20', total: 40000, currency: 'BRL', dueDate: '2026-12-20', payments: [{ id: 'p1', date: '2026-10-20', amount: 30000, note: '' }], notes: '' }],
      projects: [{ id: 'pr1', name: 'Perfect Clean', clientId: null, kind: 'site', status: 'inProgress', startDate: '2026-09-23', dueDate: '2026-12-10', endDate: '', charged: 40000, received: 0, currency: 'EUR', link: '', notes: '' }],
    },
    { modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL, reminders: { on: true, showDetails: false, rules: {} } },
  )
  await b.eval(`localStorage.setItem('nucleo:theme', ${JSON.stringify(JSON.stringify(THEME))}); true`)
  for (const w of [320, 375, 390]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: 760, deviceScaleFactor: 2, mobile: true })
    const bad = []
    for (const s of SCREENS) {
      await b.goto(BASE + '#' + s)
      await b.sleep(1100)
      const theme = await b.eval('document.documentElement.dataset.theme')
      if (theme !== THEME) bad.push(`${s}: tema ${theme}`)
      const items = await b.eval(PROBE)
      dump[`${w}${s}`] = items.map((i) => `${i.label}|${i.color}`)
      if (THEME === 'dark') {
        for (const i of items) {
          if (!i.onPill && !i.white) bad.push(`${s} "${i.label}" ${i.color}`)
          if (i.contrast < 3) bad.push(`${s} "${i.label}" contraste ${i.contrast}`)
        }
      }
      if (!(await noHorizontalScroll(b))) bad.push(`${s}: rolagem horizontal`)
      if (w === 320 && THEME === 'dark') await b.shot(`band-dark-320${s.replace(/\//g, '_') || '_home'}`)
      if (w === 375 && THEME === 'light') await b.shot(`band-light-375${s.replace(/\//g, '_') || '_home'}`)
    }
    // The compact bar (after scrolling) and the side menu are bands too.
    await b.goto(BASE + '#/tasks')
    await b.sleep(900)
    await b.eval('window.scrollTo(0, 600)')
    await b.sleep(500)
    const compact = await b.eval(PROBE)
    dump[`${w}/tasks-rolado`] = compact.map((i) => `${i.label}|${i.color}`)
    if (THEME === 'dark') for (const i of compact) if ((!i.onPill && !i.white) || i.contrast < 3) bad.push(`barra compacta "${i.label}" ${i.color} ${i.contrast}`)
    await b.eval('window.scrollTo(0, 0)')
    await b.eval(`document.querySelector('[aria-label="Abrir menu"]')?.click()`)
    await b.sleep(700)
    const menu = await b.eval(PROBE)
    dump[`${w}/menu`] = menu.map((i) => `${i.label}|${i.color}`)
    if (THEME === 'dark') for (const i of menu) if ((!i.onPill && !i.white) || i.contrast < 3) bad.push(`menu "${i.label}" ${i.color} ${i.contrast}`)
    if (w === 320) await b.shot(`band-${THEME}-320-menu`)
    r.check(`${THEME} ${w}px: ${SCREENS.length} telas + barra compacta + menu`, bad.length === 0, bad.slice(0, 12).join(' | '))
  }
  if (THEME === 'dark') {
    // Below the band nothing changed: the first card title on Financeiro keeps the normal ink.
    await b.goto(BASE + '#/finance')
    await b.sleep(900)
    const below = await b.eval(`(() => { const band = document.querySelector('.band'); const h = [...document.querySelectorAll('main h2, main section h3, main [class*=SectionTitle], main p')].find(e => !band.contains(e) && e.getBoundingClientRect().top > band.getBoundingClientRect().bottom); return h ? getComputedStyle(h).color : null })()`)
    r.check('fora da faixa nada mudou (texto normal do tema escuro)', below && below !== 'rgb(255, 255, 255)', String(below))
  }
} catch (err) {
  r.results.push('ERROR ' + err.message)
} finally {
  if (DUMP) writeFileSync(DUMP, JSON.stringify(dump, null, 1))
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
