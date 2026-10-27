/**
 * POST /functions/v1/assistant — optional interpreter of free sentences.
 *
 * Off by default in the app; only called after the person turns it on and
 * consents. Security and cost:
 * - signed-in user only (JWT verified with Supabase Auth);
 * - ANTHROPIC_API_KEY and service_role exist only as function secrets;
 * - receives only the sentence and today's date — never records;
 * - returns only an intent, validated here and again in the app; it executes nothing;
 * - daily limit per user, one request at a time, same requestId never runs twice;
 * - usage stored as numbers (tokens) without the text.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { AssistantRequest, callInterpreter, InterpreterRefusal } from '../_shared/assistant/ai.ts'

const DAILY_LIMIT = Number(Deno.env.get('ASSISTANT_DAILY_LIMIT') ?? '30')
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

function json(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'method' })

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json(req, 503, { error: 'not-configured', message: 'O interpretador com IA ainda não foi configurado no servidor.' })

  const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json(req, 401, { error: 'auth', message: 'Entre na sua conta para usar a IA.' })
  const userId = userData.user.id

  let body: AssistantRequest
  try {
    const parsed = AssistantRequest.safeParse(await req.json())
    if (!parsed.success) return json(req, 400, { error: 'input', message: 'Pedido inválido ou sem consentimento.' })
    body = parsed.data
  } catch {
    return json(req, 400, { error: 'input', message: 'Pedido inválido.' })
  }

  const admin = createClient(url, service, { auth: { persistSession: false } })
  // One atomic step in the database (migration 20261027000000): the same request never runs twice (the
  // text is not stored, so it is not replayed either), one at a time per person, failed ones count in
  // the daily limit, and a daily ceiling for all accounts together.
  const { data: reserved, error: reserveError } = await admin
    .rpc('ai_reserve', { p_user: userId, p_kind: 'assistant', p_request_id: body.requestId, p_daily_limit: DAILY_LIMIT, p_busy_seconds: 60 })
    .single<{ outcome: string; usage_id: number | null }>()
  if (reserveError || !reserved) return json(req, 503, { error: 'busy', message: 'A IA não respondeu agora. Os comandos do Assistente continuam funcionando.' })
  if (reserved.outcome === 'replay' || reserved.outcome === 'duplicate') return json(req, 409, { error: 'duplicate', message: 'Esse pedido já foi feito.' })
  if (reserved.outcome === 'busy') return json(req, 429, { error: 'busy', message: 'Aguarde a interpretação anterior terminar.' })
  if (reserved.outcome === 'limit') return json(req, 429, { error: 'limit', message: `Limite de ${DAILY_LIMIT} interpretações por dia atingido. Os comandos do Assistente continuam funcionando.` })
  if (reserved.outcome === 'global-limit') return json(req, 503, { error: 'limit', message: 'A IA atingiu o limite do dia. Os comandos do Assistente continuam funcionando.' })
  const row = { id: reserved.usage_id! }

  try {
    // A short sentence: a slow answer is not worth waiting for, and a retry would be charged twice.
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 30_000 })
    const { intent, model, inputTokens, outputTokens } = await callInterpreter(client, body)
    // Only the kind of intent and token counts are kept — never the sentence or the answer.
    await admin.from('ai_usage').update({ status: 'ok', result: { type: intent.type, model }, input_tokens: inputTokens, output_tokens: outputTokens }).eq('id', row.id)
    return json(req, 200, { intent })
  } catch (err) {
    await admin.from('ai_usage').update({ status: 'error' }).eq('id', row.id)
    if (err instanceof InterpreterRefusal) return json(req, 422, { error: 'refusal', message: 'Não foi possível interpretar esse pedido.' })
    return json(req, 502, { error: 'upstream', message: 'A IA não respondeu agora. Os comandos do Assistente continuam funcionando.' })
  }
})
