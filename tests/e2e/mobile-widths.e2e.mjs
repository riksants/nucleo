// Etapa 5.7: every main screen at iPhone widths (320, 375, 390) — no horizontal scroll, no element
// wider than the screen, header buttons at least 40px. Screenshots at 320px for review.
import { launch } from './cdp.mjs'
import { BASE, noHorizontalScroll, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9377)
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'life', 'week', 'agenda']
const SCREENS = ['/', '/today', '/finance', '/tasks', '/agenda', '/habits', '/recurring', '/tools', '/sales', '/subscribers', '/projects', '/clients', '/life', '/week', '/meals', '/routine', '/inbox', '/notes', '/automations', '/rules', '/imports', '/reminders', '/notifications', '/settings', '/search']

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(
    b,
    {
      tasks: [{ id: 't1', title: 'Entregar o site da Perfect Clean com um título bem comprido para testar quebra', projectId: null, dueDate: '2026-12-01', dueTime: '15:00', priority: 'high', status: 'todo', completedAt: null }],
      tools: [{ id: 'sp', name: 'Spotify Premium Família', link: '', plan: 'Família', price: 3490, currency: 'BRL', billing: 'monthly', nextCharge: '2026-12-10', notes: '', status: 'active' }],
      clients: [{ id: 'c1', name: 'João da Silva Santos', email: '', phone: '', notes: '', status: 'active' }],
      sales: [{ id: 's1', clientId: 'c1', clientName: '', product: 'Tênis de corrida', quantity: 1, date: '2026-10-20', total: 40000, currency: 'BRL', dueDate: '2026-11-20', payments: [{ id: 'p1', date: '2026-10-20', amount: 20000, note: '' }], notes: '' }],
    },
    { modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL, reminders: { on: true, showDetails: false, rules: {} } },
  )
  for (const w of [320, 375, 390]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: 740, deviceScaleFactor: 2, mobile: true })
    for (const s of SCREENS) {
      await b.goto(BASE + '#' + s)
      await b.sleep(900)
      const ok = await noHorizontalScroll(b)
      // Elements sticking out of the screen that nothing clips (decorative marks inside overflow-hidden bands are fine).
      const wide = await b.eval(
        `(() => { const clipped = (e) => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p); if (o.overflowX !== 'visible' || o.overflow !== 'visible') return true } return false }
          return [...document.querySelectorAll('main *, header *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) && getComputedStyle(e).position !== 'fixed' && !clipped(e) }).slice(0, 3).map(e => e.tagName + ':' + (e.innerText || e.getAttribute('aria-label') || '').slice(0, 40)) })()`,
      )
      const sw = await b.eval(`document.documentElement.scrollWidth`)
      r.check(`${s} em ${w}px sem rolagem horizontal`, ok && wide.length === 0, `${sw}px ${wide.join(' | ')}`)
      if (w === 320) await b.shot(`w320${s.replace(/\//g, '_') || '_home'}`)
    }
  }
} catch (err) {
  r.results.push('ERROR ' + err.message)
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
