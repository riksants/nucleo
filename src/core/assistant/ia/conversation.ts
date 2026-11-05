/**
 * NÚCLEO IA — the conversation the app keeps (this session only, in memory, per account).
 *
 * Sent with each question: the last 6 exchanges (compact), one line of older topics and what is
 * "in focus" (the last lookups and their arguments). Results of old lookups are NOT sent again —
 * the model looks them up again (the data may have changed).
 */
import { HISTORY_TURNS } from '../../../../supabase/functions/_shared/ia/protocol.ts'

export interface Exchange {
  q: string
  a: string
}

export interface Conversation {
  uid: string
  history: Exchange[]
  older: string[]
  /** Recent lookups: tool, arguments and the names they were about ("essa venda", "ele"). */
  focus: { tool: string; args: Record<string, unknown>; about?: string[] }[]
}

export const newConversation = (uid: string): Conversation => ({ uid, history: [], older: [], focus: [] })

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Adds one exchange (AI or local command) and keeps the window small. */
export function remember(c: Conversation, q: string, a: string, lookups: { tool: string; args: Record<string, unknown>; about?: string[] }[] = []): Conversation {
  const history = [...c.history, { q: clip(q, 600), a: clip(a, 900) }]
  const older = [...c.older]
  while (history.length > HISTORY_TURNS) older.push(clip(history.shift()!.q, 80))
  // the same lookup twice in one turn (the app's ready lookup and the model's) is kept once
  const unique = lookups.filter((l, i) => lookups.findIndex((x) => x.tool === l.tool && JSON.stringify(x.args) === JSON.stringify(l.args)) === i)
  const focus = unique.length ? [...unique, ...c.focus.filter((f) => !unique.some((l) => l.tool === f.tool))].slice(0, 8) : c.focus
  return { ...c, history, older: older.slice(-6), focus }
}

export const topicsOf = (c: Conversation) => clip(c.older.join('; '), 400)
