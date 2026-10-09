// Campos de valor como calculadora: com toque de verdade (touchstart/touchend), os botões + − × ÷ = não
// tiram o foco do campo; "200 + 50 = 250", "× 2 = 500" numa sequência só; decimais sem erro de ponto
// flutuante; troca de moeda; confirmar/cancelar/reabrir. Com um teclado de iPhone simulado (Visual
// Viewport menor), a folha cabe na área visível: cabeçalho, campo, teclas e botão de confirmar à vista.
// Também no computador (teclado físico). Modo local.
import { launch } from './cdp.mjs'
import { BASE, idb, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9531)
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'life', 'week', 'agenda', 'inbox', 'recurring', 'habits']
const KEYBOARD = 336 // iPhone keyboard height at 390×844

// A fake Visual Viewport the test can shrink like the iPhone keyboard does (the layout viewport stays the same).
const FAKE_VV = `(() => {
  const t = new EventTarget(); let h = innerHeight
  for (const [k, f] of Object.entries({ height: () => h, width: () => innerWidth, offsetTop: () => 0, offsetLeft: () => 0, pageTop: () => 0, pageLeft: () => 0, scale: () => 1 })) Object.defineProperty(t, k, { get: f })
  Object.defineProperty(window, 'visualViewport', { value: t, configurable: true })
  window.__kb = (px) => { h = innerHeight - px; t.dispatchEvent(new Event('resize')) }
})()`

async function tap(selector) {
  const p = await b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  if (!p) throw new Error('tap: not found ' + selector)
  await b.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] })
  await sleep(60)
  await b.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(180)
}
const type = async (text) => { await b.send('Input.insertText', { text }); await sleep(120) }
const focused = () => b.eval(`document.activeElement?.id || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName`)
const value = () => b.eval(`document.getElementById('tx-amount')?.value ?? null`)
const result = () => b.eval(`document.querySelector('[data-testid=calc-result]')?.textContent.trim() ?? ''`)
const key = (op) => `[role=dialog] [data-key="${op}"]`

