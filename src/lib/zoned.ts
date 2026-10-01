/**
 * Wall-clock times in a chosen IANA time zone ("America/Sao_Paulo", "Asia/Dubai").
 * Reminders are stored as absolute instants, computed from the person's zone,
 * so they fire at the right local time even when the device is elsewhere.
 */

const formatters = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(tz: string) {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    formatters.set(tz, f)
  }
  return f
}

export function isValidTimeZone(tz: string): boolean {
  try {
    partsFormatter(tz)
    return true
  } catch {
    return false
  }
}

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Local date, time and weekday of an instant in a zone. */
export function wallClock(instant: Date, tz: string) {
  const parts = Object.fromEntries(partsFormatter(tz).formatToParts(instant).map((p) => [p.type, p.value]))
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: WEEKDAYS[parts.weekday] as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    ms: Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second),
  }
}

/** Offset (ms) of the zone at an instant: local wall time minus UTC. */
function offsetAt(instant: number, tz: string): number {
  const rounded = Math.floor(instant / 1000) * 1000
  return wallClock(new Date(rounded), tz).ms - rounded
}

/**
 * "2026-10-18" + "07:30" in `tz` → the instant. Times that don't exist (clock
 * jumps forward) move to the first valid minute after; repeated times use the first one.
 */
export function zonedToInstant(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const asUtc = Date.UTC(y, m - 1, d, h, mi)
  // The zone has at most two offsets around any day: the one before and after a change.
  const before = offsetAt(asUtc - 12 * 3600_000, tz)
  const after = offsetAt(asUtc + 12 * 3600_000, tz)
  const candidates = [...new Set([asUtc - before, asUtc - after])].sort((a, b) => a - b)
  const exact = candidates.find((c) => {
    const w = wallClock(new Date(c), tz)
    return w.date === date && w.time === time
  })
  // In a gap (clock jumped forward) the old offset lands just after the jump.
  return new Date(exact ?? asUtc - before)
}

/** "YYYY-MM-DD" n days after a date string (calendar arithmetic, zone independent). */
export function addDaysToDate(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

export function weekdayOfDate(date: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6
}

export { fromMinutes, isTime, toMinutes } from '../../supabase/functions/_shared/planner/time.ts'
