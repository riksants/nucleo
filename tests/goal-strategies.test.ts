import { describe, expect, it } from 'vitest'
import { goalStrategies, nice125, niceCeil } from '../src/core/goalStrategies'

const TODAY = '2026-10-08'
const u = (units: number) => units * 100

describe('goal strategies', () => {
  it('nothing to plan when reached or the deadline is today/past', () => {
    expect(goalStrategies(0, TODAY, '2027-01-01')).toBeNull()
    expect(goalStrategies(u(100), TODAY, TODAY)).toBeNull()
    expect(goalStrategies(u(100), TODAY, '2026-10-01')).toBeNull()
  })

  it('uses only what is missing (meta 10.000, já tem 2.500 → 7.500 em 5 meses)', () => {
    const s = goalStrategies(u(10000) - u(2500), TODAY, '2027-03-09')!
    expect(s.missing).toBe(u(7500))
    expect(s.period).toBe('month')
    expect(s.periods).toBe(5)
    expect(s.save.perMonth).toBe(u(1502)) // 7.500 / (152 / 30,44) = 1.501,86 → 1.502, like the sentence
    expect(s.save.perDay).toBe(u(50))
    expect(s.sales.map((x) => [x.price, x.total, x.perPeriod])).toEqual([
      [u(100), 75, 15],
      [u(200), 38, 8],
      [u(1000), 8, 2],
    ])
    expect(s.services.map((x) => [x.count, x.price])).toEqual([
      [1, u(1500)],
      [2, u(750)],
      [4, u(380)],
    ])
    expect(s.recurring).toHaveLength(3)
  })

  it('every scenario reaches the goal (rounded up, never short)', () => {
    for (const [missing, deadline] of [
      [u(7500), '2027-03-09'],
      [u(300), '2027-01-08'],
      [u(200000), '2027-10-08'],
      [u(5000), '2026-10-25'],
      [u(1000), '2026-10-11'],
      [u(50), '2026-12-08'],
      [123457, '2027-06-30'],
    ] as const) {
      const s = goalStrategies(missing, TODAY, deadline)!
      if (s.save.perMonth) expect(s.save.perMonth * (s.daysLeft / 30.4375)).toBeGreaterThanOrEqual(missing)
      if (s.save.perWeek) expect(s.save.perWeek * Math.max(1, s.daysLeft / 7)).toBeGreaterThanOrEqual(missing)
      expect(s.save.perDay * s.daysLeft).toBeGreaterThanOrEqual(missing)
      for (const x of s.sales) {
        expect(x.price * x.total).toBeGreaterThanOrEqual(missing)
        if (x.perPeriod !== null) expect(x.perPeriod * s.periods).toBeGreaterThanOrEqual(x.total)
      }
      for (const x of s.recurring) expect(x.people * x.fee * s.recurringMonths).toBeGreaterThanOrEqual(missing)
      for (const x of s.services) expect(x.count * x.price * s.periods).toBeGreaterThanOrEqual(missing)
      // Whole currency units only.
      for (const c of [s.save.perDay, ...s.sales.map((x) => x.price), ...s.recurring.map((x) => x.fee), ...s.services.map((x) => x.price)]) expect(c % 100).toBe(0)
    }
  })

  it('example prices follow the size of the goal', () => {
    const small = goalStrategies(u(300), TODAY, '2027-01-08')!
    const big = goalStrategies(u(200000), TODAY, '2027-10-08')!
    expect(Math.max(...small.sales.map((x) => x.price))).toBeLessThanOrEqual(u(100))
    expect(Math.min(...big.sales.map((x) => x.price))).toBeGreaterThanOrEqual(u(500))
    expect(new Set(big.sales.map((x) => x.price)).size).toBe(big.sales.length)
  })

  it('adapts to a short deadline', () => {
    const weeks = goalStrategies(u(5000), TODAY, '2026-10-25')!
    expect(weeks.period).toBe('week')
    expect(weeks.save.perMonth).toBeNull()
    expect(weeks.save.perWeek).not.toBeNull()
    expect(weeks.recurring).toEqual([])

    const days = goalStrategies(u(1000), TODAY, '2026-10-11')!
    expect(days.period).toBe('total')
    expect(days.save.perWeek).toBeNull()
    expect(days.save.perDay).toBe(u(334))
    expect(days.sales.every((x) => x.perPeriod === null)).toBe(true)
  })

  it('a goal almost done only plans the little that is left', () => {
    const s = goalStrategies(u(40), TODAY, '2027-04-08')!
    expect(s.save.perMonth).toBe(u(7))
    expect(s.sales.every((x) => x.price <= u(40))).toBe(true)
  })

  it('friendly rounding', () => {
    expect(niceCeil(u(751))).toBe(u(760))
    expect(niceCeil(u(1501))).toBe(u(1600))
    expect(niceCeil(u(47.2))).toBe(u(48))
    expect(nice125(u(75))).toBe(u(100))
    expect(nice125(u(300))).toBe(u(200))
    expect(nice125(u(380))).toBe(u(500))
  })
})
