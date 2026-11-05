/**
 * NÚCLEO IA — one step of a question, on the server. Pure logic with injected dependencies
 * (login, budget, model call), so it is tested without network or database.
 *
 *  start    → route → reserve budget → call model → answer | lookups for the app (signed envelope)
 *  continue → open envelope (same user) → accept results only for the pending lookups → call again
 */
import { openTurn, sealTurn, TURN_TTL_MS, type TurnState } from './envelope.ts'
import { affordableMaxTokens, estimateTokens, MAX_INPUT_TOKENS, maxCallMicros, MODELS, costMicros, type ModelKey, type UsageLike } from './models.ts'
import { SYSTEM_PROMPT } from './prompt.ts'
import type { ContinueRequest, ErrorCode, StartRequest, StopReason, TurnError, TurnResponse } from './protocol.ts'
import { escalated, ROUTES, routeFor, type Route } from './router.ts'
import { ESCALATE_TOOL, isAppTool, MAX_RESULTS_PER_STEP, toolsFor } from './tools.ts'

/** Model calls in one question, at most. */
export const MAX_STEPS = 6

export type ReserveOutcome = 'ok' | 'busy' | 'duplicate' | 'limit-request' | 'limit-day' | 'limit-month' | 'limit-sonnet' | 'sonnet-blocked' | 'global' | 'paused' | 'no-plan'

export interface Reservation {
  outcome: ReserveOutcome
  usageId: number | null
  /** Most this call may cost (≤ what was asked), micro-dollars. */
  grantedMicros: number
}

export interface CallResult {
  content: Block[]
  stop_reason: string | null
  usage: UsageLike
  model: string
}

export type Block = { type: string; id?: string; name?: string; input?: unknown; text?: string; [k: string]: unknown }

export interface Deps {
  uid: string
  secret: string
  now(): number
  reserve(a: { turnId: string; step: number; model: ModelKey; route: Route; wantedMicros: number; minMicros: number }): Promise<Reservation>
  settle(usageId: number, a: { ok: boolean; model: ModelKey; route: Route; costMicros: number; usage: UsageLike | null; tools: string[]; stop: string | null }): Promise<void>
  callModel(params: Record<string, unknown>): Promise<CallResult>
}

export type Outcome = { status: number; body: TurnResponse | TurnError }

const MESSAGES: Partial<Record<ReserveOutcome | ErrorCode, string>> = {
  busy: 'Aguarde a resposta anterior terminar.',
  duplicate: 'Essa pergunta já foi enviada.',
  'limit-day': 'Você chegou ao limite gratuito de uso da IA de hoje. Ele renova sozinho à meia-noite (horário de Brasília), sem custo. Os comandos do Assistente continuam funcionando.',
  'limit-month': 'Você chegou ao limite gratuito de uso da IA deste mês. Ele renova sozinho no dia 1º, sem custo. Os comandos do Assistente continuam funcionando.',
  'limit-sonnet': 'Você chegou ao limite gratuito de análises a fundo deste mês. Ele renova sozinho no dia 1º, sem custo. Pergunte de novo para receber uma resposta simplificada.',
  'limit-request': 'Essa pergunta ficou grande demais para o limite por pergunta. Tente dividir em partes menores.',
  global: 'A IA está pausada por alguns minutos. Os comandos do Assistente continuam funcionando.',
  paused: 'A IA está pausada por alguns minutos. Os comandos do Assistente continuam funcionando.',
  'no-plan': 'A IA não está disponível para esta conta no momento. Os comandos do Assistente continuam funcionando.',
  upstream: 'A IA não respondeu agora. Os comandos do Assistente continuam funcionando.',
  turn: 'Essa conversa expirou. Pergunte de novo.',
  input: 'Pedido inválido.',
}

const fail = (status: number, error: ErrorCode, message?: string): Outcome => ({ status, body: { error, message: message ?? MESSAGES[error] ?? 'Erro.' } })

