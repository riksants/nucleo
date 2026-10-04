import { describe, expect, it } from 'vitest'
import {
  applyGeneralPayment,
  buyerPayments,
  buyers,
  buyerStatus,
  clientKey,
  OVERPAY,
  owedIn,
  paymentProblem,
  personName,
  salePaid,
  saleRemaining,
  salesOverview,
  similarPeople,
  totalsByCurrency,
  withoutGeneralPayment,
  withPayment,
} from '../src/data/sales'
import { matches } from '../src/data/selectors'
import type { Payment, Sale } from '../src/data/types'

let seq = 0
const id = () => `p${++seq}`
const sale = (over: Partial<Sale> = {}): Sale => ({
  id: `s${++seq}`,
  createdAt: `2026-10-01T10:00:${String(seq % 60).padStart(2, '0')}.000Z`,
  updatedAt: '2026-10-01T10:00:00.000Z',
  clientId: null,
  clientName: 'Maria',
  product: 'Produto',
  quantity: 1,
  date: '2026-10-01',
  total: 10000,
  currency: 'BRL',
  dueDate: '',
  payments: [],
  notes: '',
  ...over,
})
const pay = (amount: number, date = '2026-10-02', over: Partial<Payment> = {}): Payment => ({ id: id(), date, amount, note: '', ...over })
const name = (s: Sale) => s.clientName
/** Applies a general payment and returns the person's sales afterwards. */
function general(list: Sale[], amount: number, currency = 'BRL', date = '2026-10-05', note = '') {
  const r = applyGeneralPayment(list, { generalId: 'g' + ++seq, currency, amount, date, note }, id)
  if ('error' in r) throw new Error(r.error)
  return list.map((s) => r.changed.find((c) => c.id === s.id) ?? s)
}

describe('Vendas por pessoa', () => {
  it('várias compras da mesma pessoa somam no total dela (exemplo da Maria)', () => {
    const list = [
      sale({ product: 'Produto A', total: 10000, payments: [pay(10000)] }),
      sale({ product: 'Produto B', total: 25000, payments: [pay(5000)] }),
      sale({ product: 'Produto C', total: 5000 }),
    ]
    const [maria] = buyers(list, name)
    expect(maria.sales).toHaveLength(3)
    expect(maria.totals).toEqual([{ currency: 'BRL', total: 40000, paid: 15000, remaining: 25000 }])
    expect(maria.status).toBe('partial')
  })

  it('status: pago, parcial e pendente', () => {
    expect(buyerStatus(totalsByCurrency([sale({ payments: [pay(10000)] })]))).toBe('paid')
    expect(buyerStatus(totalsByCurrency([sale({ payments: [pay(100)] })]))).toBe('partial')
    expect(buyerStatus(totalsByCurrency([sale()]))).toBe('pending')
  })

  it('mesma pessoa digitada de jeitos diferentes não vira duas pessoas', () => {
    const list = [sale({ clientName: 'Maria José' }), sale({ clientName: '  maria   jose ' }), sale({ clientName: 'MARIA JOSÉ' })]
    expect(buyers(list, name)).toHaveLength(1)
    expect(personName(' Maria  José ')).toBe('maria jose')
    expect(clientKey({ clientId: null, clientName: 'Maria José' })).toBe(clientKey({ clientId: null, clientName: 'maria jose' }))
  })

  it('cliente cadastrado é agrupado pelo id, nunca juntado sozinho com um nome digitado', () => {
    const list = [sale({ clientId: 'c1', clientName: '' }), sale({ clientId: 'c1', clientName: '' }), sale({ clientName: 'Maria' })]
    const people = buyers(list, (s) => (s.clientId ? 'Maria' : s.clientName))
    expect(people).toHaveLength(2)
    expect(people.find((b) => b.clientId === 'c1')?.sales).toHaveLength(2)
  })

  it('sugere pessoas existentes ao digitar (para não duplicar)', () => {
    const people = [{ name: 'Maria José' }, { name: 'Mário' }, { name: 'Ana' }]
    expect(similarPeople(people, 'mari').map((p) => p.name)).toEqual(['Maria José', 'Mário'])
    expect(similarPeople(people, 'a')).toEqual([])
  })
})

