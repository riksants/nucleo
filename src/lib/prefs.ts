import { useCallback, useState } from 'react'

const PREFIX = 'nucleo:'

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writePref<T>(key: string, value: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // storage unavailable (private mode); preference just won't persist
  }
}

/** useState that remembers its value across sessions (small UI preferences only). */
export function usePref<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readPref(key, fallback))
  const update = useCallback(
    (next: T) => {
      setValue(next)
      writePref(key, next)
    },
    [key],
  )
  return [value, update] as const
}
