import { describe, expect, it } from 'vitest'
import { buildAgenda } from '../src/core/agenda'
import { indexCompletions } from '../src/core/completions'
import { financeIndex, totalsBetween } from '../src/core/finance'
import { computeInsights } from '../src/core/insights'
import { completionsByDate, dayOf, tasksByDate, tasksCompletedByDay } from '../src/core/indexes'
import { weekMetrics } from '../src/core/metrics'
import { reorganizeDay } from '../src/core/reorganize'
import type { Completion, DataState, Settings, Task, Transaction } from '../src/data/types'

const empty = (): DataState => ({ transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [], inbox: [], habits: [], recurring: [], completions: [], events: [], focusSessions: [], weeklyGoals: [], challenges: [], weekCheckins: [], weekSnapshots: [], financeGoals: [], lifePlans: [], planSteps: [], meals: [], shoppingItems: [] })
const settings = { onboarded: true, baseCurrency: 'BRL', initialBalance: 0, startedAt: '2021-10-01T12:00:00Z', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'America/Sao_Paulo', modules: { tasks: true, agenda: true, habits: true, finance: true, week: true, life: true, meals: true } } as Settings
const NOW = new Date('2026-10-14T15:00:00Z') // quarta 12:00 em SP
const e = { createdAt: '2026-01-01T12:00:00Z', updatedAt: '2026-01-01T12:00:00Z' }
const day = (i: number) => new Date(Date.UTC(2021, 9, 1) + i * 86_400_000).toISOString().slice(0, 10)
const task = (id: string, p: Partial<Task>): Task => ({ ...e, id, title: id, projectId: null, dueDate: '', priority: 'none', status: 'todo', completedAt: null, ...p })

describe('índices por data (cache por versão da lista)', () => {
  it('mesma lista → mesmo índice; lista nova (ou que mudou de tamanho) → índice novo e correto', () => {
    const list = [task('a', { dueDate: '2026-10-14' })]
    const m1 = tasksByDate(list)
    expect(tasksByDate(list)).toBe(m1)
    const next = [...list, task('b', { dueDate: '2026-10-14' })]
    expect(tasksByDate(next).get('2026-10-14')!.map((t) => t.id)).toEqual(['a', 'b'])
    list.push(task('c', { dueDate: '2026-10-15' }))
    expect(tasksByDate(list).get('2026-10-15')!.map((t) => t.id)).toEqual(['c'])
    const comps: Completion[] = [{ ...e, id: 'habit:h:2026-10-14', source: 'habit', sourceId: 'h', date: '2026-10-14', status: 'done' }]
    expect(indexCompletions(comps)).toBe(indexCompletions(comps))
    comps.push({ ...e, id: 'habit:h:2026-10-15', source: 'habit', sourceId: 'h', date: '2026-10-15', status: 'done' })
    expect(indexCompletions(comps).size).toBe(2)
    expect(completionsByDate(comps).get('2026-10-15')).toHaveLength(1)
  })

  it('data no fuso continua certa (perto da meia-noite) e por fuso', () => {
    expect(dayOf('2026-10-15T02:30:00Z', 'America/Sao_Paulo')).toBe('2026-10-14')
    expect(dayOf('2026-10-15T02:30:00Z', 'Asia/Dubai')).toBe('2026-10-15')
    const done = [task('a', { status: 'done', completedAt: '2026-10-15T02:30:00Z' })]
    expect(tasksCompletedByDay(done, 'America/Sao_Paulo').get('2026-10-14')).toBe(1)
    expect(tasksCompletedByDay(done, 'Asia/Dubai').get('2026-10-15')).toBe(1)
  })

  it('agrupamento financeiro reaproveita as datas: mudar uma movimentação não reconverte o histórico', () => {
    const txs: Transaction[] = Array.from({ length: 20000 }, (_, i) => ({ ...e, id: `x${i}`, createdAt: `${day(Math.floor(i / 11))}T15:00:00Z`, type: 'out', amount: 100, currency: 'BRL', baseAmount: -100, reason: 'r' }))
    financeIndex(txs, settings) // first time: converts every date
    const t0 = performance.now()
    const next = [...txs, { ...e, id: 'novo', createdAt: '2026-10-14T15:00:00Z', type: 'out', amount: 500, currency: 'BRL', baseAmount: -500, reason: 'novo' } as Transaction]
    const idx = financeIndex(next, settings)
    const ms = performance.now() - t0
    expect(totalsBetween(idx, '2026-10-14', '2026-10-14').expense).toBe(500)
    expect(ms).toBeLessThan(250) // antes: ~370 ms nesta máquina
  })
})

describe('"Organizar meu dia" monta a agenda uma vez só', () => {
  it('200 tarefas atrasadas: rápido e com o mesmo tipo de resultado', () => {
    const d = empty()
    d.events = [{ ...e, id: 'ev', title: 'Reunião', date: '2026-10-14', start: '14:00', end: '15:00', notes: '' }]
    d.tasks = [...Array.from({ length: 200 }, (_, i) => task(`late${i}`, { dueDate: '2026-10-01' })), ...Array.from({ length: 5000 }, (_, i) => task(`old${i}`, { dueDate: day(i % 1800), status: 'done', completedAt: `${day(i % 1800)}T12:00:00Z` }))]
    const t0 = performance.now()
    const p = reorganizeDay(d, settings, NOW)
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(1500) // antes: ~6 s nesta máquina
    const timed = p.changes.filter((c) => /^\d\d:\d\d · /.test(c.label))
    const tomorrow = p.changes.filter((c) => c.label.startsWith('Amanhã'))
    expect(timed.length + tomorrow.length).toBe(200)
    // nenhum horário proposto cobre a reunião nem se repete
    const starts = timed.map((c) => c.label.slice(0, 5))
    expect(new Set(starts).size).toBe(starts.length)
    expect(starts.every((s) => s >= '12:15' && (s < '13:30' || s >= '15:00'))).toBe(true)
  })
})

describe('histórico grande (5 anos): telas principais dentro do limite', () => {
  it('Agenda, Semana e Sugestões', () => {
    const d = empty()
    for (let i = 0; i < 10000; i++) d.tasks.push(task(`t${i}`, { dueDate: day(Math.floor(i / 5.5)), status: i < 9800 ? 'done' : 'todo', completedAt: i < 9800 ? `${day(Math.floor(i / 5.5))}T18:00:00Z` : null }))
    for (let i = 0; i < 3000; i++) d.events.push({ ...e, id: `ev${i}`, title: 'C', date: day(Math.floor(i / 1.6)), start: '14:00', end: '15:00', notes: '' })
    for (let h = 0; h < 10; h++) d.habits.push({ ...e, id: `h${h}`, name: `H${h}`, rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: day(0) })
    for (let i = 0; i < 18000; i++) d.completions.push({ ...e, id: `habit:h${i % 10}:${day(Math.floor(i / 10))}`, source: 'habit', sourceId: `h${i % 10}`, date: day(Math.floor(i / 10)), status: 'done' })
    const time = (fn: () => unknown) => {
      fn()
      const t0 = performance.now()
      fn()
      return performance.now() - t0
    }
    expect(time(() => buildAgenda(d, settings, '2026-10-14', '2026-10-14', NOW))).toBeLessThan(15) // antes ~34 ms
    expect(time(() => weekMetrics(d, settings, '2026-10-12', NOW))).toBeLessThan(80) // antes ~220 ms
    expect(time(() => computeInsights(d, settings, NOW))).toBeLessThan(200) // antes ~470 ms
  })
})
