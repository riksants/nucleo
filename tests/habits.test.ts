import { describe, expect, it } from 'vitest'
import { completionId, indexCompletions } from '../src/core/completions'
import { habitHistory, habitsDue, recurringDue } from '../src/core/habits'
import type { Completion, Habit, RecurringItem } from '../src/data/types'

const habit = (over: Partial<Habit>): Habit => ({ id: 'h', createdAt: '', updatedAt: '', name: 'Água', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-09-01', ...over })
const done = (id: string, date: string, status: Completion['status'] = 'done'): Completion => ({ id: completionId('habit', id, date), createdAt: '', updatedAt: '', source: 'habit', sourceId: id, date, status })

describe('hábitos', () => {
  it('aparece só nos dias programados, ordenado por horário; desativado some', () => {
    const list = [
      habit({ id: 'a', name: 'Ler', time: '22:00' }),
      habit({ id: 'b', name: 'Treinar', rule: { type: 'weekdays', days: [1, 3, 5] }, time: '07:00' }),
      habit({ id: 'c', name: 'Meditar', active: false }),
    ]
    expect(habitsDue(list, '2026-10-05').map((h) => h.id)).toEqual(['b', 'a']) // segunda
    expect(habitsDue(list, '2026-10-06').map((h) => h.id)).toEqual(['a']) // terça
  })

  it('não aparece antes da data de criação', () => {
    expect(habitsDue([habit({ startDate: '2026-10-02' })], '2026-10-01')).toHaveLength(0)
  })

  it('conclusões em dias diferentes ficam separadas no histórico', () => {
    const h = habit({ id: 'h1', rule: { type: 'weekdays', days: [1, 2, 3, 4, 5] } })
    const idx = indexCompletions([done('h1', '2026-09-28'), done('h1', '2026-09-30', 'skipped')])
    const week = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
    expect(habitHistory(h, week, idx)).toEqual(['done', 'pending', 'skipped', 'pending', 'pending', 'off', 'off'])
  })

  it('recorrentes do dia usam a mesma regra', () => {
    const r: RecurringItem = { id: 'r', createdAt: '', updatedAt: '', title: 'Aluguel', rule: { type: 'monthly', dayOfMonth: 5 }, time: '', notes: '', active: true, startDate: '2026-01-01' }
    expect(recurringDue([r], '2026-10-05')).toHaveLength(1)
    expect(recurringDue([r], '2026-10-06')).toHaveLength(0)
  })
})
