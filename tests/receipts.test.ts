import { describe, expect, it } from 'vitest'
import {
  allReceipts,
  belongsToProject,
  belongsToSale,
  missingReceipts,
  OVER_REMAINING,
  projectChargedProblem,
  projectPaymentProblem,
  projectReceipts,
  projectReceived,
  projectRemaining,
  receiptOps,
  receiptTransaction,
  receiptTxId,
  saleReceipts,
  unlinkOps,
  type ReceiptCtx,
} from '../src/data/receipts'
import { applyGeneralPayment } from '../src/data/sales'
import { balanceOf, projectOutstanding } from '../src/data/selectors'
import type { BatchOp } from '../src/data/repository'
import type { Project, ProjectPayment, Sale, Settings, Transaction } from '../src/data/types'
import { makeConverter } from '../src/lib/rates'
import { wallClock } from '../src/lib/zoned'

const TZ = 'Europe/Madrid'
const NOW = new Date('2026-10-05T10:00:00Z')
const settings = { baseCurrency: 'EUR', timeZone: TZ, initialBalance: 100000 } as Settings
// 1 EUR = 6 BRL = 1.1 USD (rates as the app keeps them: units per 1 EUR).
const ctx: ReceiptCtx = { settings, convert: makeConverter({ EUR: 1, BRL: 6, USD: 1.1 }), now: NOW }
const noRates: ReceiptCtx = { settings, convert: makeConverter(null), now: NOW }

const project = (over: Partial<Project> = {}): Project => ({
  id: 'pc', createdAt: '', updatedAt: '', name: 'Perfect Clean', clientId: null, kind: 'site', status: 'inProgress',
  startDate: '2026-09-01', dueDate: '', endDate: '', charged: 40000, received: 0, currency: 'EUR', link: '', notes: '', ...over,
})
const pay = (id: string, amount: number, date = '2026-10-01', currency = 'EUR'): ProjectPayment => ({ id, amount, date, currency, note: '' })
const sale = (id: string, over: Partial<Sale> = {}): Sale => ({
  id, createdAt: '', updatedAt: '', clientId: null, clientName: 'Maria', product: 'Bolo', quantity: 1, date: '2026-10-01',
  total: 30000, currency: 'EUR', dueDate: '', payments: [], notes: '', ...over,
})

/** Applies ops to a list of transactions the way the store/repository does. */
function apply(txs: Transaction[], ops: BatchOp[]): Transaction[] {
  let out = [...txs]
  for (const o of ops) {
    if (o.collection !== 'transactions') continue
    if (o.op === 'remove') out = out.filter((t) => t.id !== o.id)
    else out = [...out.filter((t) => t.id !== o.item.id), o.item as Transaction]
  }
  return out
}
const opsFor = (before: Project | null, after: Project, txs: Transaction[], c = ctx) => receiptOps(before ? projectReceipts(before) : [], projectReceipts(after), txs, c)

