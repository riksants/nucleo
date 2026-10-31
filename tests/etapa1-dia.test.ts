// Etapa 1 do dia a dia: recorrências (término, pausa, "só esta", "esta e as próximas", a cada N), vínculo
// hábito ↔ recorrente/rotina, rotina "Horário encerrado", prioridades do Início e lembretes que acompanham tudo.
import { describe, expect, it } from 'vitest'
import { buildAgenda } from '../src/core/agenda'
import { completionId } from '../src/core/completions'
import { habitHostOn } from '../src/core/habitLink'
import { endRecurring, nextRecurring, recurringDue, recurringOn, recurringState, rescheduleOccurrence, splitRecurring } from '../src/core/habits'
import { homeFocus } from '../src/core/homeFocus'
import { describeRule, occursOn } from '../src/core/recurrence'
import { timeState } from '../src/core/timeState'
import { buildOccurrences } from '../src/features/reminders/engine'
import type { Completion, DataState, Habit, RecurringItem, RoutinePlan, Settings, Task } from '../src/data/types'

const empty = (): DataState =>
  ({ transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [], inbox: [], habits: [], recurring: [], completions: [], events: [], focusSessions: [], automationRuns: [], financeGoals: [], lifePlans: [], planSteps: [], meals: [] }) as unknown as DataState
const MODULES = { agenda: true, tasks: true, habits: true, recurring: true, routine: true, today: true, meals: false, finance: false, tools: false, sales: false, subscribers: false, projects: false }
const settings = (over: Partial<Settings> = {}): Settings =>
  ({ onboarded: true, baseCurrency: 'BRL', initialBalance: 0, startedAt: '', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'America/Sao_Paulo', modules: MODULES, reminders: { showDetails: true, rules: {}, on: true }, ...over }) as Settings
