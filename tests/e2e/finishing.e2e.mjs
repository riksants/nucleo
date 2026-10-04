// Sugestões 11–14 da análise: contraste do cinza, pequenos ajustes de animação, escala tipográfica,
// seções pré-carregadas (sem tela vazia; só as ativas) e celebração nos momentos raros. Modo local.
import { launch } from './cdp.mjs'
import { BASE, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9404)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const today = new Date().toISOString().slice(0, 10)
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const fillIn = (label, value) =>
  b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const l = [...d.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); const el = l && l.querySelector('input, textarea'); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const clickIn = (text) => b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].at(-1); const el = [...d.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.click(); return true })()`)
/** A celebration ring is animating somewhere on the page. */
const ringPlaying = () => b.eval(`[...document.querySelectorAll('.ring-income\\\\/60')].some((el) => el.getAnimations().length > 0)`)
async function seed(modules = Object.fromEntries(ALL.map((m) => [m, true]))) {
  await b.goto(BASE + 'favicon.svg')
  await b.eval(`new Promise((res) => { const q = indexedDB.deleteDatabase('nucleo'); q.onsuccess = q.onerror = q.onblocked = () => res(true) })`)
  await seedExistingUser(
    b,
    {
      tasks: [{ id: 'k1', title: 'Enviar proposta', projectId: null, dueDate: today, priority: 'none', status: 'todo', completedAt: null }],
      sales: [{ id: 's1', clientId: null, clientName: 'Maria', product: 'Bolo', quantity: 1, date: today, total: 10000, currency: 'BRL', dueDate: '', payments: [], notes: '' }],
    },
    { baseCurrency: 'BRL', displayCurrency: 'BRL', modules, modulesSeen: ALL },
  )
}

try {
  await b.mobile()
  await b.send('Page.enable')
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })
  await seed()

  // ---------- 11) Contrast of the light gray text
  await b.goto(BASE + '#/finance')
  await sleep(1200)
  const faint = await b.eval(`getComputedStyle(document.querySelector('.text-faint')).color`)
  r.check('cinza claro com contraste AA (#80808b)', faint === 'rgb(128, 128, 139)', faint)

  // ---------- 13a) Type scale: no half-pixel font sizes on screen
  const halves = []
  for (const path of ['#/', '#/finance', '#/tasks', '#/today', '#/sales', '#/notes', '#/settings']) {
    await b.goto(BASE + path)
    await sleep(900)
    halves.push(...(await b.eval(`[...document.querySelectorAll('body *')].map((el) => getComputedStyle(el).fontSize).filter((f) => /\\.5px$/.test(f))`)))
  }
  r.check('nenhum tamanho de texto "quebrado" (x,5 px) nas telas principais', halves.length === 0, halves.slice(0, 5).join(','))
  const tab = await b.eval(`getComputedStyle(document.querySelector('nav[aria-label="Navegação principal"] a')).fontSize`)
  r.check('rótulos da barra de abas com 12 px', tab === '12px', tab)

  // ---------- 13b) Enabled sections are preloaded in the background → first visit is instant
  await b.goto(BASE + '#/')
  await sleep(2500)
  const loaded = await b.eval(`performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()).filter((n) => /^(SalesPage|InboxPage|HabitsPage|AgendaPage|WeekPage)-/.test(n))`)
  r.check('seções ativas pré-carregadas quando o celular está ocioso', loaded.some((n) => n.startsWith('SalesPage')) && loaded.some((n) => n.startsWith('InboxPage')), loaded.join(', '))
  // Frame by frame during the switch: the screen must never be empty while the section's code arrives.
  const frames = await b.eval(`new Promise((res) => {
    const out = []
    location.hash = '/sales'
    const t0 = performance.now()
    const tick = () => {
      const m = document.querySelector('main')
      out.push(m ? m.innerText.trim().length : -1)
      if (performance.now() - t0 < 500) requestAnimationFrame(tick)
      else res({ out, sales: m.innerText.includes('Vendas') })
    }
    requestAnimationFrame(tick)
  })`)
  r.check('primeira visita a uma seção não passa por tela vazia', frames.sales && !frames.out.includes(0), frames.out.slice(0, 12).join(','))
  // A hidden section is never loaded
  await seed({ ...Object.fromEntries(ALL.map((m) => [m, true])), sales: false })
  await b.goto(BASE + '#/')
  await sleep(2500)
  const loaded2 = await b.eval(`performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()).filter((n) => /^(SalesPage|InboxPage)-/.test(n))`)
  r.check('seção desativada não é carregada', !loaded2.some((n) => n.startsWith('SalesPage')) && loaded2.some((n) => n.startsWith('InboxPage')), loaded2.join(', '))
  await seed()

  // ---------- 12) Task check + strike-through on the GPU, short; 14c) day cleared celebration
  await b.goto(BASE + '#/today')
  await sleep(1200)
  await b.eval(`document.querySelector('button[aria-label="Concluir tarefa"]').click()`)
  await sleep(120)
  const strike = await b.eval(`(() => { const s = [...document.querySelectorAll('main span.origin-left')][0]; if (!s) return null; const cs = getComputedStyle(s); return { transform: s.style.transform, prop: cs.transitionProperty, dur: cs.transitionDuration } })()`)
  r.check('risco da tarefa concluída por transform (GPU) em 200 ms', !!strike && strike.transform === 'scaleX(1)' && strike.prop.startsWith('transform') && strike.dur === '0.2s', JSON.stringify(strike))
  await sleep(700)
  let text = await b.text()
  const celebrated = await ringPlaying()
  r.check('última tarefa do dia: "Tudo feito por hoje" com celebração', text.includes('Tudo feito por hoje') && celebrated, `anel animando: ${celebrated}`)
  await sleep(600)
  r.check('celebração toca uma vez só (anel some)', !(await ringPlaying()))
  await b.goto(BASE + '#/finance')
  await sleep(300)
  await b.goto(BASE + '#/today')
  await sleep(900)
  r.check('ao voltar para Hoje, não celebra de novo', !(await b.text()).includes('Tudo feito por hoje') && !(await ringPlaying()))

  // ---------- 14b) A person's debt settled: the "Pago" seal celebrates once
  await b.goto(BASE + '#/sales')
  await sleep(1000)
  await b.click('Maria', 'button')
  await sleep(600)
  await clickIn('Pagamento geral')
  await sleep(300)
  await b.eval(`(() => { const el = document.querySelector('input[aria-label="Valor do pagamento geral"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '100'); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await clickIn('Registrar pagamento geral')
  await sleep(150)
  const paid = await ringPlaying()
  text = await b.eval(`[...document.querySelectorAll('[role=dialog]')].map((d) => d.innerText).join(' ')`)
  r.check('venda quitada: selo "Pago" celebra', text.includes('Pago') && paid, `anel: ${paid}`)
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(500)
  await b.click('Maria', 'button')
  await sleep(600)
  r.check('reabrir a pessoa já paga não celebra de novo', !(await ringPlaying()))
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
  await sleep(500)

  // ---------- 14a) A financial goal reached: the "alcançada" seal celebrates
  await b.goto(BASE + '#/finance')
  await sleep(1000)
  await b.click('Nova meta')
  await sleep(500)
  await fillIn('Nome', 'Viagem')
  await fillIn('Valor objetivo', '100')
  await fillIn('Já guardado', '40')
  await fillIn('Data limite', new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10))
  await clickIn('Criar meta')
  await sleep(700)
  r.check('meta nova ainda não alcançada não celebra', !(await ringPlaying()))
  await b.click('Viagem', 'button')
  await sleep(600)
  await fillIn('Quanto guardou', '60')
  await clickIn('Salvar')
  await sleep(150)
  const goal = await ringPlaying()
  r.check('meta alcançada: selo "alcançada" celebra', (await b.text()).includes('alcançada') && goal, `anel: ${goal}`)

  // ---------- Reduced motion: no celebration movement
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await seed()
  await b.goto(BASE + '#/today')
  await sleep(1200)
  await b.eval(`document.querySelector('button[aria-label="Concluir tarefa"]').click()`)
  await sleep(800)
  r.check('reduzir movimento: "Tudo feito por hoje" aparece sem animação', (await b.text()).includes('Tudo feito por hoje') && !(await ringPlaying()))
  await b.send('Emulation.setEmulatedMedia', { features: [] })

  // ---------- 12) Onboarding dots: only width and color transition
  await b.goto(BASE + 'favicon.svg')
  await b.eval(`new Promise((res) => { const q = indexedDB.deleteDatabase('nucleo'); q.onsuccess = q.onerror = q.onblocked = () => res(true) })`)
  await b.goto(BASE)
  await sleep(1500)
  await b.click('Começar sem conta').catch(() => {})
  await sleep(500)
  const dots = await b.eval(`(() => { const d = document.querySelector('[aria-hidden] > span.rounded-full'); return d ? getComputedStyle(d).transitionProperty : null })()`)
  r.check('pontos do onboarding animam só largura e cor (sem transition: all)', dots === 'width, background-color', String(dots))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('finishing-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
