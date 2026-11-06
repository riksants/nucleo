// Quadros das 5 animações em câmera lenta (Animation.setPlaybackRate), para revisão visual.
//   E2E_SHOTS=<pasta> node tests/e2e/motion-frames.mjs   (servidor local do e2e em 4317)
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, OUT } from './cdp.mjs'
import { BASE, seedExistingUser } from './helpers.mjs'

const b = await launch(9413)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const ago = (d) => new Date(Date.now() - d * 86_400_000).toISOString()
const SLOW = 0.1
const frame = async (name) => {
  const { result } = await b.send('Page.captureScreenshot', { format: 'png' })
  const data = result.data
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
}
/** Starts `action`, then grabs `n` frames `every` ms apart (real time, animations at 10% speed). */
async function film(name, action, n = 5, every = 1100) {
  await b.send('Animation.setPlaybackRate', { playbackRate: SLOW })
  await b.eval(action)
  for (let i = 0; i < n; i++) {
    await sleep(i === 0 ? 150 : every)
    await frame(`${name}-${i}`)
  }
  await b.send('Animation.setPlaybackRate', { playbackRate: 1 })
  await sleep(400)
}

try {
  await b.mobile()
  await b.send('Animation.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(
    b,
    {
      projects: [
        { id: 'p1', name: 'Site Clínica Nova', kind: 'site', status: 'inProgress', clientId: null, startDate: '', dueDate: '', endDate: '', charged: 240000, received: 60000, currency: 'BRL', link: '', notes: '', payments: [] },
        { id: 'p2', name: 'App Agenda Pet', kind: 'app', status: 'review', clientId: null, startDate: '', dueDate: '', endDate: '', charged: 520000, received: 0, currency: 'BRL', link: '', notes: '', payments: [] },
      ],
      goals: [{ id: 'g1', name: 'Notebook novo', price: 400000, currency: 'BRL', note: 'Para editar vídeo', purchasedAt: null }],
      transactions: [
        { id: 't1', type: 'out', amount: 4500, currency: 'BRL', baseAmount: -4500, reason: 'Mercado', category: null, createdAt: ago(0) },
        { id: 't2', type: 'out', amount: 12000, currency: 'BRL', baseAmount: -12000, reason: 'Farmácia', category: null, createdAt: ago(2) },
        { id: 't4', type: 'out', amount: 8000, currency: 'BRL', baseAmount: -8000, reason: 'Uber', category: null, createdAt: ago(4) },
        { id: 't3', type: 'in', amount: 300000, currency: 'BRL', baseAmount: 300000, reason: 'Salário', category: null, createdAt: ago(20) },
      ],
    },
    { baseCurrency: 'BRL', displayCurrency: 'BRL', initialBalance: 100000, modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })

  await b.goto(BASE + '#/projects')
  await sleep(1500)
  await film('1-pagina', `location.hash = '/goals'`, 4, 900)
  await sleep(800)
  await b.goto(BASE + '#/projects')
  await sleep(1500)
  await film('3-card-detalhe', `document.querySelector('main [data-expand]').click()`, 6, 1000)
  await b.goto(BASE + '#/projects')
  await sleep(1500)
  await film('5-chips', `[...document.querySelectorAll('main [aria-pressed]')].find((x) => x.textContent.trim() === 'Pausados').click()`, 4, 700)
  await b.goto(BASE + '#/finance')
  await sleep(1500)
  await b.eval(`window.scrollTo(0, 260)`)
  await sleep(300)
  await film('4-valores', `[...document.querySelectorAll('[role=radiogroup][aria-label=Período] button')].find((x) => x.getAttribute('aria-checked') === 'false').click()`, 4, 1300)
  await b.goto(BASE + '#/agenda')
  await sleep(1500)
  await film('5-abas', `[...document.querySelectorAll('[role=radiogroup][aria-label=Visualização] button')].find((x) => x.textContent.trim() === 'Semana').click()`, 4, 900)
  console.log('ok')
} catch (e) {
  console.log('ERRO ' + e.stack)
} finally {
  b.close()
}
