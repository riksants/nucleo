import { describe, expect, it } from 'vitest'
import { buildOccurrences, DEFAULT_REMINDERS, effectivePrefs } from '../src/features/reminders/engine'
import { normalizeSettings } from '../src/data/normalize'
import type { AutomationRun, CalendarEvent, Completion, DataState, FinanceGoal, Habit, RecurringItem, ReminderPrefs, Sale, Settings, SubPlan, Subscriber, Task, Tool } from '../src/data/types'

const empty = () =>
  ({
    transactions: [],
    goals: [],
    clients: [],
    projects: [],
    tasks: [],
    tools: [],
    accounts: [],
    notes: [],
    portfolio: [],
    sales: [],
    offerings: [],
    subPlans: [],
    subscribers: [],
    plannerProfiles: [],
    routinePlans: [],
    mealPlans: [],
    completions: [],
    habits: [],
    recurring: [],
    events: [],
    automationRuns: [],
    financeGoals: [],
    lifePlans: [],
    planSteps: [],
    meals: [],
  }) as unknown as DataState
const ALL = {
  tasks: true,
  agenda: true,
  habits: true,
  recurring: true,
  tools: true,
  sales: true,
  subscribers: true,
  finance: true,
  projects: true,
  life: true,
  routine: true,
  meals: true,
}
const settings = (reminders: Partial<ReminderPrefs> | undefined, over: Partial<Settings> = {}): Settings =>
  ({
    onboarded: true,
    baseCurrency: 'BRL',
    initialBalance: 0,
    startedAt: '',
    rates: null,
    manualRates: {},
    lastBackupAt: null,
    timeZone: 'America/Sao_Paulo',
    modules: ALL,
    ...(reminders ? { reminders: { showDetails: true, rules: {}, ...reminders } } : {}),
    ...over,
  }) as Settings
const on = (extra: Partial<ReminderPrefs> = {}, over: Partial<Settings> = {}) => settings({ on: true, ...extra }, over)
// 2026-10-30 09:00 in São Paulo (UTC-3).
const NOW = new Date('2026-10-30T12:00:00Z')
const keys = (d: DataState, s: Settings, opts: { now?: Date; days?: number } = {}) => buildOccurrences(d, s, { now: NOW, ...opts }).map((o) => o.key)
const at = (d: DataState, s: Settings, key: string) =>
  buildOccurrences(d, s, { now: NOW })
    .find((o) => o.key === key)
    ?.fireAt.toISOString()

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  title: 'Dentista',
  projectId: null,
  dueDate: '2026-10-31',
  dueTime: '15:00',
  priority: 'none',
  status: 'todo',
  completedAt: null,
  ...over,
})
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1',
  createdAt: '',
  updatedAt: '2026-10-01T00:00:00Z',
  title: 'Reunião com Ana',
  date: '2026-10-31',
  start: '10:00',
  end: '11:00',
  notes: '',
  ...over,
})
const sale = (over: Partial<Sale> = {}): Sale =>
  ({
    id: 's1',
    createdAt: '',
    updatedAt: '2026-10-01T00:00:00Z',
    clientId: null,
    clientName: 'Maria',
    product: 'Bolo',
    quantity: 1,
    date: '2026-10-01',
    total: 30000,
    currency: 'BRL',
    dueDate: '',
    payments: [],
    notes: '',
    ...over,
  }) as Sale

