/**
 * Recurrence is a rule, not stored rows: whether something happens on a date
 * is computed on demand. Only what the person marks (done/skipped) is saved,
 * one record per day (see core/completions.ts).
 */
import type { RecurrenceRule, Weekday } from '../data/types'
import { addDaysToDate, weekdayOfDate } from '../lib/zoned'

function lastDayOfMonth(date: string): number {
  const [y, m] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Does the rule produce an occurrence on `date` (from `startDate` on)? */
export function occursOn(rule: RecurrenceRule, startDate: string, date: string): boolean {
  if (startDate && date < startDate) return false
  switch (rule.type) {
    case 'daily':
      return true
    case 'weekdays':
      return rule.days.includes(weekdayOfDate(date))
    case 'monthly': {
      const day = Number(date.slice(8, 10))
      const want = Math.min(Math.max(1, rule.dayOfMonth), lastDayOfMonth(date))
      return day === want
    }
    case 'interval': {
      // Counted from the start date (the first occurrence); without one there is no anchor.
      if (!startDate) return false
      const step = Math.max(1, Math.round(rule.every)) * (rule.unit === 'week' ? 7 : 1)
      const diff = Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 864e5)
      return diff >= 0 && diff % step === 0
    }
    default:
      // A rule from a newer version of the app: nothing is shown rather than guessing.
      return false
  }
}

/** Occurrence dates between two dates (inclusive). Bounded: at most `max` days are scanned. */
export function occurrencesBetween(rule: RecurrenceRule, startDate: string, from: string, to: string, max = 400): string[] {
  const out: string[] = []
  let d = from
  for (let i = 0; i < max && d <= to; i++, d = addDaysToDate(d, 1)) {
    if (occursOn(rule, startDate, d)) out.push(d)
  }
  return out
}

export function nextOccurrence(rule: RecurrenceRule, startDate: string, from: string): string | null {
  return occurrencesBetween(rule, startDate, from, addDaysToDate(from, 366))[0] ?? null
}

const SHORT: Record<Weekday, string> = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sáb' }
const EVERY: Record<Weekday, string> = { 0: 'Todo domingo', 1: 'Toda segunda', 2: 'Toda terça', 3: 'Toda quarta', 4: 'Toda quinta', 5: 'Toda sexta', 6: 'Todo sábado' }

export function describeRule(rule: RecurrenceRule): string {
  switch (rule.type) {
    case 'daily':
      return 'Todos os dias'
    case 'weekdays': {
      const days = [...rule.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
      if (days.length === 7) return 'Todos os dias'
      if (days.length === 5 && !days.includes(0) && !days.includes(6)) return 'Dias úteis'
      if (days.length === 1) return EVERY[days[0]]
      return days.map((d) => SHORT[d]).join(', ')
    }
    case 'monthly':
      return `Todo dia ${rule.dayOfMonth}`
    case 'interval': {
      const n = Math.max(1, Math.round(rule.every))
      if (rule.unit === 'week') return n === 1 ? 'Toda semana' : `A cada ${n} semanas`
      return n === 1 ? 'Todos os dias' : `A cada ${n} dias`
    }
    default:
      return 'Repetição'
  }
}
