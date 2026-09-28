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

/**
 * Height of the on-screen keyboard on iOS, where fixed elements are not pushed
 * up automatically. Used to keep bottom sheets' buttons visible while typing.
 */
export function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!active || !vv) return
    const update = () => setInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setInset(0)
    }
  }, [active])
  return inset
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
