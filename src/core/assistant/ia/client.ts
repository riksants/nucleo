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
import { FactBook, historyText, renderAnswer, type Fact, type Segment } from '../../../../supabase/functions/_shared/ia/facts.ts'
import { CONSENT_VERSION, type ErrorCode, type StopReason, type TurnError, type TurnRequest, type TurnResponse } from '../../../../supabase/functions/_shared/ia/protocol.ts'
import { TOOL_AREA, type Area, type ToolName } from '../../../../supabase/functions/_shared/ia/tools.ts'
import type { DataState, Settings } from '../../../data/types'
import { remember, topicsOf, type Conversation } from './conversation'
import { runActionsTool } from './actions/tool'
import type { Plan } from './actions/plan'
import { ACTION_TOOL } from '../../../../supabase/functions/_shared/ia/actions.ts'
import { runLookup } from './lookups'
import { stablePrefix, type StreamEvent } from '../../../../supabase/functions/_shared/ia/stream.ts'
import { CALC_TOOL } from '../../../../supabase/functions/_shared/ia/calc.ts'
import { questionFacts, runCalc } from './calc'
import { MEMORY_TOOL, memoryForModel, memoryRefusal, cleanMemory } from '../../../../supabase/functions/_shared/ia/memory.ts'

export type Transport = (body: TurnRequest, onEvent?: (e: StreamEvent) => void) => Promise<{ ok: true; data: TurnResponse } | { ok: false; status: number; error: TurnError }>

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
  /**
   * Progressive answer: complete sentences of the text being written, ALREADY through the guard
   * (values that are not facts hidden). null = drop what was shown (a new model call or lookups).
   */
  onPartial?(segments: Segment[] | null): void
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
      /** The last plan the model proposed in this turn (shown as an editable preview). */
      plan: Plan | null
      /** The answer says a preview/change was prepared, but no plan was built: the screen says so (nothing will be written). */
      claimedPlanWithoutOne: boolean
      /** A reminder the model proposed: shown as "Lembrar disso?", saved only on a tap. */
      memoryProposal: string | null
    }
  | { kind: 'error'; code: ErrorCode | 'session'; message: string; conversation: Conversation | null }

