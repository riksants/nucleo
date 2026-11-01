/**
 * NÚCLEO IA — one question, from the app's side.
 *
 *   start → (lookups requested → run them here on this account's data → continue)* → answer
 *
 * Security on the device (the server enforces its own; this is an extra layer):
 * - the conversation belongs to one account; before EVERY lookup the current login is checked
 *   again — a different account (or none) aborts the question and the conversation is dropped;
 * - lookups read the freshest data of the store at that moment;
 * - nothing is written: lookups only read.
 */
import { FactBook, plainAnswer, renderAnswer, type Fact, type Segment } from '../../../../supabase/functions/_shared/ia/facts.ts'
import { CONSENT_VERSION, type ErrorCode, type StopReason, type TurnError, type TurnRequest, type TurnResponse } from '../../../../supabase/functions/_shared/ia/protocol.ts'
import { TOOL_AREA, type Area, type ToolName } from '../../../../supabase/functions/_shared/ia/tools.ts'
import type { DataState, Settings } from '../../../data/types'
import { remember, topicsOf, type Conversation } from './conversation'
import { runLookup } from './lookups'

export type Transport = (body: TurnRequest) => Promise<{ ok: true; data: TurnResponse } | { ok: false; status: number; error: TurnError }>

export interface TurnDeps {
  transport: Transport
  /** The store right now (fresh at each lookup). */
  snapshot(): { data: DataState; settings: Settings }
  now(): Date
  /** The account of the CURRENT login (re-read each time), or null. */
  currentUid(): Promise<string | null>
  today: string
  timeZone: string
  areasOff: Area[]
  onStatus?(text: string): void
  newTurnId?(): string
}

export type IaAnswer =
  | {
      kind: 'answer'
      segments: Segment[]
      facts: Fact[]
      /** Values that did not come from a lookup and were hidden. Must be 0. */
      blocked: string[]
      route: string
      model: string
      costMicros: number
      stop: StopReason
      conversation: Conversation
    }
  | { kind: 'error'; code: ErrorCode | 'session'; message: string; conversation: Conversation | null }

export const STATUS_TEXT: Record<Area, string> = { agenda: 'Consultando a Agenda…', financas: 'Consultando Finanças…', metas: 'Consultando Metas…', busca: 'Procurando nos seus registros…' }

export function turnId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `t${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('')}`.slice(0, 40)
}

const MAX_ROUNDS = 8

export async function askIa(text: string, conversation: Conversation, deps: TurnDeps, opts: { deep?: boolean } = {}): Promise<IaAnswer> {
  const sessionOk = async () => (await deps.currentUid()) === conversation.uid
  if (!(await sessionOk())) return { kind: 'error', code: 'session', message: 'A conta conectada mudou. A conversa foi encerrada.', conversation: null }

  const book = new FactBook()
  const lookups: { tool: string; args: Record<string, unknown> }[] = []
  let res = await deps.transport({
    kind: 'start',
    turnId: (deps.newTurnId ?? turnId)(),
    text,
    today: deps.today,
    timeZone: deps.timeZone,
    deep: Boolean(opts.deep),
    consentVersion: CONSENT_VERSION,
    history: conversation.history,
    topics: topicsOf(conversation),
    focus: conversation.focus,
    areasOff: deps.areasOff,
  })

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (!res.ok) return { kind: 'error', code: res.error.error, message: res.error.message, conversation }
    const body = res.data
    if (body.kind === 'answer') {
      const r = renderAnswer(body.text, book.all)
      const next = remember(conversation, text, plainAnswer(r.segments), lookups)
      return { kind: 'answer', segments: r.segments, facts: [...book.all.values()], blocked: r.blocked, route: body.route, model: body.model, costMicros: body.costMicros, stop: body.stop, conversation: next }
    }
    // Lookups requested: same account still signed in, then run them over the freshest data.
    if (!(await sessionOk())) return { kind: 'error', code: 'session', message: 'A conta conectada mudou. A conversa foi encerrada.', conversation: null }
    const { data, settings } = deps.snapshot()
    const results = body.calls.map((call) => {
      const area = TOOL_AREA[call.name as ToolName]
      if (area) deps.onStatus?.(STATUS_TEXT[area])
      lookups.push({ tool: call.name, args: call.input })
      const r = runLookup(call.name, call.input, { data, settings, now: deps.now(), book, areasOff: deps.areasOff })
      return { id: call.id, content: r.content, isError: r.isError }
    })
    res = await deps.transport({ kind: 'continue', envelope: body.envelope, results })
  }
  return { kind: 'error', code: 'upstream', message: 'A IA não concluiu a resposta.', conversation }
}