describe('projetos: pagamentos', () => {
  it('pagamento parcial e vários pagamentos: recebido vem da soma, com histórico', () => {
    const p = project({ payments: [pay('a', 10000), pay('b', 10000, '2026-10-05')] })
    expect(projectReceived(p)).toBe(20000)
    expect(projectRemaining(p)).toBe(20000)
    expect(projectOutstanding(p)).toBe(20000)
    expect(projectReceipts(p).map((r) => [r.txId, r.amount, r.date])).toEqual([
      ['rcv-project-a', 10000, '2026-10-01'],
      ['rcv-project-b', 10000, '2026-10-05'],
    ])
  })

  it('quitação: falta zero', () => {
    const p = project({ payments: [pay('a', 25000), pay('b', 15000)] })
    expect(projectRemaining(p)).toBe(0)
    expect(projectOutstanding(p)).toBe(0)
  })

  it('pagamento acima do restante é recusado com a mensagem; editar não conta o próprio valor', () => {
    const p = project({ payments: [pay('a', 20000)] })
    expect(projectPaymentProblem(p, { id: 'n', amount: 30000, date: '2026-10-05' })).toBe(OVER_REMAINING)
    expect(projectPaymentProblem(p, { id: 'n', amount: 20000, date: '2026-10-05' })).toBeNull()
    expect(projectRemaining(p, 'a')).toBe(40000)
    expect(projectPaymentProblem(p, { id: 'a', amount: 40000, date: '2026-10-01' })).toBeNull()
    expect(projectPaymentProblem(p, { id: 'n', amount: 0, date: '2026-10-05' })).toMatch(/valor/)
    expect(projectPaymentProblem(p, { id: 'n', amount: 100, date: '' })).toMatch(/data/)
  })

  it('projeto concluído e ainda não quitado continua recebendo; quitado não muda o status', () => {
    const done = project({ status: 'done', received: 20000 })
    expect(projectRemaining(done)).toBe(20000)
    expect(projectPaymentProblem(done, { id: 'n', amount: 20000, date: '2026-10-05' })).toBeNull()
    const paid = { ...done, payments: [pay('n', 20000)] }
    expect(projectOutstanding(paid)).toBe(0)
    expect(paid.status).toBe('done')
  })

  it('projeto sem valor definido não tem limite; valor não pode ficar abaixo do recebido', () => {
    expect(projectPaymentProblem(project({ charged: 0 }), { id: 'n', amount: 999999, date: '2026-10-05' })).toBeNull()
    expect(projectChargedProblem(project({ received: 20000, payments: [pay('a', 10000)] }), 25000, 'EUR')).toMatch(/menor que o já recebido/)
    expect(projectChargedProblem(project({ received: 20000 }), 20000, 'EUR')).toBeNull()
  })

  it('valor antigo ("Recebido" de antes) conta no recebido mas nunca vira entrada sozinho', () => {
    const old = project({ received: 20000 })
    expect(projectReceived(old)).toBe(20000)
    expect(projectReceipts(old)).toEqual([])
    expect(missingReceipts(allReceipts({ projects: [old], sales: [], clients: [] }), [])).toEqual([])
  })
})

