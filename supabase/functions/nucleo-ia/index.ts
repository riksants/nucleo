/**
 * POST /functions/v1/nucleo-ia — NÚCLEO IA (Etapa 1). NOT PUBLISHED: deploy only with authorization.
 *
 * - Signed-in user only: the JWT is checked with Supabase Auth (getUser); the user id comes only
 *   from it, never from the body.
 * - Reads NO data: lookups run in the app over the account's own synced copy. This function only
 *   talks to the model and keeps the budget.
 * - Budget in dollars, reserved before every model call and settled with the real cost
 *   (ia_reserve / ia_settle, security definer, service_role only).
 * - Turn state travels signed (IA_TURN_SECRET); nothing of the conversation is stored.
 *
 * Secrets: ANTHROPIC_API_KEY, IA_TURN_SECRET (≥ 32 chars). Same CORS list as the other functions.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { continueTurn, startTurn, type Block, type Deps, type Reservation } from '../_shared/ia/engine.ts'
import { TurnRequest } from '../_shared/ia/protocol.ts'
import { encodeEvent, STREAM_TYPE, type StreamEvent } from '../_shared/ia/stream.ts'

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://hellonucleo.app,http://localhost:5173').split(',')

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'input', message: 'Método não permitido.' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  const secret = Deno.env.get('IA_TURN_SECRET') ?? ''
  if (!apiKey || secret.length < 32) return json(req, 503, { error: 'not-configured', message: 'A IA ainda não foi configurada no servidor.' })

  const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json(req, 401, { error: 'auth', message: 'Entre na sua conta para usar a IA.' })

  let body: TurnRequest
  try {
    const raw = await req.text()
    if (raw.length > 700_000) return json(req, 413, { error: 'input', message: 'Pedido grande demais.' })
    const parsed = TurnRequest.safeParse(JSON.parse(raw))
    if (!parsed.success) return json(req, 400, { error: 'input', message: 'Pedido inválido.' })
    body = parsed.data
  } catch {
    return json(req, 400, { error: 'input', message: 'Pedido inválido.' })
  }

  const admin = createClient(url, service, { auth: { persistSession: false } })
  // One model call per HTTP request at most, and a short timeout: a retry would be charged twice.
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 60_000 })
  // Progressive answer (Etapa 5): raw text pieces go to the app, which shows only guarded, complete sentences.
  const wantsStream = (req.headers.get('accept') ?? '').includes(STREAM_TYPE)
  let emit: (e: StreamEvent) => void = () => {}

  const deps: Deps = {
    uid: userData.user.id,
    secret,
    now: () => Date.now(),
    async reserve(a) {
      const { data, error } = await admin
        .rpc('ia_reserve', { p_user: userData.user.id, p_turn: a.turnId, p_step: a.step, p_model: a.model, p_route: a.route, p_wanted: a.wantedMicros, p_min: a.minMicros })
        .single<{ outcome: Reservation['outcome']; usage_id: number | null; granted: number }>()
      if (error || !data) return { outcome: 'paused', usageId: null, grantedMicros: 0 }
      return { outcome: data.outcome, usageId: data.usage_id, grantedMicros: Number(data.granted) }
    },
    async settle(id, a) {
      await admin.rpc('ia_settle', {
        p_id: id,
        p_ok: a.ok,
        p_cost: a.costMicros,
        p_input: a.usage?.input_tokens ?? 0,
        p_output: a.usage?.output_tokens ?? 0,
        p_cache_read: a.usage?.cache_read_input_tokens ?? 0,
        p_cache_write: a.usage?.cache_creation_input_tokens ?? 0,
        p_tools: a.tools,
        p_stop: a.stop,
      })
    },
    async callModel(params) {
      // Streaming keeps long answers clear of HTTP timeouts; the final message is what we use.
      emit({ t: 'r' })
      const stream = client.messages.stream(params as unknown as Anthropic.MessageStreamParams)
      if (wantsStream) stream.on('text', (s: string) => emit({ t: 'd', s }))
      const msg = await stream.finalMessage()
      return { content: msg.content as unknown as Block[], stop_reason: msg.stop_reason, usage: msg.usage, model: msg.model }
    },
  }

  const run = async () => {
    try {
      return body.kind === 'start' ? await startTurn(body, deps) : await continueTurn(body, deps)
    } catch {
      return { status: 502, body: { error: 'upstream', message: 'A IA não respondeu agora. Os comandos do Assistente continuam funcionando.' } }
    }
  }
  if (!wantsStream) {
    const out = await run()
    return json(req, out.status, out.body)
  }
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      emit = (e) => {
        try {
          ctrl.enqueue(enc.encode(encodeEvent(e)))
        } catch {
          // the app went away: the turn still finishes and is settled
        }
      }
      const out = await run()
      emit({ t: 'end', status: out.status, body: out.body })
      emit = () => {}
      ctrl.close()
    },
  })
  return new Response(stream, { status: 200, headers: { ...cors(req), 'Content-Type': STREAM_TYPE, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
})
