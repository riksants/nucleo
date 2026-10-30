/**
 * Focus timer state lives on the device (localStorage) while it runs, so
 * leaving the screen, locking the phone or reloading never loses time. Only a
 * finished session becomes a synced record (focusSessions).
 */
import { useCallback, useEffect, useState } from 'react'
import { readPref, writePref } from '../../lib/prefs'

export interface FocusTimer {
  taskId: string | null
  /** Set when the session is for a habit (then taskId is null). */
  habitId?: string | null
  /** When the first run started (ISO). */
  startedAt: string
  /** Time accumulated in previous runs. */
  elapsedMs: number
  /** Epoch ms of the current run, or null when paused. */
  runningSince: number | null
}

export const FOCUS_KEY = 'focusTimer'
/** Sent when the timer starts, pauses or ends (reminders follow its goal). */
export const FOCUS_EVENT = 'nucleo:focus-timer'

export function elapsed(t: FocusTimer, now = Date.now()): number {
  return t.elapsedMs + (t.runningSince !== null ? now - t.runningSince : 0)
}

export function start(taskId: string | null, now = Date.now(), habitId: string | null = null): FocusTimer {
  return { taskId, habitId, startedAt: new Date(now).toISOString(), elapsedMs: 0, runningSince: now }
}

export function pause(t: FocusTimer, now = Date.now()): FocusTimer {
  return t.runningSince !== null ? { ...t, elapsedMs: elapsed(t, now), runningSince: null } : t
}

export function resume(t: FocusTimer, now = Date.now()): FocusTimer {
  return t.runningSince !== null ? t : { ...t, runningSince: now }
}

export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}

/** Persisted timer + a ticking "now" while it runs. */
export function useFocusTimer() {
  const [timer, setTimer] = useState<FocusTimer | null>(() => readPref<FocusTimer | null>(FOCUS_KEY, null))
  const [now, setNow] = useState(() => Date.now())
  const update = useCallback((next: FocusTimer | null) => {
    setNow(Date.now())
    setTimer(next)
    writePref(FOCUS_KEY, next)
    window.dispatchEvent(new Event(FOCUS_EVENT))
  }, [])
  useEffect(() => {
    if (timer?.runningSince == null) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [timer?.runningSince])
  return { timer, update, ms: timer ? Math.max(0, elapsed(timer, now)) : 0 }
}