const e = { createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
// Sexta, 30/out/2026, 09:00 em São Paulo.
const NOW = new Date('2026-10-30T12:00:00Z')
const TODAY = '2026-10-30'

const rec = (over: Partial<RecurringItem> = {}): RecurringItem => ({ ...e, id: 'r1', title: 'Estudar inglês', rule: { type: 'weekdays', days: [1, 3, 5] }, time: '19:00', notes: '', active: true, startDate: '2026-10-01', ...over })
const habit = (over: Partial<Habit> = {}): Habit => ({ ...e, id: 'h1', name: 'Estudar', rule: { type: 'daily' }, time: '19:00', goal: '', active: true, startDate: '2026-10-01', ...over })
const done = (source: Completion['source'], id: string, date: string, via?: string): Completion => ({ ...e, id: completionId(source, id, date), source, sourceId: id, date, status: 'done', ...(via ? { via } : {}) })
const reminderKeys = (d: DataState, s = settings(), days = 14) => buildOccurrences(d, s, { now: NOW, days }).map((o) => o.key)

describe('recorrência: a cada N, término, pausa', () => {
  it('"a cada 2 semanas" e "a cada 3 dias", contados do início', () => {
    const every2w = { type: 'interval', every: 2, unit: 'week' } as const
    expect(occursOn(every2w, '2026-10-02', '2026-10-02')).toBe(true)
    expect(occursOn(every2w, '2026-10-02', '2026-10-09')).toBe(false)
    expect(occursOn(every2w, '2026-10-02', '2026-10-16')).toBe(true)
    expect(occursOn({ type: 'interval', every: 3, unit: 'day' }, '2026-10-01', '2026-10-04')).toBe(true)
    expect(occursOn({ type: 'interval', every: 3, unit: 'day' }, '2026-10-01', '2026-10-05')).toBe(false)
    expect(describeRule(every2w)).toBe('A cada 2 semanas')
  })

  it('regra desconhecida (versão nova do app) não aparece em vez de quebrar', () => {
    expect(occursOn({ type: 'futuro' } as never, '2026-10-01', '2026-10-05')).toBe(false)
  })

  it('data de término: nada depois dela, nem lembrete', () => {
    const r = rec({ endDate: '2026-11-02' })
    expect(recurringOn(r, '2026-11-02')).toBe(true)
    expect(recurringOn(r, '2026-11-04')).toBe(false)
    expect(nextRecurring(r, '2026-11-03')).toBeNull()
    const d = empty()
    d.recurring = [r]
    const ks = reminderKeys(d)
    expect(ks.some((k) => k.includes('2026-11-02T19:00'))).toBe(true)
    expect(ks.some((k) => k.includes('2026-11-04'))).toBe(false)
  })

  it('Encerrar: o dia de hoje fica se já foi marcado; senão termina ontem', () => {
    expect(endRecurring(rec(), TODAY, true).endDate).toBe(TODAY)
    expect(endRecurring(rec(), TODAY, false).endDate).toBe('2026-10-29')
    expect(recurringState(endRecurring(rec(), TODAY, false), TODAY)).toBe('ended')
  })

  it('pausado: some do dia e dos lembretes; retomado volta igual', () => {
    const d = empty()
    d.recurring = [rec({ active: false })]
    expect(buildAgenda(d, settings(), TODAY, TODAY, NOW)).toHaveLength(0)
    expect(reminderKeys(d)).toHaveLength(0)
    expect(recurringState(d.recurring[0], TODAY)).toBe('paused')
    d.recurring = [rec({ active: true })]
    expect(buildAgenda(d, settings(), TODAY, TODAY, NOW)).toHaveLength(1)
  })

  it('itens antigos (sem os campos novos) continuam exatamente iguais', () => {
    const d = empty()
    d.recurring = [rec()]
    const [item] = buildAgenda(d, settings(), TODAY, TODAY, NOW)
    expect(item).toMatchObject({ key: `recurring:r1:${TODAY}`, start: '19:00', status: 'pending' })
  })
})

describe('"só esta" e "esta e as próximas"', () => {
  it('só esta: muda o horário de uma ocorrência; as outras e a regra ficam', () => {
    const r = rescheduleOccurrence(rec(), TODAY, { date: TODAY, time: '20:30' }, TODAY)
    expect(r.rule).toEqual(rec().rule)
    expect(r.time).toBe('19:00')
    const d = empty()
    d.recurring = [r]
    const items = buildAgenda(d, settings(), TODAY, '2026-11-02', NOW)
    expect(items.map((i) => `${i.date} ${i.start}`)).toEqual([`${TODAY} 20:30`, '2026-11-02 19:00'])
  })

  it('só esta, para outro dia: aparece uma vez, no dia novo', () => {
    const r = rescheduleOccurrence(rec(), TODAY, { date: '2026-10-31', time: '10:00' }, TODAY)
    const d = empty()
    d.recurring = [r]
    const items = buildAgenda(d, settings(), TODAY, '2026-10-31', NOW)
    expect(items.map((i) => `${i.date} ${i.start}`)).toEqual(['2026-10-31 10:00'])
  })

  it('push acompanha: o aviso antigo some e o novo entra, sem duplicar', () => {
    const d = empty()
    d.recurring = [rec()]
    const before = reminderKeys(d, settings(), 3)
    d.recurring = [rescheduleOccurrence(rec(), TODAY, { date: TODAY, time: '20:30' }, TODAY)]
    const after = reminderKeys(d, settings(), 3)
    expect(before.some((k) => k.startsWith(`recurring:r1:${TODAY}T19:00`))).toBe(true)
    expect(after.some((k) => k.startsWith(`recurring:r1:${TODAY}T19:00`))).toBe(false)
    expect(after.filter((k) => k.startsWith(`recurring:r1:${TODAY}T20:30`)).length).toBeGreaterThan(0)
    expect(new Set(after).size).toBe(after.length)
  })

  it('esta e as próximas: o item termina na véspera e uma continuação começa; nenhum dia aparece duas vezes', () => {
    const split = splitRecurring(rec(), '2026-11-02', { time: '18:00' })!
    expect(split.ended.endDate).toBe('2026-11-01')
    expect(split.next).toMatchObject({ startDate: '2026-11-02', time: '18:00', title: 'Estudar inglês' })
    const d = empty()
    d.recurring = [split.ended, { ...split.next, ...e, id: 'r2' } as RecurringItem]
    const items = buildAgenda(d, settings(), TODAY, '2026-11-06', NOW)
    expect(items.map((i) => `${i.date} ${i.start} ${i.source.kind === 'recurring' ? i.source.item.id : ''}`)).toEqual([`${TODAY} 19:00 r1`, '2026-11-02 18:00 r2', '2026-11-04 18:00 r2', '2026-11-06 18:00 r2'])
    // Reminders: the old item stops, the new one goes on (one per day).
    const ks = reminderKeys(d, settings(), 8).filter((k) => k.startsWith('recurring:'))
    expect(ks.some((k) => k.startsWith('recurring:r1:2026-11-02'))).toBe(false)
    expect(ks.some((k) => k.startsWith('recurring:r2:2026-11-02T18:00'))).toBe(true)
  })

  it('esta e as próximas no primeiro dia: muda o próprio item (sem dividir)', () => {
    expect(splitRecurring(rec(), '2026-10-01', { time: '18:00' })).toBeNull()
  })

  it('aviso "N min antes" do próprio item', () => {
    const d = empty()
    d.recurring = [rec({ remindMin: 15 })]
    const o = buildOccurrences(d, settings(), { now: NOW, days: 1 }).find((x) => x.key === `recurring:r1:${TODAY}T19:00:15`)
    expect(o?.fireAt.toISOString()).toBe('2026-10-30T21:45:00.000Z') // 18:45 em São Paulo
  })

  it('ocorrência concluída não avisa; concluir uma não encerra a regra', () => {
    const d = empty()
    d.recurring = [rec()]
    d.completions = [done('recurring', 'r1', TODAY)]
    const ks = reminderKeys(d, settings(), 5)
    expect(ks.some((k) => k.startsWith(`recurring:r1:${TODAY}`))).toBe(false)
    expect(ks.some((k) => k.startsWith('recurring:r1:2026-11-02'))).toBe(true)
    expect(recurringDue(d.recurring, '2026-11-02')).toHaveLength(1)
  })
})

describe('hábito vinculado: uma linha só', () => {
  it('no dia do recorrente vinculado, o hábito vai junto na mesma linha', () => {
    const d = empty()
    d.recurring = [rec()]
    d.habits = [habit({ link: { kind: 'recurring', id: 'r1' } })]
    const items = buildAgenda(d, settings(), TODAY, TODAY, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].habits?.map((h) => h.habit.id)).toEqual(['h1'])
    expect(habitHostOn(d, settings(), d.habits[0], TODAY)).toBe(`recurring:r1:${TODAY}`)
    // Saturday: no recurring that day, the habit shows on its own.
    const sat = buildAgenda(d, settings(), '2026-10-31', '2026-10-31', NOW)
    expect(sat.map((i) => i.kind)).toEqual(['habit'])
  })

  it('o estado do hábito vem das conclusões dele (marcado junto ou não)', () => {
    const d = empty()
    d.recurring = [rec()]
    d.habits = [habit({ link: { kind: 'recurring', id: 'r1' } })]
    d.completions = [done('recurring', 'r1', TODAY), done('habit', 'h1', TODAY, `recurring:r1:${TODAY}`)]
    const [item] = buildAgenda(d, settings(), TODAY, TODAY, NOW)
    expect(item.status).toBe('done')
    expect(item.habits?.[0].status).toBe('done')
  })

  it('sem aviso duplicado: o recorrente avisa, o hábito vinculado não', () => {
    const d = empty()
    d.recurring = [rec()]
    d.habits = [habit({ link: { kind: 'recurring', id: 'r1' } })]
    const ks = reminderKeys(d, settings(), 1)
    expect(ks.some((k) => k.startsWith(`recurring:r1:${TODAY}T19:00`))).toBe(true)
    expect(ks.some((k) => k.startsWith(`habit:h1:${TODAY}`))).toBe(false)
  })

  it('vínculo com o treino da rotina', () => {
    const d = empty()
    d.routinePlans = [{ ...e, id: 'routine-current', status: 'approved', source: 'manual', notes: '', done: {}, blocks: [{ id: 'b1', day: 5, start: '07:00', end: '08:00', title: 'Treino', kind: 'training', fixed: false }] } as RoutinePlan]
    d.habits = [habit({ id: 'h2', name: 'Treinar', time: '07:00', link: { kind: 'routine', blockKind: 'training' } })]
    const items = buildAgenda(d, settings(), TODAY, TODAY, NOW)
    expect(items.map((i) => i.kind)).toEqual(['routine'])
    expect(items[0].habits?.[0].habit.name).toBe('Treinar')
  })

  it('lembrete do hábito pode ser desligado só para ele', () => {
    const d = empty()
    d.habits = [habit({ remind: false }), habit({ id: 'h3', name: 'Ler', time: '21:00' })]
    const ks = reminderKeys(d, settings(), 1)
    expect(ks.some((k) => k.startsWith('habit:h1:'))).toBe(false)
    expect(ks.some((k) => k.startsWith('habit:h3:'))).toBe(true)
  })

  it('hábito nunca é concluído pelo relógio', () => {
    const d = empty()
    d.habits = [habit({ time: '07:00' })]
    const [item] = buildAgenda(d, settings(), TODAY, TODAY, NOW)
    expect(item.status).toBe('pending')
    expect(timeState(item, TODAY, '09:00')).toBe('awaiting')
  })
})