describe('chave geral e preferências antigas', () => {
  it('sem a chave geral, nada muda: o comportamento antigo continua exatamente igual', () => {
    const p = effectivePrefs(settings(undefined))
    expect(p.legacy).toBe(true)
    expect(p.kinds.tasks.enabled).toBe(false) // era desligado por padrão
    expect(p.kinds.habits.enabled).toBe(true)
  })

  it('ao ativar pela primeira vez, tudo que é relevante liga sozinho', () => {
    const p = effectivePrefs(on())
    expect(Object.values(p.kinds).every((k) => k.enabled)).toBe(true)
    expect(p.when).toBe('before')
    expect(p.followUp).toBe(true)
  })

  it('o que a pessoa desligou de propósito continua desligado, e ajustes antigos são mantidos', () => {
    const rules = {
      ...DEFAULT_REMINDERS.rules,
      habits: { ...DEFAULT_REMINDERS.rules.habits, enabled: false },
      events: { ...DEFAULT_REMINDERS.rules.events, leadMin: 60 },
    }
    const p = effectivePrefs(settings({ on: true, rules }))
    expect(p.kinds.habits.enabled).toBe(false)
    expect(p.kinds.events.leadMin).toBe(60)
    expect(p.kinds.tasks.enabled).toBe(true)
  })

  it('desativar apaga todos os avisos', () => {
    expect(keys({ ...empty(), tasks: [task()] }, settings({ on: false }))).toEqual([])
  })

  it('o ajuste de uma categoria vale mais que o geral', () => {
    const s = on({
      when: 'before',
      kinds: { events: { when: 'at' }, tasks: { enabled: false } },
    })
    expect(keys({ ...empty(), events: [event()], tasks: [task()] }, s)).toEqual(['event:e1:2026-10-31T10:00:0'])
  })

  it('as escolhas novas sobrevivem à leitura das configurações (sincronização)', () => {
    const r = normalizeSettings({
      ...on({
        when: 'both',
        followUp: false,
        kinds: { tasks: { enabled: false } },
      }),
    }).reminders!
    expect(r).toMatchObject({
      on: true,
      when: 'both',
      followUp: false,
      kinds: { tasks: { enabled: false } },
    })
    expect(normalizeSettings({ reminders: { rules: {}, when: 'sempre', on: 'sim' } }).reminders).toEqual({ showDetails: false, rules: {} })
  })
})

describe('antes, na hora ou os dois', () => {
  const d = { ...empty(), events: [event()] }
  it('antes: 30 min antes do compromisso', () => {
    expect(at(d, on(), 'event:e1:2026-10-31T10:00:30')).toBe('2026-10-31T12:30:00.000Z')
    expect(keys(d, on())).toEqual(['event:e1:2026-10-31T10:00:30'])
  })
  it('na hora: exatamente no horário', () => {
    expect(keys(d, on({ when: 'at' }))).toEqual(['event:e1:2026-10-31T10:00:0'])
    expect(at(d, on({ when: 'at' }), 'event:e1:2026-10-31T10:00:0')).toBe('2026-10-31T13:00:00.000Z')
  })
  it('antes e na hora: os dois, sem repetir', () => {
    expect(keys(d, on({ when: 'both' }))).toEqual(['event:e1:2026-10-31T10:00:30', 'event:e1:2026-10-31T10:00:0'])
    // Zero minutos de antecedência: é um aviso só.
    expect(keys(d, on({ when: 'both', kinds: { events: { leadMin: 0 } } }))).toEqual(['event:e1:2026-10-31T10:00:0'])
  })
  it('só com data: dias antes, no dia, ou os dois (no horário do aviso)', () => {
    const t = {
      ...empty(),
      tasks: [task({ dueTime: '', dueDate: '2026-11-03' })],
    }
    expect(keys(t, on())).toEqual(['task:t1:2026-11-03:1:09:00', 'task:t1:2026-11-03:late'])
    expect(keys(t, on({ when: 'at', followUp: false }))).toEqual(['task:t1:2026-11-03:0:09:00'])
    expect(keys(t, on({ when: 'both', followUp: false }))).toEqual(['task:t1:2026-11-03:1:09:00', 'task:t1:2026-11-03:0:09:00'])
  })
  it('criado depois do momento do "antes": avisa na hora, para não perder', () => {
    const t = task({
      dueDate: '2026-10-30',
      dueTime: '09:10',
      updatedAt: '2026-10-30T11:58:00Z',
    }) // criado às 08:58, aviso "antes" seria 08:55
    expect(keys({ ...empty(), tasks: [t] }, on({ followUp: false }))).toEqual(['task:t1:2026-10-30T09:10:0'])
    // Já existia e o aviso "antes" simplesmente passou: não vira um segundo aviso.
    const old = task({
      dueDate: '2026-10-30',
      dueTime: '09:10',
      updatedAt: '2026-10-29T10:00:00Z',
    })
    expect(
      keys({ ...empty(), tasks: [old] }, on({ followUp: false }), {
        now: new Date('2026-10-30T12:06:00Z'),
      }),
    ).toEqual([])
  })
})