describe('pagamento geral', () => {
  it('Maria deve 500, paga 200 geral: falta 300', () => {
    const list = [sale({ total: 20000, date: '2026-09-01' }), sale({ total: 30000, date: '2026-09-10' })]
    const after = general(list, 20000)
    const [maria] = buyers(after, name)
    expect(maria.totals[0]).toMatchObject({ total: 50000, paid: 20000, remaining: 30000 })
  })

  it('é aplicado nas compras em aberto mais antigas primeiro e fica marcado como geral', () => {
    const old = sale({ product: 'Antiga', total: 10000, date: '2026-09-01' })
    const newer = sale({ product: 'Nova', total: 30000, date: '2026-09-20' })
    const after = general([newer, old], 15000)
    const a = after.find((s) => s.id === old.id)!
    const b = after.find((s) => s.id === newer.id)!
    expect(salePaid(a)).toBe(10000)
    expect(salePaid(b)).toBe(5000)
    expect([...a.payments, ...b.payments].every((p) => p.generalId)).toBe(true)
    // In the history it is ONE general payment, not two specific ones.
    const history = buyerPayments(after)
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ kind: 'general', amount: 15000 })
    expect(history[0].parts.map((p) => p.product)).toEqual(['Antiga', 'Nova'])
  })

  it('pula compras já quitadas', () => {
    const paid = sale({ total: 10000, date: '2026-09-01', payments: [pay(10000)] })
    const open = sale({ total: 10000, date: '2026-09-05' })
    const r = applyGeneralPayment([paid, open], { generalId: 'g', currency: 'BRL', amount: 4000, date: '2026-10-01', note: '' }, id)
    expect('changed' in r && r.changed.map((s) => s.id)).toEqual([open.id])
  })

  it('guarda valor, data, observação e tipo', () => {
    const after = general([sale({ total: 50000 })], 20000, 'BRL', '2026-10-03', 'Pix')
    const [entry] = buyerPayments(after)
    expect(entry).toMatchObject({ kind: 'general', amount: 20000, date: '2026-10-03', note: 'Pix', currency: 'BRL' })
  })

  it('não permite pagar mais do que falta, nem valor vazio ou data inválida', () => {
    const list = [sale({ total: 10000, payments: [pay(4000)] })]
    expect(applyGeneralPayment(list, { generalId: 'g', currency: 'BRL', amount: 6001, date: '2026-10-01', note: '' }, id)).toEqual({ error: OVERPAY })
    expect(applyGeneralPayment(list, { generalId: 'g', currency: 'BRL', amount: 0, date: '2026-10-01', note: '' }, id)).toEqual({ error: 'Digite o valor recebido' })
    expect(applyGeneralPayment(list, { generalId: 'g', currency: 'BRL', amount: null, date: '2026-10-01', note: '' }, id)).toEqual({ error: 'Digite o valor recebido' })
    expect(applyGeneralPayment(list, { generalId: 'g', currency: 'BRL', amount: 100, date: '', note: '' }, id)).toEqual({ error: 'Informe a data do pagamento' })
    // Exactly what is missing settles everything.
    const after = general(list, 6000)
    expect(buyers(after, name)[0].status).toBe('paid')
  })

  it('remover o pagamento geral tira todas as partes (e nada mais)', () => {
    const list = [sale({ total: 10000, date: '2026-09-01', payments: [pay(1000)] }), sale({ total: 10000, date: '2026-09-02' })]
    const after = general(list, 15000)
    const gid = after[0].payments.find((p) => p.generalId)!.generalId!
    const changed = withoutGeneralPayment(after, gid)
    const restored = after.map((s) => changed.find((c) => c.id === s.id) ?? s)
    expect(restored.map(salePaid)).toEqual([1000, 0])
  })
})

describe('pagamento específico e parcial', () => {
  it('tênis 300, pago 50, +100 → pago 150, falta 150; total da pessoa diminui junto', () => {
    const tenis = sale({ product: 'Tênis', total: 30000, payments: [pay(5000)] })
    const camisa = sale({ product: 'Camisa', total: 10000 })
    const after = withPayment(tenis, pay(10000))
    expect(salePaid(after)).toBe(15000)
    expect(saleRemaining(after)).toBe(15000)
    expect(buyers([after, camisa], name)[0].totals[0].remaining).toBe(25000)
    expect(buyerPayments([after])[0].kind).toBe('specific')
  })

  it('pagamentos parciais ficam todos no histórico (nada é substituído por um acumulado)', () => {
    let s = sale({ total: 50000 })
    s = withPayment(s, pay(10000, '2026-10-02'))
    s = withPayment(s, pay(15000, '2026-10-04'))
    expect(s.payments).toHaveLength(2)
    expect(salePaid(s)).toBe(25000)
    expect(saleRemaining(s)).toBe(25000)
    expect(buyerPayments([s]).map((e) => e.amount)).toEqual([15000, 10000])
  })

  it('pagamento específico maior que o que falta é impedido', () => {
    const s = sale({ total: 30000, payments: [pay(5000)] })
    expect(paymentProblem(s, pay(25001))).toBe(OVERPAY)
    expect(paymentProblem(s, pay(25000))).toBeNull()
  })

  it('nunca conta pagamento duas vezes: geral + específico somam uma vez só', () => {
    let a = sale({ product: 'A', total: 20000, date: '2026-09-01' })
    const b = sale({ product: 'B', total: 30000, date: '2026-09-02' })
    a = withPayment(a, pay(5000)) // specific
    const after = general([a, b], 10000) // general: 10000 more on A, oldest first
    const [p] = buyers(after, name)
    expect(p.totals[0].paid).toBe(15000)
    expect(p.totals[0].remaining).toBe(35000)
    const history = buyerPayments(after)
    expect(history.reduce((sum, e) => sum + e.amount, 0)).toBe(15000)
    // Replaying the same payment (same id) does not count again.
    const replay = withPayment(after[0], after[0].payments[0])
    expect(salePaid(replay)).toBe(salePaid(after[0]))
  })

  it('o saldo pendente nunca fica negativo', () => {
    const weird = sale({ total: 10000, payments: [pay(12000)] })
    expect(saleRemaining(weird)).toBe(0)
    expect(totalsByCurrency([weird])[0]).toMatchObject({ paid: 10000, remaining: 0 })
  })
})