describe('rotina: "Horário encerrado" sem pedir confirmação', () => {
  const plan = { ...e, id: 'routine-current', status: 'approved', source: 'manual', notes: '', done: {}, blocks: [{ id: 'b1', day: 5, start: '07:00', end: '08:00', title: 'Treino', kind: 'training', fixed: false }] } as RoutinePlan
  it('depois do fim: encerrado (não "aguardando"), nunca concluído', () => {
    const d = empty()
    d.routinePlans = [plan]
    const [item] = buildAgenda(d, settings(), TODAY, TODAY, NOW)
    expect(item.status).toBe('pending')
    expect(timeState(item, TODAY, '09:00')).toBe('ended')
    expect(timeState(item, TODAY, '07:30')).toBe('now')
  })
  it('conclusão manual continua valendo', () => {
    const d = empty()
    d.routinePlans = [plan]
    d.completions = [done('routine', 'b1', TODAY)]
    const [item] = buildAgenda(d, settings(), TODAY, TODAY, NOW)
    expect(timeState(item, TODAY, '09:00')).toBe('done')
  })
})

describe('Início: o que importa agora', () => {
  const t = (over: Partial<Task>): Task => ({ ...e, id: 't1', title: 'Tarefa', projectId: null, dueDate: TODAY, priority: 'none', status: 'todo', completedAt: null, ...over })

  it('compromisso em breve vem primeiro; tarefa atrasada em seguida; nada repetido', () => {
    const d = empty()
    d.events = [{ ...e, id: 'ev', title: 'Dentista', date: TODAY, start: '10:00', end: '11:00', notes: '' }]
    d.tasks = [t({ id: 'late', title: 'Enviar proposta', dueDate: '2026-10-28' }), t({ id: 'today', title: 'Ligar para o banco', dueTime: '10:00' })]
    const f = homeFocus(d, settings(), NOW)
    expect(f.lead).toMatchObject({ tone: 'soon', title: 'Dentista', label: 'Em 1 h' })
    expect(f.lines.map((l) => l.title)).toEqual(['Enviar proposta', 'Ligar para o banco'])
    const keys = [f.lead!.key, ...f.lines.map((l) => l.key)]
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('no máximo 1 destaque e 3 linhas', () => {
    const d = empty()
    d.tasks = Array.from({ length: 8 }, (_, i) => t({ id: `t${i}`, title: `T${i}` }))
    const f = homeFocus(d, settings(), NOW)
    expect(f.lead).not.toBeNull()
    expect(f.lines.length).toBeLessThanOrEqual(3)
  })

  it('sem pendências: limpo', () => {
    const f = homeFocus(empty(), settings(), NOW)
    expect(f).toMatchObject({ lead: null, lines: [], clear: true })
  })

  it('concluído em outra tela some do Início', () => {
    const d = empty()
    d.tasks = [t({ status: 'done', completedAt: 'x' })]
    expect(homeFocus(d, settings(), NOW).lead).toBeNull()
  })

  it('fuso: o "hoje" é o do fuso escolhido', () => {
    // 02:30 UTC de 31/out = 23:30 de 30/out em São Paulo, mas 02:30 de 31/out em Lisboa.
    const late = new Date('2026-10-31T02:30:00Z')
    const d = empty()
    d.tasks = [t({ title: 'Do dia 30', dueDate: TODAY })]
    expect(homeFocus(d, settings(), late).lead?.label).toBe('Hoje')
    expect(homeFocus(d, settings({ timeZone: 'Europe/Lisbon' }), late).lead?.label).toBe('Atrasada')
  })
})

describe('"esta e as próximas" troca também os horários avulsos seguintes', () => {
  it('um horário "só esta" depois da divisão não sobrevive à mudança de todas as próximas', () => {
    const withOne = rescheduleOccurrence(rec(), '2026-11-04', { date: '2026-11-04', time: '21:00' }, TODAY)
    const split = splitRecurring(withOne, '2026-11-02', { time: '18:00' })!
    expect(split.next.times).toBeUndefined()
    const d = empty()
    d.recurring = [split.ended, { ...split.next, ...e, id: 'r2' } as RecurringItem]
    expect(buildAgenda(d, settings(), '2026-11-04', '2026-11-04', NOW).map((i) => i.start)).toEqual(['18:00'])
  })
})
