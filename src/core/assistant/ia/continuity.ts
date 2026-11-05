/**
 * NÚCLEO IA — continuity on THIS device (Etapa 5, spec §3 (2)).
 *
 * - per account (`nucleo:iaConv:<uid>`), 12 h after the last message, never synced;
 * - the conversation context already carries no values (history keeps HISTORY_VALUE), and only the
 *   visible messages of the Assistant are kept for the thread to reappear;
 * - removed: on "Apagar conversa", when the AI or continuity is turned off, when the account leaves
 *   the device (deviceCleanup) and whenever it is expired or belongs to another account.
 */
import type { Conversation } from './conversation'

export const CONTINUITY_MS = 12 * 60 * 60 * 1000
const key = (uid: string) => `nucleo:iaConv:${uid}`

export interface Saved<M> {
  v: 1
  uid: string
  savedAt: number
  conversation: Conversation
  messages: M[]
}

export function saveContinuity<M>(uid: string, conversation: Conversation, messages: M[], now = Date.now()): void {
  if (conversation.uid !== uid) return
  try {
    localStorage.setItem(key(uid), JSON.stringify({ v: 1, uid, savedAt: now, conversation, messages } satisfies Saved<M>))
  } catch {
    // storage full or unavailable: the conversation simply stays in this session
  }
}

export function loadContinuity<M>(uid: string, now = Date.now()): Saved<M> | null {
  try {
    const raw = localStorage.getItem(key(uid))
    if (!raw) return null
    const s = JSON.parse(raw) as Saved<M>
    const valid = s?.v === 1 && s.uid === uid && s.conversation?.uid === uid && Array.isArray(s.conversation.history) && Array.isArray(s.messages) && typeof s.savedAt === 'number'
    if (!valid || now - s.savedAt > CONTINUITY_MS || s.savedAt > now + 60_000) {
      clearContinuity(uid)
      return null
    }
    return s
  } catch {
    clearContinuity(uid)
    return null
  }
}

export function clearContinuity(uid: string): void {
  try {
    localStorage.removeItem(key(uid))
  } catch {
    // storage unavailable
  }
}

/** Every saved conversation on this device ("Apagar tudo da IA neste aparelho"). */
export function clearAllContinuity(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('nucleo:iaConv:')) localStorage.removeItem(k)
  } catch {
    // storage unavailable
  }
}
