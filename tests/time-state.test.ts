import { describe, expect, it } from 'vitest'
import type { AgendaItem } from '../src/core/agenda'
import { awaitingConfirmation, confirmQuestion, inWords, nextUp, timeState } from '../src/core/timeState'

const T = '2026-10-29'
const item = (over: Partial<AgendaItem>): AgendaItem =>
  ({ key: Math.random().toString(), kind: 'routine', date: T, start: '', end: '', title: 'Treino', status: 'pending', checkable: true, source: { kind: 'event' } as never, ...over }) as AgendaItem

describe('time states', () => {
  const treino = item({ start: '09:30', end: '10:30' })
  it('scheduled → now → awaiting, never done by the clock', () => {
    expect(timeState(treino, T, '09:00')).toBe('scheduled')
    expect(timeState(treino, T, '10:00')).toBe('now')
    expect(timeState(treino, T, '10:31')).toBe('awaiting')
    expect(timeState(treino, T, '23:59')).toBe('awaiting')
  })
  it('the person decides: done or not done', () => {
    expect(timeState({ ...treino, status: 'done' }, T, '08:00')).toBe('done')
    expect(timeState({ ...treino, status: 'skipped' }, T, '12:00')).toBe('missed')
  })
  it('appointments just end (nothing to confirm)', () => {
    const ev = item({ kind: 'event', start: '14:00', end: '', checkable: false })
    expect(timeState(ev, T, '14:30')).toBe('now')
    expect(timeState(ev, T, '15:01')).toBe('ended')
  })
  it('items without a time are "a qualquer hora" today, scheduled later, awaiting when the day passed', () => {
    expect(timeState(item({}), T, '12:00')).toBe('anytime')
    expect(timeState(item({ date: '2026-10-30' }), T, '12:00')).toBe('scheduled')
    expect(timeState(item({ date: '2026-10-28' }), T, '12:00')).toBe('awaiting')
  })
  it('a habit at 18:00 counts as in progress for 30 min', () => {
    const h = item({ kind: 'habit', start: '18:00' })
    expect(timeState(h, T, '18:20')).toBe('now')
    expect(timeState(h, T, '18:31')).toBe('awaiting')
  })
  it('overnight blocks last to the end of the day', () => {
    expect(timeState(item({ start: '23:00', end: '07:00' }), T, '23:30')).toBe('now')
  })
  it('next up: in progress first, else the next with a time', () => {
    const a = item({ title: 'A', start: '08:00', end: '09:00' })
    const b = item({ title: 'B', start: '11:00', end: '12:00' })
    expect(nextUp([a, b], T, '08:30')?.title).toBe('A')
    expect(nextUp([a, b], T, '09:30')?.title).toBe('B')
    expect(nextUp([a, b], T, '13:00')).toBeNull()
    expect(awaitingConfirmation([a, b], T, '13:00').map((i) => i.title)).toEqual(['B', 'A'])
  })
  it('words', () => {
    expect(inWords(25)).toBe('em 25 min')
    expect(inWords(130)).toBe('em 2 h 10')
    expect(confirmQuestion(treino)).toBe('Estava programado até 10:30. Você concluiu?')
  })
})
