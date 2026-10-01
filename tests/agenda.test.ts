import { describe, expect, it } from 'vitest'
import { buildAgenda, tally } from '../src/core/agenda'
import { completionId } from '../src/core/completions'
import type { DataState, Settings } from '../src/data/types'

const empty = (): DataState => ({ transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [], inbox: [], habits: [], recurring: [], completions: [], events: [], focusSessions: [] })
const settings = (modules: Partial<Record<string, boolean>> = {}): Settings =>
  ({ onboarded: true, baseCurrency: 'BRL', initialBalance: 0, startedAt: '', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'America/Sao_Paulo', modules: { agenda: true, habits: true, recurring: true, routine: true, meals: true, ...modules } }) as Settings
const e = { createdAt: '', updatedAt: '' }
// Quinta, 1/out/2026, 15:00 em São Paulo
const NOW = new Date('2026-10-01T18:00:00Z')

function sample(): DataState {
  const d = empty()
  d.tasks = [
    { ...e, id: 't1', title: 'Dentista', projectId: null, dueDate: '2026-10-01', dueTime: '16:00', priority: 'none', status: 'todo', completedAt: null },
    { ...e, id: 't2', title: 'Pagar boleto', projectId: null, dueDate: '2026-10-01', priority: 'high', status: 'done', completedAt: 'x' },
    { ...e, id: 't3', title: 'Outro dia', projectId: null, dueDate: '2026-10-03', priority: 'none', status: 'todo', completedAt: null },
  ]
  d.events = [
    { ...e, id: 'e1', title: 'Reunião', date: '2026-10-01', start: '09:00', end: '10:00', notes: '' },
    { ...e, id: 'e2', title: 'Jantar', date: '2026-10-01', start: '20:00', end: '22:00', notes: '' },
  ]
  d.habits = [{ ...e, id: 'h1', name: 'Água', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-09-01' }]
  d.recurring = [{ ...e, id: 'r1', title: 'Lavar roupa', rule: { type: 'weekdays', days: [4] }, time: '19:00', notes: '', active: true, startDate: '2026-09-01' }]
  d.routinePlans = [
    {
      ...e,
      id: 'routine-current',
      status: 'approved',
      source: 'manual',
      notes: '',
      done: { '2026-10-01': ['b1'] },
      blocks: [
        { id: 'b1', day: 4, start: '07:00', end: '08:00', title: 'Musculação', kind: 'training', fixed: true },
        { id: 'b2', day: 4, start: '12:00', end: '13:00', title: 'Almoço', kind: 'meal', fixed: true },
      ],
    },
  ]
  d.completions = [{ ...e, id: completionId('habit', 'h1', '2026-10-01'), source: 'habit', sourceId: 'h1', date: '2026-10-01', status: 'done' }]
  return d
}

describe('agenda (camada de visualização)', () => {
  it('junta todas as fontes do dia, em ordem, sem gravar nada', () => {
    const data = sample()
    const before = JSON.stringify(data)
    const items = buildAgenda(data, settings(), '2026-10-01', '2026-10-01', NOW)
    expect(items.map((i) => `${i.start || '—'} ${i.kind} ${i.title}`)).toEqual([
      '— habit Água',
      '— task Pagar boleto',
      '07:00 routine Musculação',
      '09:00 event Reunião',
      '12:00 routine Almoço',
      '16:00 task Dentista',
      '19:00 recurring Lavar roupa',
      '20:00 event Jantar',
    ])
    expect(JSON.stringify(data)).toBe(before)
  })

  it('estado vem da origem: tarefa feita, hábito marcado, rotina antiga marcada', () => {
    const items = buildAgenda(sample(), settings(), '2026-10-01', '2026-10-01', NOW)
    const by = (title: string) => items.find((i) => i.title === title)!
    expect(by('Pagar boleto').status).toBe('done')
    expect(by('Água').status).toBe('done')
    expect(by('Musculação').status).toBe('done')
    expect(by('Lavar roupa').status).toBe('pending')
  })

  it('compromisso com horário passado fica "encerrado" e NÃO conta como concluído', () => {
    const items = buildAgenda(sample(), settings(), '2026-10-01', '2026-10-01', NOW)
    expect(items.find((i) => i.title === 'Reunião')!.status).toBe('ended')
    expect(items.find((i) => i.title === 'Jantar')!.status).toBe('pending')
    const t = tally(items)
    expect(t.events).toBe(2)
    expect(t.done).toBe(3) // boleto, água, musculação — nunca a reunião
    expect(t.total).toBe(6) // compromissos e refeições não entram
  })

  it('seções escondidas não aparecem na agenda', () => {
    const items = buildAgenda(sample(), settings({ habits: false, routine: false, tasks: false }), '2026-10-01', '2026-10-01', NOW)
    expect(items.some((i) => i.kind === 'habit' || i.kind === 'routine' || i.kind === 'task')).toBe(false)
  })

  it('refeição da rotina não duplica quando há plano alimentar', () => {
    const data = sample()
    data.mealPlans = [{ ...e, id: 'meals-current', status: 'approved', source: 'manual', notes: '', removed: [], shopping: [], meals: [{ id: 'm1', day: 4, time: '12:30', label: 'Almoço', items: [], substitutions: [] }] }]
    const items = buildAgenda(data, settings(), '2026-10-01', '2026-10-01', NOW)
    expect(items.filter((i) => i.title === 'Almoço').map((i) => i.kind)).toEqual(['meal'])
  })

  it('semana: cada dia com seus itens; recorrente semanal aparece uma vez', () => {
    const items = buildAgenda(sample(), settings(), '2026-09-28', '2026-10-04', NOW)
    expect(items.filter((i) => i.title === 'Lavar roupa').map((i) => i.date)).toEqual(['2026-10-01'])
    expect(items.filter((i) => i.title === 'Água')).toHaveLength(7)
    expect(items.find((i) => i.title === 'Outro dia')!.date).toBe('2026-10-03')
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length)
  })

  it('"hoje" e "horário encerrado" seguem o fuso escolhido', () => {
    // 18:00 UTC = 15:00 em SP, mas já 22:00 em Dubai → em Dubai a reunião e o jantar (até 22:00) acabaram
    const items = buildAgenda(sample(), { ...settings(), timeZone: 'Asia/Dubai' }, '2026-10-01', '2026-10-01', NOW)
    expect(items.find((i) => i.title === 'Jantar')!.status).toBe('ended')
  })

  it('rotina e plano alimentar só valem a partir do dia em que foram criados', () => {
    const data = sample()
    data.routinePlans[0] = { ...data.routinePlans[0], createdAt: '2026-10-02T12:00:00Z' }
    expect(buildAgenda(data, settings(), '2026-10-01', '2026-10-01', NOW).some((i) => i.kind === 'routine')).toBe(false)
    expect(buildAgenda(data, settings(), '2026-10-08', '2026-10-08', NOW).some((i) => i.kind === 'routine')).toBe(true)
  })
})
