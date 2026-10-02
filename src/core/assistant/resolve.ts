/**
 * Which reader handles a sentence. The local command reader always comes
 * first; the optional AI interpreter is tried only when ALL of these hold:
 * the local reader did not understand, the person turned the AI on, gave
 * consent, the account/server is available and there is a connection.
 * Off → never called (no request, no cost). Any failure → back to commands.
 */
import { readIntent, parseIntent, type Intent } from './intents'

export interface AiSwitch {
  enabled: boolean
  consentAt: string | null
}

export interface ResolveOptions {
  ai?: AiSwitch
  online: boolean
  /** A signed-in account with the server configured. */
  available: boolean
  /** Calls the interpreter (Edge Function). Must only send the sentence and today's date. */
  call(text: string, today: string): Promise<unknown>
}

export interface Resolved {
  intent: Intent
  via: 'rules' | 'ai'
  /** Neutral note when the AI could not be used. */
  note?: string
}

/** Session guard against loops: one call at a time, a short gap, and a cap per session. */
const guard = { inFlight: false, last: 0, count: 0 }
export const SESSION_CAP = 30
export const MIN_GAP_MS = 3000
export function resetGuard() {
  guard.inFlight = false
  guard.last = 0
  guard.count = 0
}

export const aiActive = (ai?: AiSwitch) => Boolean(ai?.enabled && ai.consentAt)

export async function resolveIntent(text: string, today: string, opts: ResolveOptions, now = Date.now()): Promise<Resolved> {
  const local = readIntent(text, today)
  if (local.type !== 'unknown' || !aiActive(opts.ai)) return { intent: local, via: 'rules' }
  if (!opts.available) return { intent: local, via: 'rules', note: 'O interpretador com IA precisa de uma conta conectada.' }
  if (!opts.online) return { intent: local, via: 'rules', note: 'Este recurso precisa de conexão. Os comandos do Assistente continuam funcionando sem internet.' }
  if (guard.inFlight || now - guard.last < MIN_GAP_MS || guard.count >= SESSION_CAP) return { intent: local, via: 'rules', note: 'Aguarde um instante antes de pedir outra interpretação.' }
  guard.inFlight = true
  guard.last = now
  guard.count++
  try {
    const intent = parseIntent(await opts.call(text.slice(0, 300), today))
    return intent.type === 'unknown' ? { intent, via: 'ai', note: 'Mesmo com a IA, não ficou claro o que fazer. Tente com outras palavras.' } : { intent, via: 'ai' }
  } catch (err) {
    return { intent: local, via: 'rules', note: err instanceof Error && err.message ? err.message : 'A IA não respondeu agora. Os comandos do Assistente continuam funcionando.' }
  } finally {
    guard.inFlight = false
  }
}
