import { describe, expect, it } from 'vitest'
import { completionId, indexCompletions, routineStatus, statusOf } from '../src/core/completions'
import { nowIn, todayIn, weekDates, weekStart } from '../src/core/period'
import { describeRule, nextOccurrence, occurrencesBetween, occursOn } from '../src/core/recurrence'
import type { Completion } from '../src/data/types'

describe('dia e semana no fuso do usuário', () => {
  it('o mesmo instante é "hoje" diferente em fusos diferentes (troca de dia)', () => {
    const instant = new Date('2026-10-01T23:30:00Z')
    expect(todayIn('America/Sao_Paulo', instant)).toBe('2026-10-01') // 20:30
    expect(todayIn('Asia/Dubai', instant)).toBe('2026-10-02') // 03:30
    expect(todayIn('Europe/Lisbon', new Date('2026-10-01T22:59:00Z'))).toBe('2026-10-01')
    expect(todayIn('Europe/Lisbon', new Date('2026-10-01T23:00:00Z'))).toBe('2026-10-02')
  })

  it('hora local para o Modo Manhã (antes do meio-dia no fuso)', () => {
    expect(nowIn('America/Sao_Paulo', new Date('2026-10-01T14:59:00Z')).hour).toBe(11)
    expect(nowIn('America/Sao_Paulo', new Date('2026-10-01T15:00:00Z')).hour).toBe(12)
  })

  it('semana começa na segunda e vira no domingo → segunda', () => {
    expect(weekStart('2026-10-01')).toBe('2026-09-28') // quinta
    expect(weekStart('2026-10-04')).toBe('2026-09-28') // domingo
    expect(weekStart('2026-10-05')).toBe('2026-10-05') // segunda
    expect(weekDates('2026-12-30')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03'])
  })
})

describe('recorrência calculada (sem registros futuros)', () => {
  it('diária respeita a data de início', () => {
    expect(occursOn({ type: 'daily' }, '2026-10-01', '2026-09-30')).toBe(false)
    expect(occurrencesBetween({ type: 'daily' }, '2026-10-01', '2026-09-29', '2026-10-03')).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
  })

  it('semanal / dias específicos', () => {
    const tuesday = { type: 'weekdays' as const, days: [2 as const] }
    expect(occurrencesBetween(tuesday, '', '2026-10-01', '2026-10-31')).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'])
    expect(occurrencesBetween({ type: 'weekdays', days: [1, 3, 5] }, '', '2026-10-05', '2026-10-11')).toEqual(['2026-10-05', '2026-10-07', '2026-10-09'])
    expect(describeRule(tuesday)).toBe('Toda terça')
  })

  it('mensal: dia 5 todo mês; dia 31 cai no último dia dos meses curtos', () => {
    expect(occurrencesBetween({ type: 'monthly', dayOfMonth: 5 }, '', '2026-10-01', '2026-12-31')).toEqual(['2026-10-05', '2026-11-05', '2026-12-05'])
    expect(occurrencesBetween({ type: 'monthly', dayOfMonth: 31 }, '', '2027-01-01', '2027-04-30')).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
    expect(nextOccurrence({ type: 'monthly', dayOfMonth: 5 }, '', '2026-10-06')).toBe('2026-11-05')
  })
})

describe('conclusões por dia', () => {
  const c = (source: Completion['source'], sourceId: string, date: string, status: Completion['status']): Completion => ({ id: completionId(source, sourceId, date), createdAt: '', updatedAt: '', source, sourceId, date, status })

  it('concluir numa terça não marca as próximas terças', () => {
    const idx = indexCompletions([c('recurring', 'r1', '2026-10-06', 'done')])
    expect(statusOf(idx, 'recurring', 'r1', '2026-10-06')).toBe('done')
    expect(statusOf(idx, 'recurring', 'r1', '2026-10-13')).toBe('pending')
  })

  it('pulado é registrado como pulado, nunca como concluído', () => {
    const idx = indexCompletions([c('habit', 'h1', '2026-10-01', 'skipped')])
    expect(statusOf(idx, 'habit', 'h1', '2026-10-01')).toBe('skipped')
  })

  it('id fixo: marcar o mesmo item no mesmo dia em dois aparelhos vira um registro só', () => {
    expect(completionId('habit', 'h1', '2026-10-01')).toBe(completionId('habit', 'h1', '2026-10-01'))
    expect(indexCompletions([c('habit', 'h1', '2026-10-01', 'done'), c('habit', 'h1', '2026-10-01', 'done')]).size).toBe(1)
  })

  it('rotina: lê marcações antigas do plano e as novas por dia (a nova prevalece)', () => {
    const plan = { done: { '2026-10-01': ['b1'] } }
    expect(routineStatus(indexCompletions([]), plan, 'b1', '2026-10-01')).toBe('done')
    expect(routineStatus(indexCompletions([c('routine', 'b2', '2026-10-01', 'done')]), plan, 'b2', '2026-10-01')).toBe('done')
    expect(routineStatus(indexCompletions([c('routine', 'b1', '2026-10-01', 'skipped')]), plan, 'b1', '2026-10-01')).toBe('skipped')
  })
})
