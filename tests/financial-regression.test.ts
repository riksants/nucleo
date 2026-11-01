// Regression guard (2026-11-01 audit): partial payments and old financial records must read exactly the
// same after any update. Shapes below are the real formats stored in production (ids/names made up).
import { describe, expect, it } from 'vitest'
import { installmentViews, salePaid, saleRemaining, saleStatus } from '../src/data/sales'
import { isStorableEntity } from '../src/data/normalize'
import { buildOccurrences, buildSeries } from '../src/features/reminders/engine'
import { alertFields } from '../src/features/reminders/AlertsField'
import type { DataState, Project, Sale, Settings } from '../src/data/types'

/** A sale saved before Etapa 4/5: no items, no installments, no alerts. €400 with €300 received. */
const oldSale = (): Sale =>
  ({
    id: 's-old',
    createdAt: '2026-10-04T14:46:23.734Z',
    updatedAt: '2026-10-09T14:28:24.335Z',
    clientId: 'c1',
    clientName: '',
    product: 'Web Site',
    quantity: 1,
    date: '2026-09-28',
    total: 40000,
    currency: 'EUR',
    dueDate: '',
    notes: '',
    payments: [
      { id: 'p1', date: '2026-10-05', amount: 20000, note: '', finance: true },
      { id: 'p2', date: '2026-10-21', amount: 10000, note: '' },
    ],
  }) as Sale

/** A project with money typed in the old form ("received") plus the newer payment history. */
const oldProject = (): Project =>
  ({
    id: 'pr1', createdAt: '2026-09-28T13:35:13.105Z', updatedAt: '2026-10-21T17:56:28.494Z', name: 'Perfect Clean', clientId: 'c1', kind: 'site', status: 'done',
    startDate: '2026-09-23', dueDate: '', endDate: '2026-09-28', charged: 40000, received: 20000, currency: 'EUR', link: '', notes: '', legacyReceived: 'inFinance',
    payments: [{ id: 'pp1', date: '2026-10-21', amount: 10000, currency: 'EUR', note: '' }],
  }) as Project

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.freeze(o)
    for (const v of Object.values(o)) deepFreeze(v)
  }
  return o
}

describe('pagamentos parciais e registros antigos', () => {
  it('venda antiga com pagamento parcial: recebido, falta e situação', () => {
    const s = oldSale()
    expect(salePaid(s)).toBe(30000)
    expect(saleRemaining(s)).toBe(10000)
    expect(saleStatus(s)).toBe('partial')
  })

  it('pagamento geral (repartido entre compras) e parcelas continuam somando certo', () => {
    const s = { ...oldSale(), payments: [{ id: 'g', date: '2026-10-05', amount: 30000, note: '', generalId: 'G1' }], installments: [{ id: 'a', due: '2026-10-10', amount: 20000 }, { id: 'b', due: '2026-11-10', amount: 20000 }] } as Sale
    expect(salePaid(s)).toBe(30000)
    expect(installmentViews(s, '2026-11-01').map((v) => [v.paid, v.state])).toEqual([[20000, 'paid'], [10000, 'partial']])
  })

  it('o registro do servidor é guardado como veio (pagamentos e campos antigos intactos)', () => {
    const fromServer = JSON.parse(JSON.stringify(oldSale()))
    expect(isStorableEntity(fromServer, 's-old')).toBe(true)
    expect(fromServer.payments).toEqual(oldSale().payments)
  })

  it('lembretes nunca alteram registros financeiros (entrada congelada)', () => {
    const data = deepFreeze({
      transactions: [], goals: [], clients: [{ id: 'c1', name: 'Vânia' }], projects: [oldProject()], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [{ ...oldSale(), dueDate: '2026-11-03' }],
      offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [], completions: [], habits: [], recurring: [], events: [], automationRuns: [], financeGoals: [], lifePlans: [], planSteps: [], meals: [],
    } as unknown as DataState)
    const settings = { timeZone: 'Europe/Madrid', modules: { sales: true, projects: true, clients: true }, reminders: { on: true, showDetails: false, rules: {} } } as unknown as Settings
    const occ = buildOccurrences(data, settings, { now: new Date('2026-11-01T10:00:00Z') })
    buildSeries(data, settings, { now: new Date('2026-11-01T10:00:00Z') })
    // The reminder for the sale speaks of what is really missing (€100), never of the total.
    const sale = occ.find((o) => o.key.startsWith('sale:s-old'))!
    expect(sale.detail).toContain('100,00')
    expect(sale.detail).not.toContain('400,00')
    expect(data.sales[0].payments).toHaveLength(2)
  })

  it('campos de lembrete da Etapa 5 não apagam pagamentos ao salvar a venda (mesma mescla do formulário)', () => {
    const before = oldSale()
    const next = { ...before, product: 'Web Site', ...alertFields([{ id: 'x', type: 'day', days: 1, at: '09:00' }], false) }
    expect(next.payments).toEqual(before.payments)
    expect(salePaid(next)).toBe(30000)
    const cleared = { ...next, ...alertFields([], false) }
    expect(cleared.payments).toEqual(before.payments)
  })
})
