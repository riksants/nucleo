/**
 * One primary action per screen. A screen declares what "+" means there (Nova tarefa, Novo projeto…):
 * on the phone it is the floating "+" button, on the computer the button at the top of the page.
 * - not declared: the floating "+" captures to the Caixa de entrada (when that section is on);
 * - null: no floating "+" (the screen already has its own main actions, e.g. Início and Financeiro).
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'

export interface PrimaryAction {
  /** Short text of the button at the top of the page (computer): "Nova", "Novo". */
  label: string
  /** Full name, read by screen readers and used on the floating button: "Nova tarefa". */
  aria: string
  onPress(): void
  disabled?: boolean
}

type Slot = PrimaryAction | null | undefined

let current: Slot = undefined
let owner = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function useCurrentPrimaryAction(): Slot {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

/** Declares this screen's primary action while it is mounted (`undefined` = declare nothing). */
export function usePrimaryAction(action: Slot) {
  const latest = useRef(action)
  latest.current = action
  const kind = action === undefined ? 'none' : action === null ? 'hide' : `${action.label}|${action.aria}|${action.disabled ? 1 : 0}`
  useEffect(() => {
    if (kind === 'none') return
    const me = ++owner
    // The press always runs the latest handler (it closes over the screen's current state).
    current = kind === 'hide' ? null : { ...(latest.current as PrimaryAction), onPress: () => (latest.current as PrimaryAction | null)?.onPress() }
    emit()
    return () => {
      if (owner !== me) return
      current = undefined
      emit()
    }
  }, [kind])
}
