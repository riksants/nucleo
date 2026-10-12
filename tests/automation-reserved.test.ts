import { describe, expect, it } from 'vitest'
import { reserveSummary } from '../src/core/reserved'
import { isPaidTool } from '../src/data/selectors'
import type { FinanceGoal, Tool } from '../src/data/types'
import { makeConverter } from '../src/lib/rates'

const convert = makeConverter({ EUR: 1, BRL: 6, AED: 4 })
const goal = (id: string, over: Partial<FinanceGoal> = {}): FinanceGoal => ({
  id, createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z',
  name: id, target: 100000, saved: 20000, deadline: '2027-06-01', currency: 'EUR', note: '', status: 'active', history: [], ...over,
})

describe('Saldo / Reservado / Disponível', () => {
  it('só metas ativas marcadas como "no meu saldo" contam como reservado', () => {
    const r = reserveSummary([goal('a', { inBalance: true }), goal('b'), goal('c', { inBalance: true, status: 'archived' })], 100000, 'EUR', convert)
    expect(r).toEqual({ balance: 100000, reserved: 20000, available: 80000, currency: 'EUR', missing: [], hasReserve: true })
  })

  it('metas antigas (sem inBalance) não mudam o Disponível', () => {
    const r = reserveSummary([goal('a'), goal('b')], 100000, 'EUR', convert)
    expect(r.reserved).toBe(0)
    expect(r.available).toBe(100000)
    expect(r.hasReserve).toBe(false)
  })

  it('meta em outra moeda é convertida só para o cálculo; o valor guardado não muda', () => {
    const g = goal('brl', { inBalance: true, currency: 'BRL', saved: 60000 })
    const r = reserveSummary([g], 100000, 'EUR', convert)
    expect(r.reserved).toBe(10000)
    expect(r.available).toBe(90000)
    expect(g.saved).toBe(60000)
  })

  it('sem cotação: a reserva fica fora do Disponível e é avisada, sem inventar conversão', () => {
    const r = reserveSummary([goal('usd', { inBalance: true, currency: 'USD' }), goal('eur', { inBalance: true })], 100000, 'EUR', convert)
    expect(r.reserved).toBe(20000)
    expect(r.missing).toEqual(['USD'])
    expect(r.available).toBe(80000)
  })

  it('reservar nunca muda o saldo', () => {
    expect(reserveSummary([goal('a', { inBalance: true, saved: 150000 })], 100000, 'EUR', convert).balance).toBe(100000)
  })
})

describe('Ferramenta em Teste não é despesa paga', () => {
  const tool = (status: Tool['status']): Tool => ({
    id: 't', createdAt: '', updatedAt: '', name: 'X', link: '', plan: '', price: 2000, currency: 'EUR', billing: 'monthly', nextCharge: '2026-10-20', notes: '', status,
  })
  it('só ativa conta como paga', () => {
    expect(isPaidTool(tool('active'))).toBe(true)
    expect(isPaidTool(tool('trial'))).toBe(false)
    expect(isPaidTool(tool('cancelled'))).toBe(false)
  })
})
