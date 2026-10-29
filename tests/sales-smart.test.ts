import { describe, expect, it } from 'vitest'
import { buildInstallments, chargeMessage, installmentViews, isLate, itemsSummary, knownProducts, matchesSearch, nextDue, nextRepeat, readSaleText, readSearch, settles, whatsappLink } from '../src/core/salesSmart'
import type { Sale } from '../src/data/types'

const T = '2026-10-29' // quinta-feira
let n = 0
const id = () => `i${++n}`
const sale = (over: Partial<Sale>): Sale => ({ id: id(), createdAt: '', updatedAt: '', clientId: null, clientName: 'João', product: 'Tênis', quantity: 1, date: '2026-10-20', total: 30000, currency: 'BRL', dueDate: '', payments: [], notes: '', ...over })

describe('ler uma frase de venda', () => {
  it('o exemplo completo: cliente, produto, total, entrada, restante e sexta', () => {
    const r = readSaleText('Vendi um tênis pra João por 300, ele deu 100 e paga o resto sexta.', T)
    expect(r.kind).toBe('create')
    if (r.kind !== 'create') return
    expect(r.draft).toMatchObject({ clientName: 'João', product: 'tênis', quantity: 1, total: 30000, paid: 10000, dueDate: '2026-10-30' })
    expect(r.missing).toEqual([])
  })
  it('quantidade, preço por unidade, moeda e pagamento total', () => {
    const r = readSaleText('Vendi 3 bolos para Maria por 25 reais cada, pagou à vista', T)
    if (r.kind !== 'create') throw new Error(r.kind)
    expect(r.draft).toMatchObject({ clientName: 'Maria', product: 'bolos', quantity: 3, total: 7500, paid: 7500, currency: 'BRL', dueDate: '' })
  })
  it('usa os nomes conhecidos (sobrenome) e "X comprou"', () => {
    const r = readSaleText('Ana Paula comprou uma bolsa por 1.200 em 3x', T, ['Ana Paula Souza', 'Ana Paula'])
    if (r.kind !== 'create') throw new Error(r.kind)
    expect(r.draft).toMatchObject({ clientName: 'Ana Paula', product: 'bolsa', total: 120000, installments: 3 })
  })
  it('não inventa: o que não foi dito fica faltando', () => {
    const r = readSaleText('Vendi um tênis', T)
    if (r.kind !== 'create') throw new Error(r.kind)
    expect(r.missing).toEqual(['client', 'total'])
    expect(r.draft.paid).toBeNull()
  })
  it('busca e ambiguidade', () => {
    expect(readSaleText('João', T).kind).toBe('search')
    expect(readSaleText('vendas de sexta', T).kind).toBe('search')
    expect(readSaleText('vendas atrasadas', T).kind).toBe('search')
    expect(readSaleText('João 300', T, ['João']).kind).toBe('ambiguous')
  })
})

describe('buscar vendas', () => {
  const joao = sale({ clientName: 'João', product: 'Tênis', date: '2026-10-23', dueDate: '2026-10-27', total: 30000 }) // sexta, atrasada
  const maria = sale({ clientName: 'Maria', product: 'Bolo', date: '2026-10-28', total: 5000, payments: [{ id: 'p', date: '2026-10-28', amount: 5000, note: '' }] })
  const all = [joao, maria]
  const find = (q: string) => all.filter((s) => matchesSearch(s, s.clientName, readSearch(q, T), T)).map((s) => s.clientName)
  it('por nome, produto, valor, status e data relativa', () => {
    expect(find('João')).toEqual(['João'])
    expect(find('tenis')).toEqual(['João'])
    expect(find('300')).toEqual(['João'])
    expect(find('vendas atrasadas')).toEqual(['João'])
    expect(find('quitadas')).toEqual(['Maria'])
    expect(find('vendas de sexta')).toEqual(['João'])
    expect(readSearch('vendas de sexta', T).dateLabel).toBe('sexta, 23/10')
    expect(find('')).toEqual(['João', 'Maria'])
  })
})

