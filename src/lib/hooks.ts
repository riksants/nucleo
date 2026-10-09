import { useEffect, useState, useSyncExternalStore } from 'react'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
  )
}

export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)')

/** "Reduzir movimento" on the device — live (Framer's useReducedMotion only reads it once, at mount). */
export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)')

/**
 * The part of the screen that is really visible (the Visual Viewport): on iPhone the keyboard covers
 * the page instead of resizing it, and fixed elements are not moved. Bottom sheets size and place
 * themselves to this box, so they sit right above the keyboard. `keyboard`: the keyboard (or any
 * bottom bar of the browser) is covering part of the screen. null when inactive or unsupported.
 */
export function useVisualViewport(active: boolean): { top: number; height: number; keyboard: boolean } | null {
  const [box, setBox] = useState<{ top: number; height: number; keyboard: boolean } | null>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!active || !vv) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const height = Math.round(vv.height)
        const top = Math.round(vv.offsetTop)
        const keyboard = window.innerHeight - height > 80
        setBox((b) => (b && b.top === top && b.height === height && b.keyboard === keyboard ? b : { top, height, keyboard }))
      })
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      cancelAnimationFrame(frame)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setBox(null)
    }
  }, [active])
  return box
}

/** Locks page scroll while a sheet or dialog is open. Supports nesting. */
let lockCount = 0
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    lockCount++
    document.documentElement.style.overflow = 'hidden'
    return () => {
      lockCount--
      if (lockCount === 0) document.documentElement.style.overflow = ''
    }
  }, [active])
}

/**
 * The current time, refreshed every minute and when the app comes back to the foreground — for
 * text that depends on the hour or the day ("Bom dia" → "Boa tarde", the weekday, the month).
 */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const timer = window.setInterval(tick, everyMs)
    const onVisible = () => document.visibilityState === 'visible' && tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [everyMs])
  return now
}
