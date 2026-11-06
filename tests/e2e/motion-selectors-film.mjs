// Grava, em velocidade real (screencast: cada quadro pintado), os seletores com indicador deslizante:
// chips de Projetos, abas sublinhadas do Financeiro (período) e abas da Agenda (conteúdo entrando pelo lado).
//   E2E_SHOTS=<pasta> node tests/e2e/motion-selectors-film.mjs   (servidor local do e2e em 4317)
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, OUT } from './cdp.mjs'
import { BASE, seedExistingUser } from './helpers.mjs'

const b = await launch(9422)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString()

/** Runs `action` and keeps every painted frame for `ms` milliseconds; saves `keep` evenly spaced ones. */
async function film(name, action, ms = 650, keep = 6) {
  const got = []
  const onFrame = async (p) => {
    got.push({ t: performance.now(), data: p.data })
    await b.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {})
  }
  b.on('Page.screencastFrame', onFrame)
  await b.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 390, maxHeight: 844 })
  await sleep(250)
  const t0 = performance.now()
  await b.eval(action)
  await sleep(ms)
  await b.send('Page.stopScreencast')
  const frames = got.filter((f) => f.t >= t0 - 20)
  const step = Math.max(1, (frames.length - 1) / (keep - 1))
  const pick = Array.from({ length: Math.min(keep, frames.length) }, (_, i) => frames[Math.min(frames.length - 1, Math.round(i * step))])
  pick.forEach((f, i) => writeFileSync(join(OUT, `${name}-${i}.png`), Buffer.from(f.data, 'base64')))
  console.log(name, `${frames.length} quadros em ${ms} ms → ${pick.length} salvos`)
  // stop delivering to this film
  got.length = 0
  b.on('Page.screencastFrame', () => {})
}

try {
  await b.mobile()
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(
    b,
    {
      projects: [
        { id: 'p1', name: 'Site Clínica Nova', kind: 'site', status: 'inProgress', clientId: null, startDate: '', dueDate: '', endDate: '', charged: 240000, received: 60000, currency: 'BRL', link: '', notes: '', payments: [] },
        { id: 'p2', name: 'App Agenda Pet', kind: 'app', status: 'paused', clientId: null, startDate: '', dueDate: '', endDate: '', charged: 520000, received: 0, currency: 'BRL', link: '', notes: '', payments: [] },
      ],
      transactions: [
        { id: 't1', type: 'out', amount: 4500, currency: 'BRL', baseAmount: -4500, reason: 'Mercado', category: null, createdAt: ago(0) },
        { id: 't2', type: 'out', amount: 12000, currency: 'BRL', baseAmount: -12000, reason: 'Farmácia', category: null, createdAt: ago(3) },
        { id: 't3', type: 'in', amount: 300000, currency: 'BRL', baseAmount: 300000, reason: 'Salário', category: null, createdAt: ago(20) },
      ],
    },
    { baseCurrency: 'BRL', displayCurrency: 'BRL', initialBalance: 100000, modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  await b.goto(BASE + '#/projects')
  await b.waitText('Site Clínica Nova')
  await sleep(900)
  await film('sel-chips', `[...document.querySelectorAll('main [aria-pressed]')].find((x) => x.textContent.trim() === 'Pausados').click()`)
  await sleep(400)
  await film('sel-chips-volta', `[...document.querySelectorAll('main [aria-pressed]')].find((x) => x.textContent.trim() === 'Ativos').click()`)

  await b.goto(BASE + '#/finance')
  await b.waitText('Resultado do período')
  await sleep(900)
  await b.eval(`document.querySelector('[role=radiogroup][aria-label=Período]').scrollIntoView({ block: 'start' }); window.scrollBy(0, -120)`)
  await sleep(400)
  await film('sel-periodo', `[...document.querySelectorAll('[role=radiogroup][aria-label=Período] button')].find((x) => x.textContent.trim() === 'Ano').click()`, 750)

  await b.goto(BASE + '#/agenda')
  await b.waitText('Semana')
  await sleep(900)
  await film('sel-abas-agenda', `[...document.querySelectorAll('[role=radiogroup][aria-label=Visualização] button')].find((x) => x.textContent.trim() === 'Semana').click()`, 500)
  console.log('ok')
} catch (e) {
  console.log('ERRO ' + e.stack)
} finally {
  b.close()
}
