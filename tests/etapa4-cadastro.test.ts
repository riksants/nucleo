/**
 * Etapa 4.5 — Cadastro inteligente: uma frase vira prévia, com o que foi dito e as perguntas do que falta.
 * Nunca assume dinheiro: moeda, valor, data e "é o pagamento de algo já registrado?" são perguntados.
 */
import { describe, expect, it } from 'vitest'
import { parseCapture } from '../src/core/capture'
import { missingOf, paymentLinks, sameMovement, understand, type MoneyDraft, type SmartCtx } from '../src/core/smart/understand'
import type { AutomationRun, Sale } from '../src/data/types'
import { makeConverter } from '../src/lib/rates'
import { data, settings, T } from './rules-helpers'

const TODAY = '2026-10-29'
const multi: SmartCtx = { today: TODAY, data: data(), settings: { ...settings, currencies: ['EUR', 'BRL'] }, convert: makeConverter({ EUR: 1, BRL: 6 }) }
const single: SmartCtx = { ...multi, settings: { ...settings, currencies: ['EUR'] } }
const sale = (over: Partial<Sale> = {}): Sale => ({ id: 's1', createdAt: T, updatedAt: T, clientId: null, clientName: 'João', product: 'Site', quantity: 1, date: '2026-10-01', total: 100000, currency: 'EUR', dueDate: '', payments: [], notes: '', ...over })

describe('os exemplos do pedido', () => {
  it('“Gastei 45 reais no mercado hoje” → saída completa', () => {
    const d = understand('Gastei 45 reais no mercado hoje', multi)
    expect(d).toMatchObject({ kind: 'money', type: 'out', amount: 4500, currency: 'BRL', date: TODAY, reason: 'Mercado' })
    expect(missingOf(d!)).toEqual([])
  })

  it('“Recebi 300 euros do João pelo site” → entrada; pergunta a data e se é o pagamento da venda do João', () => {
    const ctx = { ...multi, data: data({ sales: [sale()] }) }
    const d = understand('Recebi 300 euros do João pelo site', ctx) as MoneyDraft
    expect(d).toMatchObject({ kind: 'money', type: 'in', amount: 30000, currency: 'EUR', person: 'João', reason: 'João · Site', date: null })
    const links = paymentLinks(d, ctx.data, 'Recebi 300 euros do João pelo site')
    expect(links.map((l) => l.saleId)).toEqual(['s1'])
    expect(missingOf(d, links)).toEqual(['date', 'link'])
    expect(missingOf({ ...d, date: TODAY, link: 'none' }, links)).toEqual([])
  })

  it('“Tenho reunião amanhã às 14h” → compromisso (fluxo existente)', () => {
    expect(understand('Tenho reunião amanhã às 14h', multi)).toMatchObject({ kind: 'capture', capture: { kind: 'event', date: '2026-10-30', time: '14:00' } })
  })

  it('“Quero guardar 500 reais por mês para comprar um carro” → meta com 500/mês; pergunta valor total e prazo', () => {
    const d = understand('Quero guardar 500 reais por mês para comprar um carro', multi)
    expect(d).toMatchObject({ kind: 'goal', name: 'Carro', monthly: 50000, currency: 'BRL', autoSave: true, target: null, deadline: null })
    expect(missingOf(d!)).toEqual(['target', 'deadline'])
  })

  it('“Vendi um celular por 1.200 reais, recebi 500 e o restante fica para sexta” → venda (formulário de Vendas)', () => {
    expect(understand('Vendi um celular por 1.200 reais, recebi 500 e o restante fica para sexta', multi)).toMatchObject({ kind: 'sale', sale: { product: 'celular', total: 120000, paid: 50000, currency: 'BRL', dueDate: '2026-10-30' } })
  })

  it('“Treino segunda, quarta e sexta às 8h” → recorrente nesses três dias', () => {
    expect(parseCapture('Treino segunda, quarta e sexta às 8h', TODAY)).toMatchObject({ kind: 'recurring', title: 'Treino', rule: { type: 'weekdays', days: [1, 3, 5] }, time: '08:00' })
  })

  it('“Assinei uma ferramenta de 12 euros por mês” → assinatura; pergunta o nome e a próxima cobrança', () => {
    const d = understand('Assinei uma ferramenta de 12 euros por mês', multi)
    expect(d).toMatchObject({ kind: 'subscription', name: '', price: 1200, currency: 'EUR', billing: 'monthly' })
    expect(missingOf(d!)).toEqual(['name', 'nextCharge'])
  })
})

