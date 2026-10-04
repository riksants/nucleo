import { createElement, lazy, type ComponentType } from 'react'

export type PreloadablePage = ComponentType & { preload(): Promise<void> }

/**
 * A section loaded on demand (its code is not in the startup bundle) that can also be preloaded.
 * Once preloaded it renders straight away — no empty frame while its code arrives on the first visit.
 */
export function lazyPage(load: () => Promise<ComponentType>): PreloadablePage {
  let loaded: ComponentType | null = null
  let pending: Promise<void> | null = null
  const preload = () => {
    pending ??= load().then(
      (c) => {
        loaded = c
      },
      (err) => {
        // Offline before the code was cached: try again next time instead of failing forever.
        pending = null
        throw err
      },
    )
    return pending
  }
  const Lazy = lazy(() => preload().then(() => ({ default: loaded! })))
  return Object.assign(() => createElement(loaded ?? Lazy), { preload })
}

/** Runs when the phone is idle (falls back to a short delay where requestIdleCallback doesn't exist, e.g. Safari). */
export function whenIdle(run: () => void): () => void {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout: 3000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(run, 1200)
  return () => clearTimeout(id)
}
