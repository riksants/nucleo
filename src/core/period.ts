/**
 * "Today" and "this week" always in the person's chosen time zone (Settings),
 * never just the device clock. Dates are "YYYY-MM-DD" calendar days.
 */
import { useEffect, useState } from 'react'
import type { Settings, Weekday } from '../data/types'
import { addDaysToDate, deviceTimeZone, wallClock, weekdayOfDate } from '../lib/zoned'

export function zoneOf(settings: Pick<Settings, 'timeZone'>): string {
  return settings.timeZone || deviceTimeZone()
}

/** Calendar date and clock time right now in the zone. */
export function nowIn(tz: string, now = new Date()) {
  const w = wallClock(now, tz)
  return { date: w.date, time: w.time, weekday: w.weekday as Weekday, hour: Number(w.time.slice(0, 2)) }
}

export function todayIn(tz: string, now = new Date()): string {
  return nowIn(tz, now).date
}

/** Monday of the week that contains `date`. */
export function weekStart(date: string): string {
  const back = (weekdayOfDate(date) + 6) % 7
  return addDaysToDate(date, -back)
}

/** The 7 dates (Monday → Sunday) of the week that contains `date`. */
export function weekDates(date: string): string[] {
  const start = weekStart(date)
  return Array.from({ length: 7 }, (_, i) => addDaysToDate(start, i))
}

export { addDaysToDate, weekdayOfDate }

/**
 * Today's date in the person's zone, updated when the day turns (checked every
 * minute and when the app comes back to the foreground).
 */
export function useToday(tz: string): string {
  const [today, setToday] = useState(() => todayIn(tz))
  useEffect(() => {
    const check = () => setToday(todayIn(tz))
    check()
    const timer = window.setInterval(check, 60_000)
    const onVisible = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [tz])
  return today
}