describe('mudanças atualizam os avisos', () => {
  it('concluída, remarcada ou excluída: o aviso some ou muda de chave', () => {
    const base = keys({ ...empty(), tasks: [task()] }, on({ followUp: false }))
    expect(base).toEqual(['task:t1:2026-10-31T15:00:15'])
    expect(keys({ ...empty(), tasks: [task({ status: 'done' })] }, on())).toEqual([])
    expect(keys({ ...empty(), tasks: [task({ dueTime: '16:00' })] }, on({ followUp: false }))).toEqual(['task:t1:2026-10-31T16:00:15'])
    expect(keys(empty(), on())).toEqual([])
  })

  it('tarefa atrasada avisa uma vez no dia seguinte; concluída não', () => {
    const late = task({ dueDate: '2026-10-29', dueTime: '' })
    expect(keys({ ...empty(), tasks: [late] }, on())).toEqual(['task:t1:2026-10-29:late'])
    expect(at({ ...empty(), tasks: [late] }, on(), 'task:t1:2026-10-29:late')).toBe('2026-10-30T12:00:00.000Z')
    // Um dia depois, não insiste.
    expect(
      keys({ ...empty(), tasks: [late] }, on(), {
        now: new Date('2026-10-31T12:00:00Z'),
      }),
    ).toEqual([])
    expect(keys({ ...empty(), tasks: [{ ...late, status: 'done' }] }, on())).toEqual([])
    expect(keys({ ...empty(), tasks: [late] }, on({ followUp: false }))).toEqual([])
  })

  it('compromisso que já passou não vira "feito" nem gera aviso', () => {
    expect(keys({ ...empty(), events: [event({ date: '2026-10-29' })] }, on())).toEqual([])
  })
})

