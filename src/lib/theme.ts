/**
 * Light / dark theme. "auto" follows the device; the choice is per device (Configurações → Aparência).
 * index.html applies the same rule before the first paint, so the page never flashes the other theme.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { readPref, writePref } from './prefs'

export type ThemePref = 'auto' | 'light' | 'dark'

export const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'auto', label: 'Automático' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
]

/** Browser chrome color (status bar / tab) per theme: the page background. */
const CHROME = { dark: '#0b100d', light: '#f3f4ef' } as const
const QUERY = '(prefers-color-scheme: dark)'

let current: ThemePref = readPref<ThemePref>('theme', 'auto')
const listeners = new Set<() => void>()

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref !== 'light' && window.matchMedia(QUERY).matches)
  const theme = dark ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', CHROME[theme])
}

export function setThemePref(pref: ThemePref) {
  current = pref
  writePref('theme', pref)
  apply(pref)
  listeners.forEach((l) => l())
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

/** Keeps the page in sync: applies the choice and, on "Automático", follows the device when it changes. */
export function useTheme() {
  const pref = useThemePref()
  useEffect(() => {
    apply(pref)
    if (pref !== 'auto') return
    const mql = window.matchMedia(QUERY)
    const onChange = () => apply('auto')
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [pref])
}