describe('financeiro: entrada de cada recebimento', () => {
  it('pagamento gera uma entrada (id fixo, categoria Freelance) e o saldo sobe', () => {
    const before = project()
    const after = project({ payments: [pay('a', 20000, '2026-10-05')] })
    const ops = opsFor(before, after, [])
    expect(ops).toHaveLength(1)
    const tx = (ops[0] as { item: Transaction }).item
    expect(tx).toMatchObject({ id: 'rcv-project-a', type: 'in', amount: 20000, currency: 'EUR', baseAmount: 20000, reason: 'Perfect Clean · Pagamento de projeto', category: 'freelance', source: { kind: 'project', parentId: 'pc', paymentId: 'a' } })
    expect(balanceOf(settings, [])).toBe(100000)
    expect(balanceOf(settings, apply([], ops))).toBe(120000)
  })

  it('o valor combinado do projeto não mexe no saldo', () => {
    expect(opsFor(project({ charged: 0 }), project({ charged: 40000 }), [])).toEqual([])
  })

  it('a mesma operação de novo não cria outra entrada (reload, sync, segundo aparelho)', () => {
    const after = project({ payments: [pay('a', 20000)] })
    let txs = apply([], opsFor(project(), after, []))
    // Saving again, reapplying from another device, or from scratch: nothing new.
    expect(opsFor(after, after, txs)).toEqual([])
    expect(opsFor(null, after, txs)).toEqual([])
    txs = apply(txs, opsFor(project(), after, txs))
    expect(txs.filter((t) => t.id === 'rcv-project-a')).toHaveLength(1)
  })

  it('editar o pagamento atualiza a MESMA entrada (200 → 150), mantendo a cotação original', () => {
    const v1 = project({ currency: 'BRL', payments: [pay('a', 120000, '2026-10-01', 'BRL')] })
    let txs = apply([], opsFor(project({ currency: 'BRL' }), v1, []))
    expect(txs[0].baseAmount).toBe(20000)
    const v2 = { ...v1, payments: [pay('a', 90000, '2026-10-01', 'BRL')] }
    // Rates changed meanwhile: the edit keeps the rate of the original moment.
    txs = apply(txs, opsFor(v1, v2, txs, { ...ctx, convert: makeConverter({ EUR: 1, BRL: 9 }) }))
    expect(txs).toHaveLength(1)
    expect(txs[0]).toMatchObject({ id: 'rcv-project-a', amount: 90000, baseAmount: 15000 })
  })

  it('mudar a data leva a entrada para o novo dia; renomear o projeto atualiza o motivo', () => {
    const v1 = project({ payments: [pay('a', 10000, '2026-10-05')] })
    let txs = apply([], opsFor(project(), v1, []))
    expect(txs[0].createdAt).toBe(NOW.toISOString())
    const v2 = { ...v1, name: 'Perfect Clean BCN', payments: [pay('a', 10000, '2026-09-20')] }
    txs = apply(txs, opsFor(v1, v2, txs))
    expect(wallClock(new Date(txs[0].createdAt), TZ).date).toBe('2026-09-20')
    expect(txs[0].reason).toBe('Perfect Clean BCN · Pagamento de projeto')
  })

  it('excluir o pagamento remove a entrada e o saldo volta', () => {
    const v1 = project({ payments: [pay('a', 10000), pay('b', 5000)] })
    let txs = apply([], opsFor(project(), v1, []))
    const v2 = { ...v1, payments: [pay('a', 10000)] }
    const ops = opsFor(v1, v2, txs)
    expect(ops).toEqual([{ op: 'remove', collection: 'transactions', id: 'rcv-project-b' }])
    txs = apply(txs, ops)
    expect(balanceOf(settings, txs)).toBe(110000)
  })

  it('"Lançar no Financeiro agora": o valor antigo vira um pagamento na data informada', () => {
    const old = project({ received: 20000 })
    const launched = { ...old, received: 0, payments: [pay('legacy', 20000, '2026-09-15')] }
    const txs = apply([], opsFor(old, launched, []))
    expect(txs).toHaveLength(1)
    expect(wallClock(new Date(txs[0].createdAt), TZ).date).toBe('2026-09-15')
    expect(projectReceived(launched)).toBe(20000)
  })

  it('sem cotação: o pagamento fica e a entrada é criada depois, uma só vez', () => {
    const p = project({ currency: 'USD', payments: [pay('a', 11000, '2026-10-05', 'USD')] })
    expect(opsFor(project({ currency: 'USD' }), p, [], noRates)).toEqual([])
    const missing = missingReceipts(projectReceipts(p), [])
    expect(missing.map((r) => r.txId)).toEqual(['rcv-project-a'])
    expect(receiptTransaction(missing[0], noRates)).toBeNull()
    const tx = receiptTransaction(missing[0], ctx)!
    expect(tx).toMatchObject({ id: 'rcv-project-a', amount: 11000, currency: 'USD', baseAmount: 10000 })
    expect(missingReceipts(projectReceipts(p), [tx])).toEqual([])
  })

  it('entrada desvinculada (projeto excluído) nunca mais é tocada', () => {
    const v1 = project({ payments: [pay('a', 10000)] })
    let txs = apply([], opsFor(project(), v1, []))
    txs = apply(txs, unlinkOps(txs, belongsToProject('pc')))
    expect(txs[0].source).toBeUndefined()
    expect(txs[0].amount).toBe(10000)
    expect(opsFor(v1, { ...v1, payments: [] }, txs)).toEqual([])
    expect(opsFor(v1, { ...v1, payments: [pay('a', 5000)] }, txs)).toEqual([])
  })
})