describe('dinheiro: a pagar e a receber', () => {
  it('parcelas de venda: cada parcela aberta avisa; a paga não; a atrasada avisa uma vez', () => {
    const s = sale({
      installments: [
        { id: 'a', due: '2026-10-29', amount: 10000 },
        { id: 'b', due: '2026-11-05', amount: 10000 },
        { id: 'c', due: '2026-12-05', amount: 10000 },
      ],
    })
    // (Each open installment also has its one "still pending?" the day after its date.)
    expect(keys({ ...empty(), sales: [s] }, on())).toEqual(['sale:s1:2026-10-29:late', 'sale:s1:2026-11-05:1:09:00', 'sale:s1:2026-11-05:late'])
    const paidFirst = {
      ...s,
      payments: [{ id: 'p', date: '2026-10-29', amount: 10000, note: '' }],
    }
    expect(keys({ ...empty(), sales: [paidFirst] }, on())).toEqual(['sale:s1:2026-11-05:1:09:00', 'sale:s1:2026-11-05:late'])
    const settled = {
      ...s,
      payments: [{ id: 'p', date: '2026-10-29', amount: 30000, note: '' }],
    }
    expect(keys({ ...empty(), sales: [settled] }, on())).toEqual([])
  })

  it('a pagar e a receber têm textos diferentes; valores nunca aparecem', () => {
    const tool = {
      id: 'tl',
      createdAt: '',
      updatedAt: '',
      name: 'Figma',
      link: '',
      plan: '',
      price: 1500,
      currency: 'USD',
      billing: 'monthly',
      nextCharge: '2026-11-03',
      notes: '',
      status: 'active',
    } as Tool
    const occ = buildOccurrences({ ...empty(), tools: [tool], sales: [sale({ dueDate: '2026-11-03' })] }, on(), { now: NOW })
    expect(occ.find((o) => o.kind === 'payments')).toMatchObject({
      title: 'Pagar: Figma',
    })
    expect(occ.find((o) => o.kind === 'receivables')).toMatchObject({
      title: 'Receber: Bolo',
      detail: 'Cobrar Maria · Bolo em 1 dia',
    })
    const locked = buildOccurrences({ ...empty(), tools: [tool], sales: [sale({ dueDate: '2026-11-03' })] }, on({ showDetails: false, followUp: false }), { now: NOW })
    expect(locked.map((o) => [o.title, o.body])).toEqual([
      ['Núcleo', 'Você tem uma conta a pagar'],
      ['Núcleo', 'Você tem um valor a receber'],
    ])
    expect(JSON.stringify(occ)).not.toMatch(/15,00|300|1500|30000/)
  })

  it('conta já paga não continua lembrando; cobrança pendente lembra uma vez', () => {
    const tool = {
      id: 'tl',
      createdAt: '',
      updatedAt: '',
      name: 'Figma',
      link: '',
      plan: '',
      price: 1500,
      currency: 'USD',
      billing: 'monthly',
      nextCharge: '2026-11-03',
      notes: '',
      status: 'active',
    } as Tool
    const paid = {
      id: 'x',
      automation: 'toolCharge',
      date: '2026-11-03',
      status: 'done',
      origin: { collection: 'tools', id: 'tl', label: 'Figma' },
    } as AutomationRun
    expect(keys({ ...empty(), tools: [tool], automationRuns: [paid] }, on())).toEqual([])
    const pending = {
      ...paid,
      date: '2026-10-29',
      status: 'pending',
    } as AutomationRun
    expect(keys({ ...empty(), tools: [tool], automationRuns: [pending] }, on())).toEqual(['tool:tl:2026-10-29:late', 'tool:tl:2026-11-03:2:09:00'])
    expect(keys({ ...empty(), tools: [{ ...tool, status: 'cancelled' }] }, on())).toEqual([])
  })

  it('assinante "considerar pago" não gera cobrança; o normal lembra na data combinada', () => {
    const plan = {
      id: 'p1',
      offeringId: 'o',
      name: 'Mensal',
      price: 5000,
      currency: 'BRL',
      interval: 'monthly',
    } as unknown as SubPlan
    const sub = {
      id: 'sb',
      createdAt: '',
      updatedAt: '',
      offeringId: 'o',
      planId: 'p1',
      name: 'Rui',
      clientId: null,
      email: '',
      startDate: '2026-10-01',
      nextCharge: '2026-11-01',
      status: 'active',
      cancelledAt: '',
      payments: [],
      notes: '',
    } as Subscriber
    expect(keys({ ...empty(), subPlans: [plan], subscribers: [sub] }, on({ when: 'at' }))).toEqual(['sub:sb:2026-11-01:0:09:00'])
    expect(
      keys(
        {
          ...empty(),
          subPlans: [plan],
          subscribers: [{ ...sub, paymentMode: 'autoPaid' }],
        },
        on(),
      ),
    ).toEqual([])
  })

  it('conta recorrente: o "N dias antes" do item vale mais que o geral; paga não avisa; pendente avisa no dia seguinte', () => {
    const rent = {
      id: 'r1',
      title: 'Aluguel',
      rule: { type: 'monthly', dayOfMonth: 5 },
      time: '',
      notes: '',
      active: true,
      startDate: '2026-01-01',
      bill: true,
    } as RecurringItem
    expect(keys({ ...empty(), recurring: [rent] }, on())).toEqual(['recurring:r1:2026-11-05:2:09:00'])
    expect(keys({ ...empty(), recurring: [{ ...rent, remindDays: 5 }] }, on({ when: 'both' }))).toEqual(['recurring:r1:2026-11-05:5:09:00', 'recurring:r1:2026-11-05:0:09:00'])
    const done = {
      id: 'recurring:r1:2026-11-05',
      source: 'recurring',
      sourceId: 'r1',
      date: '2026-11-05',
      status: 'done',
    } as Completion
    expect(keys({ ...empty(), recurring: [rent], completions: [done] }, on())).toEqual([])
    const due29 = {
      ...rent,
      rule: { type: 'monthly', dayOfMonth: 29 },
    } as RecurringItem
    expect(keys({ ...empty(), recurring: [due29] }, on(), { days: 2 })).toEqual(['recurring:r1:2026-10-29:late'])
  })

  it('adiada ("Adiar") lembra na nova data, não na antiga', () => {
    const rent = {
      id: 'r1',
      title: 'Aluguel',
      rule: { type: 'monthly', dayOfMonth: 5 },
      time: '',
      notes: '',
      active: true,
      startDate: '2026-01-01',
      bill: true,
      moved: { '2026-11-05': '2026-11-08' },
    } as RecurringItem
    expect(keys({ ...empty(), recurring: [rent] }, on())).toEqual(['recurring:r1:2026-11-08:2:09:00'])
  })
})

