// Recorrentes alterados, pausados, encerrados ou reagendados: o espelho dos pushes no servidor acompanha —
// o aviso antigo é apagado, o novo entra, nada fica duplicado. Servidor simulado em memória (mesma API do
// supabase-js usada em push.ts), relógio fixo.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DataState, RecurringItem, Settings } from '../src/data/types'

interface Row {
  key: string
  fire_at: string
  title: string
  body: string
  url: string
  sent_at: string | null
}
const table = new Map<string, Row>()

/** Just enough of the query builder: select().is().gt(), delete().in().is(), upsert(rows, { onConflict }). */
const fake = {
  from: () => ({
    select: () => {
      const filters: ((r: Row) => boolean)[] = []
      const q = {
        is: (col: keyof Row, v: null) => (filters.push((r) => r[col] === v), q),
        gt: (col: keyof Row, v: string) => (filters.push((r) => Date.parse(String(r[col])) > Date.parse(v)), q),
        then: (res: (x: { data: Row[]; error: null }) => void) => res({ data: [...table.values()].filter((r) => filters.every((f) => f(r))), error: null }),
      }
      return q
    },
    delete: () => {
      let keys: string[] = []
      const q = {
        in: (_c: string, ks: string[]) => ((keys = ks), q),
        is: () => q,
        then: (res: (x: { error: null }) => void) => {
          for (const k of keys) if (table.get(k)?.sent_at === null) table.delete(k)
          res({ error: null })
        },
      }
      return q
    },
    upsert: async (rows: Omit<Row, 'sent_at'>[]) => {
      for (const r of rows) table.set(r.key, { ...r, sent_at: table.get(r.key)?.sent_at ?? null })
      return { error: null }
    },
  }),
}
vi.mock('../src/lib/supabase', () => ({ supabase: fake }))

const { syncSchedule } = await import('../src/features/reminders/push')
const { buildOccurrences } = await import('../src/features/reminders/engine')
const { endRecurring, rescheduleOccurrence, splitRecurring } = await import('../src/core/habits')

const NOW = new Date('2026-10-30T12:00:00Z') // sexta 09:00 em São Paulo
const TODAY = '2026-10-30'
const settings = { onboarded: true, baseCurrency: 'BRL', initialBalance: 0, startedAt: '', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'America/Sao_Paulo', modules: { recurring: true }, reminders: { showDetails: true, rules: {}, on: true } } as unknown as Settings
const e = { createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
const base = (): RecurringItem => ({ ...e, id: 'r1', title: 'Estudar inglês', rule: { type: 'weekdays', days: [1, 3, 5] }, time: '19:00', notes: '', active: true, startDate: '2026-10-01' })
const data = (recurring: RecurringItem[]) => ({ recurring, completions: [], habits: [], tasks: [], events: [], routinePlans: [], mealPlans: [], meals: [], tools: [], sales: [], subscribers: [], subPlans: [], projects: [], lifePlans: [], planSteps: [], financeGoals: [], automationRuns: [] }) as unknown as DataState
const sync = (recurring: RecurringItem[]) => syncSchedule(buildOccurrences(data(recurring), settings, { now: NOW }))
const keysOf = (id: string) => [...table.keys()].filter((k) => k.startsWith(`recurring:${id}:`)).sort()
/** One reminder row per occurrence and lead (no two rows for the same moment of the same item). */
const noDuplicates = () => {
  const seen = new Set<string>()
  for (const r of table.values()) {
    const id = `${r.key.split(':').slice(0, 3).join(':').slice(0, 30)}|${r.fire_at}`
    if (seen.has(id)) return false
    seen.add(id)
  }
  return true
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterAll(() => vi.useRealTimers())

describe('push no servidor acompanha os recorrentes', () => {
  it('cria os avisos das próximas ocorrências', async () => {
    await sync([base()])
    expect(keysOf('r1').some((k) => k.startsWith(`recurring:r1:${TODAY}T19:00`))).toBe(true)
    expect(noDuplicates()).toBe(true)
  })

  it('"só esta" em outro horário: apaga o aviso antigo e cria o novo', async () => {
    await sync([rescheduleOccurrence(base(), TODAY, { date: TODAY, time: '20:30' }, TODAY)])
    expect(keysOf('r1').some((k) => k.startsWith(`recurring:r1:${TODAY}T19:00`))).toBe(false)
    expect(keysOf('r1').some((k) => k.startsWith(`recurring:r1:${TODAY}T20:30`))).toBe(true)
    expect(keysOf('r1').some((k) => k.startsWith('recurring:r1:2026-11-02T19:00'))).toBe(true)
    expect(noDuplicates()).toBe(true)
  })

  it('pausar cancela todos os avisos futuros; retomar traz de volta sem duplicar', async () => {
    await sync([{ ...base(), active: false }])
    expect(keysOf('r1')).toEqual([])
    await sync([base()])
    const n = keysOf('r1').length
    await sync([base()])
    expect(keysOf('r1').length).toBe(n)
    expect(noDuplicates()).toBe(true)
  })

  it('encerrar cancela o que viria depois', async () => {
    await sync([endRecurring(base(), TODAY, false)])
    expect(keysOf('r1')).toEqual([])
  })

  it('"esta e as próximas": avisos do antigo param na véspera, a continuação assume', async () => {
    await sync([base()])
    const split = splitRecurring(base(), '2026-11-02', { time: '18:00' })!
    await sync([split.ended, { ...split.next, ...e, id: 'r2' } as RecurringItem])
    expect(keysOf('r1').every((k) => k.split(':')[2] < '2026-11-02')).toBe(true)
    expect(keysOf('r2').some((k) => k.startsWith('recurring:r2:2026-11-02T18:00'))).toBe(true)
    expect(keysOf('r2').some((k) => k.includes('T19:00'))).toBe(false)
    expect(noDuplicates()).toBe(true)
  })

  it('aviso já enviado não é apagado nem reenviado', async () => {
    table.clear()
    await sync([base()])
    const first = keysOf('r1')[0]
    table.get(first)!.sent_at = NOW.toISOString()
    await sync([{ ...base(), active: false }])
    expect(table.has(first)).toBe(true)
  })
})
