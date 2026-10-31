/**
 * Etapa 4.2 — Feito pelo Núcleo: resultado de cada execução, frases da semana (só contagens reais),
 * pendências reunidas (com Adiar e Dispensar) e números por automação.
 */
import { describe, expect, it } from 'vitest'
import { automationStats, matchesFilter, pendingItems, runOutcome, weekDigest } from '../src/core/automation/activity'
import type { AutomationRun, DataState, Rule, Sale } from '../src/data/types'
import { emptyData, T } from './automation-helpers'

const TODAY = '2026-10-29' // quinta; semana começa na segunda 26/10
const run = (over: Partial<AutomationRun>): AutomationRun => ({
  id: 'r', createdAt: T, updatedAt: `${TODAY}T09:00:00.000Z`, automation: 'toolCharge', date: TODAY, summary: 'x', origin: { collection: 'tools', id: 't', label: 'Figma' }, created: [], changed: [], status: 'done', ...over,
})
const data = (over: Partial<DataState>): DataState => ({ ...emptyData(), ...over })

describe('resultado de cada execução', () => {
  it('distingue concluída, corrigida, desfeita, não concluída e pulada', () => {
    expect(runOutcome(run({}))).toBe('done')
    expect(runOutcome(run({ status: 'undone' }))).toBe('undone')
    expect(runOutcome(run({ status: 'skipped', detail: 'Marcado como não pago' }))).toBe('skipped')
    expect(runOutcome(run({ status: 'pending' }))).toBe('pending')
    expect(runOutcome(run({ automation: 'goalSave', status: 'skipped', amount: 0, summary: 'Nada reservado: saldo disponível insuficiente' }))).toBe('notDone')
    expect(runOutcome(run({ automation: 'goalSave', status: 'skipped', amount: 0, detail: 'Mês pulado.' }))).toBe('skipped')
    expect(runOutcome(run({ automation: 'goalSave', detail: 'Valor deste mês alterado por você.' }))).toBe('corrected')
    expect(runOutcome(run({ automation: 'rule', status: 'skipped', summary: 'Regra “X” não rodou' }))).toBe('notDone')
    expect(runOutcome(run({ automation: 'rule', actions: [{ text: 'a', ok: true, undone: true }, { text: 'b', ok: true }] }))).toBe('corrected')
    expect(runOutcome(run({ automation: 'rule', status: 'pending' }))).toBe('awaiting')
  })

  it('filtros da atividade', () => {
    expect(matchesFilter(run({}), 'payments')).toBe(true)
    expect(matchesFilter(run({ automation: 'rule' }), 'payments')).toBe(false)
    expect(matchesFilter(run({ automation: 'bankImport' }), 'imports')).toBe(true)
    expect(matchesFilter(run({ status: 'undone' }), 'undone')).toBe(true)
    expect(matchesFilter(run({ automation: 'rule', status: 'skipped' }), 'failed')).toBe(true)
  })
})

describe('frases da semana: só registros reais', () => {
  it('sem execuções, nenhuma frase', () => {
    expect(weekDigest([], data({}), TODAY, 0)).toEqual([])
  })

  it('conta pagamentos automáticos, pendências, desfeitas e falhas da semana', () => {
    const runs = [
      run({ id: 'a' }),
      run({ id: 'b', date: '2026-10-27' }),
      run({ id: 'c', date: '2026-10-26' }),
      run({ id: 'old', date: '2026-10-20', updatedAt: '2026-10-20T09:00:00.000Z' }), // semana passada
      run({ id: 'conf', fromPending: true }), // confirmada pela pessoa: não é "automático"
      run({ id: 'p', status: 'pending' }),
      run({ id: 'u', status: 'undone' }),
      run({ id: 'f', automation: 'rule', status: 'skipped', summary: 'Regra “X” não rodou', detail: 'Não deu para conferir a condição: sem cotação.' }),
    ]
    const texts = weekDigest(runs, data({}), TODAY, 2).map((d) => d.text)
    expect(texts).toContain('O Núcleo registrou 3 pagamentos automaticamente esta semana.')
    expect(texts).toContain('Existem 2 itens esperando uma decisão sua.')
    expect(texts).toContain('Uma ação foi desfeita esta semana.')
    expect(texts).toContain('Uma automação não foi executada porque faltava uma informação.')
  })
})

describe('pendências', () => {
  const sale: Sale = { id: 's1', createdAt: T, updatedAt: T, clientId: null, clientName: 'João', product: 'Site', quantity: 1, date: '2026-10-01', total: 10000, currency: 'EUR', dueDate: '2026-10-10', payments: [], notes: '' } as Sale
  const paused: Rule = { id: 'rl', createdAt: T, updatedAt: T, name: 'Impostos', on: false, since: '2026-10-01', order: 0, trigger: { kind: 'moneyIn' }, conditions: [], actions: [], paused: { at: '2026-10-28T10:00:00.000Z', reason: 'Rodou 30 vezes hoje' } }

  it('reúne cobranças, ações para tentar de novo, regras pausadas e vendas atrasadas', () => {
    const retry = run({ id: 'rr', automation: 'rule', rule: { id: 'x', name: 'Reserva' }, actions: [{ text: 'reservar €10', ok: false, def: { kind: 'reserveFixed', goalId: 'g', amount: 1000 }, code: 'noAvailable' }] })
    const list = pendingItems(data({ automationRuns: [run({ id: 'c1', status: 'pending', date: '2026-10-28' }), retry], rules: [paused], sales: [sale] }), TODAY)
    expect(list.map((i) => i.kind)).toEqual(['lateSale', 'charge', 'pausedRule', 'retry'])
    expect(list.find((i) => i.kind === 'charge')!.next).toBe('Confirmar o pagamento')
    expect(list.find((i) => i.kind === 'lateSale')!.detail).toContain('100,00')
  })

  it('Adiar esconde até o dia; Dispensar não volta', () => {
    const snoozed = run({ id: 'c1', status: 'pending', snoozedUntil: '2026-11-01' })
    const gone = run({ id: 'c2', status: 'pending', dismissedAt: `${TODAY}T10:00:00.000Z` })
    expect(pendingItems(data({ automationRuns: [snoozed, gone] }), TODAY)).toEqual([])
    expect(pendingItems(data({ automationRuns: [snoozed, gone] }), TODAY, { includeSnoozed: true }).map((i) => i.key)).toEqual(['c1'])
    expect(pendingItems(data({ automationRuns: [snoozed] }), '2026-11-01').map((i) => i.key)).toEqual(['c1'])
  })
})

describe('números por automação', () => {
  it('última execução e quantas vezes', () => {
    const runs = [run({ id: 'a', date: '2026-10-01' }), run({ id: 'b', date: '2026-10-20' }), run({ id: 'c', automation: 'goalSave' })]
    const s = automationStats(runs, 'toolCharge', TODAY)
    expect(s.count).toBe(2)
    expect(s.last?.id).toBe('b')
    expect(automationStats(runs, 'saleRecurring', TODAY)).toEqual({ last: null, count: 0, month: 0 })
  })
})