describe('outros módulos', () => {
  it('meta financeira com prazo avisa; meta atingida não', () => {
    const g = {
      id: 'g1',
      createdAt: '',
      updatedAt: '',
      name: 'Viagem',
      target: 500000,
      saved: 100000,
      deadline: '2026-11-10',
      currency: 'BRL',
      note: '',
      status: 'active',
      history: [],
    } as FinanceGoal
    expect(keys({ ...empty(), financeGoals: [g] }, on())).toEqual(['fgoal:g1:2026-11-10:1:09:00'])
    expect(keys({ ...empty(), financeGoals: [{ ...g, saved: 500000 }] }, on())).toEqual([])
  })

  it('hábitos: no horário e um único lembrete à noite enquanto faltar algo', () => {
    const h = {
      id: 'h1',
      name: 'Ler',
      rule: { type: 'daily' },
      time: '18:00',
      goal: '',
      active: true,
      startDate: '2026-10-01',
    } as Habit
    const today = (d: DataState) => keys(d, on(), { days: 1 }).filter((k) => k.includes('2026-10-30'))
    expect(today({ ...empty(), habits: [h] })).toEqual(['habit:h1:2026-10-30T18:00:10', 'habits-open:2026-10-30'])
    const done = {
      id: 'habit:h1:2026-10-30',
      source: 'habit',
      sourceId: 'h1',
      date: '2026-10-30',
      status: 'done',
    } as Completion
    expect(today({ ...empty(), habits: [h], completions: [done] })).toEqual([])
  })

  it('modo foco: avisa quando a sessão do hábito chega à meta (pausada não)', () => {
    const h = {
      id: 'h1',
      name: 'Estudar',
      rule: { type: 'daily' },
      time: '',
      goal: '',
      active: true,
      startDate: '2026-10-01',
      minutes: 30,
    } as Habit
    const run = {
      habitId: 'h1',
      startedAt: '2026-10-30T11:50:00Z',
      elapsedMs: 10 * 60_000,
      runningSince: NOW.getTime(),
    }
    const occ = buildOccurrences({ ...empty(), habits: [h] }, on({ followUp: false }), { now: NOW, focus: run })
    expect(occ.map((o) => [o.kind, o.fireAt.toISOString()])).toEqual([['focus', '2026-10-30T12:20:00.000Z']])
    expect(
      buildOccurrences({ ...empty(), habits: [h] }, on({ followUp: false }), {
        now: NOW,
        focus: { ...run, runningSince: null },
      }),
    ).toEqual([])
  })

  it('fuso horário: o mesmo 15:00 é outro instante em Lisboa', () => {
    const sp = at({ ...empty(), tasks: [task()] }, on(), 'task:t1:2026-10-31T15:00:15')
    const lis = at({ ...empty(), tasks: [task()] }, on({}, { timeZone: 'Europe/Lisbon' }), 'task:t1:2026-10-31T15:00:15')
    expect(sp).toBe('2026-10-31T17:45:00.000Z')
    expect(lis).toBe('2026-10-31T14:45:00.000Z')
  })

  it('horário silencioso: o aviso espera o fim, com a mesma chave', () => {
    const t = task({ dueTime: '23:00' })
    const occ = buildOccurrences({ ...empty(), tasks: [t] }, on({ quiet: { from: '22:00', to: '07:00' }, followUp: false }), { now: NOW })
    expect(occ.map((o) => [o.key, o.fireAt.toISOString()])).toEqual([['task:t1:2026-10-31T23:00:15', '2026-11-01T10:00:00.000Z']])
  })

  it('módulo desligado não lembra', () => {
    expect(keys({ ...empty(), tasks: [task()] }, on({}, { modules: { ...ALL, tasks: false } }))).toEqual([])
  })

  it('nenhuma chave repetida, mesmo com tudo ligado em "antes e na hora"', () => {
    const d = {
      ...empty(),
      tasks: [task(), task({ id: 't2', dueTime: '' })],
      events: [event()],
      sales: [sale({ dueDate: '2026-11-02' })],
    }
    const k = keys(d, on({ when: 'both' }))
    expect(new Set(k).size).toBe(k.length)
  })
})
