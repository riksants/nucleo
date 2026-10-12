/** Calendar math on "YYYY-MM-DD" strings (no time zone involved). */

const pad = (n: number) => String(n).padStart(2, '0')

export const isDate = (s: string | undefined): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

export const dayOfDate = (date: string) => Number(date.slice(8, 10))

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** The `anchorDay` of the month `months` after `date`'s month (29–31 → last day of shorter months). */
export function shiftMonths(date: string, months: number, anchorDay: number): string {
  const total = Number(date.slice(0, 4)) * 12 + (Number(date.slice(5, 7)) - 1) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return `${year}-${pad(month)}-${pad(Math.min(anchorDay, lastDayOfMonth(year, month)))}`
}

/** "YYYY-MM" → the anchor day inside that month. */
export function dayInMonth(month: string, anchorDay: number): string {
  return shiftMonths(`${month}-01`, 0, anchorDay)
}

/**
 * Charge dates from `start` every `stepMonths`, keeping `anchorDay`.
 * `due`: those between `since` and `today` (inclusive), at most `max` — dates before `since` are
 * passed over without being charged. `next`: the first date after the last one passed over.
 */
export function cycleDates(start: string, anchorDay: number, stepMonths: number, since: string, today: string, max: number): { due: string[]; next: string } {
  const due: string[] = []
  let k = 0
  let date = start
  while (date <= today && due.length < max) {
    if (date >= since) due.push(date)
    k++
    date = shiftMonths(start, k * stepMonths, anchorDay)
  }
  return { due, next: date }
}