try {
  await b.mobile()
  await seedExistingUser(b, {}, { baseCurrency: 'BRL', displayCurrency: 'BRL', quickCurrencies: ['BRL', 'EUR', 'AED'], rates: { values: { EUR: 1, BRL: 6, AED: 4 }, fetchedAt: new Date().toISOString(), source: 't' }, timeZone: 'America/Sao_Paulo', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL })
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `${FAKE_VV}; localStorage.setItem('nucleo:theme', '"light"'); document.addEventListener('DOMContentLoaded', () => document.getElementById('splash')?.remove())` })
  await b.goto(BASE + '#/finance')
  await sleep(1400)

  // ---------- open: the field gets the focus; the keyboard opens
  await b.click('Adicionar', 'main button')
  await sleep(700)
  r.check('ao abrir "Adicionar dinheiro", o campo de valor recebe o foco', (await focused()) === 'tx-amount', await focused())
  await b.eval(`__kb(${KEYBOARD})`)
  await sleep(500)
  const fit = await b.eval(`(() => {
    const vis = innerHeight - ${KEYBOARD}
    const rect = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) } }
    return { vis, panel: rect('[role=dialog] .bg-sheet'), title: rect('[role=dialog] h2'), input: rect('#tx-amount'), keys: rect('[role=dialog] [role=group]'), confirm: rect('[role=dialog] .border-t button'), scrollX: document.documentElement.scrollWidth > innerWidth, pageY: scrollY }
  })()`)
  r.check('com o teclado aberto, a folha cabe na área visível (acima do teclado)', fit.panel && fit.panel.top >= 0 && fit.panel.bottom <= fit.vis + 1, JSON.stringify(fit))
  r.check('o título continua visível (não fica embaixo da barra de status)', fit.title && fit.title.top >= 0 && fit.title.bottom <= fit.vis, JSON.stringify(fit.title))
  r.check('o campo de valor e as teclas da calculadora aparecem', fit.input && fit.input.bottom <= fit.vis && fit.keys && fit.keys.bottom <= fit.vis, JSON.stringify({ input: fit.input, keys: fit.keys }))
  r.check('o botão de confirmar continua alcançável', fit.confirm && fit.confirm.bottom <= fit.vis + 1 && fit.confirm.top > 0, JSON.stringify(fit.confirm))
  r.check('a página não rolou nem ganhou rolagem horizontal', fit.pageY === 0 && !fit.scrollX)
  await b.shot('amount-keyboard-open')

  // ---------- 200 + 50 = 250, then × 2 = 500, without ever touching the field again
  await type('200')
  await tap(key('+'))
  r.check('tocar "+" não tira o foco do campo', (await focused()) === 'tx-amount', await focused())
  r.check('a conta aparece no campo: "200 + "', (await value()) === '200 + ', await value())
  await type('50')
  r.check('dá para continuar digitando direto: "200 + 50" e a prévia "= 250"', (await value()) === '200 + 50' && (await result()) === '= 250', `${await value()} | ${await result()}`)
  await b.shot('amount-expression')
  await tap(key('='))
  r.check('"=" põe o resultado no campo (250) e o foco continua', (await value()) === '250' && (await focused()) === 'tx-amount', `${await value()} / ${await focused()}`)
  await tap(key('*'))
  await type('2')
  await tap(key('='))
  r.check('continua calculando depois do "=": 250 × 2 = 500', (await value()) === '500' && (await focused()) === 'tx-amount', await value())
  await tap(key('-'))
  await tap(key('/'))
  r.check('trocar de operador não duplica: "500 ÷ "', (await value()) === '500 ÷ ', await value())

  // ---------- erase, decimals (no floating point noise)
  for (let i = 0; i < 6; i++) await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }), await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await sleep(150)
  r.check('apagar funciona e o foco continua', (await value()) === '' && (await focused()) === 'tx-amount', JSON.stringify(await value()))
  await type('0,1')
  await tap(key('+'))
  await type('0,2')
  r.check('0,1 + 0,2 mostra "= 0,30" (sem 0,30000000000000004)', (await result()) === '= 0,30', await result())
  await tap(key('='))
  r.check('e o resultado no campo é 0,30', (await value()) === '0,30', await value())

  // ---------- currency
  await b.click('EUR €', '[role=dialog] [role=radio]')
  await sleep(300)
  r.check('trocar a moeda muda o símbolo do campo e mantém o valor', (await b.eval(`document.querySelector('#tx-amount').parentElement.textContent.includes('€')`)) && (await value()) === '0,30')

  // ---------- confirm an unfinished calculation (no "=")
  await b.eval(`document.getElementById('tx-amount').focus()`)
  for (let i = 0; i < 4; i++) await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }), await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
  await type('200')
  await tap(key('+'))
  await type('50')
  await b.eval(`document.getElementById('tx-reason').focus()`)
  await type('Teste da calculadora')
  r.check('o botão de confirmar já mostra o resultado da conta', /Adicionar\s+€\s*250,00/.test(await b.eval(`document.querySelector('[role=dialog] .border-t button').textContent`)), await b.eval(`document.querySelector('[role=dialog] .border-t button').textContent`))
  await tap('[role=dialog] .border-t button')
  await sleep(900)
  const txs = await idb(b, 'transactions')
  const saved = txs.find((t) => t.reason === 'Teste da calculadora')
  r.check('confirmar sem "=" salva o resultado (250 EUR)', saved?.amount === 25000 && saved?.currency === 'EUR', JSON.stringify(saved && { amount: saved.amount, currency: saved.currency }))
  r.check('a folha fecha depois de confirmar', !(await b.eval(`!!document.querySelector('[role=dialog]')`)))

  // ---------- cancel and reopen
  await b.eval(`__kb(0)`)
  await b.click('Retirar', 'main button')
  await sleep(700)
  await type('99')
  await b.click('Fechar', '[role=dialog] button')
  await sleep(600)
  await b.click('Adicionar', 'main button')
  await sleep(700)
  r.check('cancelar e reabrir: campo vazio e focado de novo', (await value()) === '' && (await focused()) === 'tx-amount', `${JSON.stringify(await value())} / ${await focused()}`)
  await b.click('Fechar', '[role=dialog] button')
  await sleep(500)

  // ---------- the same keys in a form field (MoneyInput): appear on focus, keep the focus
  await b.click('Nova meta', 'main button')
  await sleep(700)
  await b.eval(`[...document.querySelectorAll('[role=dialog] [data-amount-field] input')][0].focus()`)
  await sleep(200)
  r.check('o formulário com valor + moeda cabe na largura do celular (nada fora da tela)', await b.eval(`(() => { const d = document.querySelector('[role=dialog] .bg-sheet'); return [...d.querySelectorAll('[data-amount-field], [data-amount-field] *')].every((e) => e.getBoundingClientRect().right <= innerWidth + 1) })()`))
  await b.shot('amount-form-focus')
  await type('1000')
  await tap(key('+'))
  const formFocus = await b.eval(`document.activeElement === [...document.querySelectorAll('[role=dialog] [data-amount-field] input')][0]`)
  await type('500')
  await tap(key('='))
  const formVal = await b.eval(`[...document.querySelectorAll('[role=dialog] [data-amount-field] input')][0].value`)
  r.check('nos formulários (ex.: valor da meta) as teclas aparecem e não tiram o foco: 1000 + 500 = 1.500', formFocus && formVal === '1.500', JSON.stringify({ formFocus, formVal, n: await b.eval(`document.querySelectorAll('[role=dialog] [data-amount-field]').length`), title: await b.eval(`document.querySelector('[role=dialog] h2')?.textContent`) }))
  await b.click('Fechar', '[role=dialog] button')
  await sleep(500)

  // ---------- desktop: physical keyboard
  await b.desktop()
  await b.goto(BASE + '#/finance')
  await sleep(1200)
  await b.click('Adicionar', 'main button')
  await sleep(600)
  await type('200+50')
  await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '=', code: 'Equal', text: '=' })
  await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '=', code: 'Equal' })
  await sleep(200)
  r.check('no computador: digitar "200+50" e "=" dá 250', (await value()) === '250', await value())
  await b.eval(`document.querySelector('[role=dialog] [data-key="+"]').click()`)
  await sleep(150)
  r.check('no computador: clicar nas teclas também mantém o foco', (await focused()) === 'tx-amount' && (await value()) === '250 + ', `${await value()} / ${await focused()}`)
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('amount-field-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