describe('nunca assume dinheiro', () => {
  it('sem moeda escrita e com várias moedas: pergunta', () => {
    const d = understand('gastei 45 no mercado', multi)!
    expect(missingOf(d)).toEqual(['currency', 'date'])
  })
  it('com uma moeda só, ela é usada', () => {
    expect(understand('gastei 45 no mercado ontem', single)).toMatchObject({ currency: 'EUR', date: '2026-10-28' })
  })
  it('sem valor: pergunta o valor', () => {
    expect(missingOf(understand('Paguei a internet hoje', single)!)).toEqual(['amount'])
  })
  it('“ontem” e “anteontem”', () => {
    expect(understand('Paguei 80 de luz anteontem', single)).toMatchObject({ date: '2026-10-27', reason: 'Luz' })
  })
  it('venda sem moeda (várias moedas): pergunta antes do formulário', () => {
    expect(missingOf(understand('Vendi um bolo para a Ana por 30', multi)!)).toEqual(['currency'])
  })
})

describe('identificação do pagamento (sem contar duas vezes)', () => {
  it('venda de outra moeda ou já paga não aparece', () => {
    const ctx = { ...multi, data: data({ sales: [sale({ currency: 'BRL' }), sale({ id: 's2', payments: [{ id: 'p', date: TODAY, amount: 100000, note: '' }] })] }) }
    const d = understand('Recebi 300 euros do João', ctx) as MoneyDraft
    expect(paymentLinks(d, ctx.data, '')).toEqual([])
  })
  it('saída com uma cobrança “a pagar” do mesmo nome: oferece confirmar a cobrança', () => {
    const run: AutomationRun = { id: 'auto-tool-t1-2026-10-28', createdAt: T, updatedAt: T, automation: 'toolCharge', date: '2026-10-28', summary: '', origin: { collection: 'tools', id: 't1', label: 'Figma' }, amount: 1200, currency: 'EUR', created: [], changed: [], status: 'pending' }
    const ctx = { ...single, data: data({ automationRuns: [run] }) }
    const text = 'Paguei o Figma 12 euros hoje'
    const d = understand(text, ctx) as MoneyDraft
    expect(paymentLinks(d, ctx.data, text).map((l) => l.run?.id)).toEqual([run.id])
  })
  it('a mesma movimentação no mesmo dia é reconhecida (pede confirmação antes de repetir)', () => {
    const d: MoneyDraft = { kind: 'money', type: 'out', amount: 4500, currency: 'EUR', date: TODAY, reason: 'Mercado', category: null, person: '' }
    const existing = { id: 'x', createdAt: `${TODAY}T10:00:00.000Z`, updatedAt: T, type: 'out' as const, amount: 4500, currency: 'EUR', baseAmount: -4500, reason: 'mercado' }
    expect(sameMovement(d, { transactions: [existing] }, (iso) => iso.slice(0, 10))).toBe(true)
  })
})

describe('outros cadastros', () => {
  it('cliente novo', () => {
    expect(understand('Novo cliente Ana Souza', multi)).toEqual({ kind: 'client', name: 'Ana Souza' })
  })
  it('meta com valor total e prazo', () => {
    const d = understand('Quero juntar 30 mil reais até dezembro para a viagem', multi)
    expect(d).toMatchObject({ kind: 'goal', name: 'Viagem', target: 3000000, deadline: '2026-12-31', currency: 'BRL', monthly: null })
    expect(missingOf(d!)).toEqual([])
  })
  it('assinatura com nome', () => {
    expect(understand('Assinei o Figma por 12 euros por mês', multi)).toMatchObject({ name: 'Figma', price: 1200 })
  })
  it('frase de tarefa segue para o cadastro de tarefas', () => {
    expect(understand('Ligar para o banco amanhã', multi)).toMatchObject({ kind: 'capture', capture: { kind: 'task' } })
  })
})