describe('parcelas', () => {
  it('somam exatamente o total devido', () => {
    const list = buildInstallments(100000, 3, '2026-11-05', 'month', id)
    expect(list.map((i) => i.amount)).toEqual([33334, 33333, 33333])
    expect(list.reduce((s, i) => s + i.amount, 0)).toBe(100000)
    expect(list.map((i) => i.due)).toEqual(['2026-11-05', '2026-12-05', '2027-01-05'])
    expect(buildInstallments(1000, 2, '2026-11-01', 'week', id).map((i) => i.due)).toEqual(['2026-11-01', '2026-11-08'])
  })
  it('estado de cada parcela vem dos pagamentos (entrada fora das parcelas)', () => {
    // total 400, entrada 100, 3 × 100
    const s = sale({ total: 40000, installments: buildInstallments(30000, 3, '2026-10-20', 'month', id), payments: [{ id: 'e', date: '2026-10-01', amount: 10000, note: '' }, { id: 'p1', date: '2026-10-20', amount: 15000, note: '' }] })
    expect(installmentViews(s, T).map((v) => [v.paid, v.state])).toEqual([
      [10000, 'paid'],
      [5000, 'partial'],
      [0, 'pending'],
    ])
    expect(settles(s, 8000, T)).toEqual([
      { index: 1, due: '2026-11-20', covers: 5000, full: true },
      { index: 2, due: '2026-12-20', covers: 3000, full: false },
    ])
    expect(nextDue(s, T)).toBe('2026-11-20')
  })
  it('atrasada pela parcela vencida', () => {
    const s = sale({ total: 20000, installments: buildInstallments(20000, 2, '2026-10-10', 'month', id) })
    expect(isLate(s, T)).toBe(true)
    expect(installmentViews(s, T)[0].state).toBe('overdue')
  })
})

describe('produtos lembrados, itens, cobrança e repetição', () => {
  it('lembra o último preço por unidade', () => {
    const list = knownProducts([sale({ product: 'Bolo', quantity: 2, total: 6000, date: '2026-10-01' }), sale({ product: 'bolo', quantity: 1, total: 3500, date: '2026-10-10' })])
    expect(list[0]).toMatchObject({ name: 'bolo', price: 3500, times: 2 })
  })
  it('itens viram resumo e total com desconto', () => {
    expect(itemsSummary([{ id: 'a', name: 'Tênis', quantity: 1, price: 30000 }, { id: 'b', name: 'Meia', quantity: 2, price: 1500 }], 1000)).toEqual({ product: 'Tênis + 2× Meia', quantity: 1, total: 32000 })
  })
  it('mensagem com o valor pendente e o vencimento; link do WhatsApp só com número', () => {
    const msg = chargeMessage({ name: 'João Silva', product: 'tênis', saleDate: '2026-10-20', pending: 'R$ 200,00', due: '2026-10-27', late: true })
    expect(msg).toContain('Oi, João!')
    expect(msg).toContain('R$ 200,00 em aberto, que venceu em 27/10')
    expect(whatsappLink('+55 (11) 98888-7777', 'oi')).toBe('https://wa.me/5511988887777?text=oi')
    expect(whatsappLink('123', 'oi')).toBeNull()
  })
  it('próxima repetição mantém o dia do mês', () => {
    expect(nextRepeat('2026-01-31', 'month')).toBe('2026-02-28')
    expect(nextRepeat('2026-02-28', 'month', 31)).toBe('2026-03-31')
    expect(nextRepeat('2026-10-29', 'week')).toBe('2026-11-05')
  })
})

describe('ambiguidade', () => {
  it('"João 300" pergunta (com João e 300 prontos para a venda); buscas continuam buscas', () => {
    const r = readSaleText('João 300', T)
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.draft).toMatchObject({ clientName: 'João', total: 30000 })
    expect(readSaleText('300', T).kind).toBe('search')
    expect(readSaleText('vendas de 300', T).kind).toBe('search')
    expect(readSaleText('atrasadas 2', T).kind).toBe('search')
  })
})
