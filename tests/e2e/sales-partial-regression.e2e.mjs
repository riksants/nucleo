// Regression (2026-11-01 audit): an OLD sale (format before Etapas 4/5) with a partial payment keeps showing
// Recebido €300 / Falta €100 and its payments, also after editing it with the new reminder fields and
// reloading. A project with the old "received" amount keeps its own totals. Nothing financial is rewritten.
import { launch } from './cdp.mjs'
import { BASE, idb, reporter, seedExistingUser } from './helpers.mjs'

const r = reporter()
const b = await launch(9383)
const ALL = ['today', 'finance', 'projects', 'tasks', 'clients', 'goals', 'tools', 'accounts', 'notes', 'portfolio', 'sales', 'subscribers', 'routine', 'meals', 'inbox', 'habits', 'recurring', 'life', 'week', 'agenda']
const dialog = () => b.eval(`[...document.querySelectorAll('[role=dialog]')].pop()?.innerText ?? ''`)
const clickIn = (t) => b.eval(`(() => { const d = [...document.querySelectorAll('[role=dialog]')].pop(); const el = [...d.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(t)})); if (!el) return false; el.click(); return true })()`)
const sale = {
  id: 's-old', createdAt: '2026-10-04T14:46:23.734Z', updatedAt: '2026-10-09T14:28:24.335Z', clientId: 'c1', clientName: '', product: 'Web Site', quantity: 1, date: '2026-09-28',
  total: 40000, currency: 'EUR', dueDate: '', notes: '',
  payments: [{ id: 'p1', date: '2026-10-05', amount: 20000, note: '' }, { id: 'p2', date: '2026-10-21', amount: 10000, note: '' }],
}
try {
  await b.mobile()
  await seedExistingUser(
    b,
    {
      clients: [{ id: 'c1', name: 'Vânia', email: '', notes: '', phone: '', status: 'active', company: 'Perfect Clean', updatedAt: '2026-09-28T13:48:56.505Z' }],
      sales: [sale],
      // As in production: the project's €100 payment already has its income in Financeiro.
      transactions: [{ id: 'rcv-project-pp1', createdAt: '2026-10-21T15:00:00.000Z', updatedAt: '2026-10-21T17:56:28.494Z', type: 'in', amount: 10000, currency: 'EUR', baseAmount: 10000, reason: 'Perfect Clean · Pagamento de projeto', category: 'freelance', source: { kind: 'project', parentId: 'pr1', paymentId: 'pp1' } }],
      projects: [{ id: 'pr1', name: 'Perfect Clean', clientId: 'c1', kind: 'site', status: 'done', startDate: '2026-09-23', dueDate: '', endDate: '2026-09-28', charged: 40000, received: 20000, currency: 'EUR', link: '', notes: '', legacyReceived: 'inFinance', payments: [{ id: 'pp1', date: '2026-10-21', amount: 10000, currency: 'EUR', note: '' }] }],
    },
    { baseCurrency: 'EUR', modules: Object.fromEntries(ALL.map((m) => [m, true])), modulesSeen: ALL },
  )
  await b.goto(BASE + '#/sales?open=s-old')
  await b.sleep(1500)
  let d = await dialog()
  const money = (s) => s.replace(/\s/g, ' ')
  r.check('venda antiga: Recebido €300 e Falta €100', /Recebido\s*€ 300,00/.test(money(d)) && /Falta\s*€ 100,00/.test(money(d)), money(d).slice(0, 220))
  r.check('os dois pagamentos aparecem', !d.includes('Nenhum pagamento ainda') && money(d).includes('€ 200,00') && money(d).includes('€ 100,00'))
  await b.shot('regr-venda-antes')

  // Edit with the Etapa 5 form (reminder fields) and save.
  await clickIn('Editar venda')
  await b.sleep(900)
  await b.click('Escolher quando avisar', 'button').catch(() => {})
  await b.click('1 dia antes às 09:00', 'button').catch(() => {})
  await b.click('Salvar', 'button')
  await b.sleep(1200)
  const stored = await idb(b, 'sales', 's-old')
  r.check('após editar: pagamentos intactos no aparelho', JSON.stringify(stored.payments) === JSON.stringify(sale.payments) && stored.total === 40000, JSON.stringify(stored.payments))

  await b.eval('location.reload()')
  await b.sleep(1800)
  await b.goto(BASE + '#/sales?open=s-old')
  await b.sleep(1500)
  d = await dialog()
  r.check('após recarregar: ainda Recebido €300 / Falta €100', /Recebido\s*€ 300,00/.test(money(d)) && /Falta\s*€ 100,00/.test(money(d)))

  await b.goto(BASE + '#/clients')
  await b.sleep(900)
  await b.click('Vânia', 'button').catch(() => {})
  await b.sleep(900)
  const t = money(await b.text())
  r.check('ficha da cliente (projetos): Recebido €300 / A receber €100', /Recebido\s*€ 300,00/.test(t) && /A receber\s*€ 100,00/.test(t), t.slice(t.indexOf('Recebido') - 20, t.indexOf('Recebido') + 80))
  const proj = await idb(b, 'projects', 'pr1')
  r.check('projeto antigo intacto (recebido antigo + pagamento)', proj.received === 20000 && proj.payments.length === 1)
  const txs = await idb(b, 'transactions')
  r.check('nada novo no Financeiro só por abrir/editar (a entrada do projeto continua a mesma)', txs.length === 1 && txs[0].id === 'rcv-project-pp1' && txs[0].amount === 10000 && txs[0].updatedAt === '2026-10-21T17:56:28.494Z', JSON.stringify(txs.map((t) => [t.id, t.amount, t.updatedAt])))
} catch (err) {
  r.results.push('ERROR ' + err.message)
  await b.shot('regr-erro')
} finally {
  const failed = r.print(b)
  b.close()
  process.exit(failed ? 1 : 0)
}