describe('vendas: entrada de cada recebimento', () => {
  const nameOf = (s: Sale) => s.clientName
  it('pagamento específico gera entrada "Pagamento de venda — Maria"; pagamentos antigos não', () => {
    const s = sale('s1', { payments: [{ id: 'old', date: '2026-09-01', amount: 5000, note: '' }, { id: 'p1', date: '2026-10-05', amount: 10000, note: '', finance: true }] })
    const receipts = saleReceipts([s], nameOf)
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toMatchObject({ txId: 'rcv-sale-p1', amount: 10000, currency: 'EUR', reason: 'Pagamento de venda — Maria · Bolo', category: 'sales' })
    const txs = apply([], receiptOps([], receipts, [], ctx))
    expect(txs).toHaveLength(1)
  })

  it('pagamento geral vira UMA entrada com o valor inteiro, em qualquer ordem da lista', () => {
    const sales = [sale('s1', { total: 10000, date: '2026-09-01' }), sale('s2', { total: 20000, date: '2026-09-10' })]
    const r = applyGeneralPayment(sales, { generalId: 'g1', currency: 'EUR', amount: 25000, date: '2026-10-05', note: '' }, (() => {
      let i = 0
      return () => `piece${++i}`
    })())
    if ('error' in r) throw new Error(r.error)
    expect(r.changed.every((s) => s.payments.every((p) => p.finance))).toBe(true)
    const a = saleReceipts(r.changed, nameOf)
    const b = saleReceipts([...r.changed].reverse(), nameOf)
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ txId: 'rcv-general-g1', amount: 25000, reason: 'Pagamento de venda — Maria' })
    expect(b[0].source).toEqual(a[0].source)
    const txs = apply([], receiptOps([], a, [], ctx))
    expect(receiptOps(a, b, txs, ctx)).toEqual([])
  })

  it('pagamentos parciais da mesma venda: uma entrada por pagamento, sem duplicar', () => {
    const v1 = sale('s1', { payments: [{ id: 'p1', date: '2026-10-01', amount: 10000, note: '', finance: true }] })
    let txs = apply([], receiptOps([], saleReceipts([v1], nameOf), [], ctx))
    const v2 = { ...v1, payments: [...v1.payments, { id: 'p2', date: '2026-10-05', amount: 5000, note: '', finance: true as const }] }
    txs = apply(txs, receiptOps(saleReceipts([v1], nameOf), saleReceipts([v2], nameOf), txs, ctx))
    txs = apply(txs, receiptOps(saleReceipts([v2], nameOf), saleReceipts([v2], nameOf), txs, ctx))
    expect(txs.map((t) => t.id).sort()).toEqual(['rcv-sale-p1', 'rcv-sale-p2'])
    expect(balanceOf(settings, txs)).toBe(115000)
  })

  it('excluir a venda mantém as entradas, sem vínculo (inclui pagamento geral com parte nela)', () => {
    const s = sale('s1', { payments: [{ id: 'p1', date: '2026-10-01', amount: 10000, note: '', finance: true }, { id: 'x', date: '2026-10-02', amount: 2000, note: '', generalId: 'g1', finance: true }] })
    const txs = apply([], receiptOps([], saleReceipts([s], nameOf), [], ctx))
    const after = apply(txs, unlinkOps(txs, belongsToSale(s)))
    expect(after.map((t) => [t.id, t.source])).toEqual([
      ['rcv-sale-p1', undefined],
      ['rcv-general-g1', undefined],
    ])
    expect(balanceOf(settings, after)).toBe(112000)
  })
})

describe('moedas', () => {
  it('EUR, BRL e USD: cada entrada guarda a própria moeda; o saldo usa o valor convertido', () => {
    const eur = project({ id: 'e', currency: 'EUR', payments: [pay('e1', 10000, '2026-10-05', 'EUR')] })
    const brl = project({ id: 'b', currency: 'BRL', payments: [pay('b1', 60000, '2026-10-05', 'BRL')] })
    const usd = project({ id: 'u', currency: 'USD', payments: [pay('u1', 22000, '2026-10-05', 'USD')] })
    const txs = apply([], [eur, brl, usd].flatMap((p) => opsFor(null, p, [])))
    expect(txs.map((t) => [t.currency, t.amount, t.baseAmount])).toEqual([
      ['EUR', 10000, 10000],
      ['BRL', 60000, 10000],
      ['USD', 22000, 20000],
    ])
    // Never adds 10000 + 60000 + 22000 of different currencies: the balance sums the converted values.
    expect(balanceOf(settings, txs)).toBe(100000 + 40000)
  })

  it('moeda principal BRL: entrada em BRL não converte nada', () => {
    const c = { ...ctx, settings: { ...settings, baseCurrency: 'BRL' } }
    const tx = receiptTransaction(projectReceipts(project({ currency: 'BRL', payments: [pay('a', 12345, '2026-10-05', 'BRL')] }))[0], c)!
    expect([tx.amount, tx.baseAmount]).toEqual([12345, 12345])
  })

  it('receiptTxId é estável e cabe no limite do servidor', () => {
    const id = receiptTxId('general', '123e4567-e89b-12d3-a456-426614174000')
    expect(id).toBe('rcv-general-123e4567-e89b-12d3-a456-426614174000')
    expect(id.length).toBeLessThanOrEqual(100)
  })
})
