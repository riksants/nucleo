import { describe, expect, it } from 'vitest'
import { dispatch, type DueRow, type Subscription } from '../supabase/functions/_shared/push/dispatch.ts'
import { DEFAULT_REMINDERS, buildOccurrences } from '../src/features/reminders/engine'
import type { DataState, MealPlan, RoutinePlan, Settings, Task } from '../src/data/types'

const empty = (): DataState => ({ transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [] })
const on = (kinds: (keyof typeof DEFAULT_REMINDERS.rules)[], extra: Partial<Settings> = {}): Settings =>
  ({
    onboarded: true,
    baseCurrency: 'BRL',
    initialBalance: 0,
    startedAt: '',
    rates: null,
    manualRates: {},
    lastBackupAt: null,
    timeZone: 'America/Sao_Paulo',
    modules: { routine: true, meals: true, sales: true, subscribers: true },
    reminders: { showDetails: false, rules: Object.fromEntries(Object.entries(DEFAULT_REMINDERS.rules).map(([k, r]) => [k, { ...r, enabled: kinds.includes(k as never) }])) as never },
    ...extra,
  }) as Settings

const task = (over: Partial<Task>): Task => ({ id: 't1', createdAt: '', updatedAt: '', title: 'Dentista', projectId: null, dueDate: '2026-10-02', dueTime: '15:00', priority: 'none', status: 'todo', completedAt: null, ...over })
const NOW = new Date('2026-10-01T12:00:00Z') // 09:00 em São Paulo

describe('lembretes', () => {
  it('respeita fuso e antecedência (15:00 em São Paulo, 15 min antes = 17:45 UTC)', () => {
    const data = { ...empty(), tasks: [task({})] }
    const [o] = buildOccurrences(data, on(['tasks']), { now: NOW })
    expect(o.fireAt.toISOString()).toBe('2026-10-02T17:45:00.000Z')
    const dubai = buildOccurrences(data, on(['tasks'], { timeZone: 'Asia/Dubai' }), { now: NOW })[0]
    expect(dubai.fireAt.toISOString()).toBe('2026-10-02T10:45:00.000Z')
  })

  it('na tela bloqueada não mostra detalhes por padrão', () => {
    const [o] = buildOccurrences({ ...empty(), tasks: [task({})] }, on(['tasks']), { now: NOW })
    expect(o.title).toBe('Núcleo')
    expect(o.body).not.toContain('Dentista')
    expect(o.detail).toContain('Dentista')
  })

  it('mudar ou concluir a origem muda ou cancela o lembrete (chave nova / some)', () => {
    const before = buildOccurrences({ ...empty(), tasks: [task({})] }, on(['tasks']), { now: NOW })
    const moved = buildOccurrences({ ...empty(), tasks: [task({ dueTime: '16:00' })] }, on(['tasks']), { now: NOW })
    const done = buildOccurrences({ ...empty(), tasks: [task({ status: 'done' })] }, on(['tasks']), { now: NOW })
    expect(before[0].key).not.toBe(moved[0].key)
    expect(done).toHaveLength(0)
  })

  it('rotina e refeições se repetem toda semana, sem chaves duplicadas, e refeição não expõe o cardápio', () => {
    const routine: RoutinePlan = { id: 'routine-current', createdAt: '', updatedAt: '', status: 'approved', source: 'manual', notes: '', done: {}, blocks: [{ id: 'b1', day: 1, start: '07:00', end: '08:00', title: 'Treino', kind: 'training', fixed: true }] }
    const meals: MealPlan = { id: 'meals-current', createdAt: '', updatedAt: '', status: 'approved', source: 'manual', notes: '', removed: [], shopping: [], meals: [{ id: 'm1', day: 1, time: '12:30', label: 'Almoço', items: ['Frango', 'Salada'], substitutions: [] }] }
    const occ = buildOccurrences({ ...empty(), routinePlans: [routine], mealPlans: [meals] }, on(['routine', 'meals'], { reminders: { showDetails: true, rules: { ...DEFAULT_REMINDERS.rules, routine: { ...DEFAULT_REMINDERS.rules.routine, enabled: true }, meals: { ...DEFAULT_REMINDERS.rules.meals, enabled: true } } } }), { now: NOW, days: 14 })
    const mondays = occ.filter((o) => o.kind === 'routine')
    expect(mondays).toHaveLength(2) // 5/out e 12/out
    expect(new Set(occ.map((o) => o.key)).size).toBe(occ.length)
    const meal = occ.find((o) => o.kind === 'meals')!
    expect(`${meal.title} ${meal.body}`).not.toMatch(/Frango|Salada/)
  })

  it('seção escondida não gera lembretes', () => {
    const occ = buildOccurrences({ ...empty(), tasks: [task({})] }, on(['tasks'], { modules: { tasks: false } }), { now: NOW })
    expect(occ).toHaveLength(0)
  })
})

describe('envio de push', () => {
  it('envia cada lembrete reservado a todos os aparelhos do dono, remove inscrições expiradas e não reenvia', async () => {
    let claimed = false
    const due: DueRow[] = [{ user_id: 'u1', key: 'k1', title: 'Núcleo', body: 'x', url: '#/today' }]
    const subs: Subscription[] = [
      { id: 's1', user_id: 'u1', endpoint: 'https://a', p256dh: 'p', auth: 'a' },
      { id: 's2', user_id: 'u1', endpoint: 'https://gone', p256dh: 'p', auth: 'a' },
      { id: 's3', user_id: 'u2', endpoint: 'https://other', p256dh: 'p', auth: 'a' },
    ]
    const sent: string[] = []
    const removed: string[] = []
    const deps = {
      claim: async () => (claimed ? [] : ((claimed = true), due)),
      subscriptionsFor: async (ids: string[]) => subs.filter((s) => ids.includes(s.user_id)),
      send: async (s: Subscription) => (sent.push(s.endpoint), { gone: s.endpoint.includes('gone') }),
      removeSubscription: async (id: string) => void removed.push(id),
    }
    expect(await dispatch(deps)).toEqual({ due: 1, sent: 1, removed: 1 })
    expect(sent).not.toContain('https://other')
    expect(removed).toEqual(['s2'])
    expect(await dispatch(deps)).toEqual({ due: 0, sent: 0, removed: 0 })
  })
})
