// Calculadora no campo de valor (Adicionar / Retirar dinheiro). Modo local (dist-e2e em 4317).
import { launch } from './cdp.mjs'
import { BASE, idb, noHorizontalScroll, reporter, seedExistingUser, setValue } from './helpers.mjs'

const r = reporter()
const b = await launch(9383)
const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString()
/** Taps a calculator key (by its accessible name). */
const key = (label) =>
  b.eval(`(() => { const el = document.querySelector('[role=dialog] button[aria-label=${JSON.stringify(label)}]'); if (!el) return false; el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); el.click(); return true })()`)
const amount = () => b.eval(`document.querySelector('#tx-amount').value`)
const preview = () => b.eval(`document.querySelector('[data-testid=calc-result]')?.textContent ?? null`)
/** Types more digits at the end of the field, like the phone keyboard. */
const typeMore = async (digits) => setValue(b, '#tx-amount', (await amount()) + digits)

try {
  await b.mobile()
  await b.send('Network.enable')
  await b.send('Network.setBypassServiceWorker', { bypass: true })
  await seedExistingUser(
    b,
    { transactions: [{ id: 'old-in', type: 'in', amount: 100000, currency: 'BRL', baseAmount: 100000, reason: 'Saldo antigo', createdAt: ago(10), updatedAt: ago(10) }] },
    { baseCurrency: 'BRL', displayCurrency: 'BRL', startedAt: ago(30) },
  )
  await b.goto(BASE + '#/finance')
  await b.sleep(1200)

  // Adicionar: 2500 + 750 + 120 = → 3.370 → Confirmar registra 3.370
  await b.click('Adicionar')
  await b.sleep(400)
  r.check('teclas da calculadora aparecem no campo de valor', (await key('Somar')) !== false && (await b.text()).includes('÷'))
  await setValue(b, '#tx-amount', '2500')
  r.check('número sozinho não mostra linha de resultado', (await preview()) === null)
  await key('Somar')
  await typeMore('750')
  await key('Somar')
  await typeMore('120')
  r.check('mostra a conta e o resultado', (await amount()) === '2500 + 750 + 120' && (await preview()) === '= 3.370', `${await amount()} | ${await preview()}`)
  r.check('Confirmar já mostra o resultado final', (await b.text()).includes('Adicionar R$ 3.370,00'))
  const before = (await idb(b, 'transactions')).length
  await key('Calcular')
  await b.sleep(300)
  r.check('"=" mostra o resultado no campo e não registra nada', (await amount()) === '3.370' && (await idb(b, 'transactions')).length === before)
  await b.shot('calc-adicionar')
  await setValue(b, '#tx-reason', 'Projetos do mês')
  await b.click('Adicionar R$ 3.370,00', 'button')
  await b.sleep(500)
  let all = await idb(b, 'transactions')
  const added = all.find((t) => t.reason === 'Projetos do mês')
  r.check('Confirmar registra uma entrada de 3.370', added?.type === 'in' && added.amount === 337000 && added.baseAmount === 337000 && added.currency === 'BRL' && all.length === before + 1)

  // Retirar: 100 + 50 = 150, continua 150 + 50 = 200, corrige com apagar
  await b.click('Retirar')
  await b.sleep(400)
  await setValue(b, '#tx-amount', '100')
  await key('Somar')
  await typeMore('50')
  await key('Calcular')
  r.check('Retirar: 100 + 50 = 150', (await amount()) === '150')
  await key('Somar')
  await typeMore('5')
  // Apagar (corrigir antes de confirmar): "150 + 5" → "150 + " → "150 + 50"
  await setValue(b, '#tx-amount', (await amount()).slice(0, -1))
  await typeMore('50')
  r.check('continua calculando depois do "=": 150 + 50 = 200', (await preview()) === '= 200' && (await b.text()).includes('Retirar R$ 200,00'))
  await key('Multiplicar')
  await key('Dividir')
  r.check('trocar de operador não cria conta inválida', (await amount()) === '150 + 50 ÷ ')
  await typeMore('0')
  r.check('divisão por zero é avisada', (await preview()) === 'Não dá para dividir por zero')
  await setValue(b, '#tx-reason', 'Conta dividida')
  await b.click('Confirmar', 'button')
  await b.sleep(400)
  r.check('com conta inválida, Confirmar não registra nada', !(await idb(b, 'transactions')).some((t) => t.reason === 'Conta dividida'))
  await setValue(b, '#tx-amount', '150 + 50')
  await b.click('Retirar R$ 200,00', 'button')
  await b.sleep(500)
  all = await idb(b, 'transactions')
  const out = all.find((t) => t.reason === 'Conta dividida')
  r.check('Retirar registra o resultado final (200)', out?.type === 'out' && out.amount === 20000 && out.baseAmount === -20000)
  r.check('nenhum valor inválido salvo', all.every((t) => Number.isSafeInteger(t.amount) && t.amount > 0 && Number.isFinite(t.baseAmount)))

  // Valor único continua como antes, com centavos
  await b.click('Retirar')
  await b.sleep(400)
  await setValue(b, '#tx-amount', '12,50')
  await setValue(b, '#tx-reason', 'Café')
  await b.click('Retirar R$ 12,50', 'button')
  await b.sleep(500)
  const cafe = (await idb(b, 'transactions')).find((t) => t.reason === 'Café')
  r.check('valor único com centavos funciona como antes', cafe?.amount === 1250 && cafe.baseAmount === -1250)

  // Editar uma movimentação antiga: valor aparece igual e continua salvando
  await b.click('Tudo', '[role=radio], button')
  await b.click('Saldo antigo', 'button')
  await b.sleep(400)
  r.check('editar mostra o valor antigo como antes', (await amount()) === '1000' && (await preview()) === null)
  await b.click('Salvar alterações', 'button')
  await b.sleep(400)
  const old = await idb(b, 'transactions', 'old-in')
  r.check('editar sem mudar mantém o valor', old.amount === 100000 && old.baseAmount === 100000)

  await b.click('Adicionar')
  await b.sleep(400)
  await setValue(b, '#tx-amount', '999999 × 999999 + 123456,78')
  r.check('sem rolagem horizontal com conta longa (390px)', await noHorizontalScroll(b))
  await b.shot('calc-longa')
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('calc-erro').catch(() => {})
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
