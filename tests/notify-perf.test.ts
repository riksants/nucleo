// Etapa 5.8: the reminder engine runs on every change of the data (and the series on each sync).
// With a heavy account it must stay well under a frame budget on a phone-class CPU.
import { describe, expect, it } from 'vitest'
import { buildOccurrences, buildSeries } from '../src/features/reminders/engine'
import type { DataState, Settings } from '../src/data/types'

const e = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const NOW = new Date('2026-10-20T10:00:00Z')
const day = (n: number) => new Date(NOW.getTime() + n * 864e5).toISOString().slice(0, 10)
const heavy = (): DataState =>
  ({
    transactions: [], goals: [], clients: [], projects: [], accounts: [], notes: [], portfolio: [], offerings: [], plannerProfiles: [], mealPlans: [], meals: [], lifePlans: [], planSteps: [], financeGoals: [], automationRuns: [], subPlans: [], subscribers: [], sales: [], events: [],
    tasks: Array.from({ length: 1500 }, (_, i) => ({ ...e, id: `t${i}`, title: `Tarefa ${i}`, projectId: null, dueDate: day((i % 120) - 30), dueTime: i % 3 ? '15:00' : '', priority: 'none', status: i % 4 ? 'todo' : 'done', completedAt: null })),
    recurring: Array.from({ length: 150 }, (_, i) => ({ ...e, id: `r${i}`, title: `Conta ${i}`, rule: i % 2 ? { type: 'monthly', dayOfMonth: (i % 28) + 1 } : { type: 'weekdays', days: [1, 3, 5] }, time: i % 2 ? '' : '09:00', notes: '', active: true, startDate: '2026-01-01', bill: !!(i % 2) })),
    habits: Array.from({ length: 40 }, (_, i) => ({ ...e, id: `h${i}`, name: `Hábito ${i}`, rule: { type: 'daily' }, time: '07:30', goal: '', active: true, startDate: '2026-01-01' })),
    tools: Array.from({ length: 60 }, (_, i) => ({ ...e, id: `x${i}`, name: `Serviço ${i}`, link: '', plan: '', price: 990, currency: 'EUR', billing: 'monthly', nextCharge: day(i % 30), notes: '', status: 'active' })),
    completions: Array.from({ length: 3000 }, (_, i) => ({ ...e, id: `c${i}`, source: 'habit', sourceId: `h${i % 40}`, date: day(-(i % 75)), status: 'done' })),
    routinePlans: [],
  }) as unknown as DataState
const settings = { onboarded: true, baseCurrency: 'EUR', initialBalance: 0, startedAt: '', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'Europe/Madrid', modules: { tasks: true, recurring: true, habits: true, tools: true }, reminders: { on: true, showDetails: false, rules: {} } } as unknown as Settings

describe('desempenho do motor de lembretes', () => {
  it('conta pesada: lista de 14 dias e séries rápidas, dentro dos limites do servidor', () => {
    const data = heavy()
    buildOccurrences(data, settings, { now: NOW }) // warm-up (JIT)
    let t = performance.now()
    const occ = buildOccurrences(data, settings, { now: NOW })
    const occMs = performance.now() - t
    t = performance.now()
    const series = buildSeries(data, settings, { now: NOW })
    const seriesMs = performance.now() - t
    console.log(`ocorrências: ${occ.length} em ${occMs.toFixed(1)} ms · séries: ${series.length} em ${seriesMs.toFixed(1)} ms`)
    expect(occMs).toBeLessThan(250)
    expect(seriesMs).toBeLessThan(250)
    expect(series.length).toBeLessThanOrEqual(400)
  })
})
