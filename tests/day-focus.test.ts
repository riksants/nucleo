import { describe, expect, it } from 'vitest'
import { completionId } from '../src/core/completions'
import { moneyDueOn, morningSentence, nightSentence, planDay } from '../src/core/day'
import { elapsed, formatClock, pause, resume, start } from '../src/features/focus/timer'
import type { DataState, Settings } from '../src/data/types'

const empty = (): DataState => ({ transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [], inbox: [], habits: [], recurring: [], completions: [], events: [], focusSessions: [] })
const settings = { onboarded: true, baseCurrency: 'BRL', initialBalance: 0, startedAt: '', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'America/Sao_Paulo', modules: { agenda: true, habits: true, recurring: true, routine: true, sales: true } } as Settings
const e = { createdAt: '', updatedAt: '' }
const MORNING = new Date('2026-10-01T10:00:00Z') // 07:00 SP
const task = (id: string, over: object) => ({ ...e, id, title: id, projectId: null, dueDate: '', priority: 'none', status: 'todo', completedAt: null, ...over }) as DataState['tasks'][number]

function data(): DataState {
  const d = empty()
  d.tasks = [
    task('Relatório', { dueDate: '2026-10-01', priority: 'high' }),
    task('Mercado', { dueDate: '2026-10-01' }),
    task('Ligar banco', { dueDate: '2026-10-01', status: 'done', completedAt: 'x' }),
    task('Atrasada', { dueDate: '2026-09-28' }),
    task('Urgente sem data', { priority: 'high' }),
  ]
  d.events = [{ ...e, id: 'e1', title: 'Reunião', date: '2026-10-01', start: '16:00', end: '17:00', notes: '' }]
  d.habits = ['Água', 'Ler', 'Meditar', 'Alongar'].map((name, i) => ({ ...e, id: `h${i}`, name, rule: { type: 'daily' as const }, time: '', goal: '', active: true, startDate: '2026-01-01' }))
  d.completions = [
    { ...e, id: completionId('habit', 'h0', '2026-10-01'), source: 'habit', sourceId: 'h0', date: '2026-10-01', status: 'done' },
    { ...e, id: completionId('habit', 'h3', '2026-10-01'), source: 'habit', sourceId: 'h3', date: '2026-10-01', status: 'skipped' },
  ]
  d.sales = [{ ...e, id: 's1', clientId: null, clientName: 'Ana', product: 'Bolo', quantity: 1, date: '2026-09-20', total: 10000, currency: 'BRL', dueDate: '2026-10-01', payments: [{ id: 'p', date: '2026-09-20', amount: 4000, note: '' }], notes: '' }]
  return d
}

describe('Modo Manhã', () => {
  it('resumo em uma frase com tarefas, compromisso e hábitos', () => {
    const plan = planDay(data(), settings, MORNING)
    expect(morningSentence(plan)).toBe('Hoje você tem 2 tarefas, 1 compromisso às 16h e 2 hábitos para concluir.')
  })

  it('prioridades (alta primeiro, sem repetir), atrasadas e cobranças do dia', () => {
    const plan = planDay(data(), settings, MORNING)
    expect(plan.priorities.map((t) => t.title)).toEqual(['Relatório', 'Urgente sem data', 'Mercado'])
    expect(plan.overdue.map((t) => t.title)).toEqual(['Atrasada'])
    expect(plan.money).toEqual([expect.objectContaining({ title: 'Bolo', cents: 6000, direction: 'receive' })])
  })

  it('dia livre tem uma frase gentil', () => {
    expect(morningSentence(planDay(empty(), settings, MORNING))).toMatch(/livre/)
  })

  it('cobranças só aparecem com a seção ligada', () => {
    expect(moneyDueOn(data(), { ...settings, modules: { ...settings.modules, sales: false } }, '2026-10-01', MORNING)).toEqual([])
  })
})

describe('Modo Noite', () => {
  it('"X de Y" conta concluídos; pulados ficam fora da conta (sem julgamento)', () => {
    const plan = planDay(data(), settings, new Date('2026-10-01T23:00:00Z'))
    // checáveis: 3 tarefas do dia + 4 hábitos = 7; 1 pulado → 6 considerados; feitos: tarefa + Água = 2
    expect(nightSentence(plan)).toBe('Seu dia terminou com 2 de 6 itens concluídos.')
    expect(plan.counts.events).toBe(1) // compromisso nunca entra como concluído
  })
})

describe('cronômetro do foco', () => {
  it('soma o tempo entre pausas e continua de onde parou', () => {
    let t = start('t1', 0)
    t = pause(t, 60_000)
    expect(elapsed(t, 999_999)).toBe(60_000) // pausado não conta
    t = resume(t, 100_000)
    expect(elapsed(t, 130_000)).toBe(90_000)
    expect(formatClock(90_000)).toBe('01:30')
    expect(formatClock(3_725_000)).toBe('1:02:05')
  })

  it('o estado é serializável (sobrevive a sair da tela/recarregar)', () => {
    const t = pause(start('t1', 0), 5_000)
    expect(JSON.parse(JSON.stringify(t))).toEqual(t)
  })
})
