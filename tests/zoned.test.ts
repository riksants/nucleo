import { describe, expect, it } from 'vitest'
import { addDaysToDate, wallClock, weekdayOfDate, zonedToInstant } from '../src/lib/zoned'

describe('fuso horário', () => {
  it('São Paulo (UTC−3, sem horário de verão)', () => {
    expect(zonedToInstant('2026-10-18', '07:30', 'America/Sao_Paulo').toISOString()).toBe('2026-10-18T10:30:00.000Z')
  })
  it('Dubai (UTC+4)', () => {
    expect(zonedToInstant('2026-10-18', '07:30', 'Asia/Dubai').toISOString()).toBe('2026-10-18T03:30:00.000Z')
  })
  it('Lisboa antes e depois da mudança de horário (25/out/2026)', () => {
    expect(zonedToInstant('2026-10-24', '09:00', 'Europe/Lisbon').toISOString()).toBe('2026-10-24T08:00:00.000Z')
    expect(zonedToInstant('2026-10-26', '09:00', 'Europe/Lisbon').toISOString()).toBe('2026-10-26T09:00:00.000Z')
  })
  it('horário inexistente (Nova York, 8/mar/2026 02:30) vai para depois do salto', () => {
    const d = zonedToInstant('2026-03-08', '02:30', 'America/New_York')
    expect(wallClock(d, 'America/New_York').time).toBe('03:30')
  })
  it('horário repetido (Nova York, 1/nov/2026 01:30) usa a primeira ocorrência', () => {
    expect(zonedToInstant('2026-11-01', '01:30', 'America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z')
  })
  it('o mesmo instante mostra dia/hora diferentes em fusos diferentes', () => {
    const d = new Date('2026-10-18T23:30:00Z')
    expect(wallClock(d, 'America/Sao_Paulo')).toMatchObject({ date: '2026-10-18', time: '20:30', weekday: 0 })
    expect(wallClock(d, 'Asia/Dubai')).toMatchObject({ date: '2026-10-19', time: '03:30', weekday: 1 })
  })
  it('aritmética de datas', () => {
    expect(addDaysToDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(weekdayOfDate('2026-10-01')).toBe(4)
  })
})
