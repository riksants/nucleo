import { describe, expect, it } from 'vitest'
import { buildOccurrences, DEFAULT_REMINDERS, outsideQuiet } from '../src/features/reminders/engine'
import type { AutomationRun, Completion, DataState, Habit, RecurringItem, Settings, Tool } from '../src/data/types'

const empty = () => ({ transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [], completions: [], habits: [], recurring: [], events: [], automationRuns: [] }) as unknown as DataState
const settings = (over: Partial<Settings> = {}, quiet: { from: string; to: string } | null = null): Settings =>
  ({
    onboarded: true,
    baseCurrency: 'EUR',
    initialBalance: 0,
    startedAt: '',
    rates: null,
    manualRates: {},
    lastBackupAt: null,
    timeZone: 'Europe/Lisbon',
    modules: { habits: true, recurring: true, agenda: true, tools: true },
    reminders: { showDetails: true, rules: { ...DEFAULT_REMINDERS.rules, payments: { ...DEFAULT_REMINDERS.rules.payments, enabled: true } }, quiet },
    ...over,
  }) as Settings
const NOW = new Date('2026-10-29T08:00:00Z') // 08:00 in Lisbon (winter time)

describe('lembretes da etapa 8', () => {
  it('"Pagar aluguel todo dia 5" lembra sozinho: 2 dias antes e no dia', () => {
    const rent = { id: 'r1', title: 'Pagar aluguel', rule: { type: 'monthly', dayOfMonth: 5 }, time: '', notes: '', active: true, startDate: '2026-01-01', bill: true } as RecurringItem
    const occ = buildOccurrences({ ...empty(), recurring: [rent] }, settings(), { now: NOW, days: 14 })
    expect(occ.map((o) => [o.key, o.fireAt.toISOString()])).toEqual([
      ['recurring:r1:2026-11-05:2:09:00', '2026-11-03T09:00:00.000Z'],
      ['recurring:r1:2026-11-05:0:09:00', '2026-11-05T09:00:00.000Z'],
    ])
    expect(occ[0].title).toBe('Conta: Pagar aluguel')
  })

  it('hábito com horário lembra antes; já feito no dia não lembra', () => {
    const h = { id: 'h1', name: 'Estudar inglês', rule: { type: 'daily' }, time: '18:00', goal: '', active: true, startDate: '2026-10-01', minutes: 30 } as Habit
    const done = { id: 'habit:h1:2026-10-29', source: 'habit', sourceId: 'h1', date: '2026-10-29', status: 'done' } as Completion
    const today = buildOccurrences({ ...empty(), habits: [h], completions: [done] }, settings(), { now: NOW, days: 2 }).map((o) => o.key)
    expect(today).toEqual(['habit:h1:2026-10-30T18:00:10'])
  })

  it('assinatura: 2 dias antes e no dia; já paga não lembra', () => {
    const t = { id: 't1', createdAt: '', updatedAt: '', name: 'Figma', link: '', plan: '', price: 1500, currency: 'USD', billing: 'monthly', nextCharge: '2026-11-03', notes: '', status: 'active' } as Tool
    expect(buildOccurrences({ ...empty(), tools: [t] }, settings(), { now: NOW }).map((o) => o.key)).toEqual(['tool:t1:2026-11-03:2:09:00', 'tool:t1:2026-11-03:0:09:00'])
    const paid = { id: 'auto-tool-t1-2026-11-03', automation: 'toolCharge', date: '2026-11-03', status: 'done', origin: { collection: 'tools', id: 't1', label: 'Figma' } } as AutomationRun
    expect(buildOccurrences({ ...empty(), tools: [t], automationRuns: [paid] }, settings(), { now: NOW })).toEqual([])
  })

  it('horário silencioso adia para o fim (mesma chave, nunca duplicado)', () => {
    const tz = 'Europe/Lisbon'
    const q = { from: '22:00', to: '07:00' }
    expect(outsideQuiet(new Date('2026-10-29T23:30:00Z'), q, tz).toISOString()).toBe('2026-10-30T07:00:00.000Z')
    expect(outsideQuiet(new Date('2026-10-30T05:00:00Z'), q, tz).toISOString()).toBe('2026-10-30T07:00:00.000Z')
    expect(outsideQuiet(new Date('2026-10-30T12:00:00Z'), q, tz).toISOString()).toBe('2026-10-30T12:00:00.000Z')
    const h = { id: 'h2', name: 'Ler', rule: { type: 'daily' }, time: '23:00', goal: '', active: true, startDate: '2026-10-01' } as Habit
    const occ = buildOccurrences({ ...empty(), habits: [h] }, settings({}, q), { now: NOW, days: 1 })
    expect(occ[0].fireAt.toISOString()).toBe('2026-10-30T07:00:00.000Z')
  })

  it('seção desligada ou item inativo não lembra', () => {
    const h = { id: 'h1', name: 'Estudar', rule: { type: 'daily' }, time: '18:00', goal: '', active: false, startDate: '2026-10-01' } as Habit
    expect(buildOccurrences({ ...empty(), habits: [h] }, settings(), { now: NOW })).toEqual([])
    const h2 = { ...h, active: true }
    expect(buildOccurrences({ ...empty(), habits: [h2] }, settings({ modules: { habits: false } }), { now: NOW })).toEqual([])
  })
})
