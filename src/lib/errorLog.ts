/**
 * The last errors of this device, kept only here (localStorage), so a problem can be described
 * without guessing (audit A9). Only the message (cut short) and where it happened: never data.
 * Nothing is sent anywhere; the person can copy it from Configurações → Diagnóstico.
 */
const KEY = 'nucleo:errors'
const MAX = 20

export interface LoggedError {
  at: string
  where: string
  message: string
}

export function readErrors(): LoggedError[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(list) ? (list as LoggedError[]) : []
  } catch {
    return []
  }
}

export function logError(where: string, err: unknown) {
  const message = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 160)
  try {
    const list = [{ at: new Date().toISOString(), where, message }, ...readErrors()].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // no storage (private window): nothing kept
  }
}

export function clearErrors() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing to clear
  }
}

/** Errors nobody caught (a failed promise, an error outside React). */
export function installErrorLog() {
  window.addEventListener('error', (e) => logError('app', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => logError('app', e.reason))
}

/** A section's code that is no longer on the server (a new version was published while the app was open). */
export function isChunkError(err: unknown): boolean {
  const text = err instanceof Error ? `${err.name} ${err.message}` : String(err)
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|ChunkLoadError|Failed to fetch dynamically/i.test(text)
}