export const STATUS_TEXT: Record<Area, string> = {
  agenda: 'Consultando a Agenda…',
  tarefas: 'Consultando Tarefas…',
  habitos: 'Consultando Hábitos…',
  financas: 'Consultando Finanças…',
  metas: 'Consultando Metas…',
  vendas: 'Consultando Vendas…',
  clientes: 'Consultando Clientes e projetos…',
  alimentacao: 'Consultando Alimentação…',
  anotacoes: 'Lendo suas anotações…',
  busca: 'Procurando nos seus registros…',
}

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
  // the person's own amounts (shown as "você informou" when the answer repeats them)
  questionFacts(text, book, deps.snapshot().settings)
  const id = (deps.newTurnId ?? turnId)()
  // a holder: the plan is set inside the lookups callback
  const proposed: { plan: Plan | null; count: number; memory: string | null } = { plan: null, count: 0, memory: null }
  const ai0 = deps.snapshot().settings.assistantAi
  const memory = ai0?.memoryOn ? memoryForModel(ai0.memory) : []
  const lookups: { tool: string; args: Record<string, unknown>; about?: string[] }[] = []
  let raw = ''
  let shown = ''
  const onEvent = deps.onPartial
    ? (e: StreamEvent) => {
        if (e.t === 'r') {
          raw = ''
          shown = ''
          deps.onPartial!(null)
          return
        }
        if (e.t !== 'd') return
        raw += e.s
        const safe = stablePrefix(raw)
        if (safe.length > shown.length) {
          shown = safe
          // the same guard as the final answer, with this turn's facts: nothing unverified is shown
          deps.onPartial!(renderAnswer(safe, book.all).segments)
        }
      }
    : undefined
  let res = await deps.transport({
    kind: 'start',
    turnId: id,
    text,
    today: deps.today,
    timeZone: deps.timeZone,
    deep: Boolean(opts.deep),
    consentVersion: CONSENT_VERSION,
    history: conversation.history,
    topics: topicsOf(conversation),
    focus: conversation.focus,
    areasOff: deps.areasOff,
    ...(memory.length ? { memory } : {}),
  }, onEvent)

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (!res.ok) return { kind: 'error', code: res.error.error, message: res.error.message, conversation }
    const body = res.data
    if (body.kind === 'answer') {
      const r = renderAnswer(body.text, book.all)
      const next = remember(conversation, text, historyText(r.segments), lookups)
      const plan = proposed.plan
      // the history says a preview is waiting, so "confirma" / "muda a data" are understood next
      const conv = plan ? remember(next, '(prévia de alterações mostrada)', `Prévia com ${plan.items.length} ${plan.items.length === 1 ? 'item' : 'itens'}, aguardando a pessoa confirmar ou editar na tela. Nada foi gravado ainda.`) : next
      return { kind: 'answer', segments: r.segments, facts: [...book.all.values()], blocked: r.blocked, route: body.route, model: body.model, costMicros: body.costMicros, stop: body.stop, conversation: conv, plan, claimedPlanWithoutOne: !plan && !proposed.memory && claimsPlan(body.text), memoryProposal: proposed.memory }
    }
    // Lookups requested: same account still signed in, then run them over the freshest data.
    if (!(await sessionOk())) return { kind: 'error', code: 'session', message: 'A conta conectada mudou. A conversa foi encerrada.', conversation: null }
    const { data, settings } = deps.snapshot()
    const results = body.calls.map((call) => {
      if (call.name === ACTION_TOOL) {
        deps.onStatus?.('Preparando a prévia…')
        const r = runActionsTool(call.input, { data, settings, now: deps.now(), areasOff: deps.areasOff, uid: conversation.uid, planId: `${id}${++proposed.count}`, book })
        if (r.plan) proposed.plan = r.plan
        return { id: call.id, content: r.content, isError: r.isError }
      }
      if (call.name === MEMORY_TOOL) {
        const ai = settings.assistantAi
        if (!ai?.memoryOn) return { id: call.id, content: JSON.stringify({ erro: 'Os lembretes de longo prazo estão desligados. A pessoa pode ligá-los em "Privacidade da IA", no Assistente.' }), isError: true }
        if ((ai.memory?.length ?? 0) >= 20) return { id: call.id, content: JSON.stringify({ erro: 'Já há 20 lembretes. A pessoa precisa apagar um em "Privacidade da IA" antes.' }), isError: true }
        const why = memoryRefusal(call.input?.texto)
        if (why) return { id: call.id, content: JSON.stringify({ erro: why }), isError: true }
        proposed.memory = cleanMemory(call.input.texto)
        return { id: call.id, content: JSON.stringify({ mostrado_na_tela: true, aviso: 'Nada foi salvo: o lembrete só é guardado se a pessoa tocar em "Lembrar". Não diga que já lembrou.' }), isError: false }
      }
      if (call.name === CALC_TOOL) {
        deps.onStatus?.('Calculando…')
        return { id: call.id, ...runCalc(call.input, book, settings) }
      }
      const area = TOOL_AREA[call.name as ToolName]
      if (area) deps.onStatus?.(STATUS_TEXT[area])
      const r = runLookup(call.name, call.input, { data, settings, now: deps.now(), book, areasOff: deps.areasOff })
      lookups.push({ tool: call.name, args: call.input, ...(r.about?.length ? { about: r.about.map((a) => a.slice(0, 80)) } : {}) })
      return { id: call.id, content: r.content, isError: r.isError }
    })
    deps.onPartial?.(null)
    res = await deps.transport({ kind: 'continue', envelope: body.envelope, results }, onEvent)
  }
  return { kind: 'error', code: 'upstream', message: 'A IA não concluiu a resposta.', conversation }
}

/** "Preparei a prévia…", "Preparei a reserva…" — an answer that speaks of a prepared change. */
export function claimsPlan(text: string): boolean {
  return /\b(preparei|montei)\b|\bprévia\b|confirm(e|ar) na tela/i.test(text)
}
