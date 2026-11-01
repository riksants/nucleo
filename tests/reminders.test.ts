import { describe, expect, it } from 'vitest'
import { compose, dispatch, type DueRow, type RowResult, type Subscription } from '../supabase/functions/_shared/push/dispatch.ts'
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

  it('na tela bloqueada: específico por padrão; discreto só quando escolhido', () => {
    const [o] = buildOccurrences({ ...empty(), tasks: [task({})] }, on(['tasks']), { now: NOW })
    // iPhone: "Núcleo" como título e a mensagem específica (nome e horário), sem "Agora:" nem repetição.
    expect(o.title).toBe('Núcleo')
    expect(o.body).toBe('Dentista hoje às 15:00')
    const [now] = buildOccurrences({ ...empty(), tasks: [task({})] }, { ...on(['tasks']), reminders: { ...on(['tasks']).reminders!, on: true, when: 'at' } }, { now: NOW })
    expect([now.title, now.body]).toEqual(['Núcleo', 'Dentista às 15:00'])
    const s = on(['tasks'])
    const [d] = buildOccurrences({ ...empty(), tasks: [task({})] }, { ...s, reminders: { ...s.reminders!, privacy: 'discreet' } }, { now: NOW })
    expect(d.title).toBe('Núcleo')
    expect(d.body).not.toContain('Dentista')
    expect(d.detail).toContain('Dentista')
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
    const mondays = occ.filter((o) => o.kind === 'routine' && o.key.startsWith('routine:'))
    expect(mondays).toHaveLength(2) // 5/out e 12/out
    // When a block ends it only reads "Horário encerrado" in the app: no "concluiu?" push (Etapa 1 do dia a dia).
    expect(occ.filter((o) => o.key.startsWith('routine-end:'))).toEqual([])
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
    expect(await dispatch(deps)).toEqual({ due: 1, sent: 1, removed: 1, failed: 0 })
    expect(sent).not.toContain('https://other')
    expect(removed).toEqual(['s2'])
    expect(await dispatch(deps)).toEqual({ due: 0, sent: 0, removed: 0, failed: 0 })
  })

  const row = (key: string, over: Partial<DueRow> = {}): DueRow => ({ user_id: 'u1', key, title: `T ${key}`, body: `B ${key}`, url: `#/x?open=${key}`, kind: 'payments', custom: false, fire_at: '2026-11-10T08:00:00Z', ...over })

  it('agrupa automáticos do mesmo minuto listando cada um; os da pessoa e os do app vão sozinhos', () => {
    const msgs = compose([
      row('a'),
      row('b'),
      row('mine', { custom: true }),
      row('notice', { kind: 'app' }),
      row('other-minute', { fire_at: '2026-11-10T08:01:00Z' }),
      row('other-user', { user_id: 'u2' }),
    ])
    const group = msgs.find((m) => m.rows.length > 1)!
    expect(group.rows.map((r) => r.key)).toEqual(['a', 'b'])
    expect(group.payload.title).toBe('Núcleo')
    expect(group.payload.body).toBe('2 lembretes\n• T a: B a\n• T b: B b')
    expect(group.payload.url).toBe('#/notifications?at=2026-11-10T08%3A00%3A00.000Z')
    expect(msgs.filter((m) => m.rows.length === 1).map((m) => m.rows[0].key).sort()).toEqual(['mine', 'notice', 'other-minute', 'other-user'])
    // Linhas antigas (servidor sem as colunas novas): tudo sozinho, como antes.
    expect(compose([{ user_id: 'u1', key: 'x', title: 't', body: 'b', url: '' }, { user_id: 'u1', key: 'y', title: 't', body: 'b', url: '' }])).toHaveLength(2)
    // Muitos: 4 linhas e o resto indicado na central.
    const many = compose(['1', '2', '3', '4', '5', '6'].map((k) => row(k)))
    expect(many[0].payload.body.split('\n')).toHaveLength(6)
    expect(many[0].payload.body).toContain('+ 2 na central')
  })

  it('aviso antigo ainda na fila (título específico) sai com "Núcleo" sem perder o nome do item', () => {
    const [legacy] = compose([row('x', { custom: true, title: 'Pagar: Spotify', body: 'Cobrança de Spotify hoje' })])
    expect(legacy.payload).toMatchObject({ title: 'Núcleo', body: 'Pagar: Spotify: Cobrança de Spotify hoje' })
    const [already] = compose([row('y', { custom: true, title: 'teste', body: 'Agora: teste' })])
    expect(already.payload).toMatchObject({ title: 'Núcleo', body: 'Agora: teste' })
    const [fresh] = compose([row('z', { custom: true, title: 'Núcleo', body: 'Teste' })])
    expect(fresh.payload).toMatchObject({ title: 'Núcleo', body: 'Teste' })
  })

  it('guarda o resultado de cada lembrete (enviado ao serviço, falhou, sem aparelho)', async () => {
    const due = [row('a'), row('b'), row('c', { user_id: 'u2', custom: true }), row('d', { user_id: 'u3', custom: true })]
    const subs: Subscription[] = [
      { id: 's1', user_id: 'u1', endpoint: 'https://ok', p256dh: 'p', auth: 'a' },
      { id: 's2', user_id: 'u2', endpoint: 'https://bad', p256dh: 'p', auth: 'a' },
    ]
    let results: RowResult[] = []
    const payloads: string[] = []
    let claimed = false
    const res = await dispatch({
      claim: async () => (claimed ? [] : ((claimed = true), due)),
      subscriptionsFor: async (ids) => subs.filter((s) => ids.includes(s.user_id)),
      send: async (s, p) => {
        if (s.endpoint.includes('bad')) throw new Error('500 do serviço')
        payloads.push(p)
        return { gone: false }
      },
      removeSubscription: async () => {},
      record: async (r) => void (results = r),
    })
    expect(res).toEqual({ due: 4, sent: 1, removed: 0, failed: 1 })
    expect(payloads).toHaveLength(1) // a e b numa só notificação
    const by = Object.fromEntries(results.map((r) => [r.key, r]))
    expect(by.a).toMatchObject({ status: 'sent', grouped: true })
    expect(by.b).toMatchObject({ status: 'sent', grouped: true })
    expect(by.c).toMatchObject({ status: 'failed', error: '500 do serviço', grouped: false })
    expect(by.d).toMatchObject({ status: 'nodevice', sent: 0 })
  })
})