describe('nova compra depois de dívida', () => {
  it('devia 200, nova compra de 300 → falta 500, histórico mantido', () => {
    const old = sale({ total: 40000, payments: [pay(20000)] })
    const fresh = sale({ total: 30000, date: '2026-10-10' })
    const [p] = buyers([old, fresh], name)
    expect(p.totals[0].remaining).toBe(50000)
    expect(p.sales.map((s) => s.id)).toEqual([old.id, fresh.id])
    expect(buyerPayments(p.sales)).toHaveLength(1)
  })
})

describe('moedas', () => {
  it('não soma moedas diferentes', () => {
    const list = [sale({ total: 10000, currency: 'BRL' }), sale({ total: 5000, currency: 'EUR', payments: [pay(1000)] })]
    const [p] = buyers(list, name)
    expect(p.totals).toEqual([
      { currency: 'BRL', total: 10000, paid: 0, remaining: 10000 },
      { currency: 'EUR', total: 5000, paid: 1000, remaining: 4000 },
    ])
    expect(owedIn(list, 'EUR')).toBe(4000)
  })

  it('pagamento geral só usa compras da moeda escolhida', () => {
    const brl = sale({ total: 10000, currency: 'BRL', date: '2026-09-01' })
    const eur = sale({ total: 10000, currency: 'EUR', date: '2026-09-02' })
    const r = applyGeneralPayment([brl, eur], { generalId: 'g', currency: 'EUR', amount: 10000, date: '2026-10-01', note: '' }, id)
    expect('changed' in r && r.changed.map((s) => s.id)).toEqual([eur.id])
    expect(applyGeneralPayment([brl, eur], { generalId: 'g', currency: 'EUR', amount: 10001, date: '2026-10-01', note: '' }, id)).toEqual({ error: OVERPAY })
  })
})

describe('resumo geral, filtros e busca', () => {
  const list = [
    sale({ clientName: 'Ana', total: 10000, payments: [pay(10000)] }),
    sale({ clientName: 'Bruno', total: 20000, payments: [pay(5000)] }),
    sale({ clientName: 'Carla', total: 30000 }),
    sale({ clientName: 'Carla', total: 1000, currency: 'EUR' }),
  ]
  it('total vendido, recebido, a receber (por moeda) e pessoas com valor pendente', () => {
    const o = salesOverview(list, name)
    expect(o.totals.find((t) => t.currency === 'BRL')).toEqual({ currency: 'BRL', total: 60000, paid: 15000, remaining: 45000 })
    expect(o.totals.find((t) => t.currency === 'EUR')).toEqual({ currency: 'EUR', total: 1000, paid: 0, remaining: 1000 })
    expect(o.owing).toBe(2)
  })
  it('filtros por status e busca por nome', () => {
    const people = buyers(list, name)
    const by = (st: string) => people.filter((b) => b.status === st).map((b) => b.name)
    expect(by('paid')).toEqual(['Ana'])
    expect(by('partial')).toEqual(['Bruno'])
    expect(by('pending')).toEqual(['Carla'])
    expect(people.filter((b) => matches('car', b.name)).map((b) => b.name)).toEqual(['Carla'])
    expect(people.filter((b) => matches('BRÚNO', b.name)).map((b) => b.name)).toEqual(['Bruno'])
  })
})

describe('nome exibido da pessoa', () => {
  it('usa a grafia mais comum, sem espaços sobrando', () => {
    const list = [sale({ clientName: 'Maria', date: '2026-09-01' }), sale({ clientName: 'Maria', date: '2026-09-02' }), sale({ clientName: ' maria ', date: '2026-09-03' })]
    expect(buyers(list, name)[0].name).toBe('Maria')
    expect(buyers([sale({ clientName: 'Ana' }), sale({ clientName: 'ANA', date: '2026-10-09' })], name)[0].name).toBe('ANA')
  })
})
