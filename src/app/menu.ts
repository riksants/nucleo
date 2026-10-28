/** Open/closed state of the side menu (phone). One menu for the whole app, opened from any screen's header. */
import { useSyncExternalStore } from 'react'

let open = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function openMenu() {
  if (open) return
  open = true
  emit()
}

export function closeMenu() {
  if (!open) return
  open = false
  emit()
}

export function useMenuOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => open,
  )
}