function reserveFailure(o: ReserveOutcome): Outcome {
  switch (o) {
    case 'busy':
      return fail(429, 'busy')
    case 'duplicate':
      return fail(409, 'duplicate')
    case 'limit-day':
    case 'limit-month':
    case 'limit-sonnet':
    case 'limit-request':
      return fail(429, 'limit', MESSAGES[o])
    case 'no-plan':
      return fail(403, 'no-plan')
    case 'global':
      return fail(503, 'global-limit', MESSAGES.global)
    default:
      return fail(503, 'paused')
  }
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

/** Opening messages of a question: compact history + context block + the sentence. */
export function baseMessages(req: StartRequest): unknown[] {
  const out: unknown[] = []
  for (const h of req.history) {
    out.push({ role: 'user', content: h.q })
    out.push({ role: 'assistant', content: h.a || '…' })
  }
  const ctx = {
    hoje: req.today,
    dia_da_semana: WEEKDAYS[new Date(`${req.today}T12:00:00Z`).getUTCDay()],
    fuso: req.timeZone,
    areas_desligadas: req.areasOff,
    consultas_recentes: req.focus,
    temas_anteriores: req.topics || null,
    modo: req.deep ? 'analise_completa' : 'resposta_curta',
    ...(req.memory?.length ? { lembretes_da_pessoa: req.memory } : {}),
  }
  out.push({ role: 'user', content: `<contexto>\n${JSON.stringify(ctx)}\n</contexto>\n\n${req.text}` })
  return out
}

function params(state: TurnState, maxTokens: number | null) {
  const last = state.step >= MAX_STEPS - 1
  return {
    model: MODELS[state.model].id,
    max_tokens: maxTokens ?? MODELS[state.model].maxOutput,
    system: [{ type: 'text', text: SYSTEM_PROMPT }],
    tools: toolsFor(state.model),
    tool_choice: last ? { type: 'none' } : { type: 'auto' },
    thinking: { type: 'adaptive' },
    output_config: { effort: state.effort },
    // Automatic caching: instructions + tools + the turn so far are reused on the next call.
    cache_control: { type: 'ephemeral' },
    messages: state.messages,
  }
}

const textOf = (content: Block[]) =>
  content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
    .trim()

export async function startTurn(req: StartRequest, deps: Deps): Promise<Outcome> {
  const choice = routeFor(req.text, { deep: req.deep })
  const base = baseMessages(req)
  const state: TurnState = {
    v: 1,
    uid: deps.uid,
    turnId: req.turnId,
    route: choice.route,
    model: choice.model,
    effort: choice.effort,
    step: 0,
    spentMicros: 0,
    escalated: false,
    base,
    messages: [...base],
    pending: [],
    pre: [],
    exp: deps.now() + TURN_TTL_MS,
  }
  return advance(state, deps)
}

export async function continueTurn(req: ContinueRequest, deps: Deps): Promise<Outcome> {
  const opened = await openTurn(req.envelope, deps.secret, deps.uid, deps.now())
  if (!opened.ok) return fail(409, 'turn')
  const state = opened.state
  const want = new Set(state.pending.map((p) => p.id))
  const got = new Set(req.results.map((r) => r.id))
  if (want.size !== got.size || [...want].some((id) => !got.has(id))) return fail(400, 'input', 'Resultados não correspondem às consultas pedidas.')
  const byId = new Map(req.results.map((r) => [r.id, r]))
  const results = [
    ...(state.pre ?? []),
    ...state.pending.map((p) => {
      const r = byId.get(p.id)!
      return { type: 'tool_result', tool_use_id: p.id, content: r.content, ...(r.isError ? { is_error: true } : {}) }
    }),
  ]
  state.messages = [...state.messages, { role: 'user', content: results }]
  state.pending = []
  state.pre = []
  return advance(state, deps)
}

async function advance(state: TurnState, deps: Deps): Promise<Outcome> {
  // A fast-model state kept aside while trying the deeper model (restored if its budget refuses).
  let fallback: TurnState | null = null
  for (let guard = 0; guard < MAX_STEPS + 2; guard++) {
    if (state.step >= MAX_STEPS) return answer(state, 'Não consegui concluir essa análise. Tente uma pergunta mais específica.', 'steps')
    const draft = params(state, null)
    const inputTokens = estimateTokens(JSON.stringify({ ...draft, max_tokens: undefined }).length)
    if (inputTokens > MAX_INPUT_TOKENS) return fail(429, 'limit', MESSAGES['limit-request'])
    const wanted = maxCallMicros(state.model, inputTokens, MODELS[state.model].maxOutput)
    const min = maxCallMicros(state.model, inputTokens, 400)
    const r = await deps.reserve({ turnId: state.turnId, step: state.step + 1, model: state.model, route: state.route, wantedMicros: wanted, minMicros: min })

    if (r.outcome !== 'ok') {
      const sonnetRefused = state.model === 'sonnet' && (r.outcome === 'limit-sonnet' || r.outcome === 'sonnet-blocked')
      if (sonnetRefused && fallback) {
        // Escalation refused: the fast model goes on, told to do its best and say so.
        state = fallback
        fallback = null
        continue
      }
      if (sonnetRefused && state.step === 0) {
        const c = escalated(false)
        state = { ...state, route: c.route, model: c.model, effort: c.effort }
        continue
      }
      if (r.outcome === 'limit-request' && state.step > 0) return answer(state, 'Parei aqui para não passar do limite desta pergunta. Tente dividir em partes menores.', 'request-limit')
      return reserveFailure(r.outcome)
    }

    const maxTokens = affordableMaxTokens(state.model, inputTokens, r.grantedMicros)
    if (!maxTokens) {
      await deps.settle(r.usageId!, { ok: false, model: state.model, route: state.route, costMicros: 0, usage: null, tools: [], stop: 'no-room' })
      if (state.step > 0) return answer(state, 'Parei aqui para não passar do limite desta pergunta.', 'request-limit')
      return fail(429, 'limit', MESSAGES['limit-request'])
    }

    let res: CallResult
    try {
      res = await deps.callModel(params(state, maxTokens))
    } catch {
      await deps.settle(r.usageId!, { ok: false, model: state.model, route: state.route, costMicros: 0, usage: null, tools: [], stop: 'error' })
      return fail(502, 'upstream')
    }
    const cost = costMicros(state.model, res.usage)
    const uses = res.content.filter((b) => b.type === 'tool_use')
    await deps.settle(r.usageId!, { ok: true, model: state.model, route: state.route, costMicros: cost, usage: res.usage, tools: uses.map((u) => String(u.name)), stop: res.stop_reason })
    state = { ...state, step: state.step + 1, spentMicros: state.spentMicros + cost, messages: [...state.messages, { role: 'assistant', content: res.content }] }

    if (res.stop_reason === 'refusal') return answer(state, 'Não posso ajudar com esse pedido.', 'refusal')
    if (res.stop_reason === 'max_tokens') return answer(state, textOf(res.content) || 'A resposta ficou longa demais. Pode reformular a pergunta?', 'max_tokens')
    if (res.stop_reason !== 'tool_use' || !uses.length) return answer(state, textOf(res.content) || 'Não consegui formular uma resposta.', 'end')

    const escalate = uses.find((u) => u.name === ESCALATE_TOOL)
    if (escalate && state.model === 'haiku' && !state.escalated) {
      // Keep the fast model's state, with an answer to every lookup it asked for, in case the budget refuses.
      fallback = {
        ...state,
        escalated: true,
        effort: 'medium',
        messages: [
          ...state.messages,
          {
            role: 'user',
            content: uses.map((u) =>
              u.name === ESCALATE_TOOL
                ? { type: 'tool_result', tool_use_id: u.id, content: 'A análise profunda não está disponível agora. Responda você mesmo da melhor forma possível e diga que é uma análise simplificada.' }
                : { type: 'tool_result', tool_use_id: u.id, content: 'Consulta não executada; peça de novo se ainda precisar.', is_error: true },
            ),
          },
        ],
      }
      const c = escalated(true)
      // The deeper model restarts the question from the beginning (it does not inherit the fast model's thinking).
      state = { ...state, escalated: true, route: c.route, model: c.model, effort: c.effort, messages: [...state.base] }
      continue
    }

    const pre: unknown[] = []
    const calls: { id: string; name: string; input: Record<string, unknown> }[] = []
    for (const u of uses) {
      if (isAppTool(String(u.name))) calls.push({ id: String(u.id), name: String(u.name), input: (u.input ?? {}) as Record<string, unknown> })
      else pre.push({ type: 'tool_result', tool_use_id: u.id, content: 'Consulta indisponível.', is_error: true })
    }
    if (!calls.length) {
      state = { ...state, messages: [...state.messages, { role: 'user', content: pre }] }
      continue
    }
    // At most MAX_RESULTS_PER_STEP lookups go to the app at once; the rest get an answer asking to repeat them later.
    const now = calls.slice(0, MAX_RESULTS_PER_STEP)
    for (const c of calls.slice(MAX_RESULTS_PER_STEP)) pre.push({ type: 'tool_result', tool_use_id: c.id, content: `Limite de ${MAX_RESULTS_PER_STEP} consultas por vez: esta não foi feita. Use as que voltaram ou peça esta de novo depois.`, is_error: true })
    const sealed: TurnState = { ...state, pending: now.map((c) => ({ id: c.id, name: c.name })), pre, exp: deps.now() + TURN_TTL_MS }
    return { status: 200, body: { kind: 'tools', calls: now, envelope: await sealTurn(sealed, deps.secret), route: state.route, model: MODELS[state.model].id } }
  }
  return answer(state, 'Não consegui concluir essa análise.', 'steps')
}

function answer(state: TurnState, text: string, stop: StopReason): Outcome {
  return { status: 200, body: { kind: 'answer', text, route: state.route, model: MODELS[state.model].id, costMicros: state.spentMicros, steps: state.step, stop } }
}

export { ROUTES }
