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
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://riksants.github.io,http://localhost:5173').split(',')

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
  // Same request again (retry, double tap): never runs twice. The text is not stored, so it is not replayed either.
  const { data: existing } = await admin.from('ai_usage').select('status').eq('user_id', userId).eq('request_id', body.requestId).maybeSingle()
  if (existing) return json(req, 409, { error: 'duplicate', message: 'Esse pedido já foi feito.' })

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { count } = await admin.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', 'assistant').gte('created_at', since).neq('status', 'error')
  if ((count ?? 0) >= DAILY_LIMIT) return json(req, 429, { error: 'limit', message: `Limite de ${DAILY_LIMIT} interpretações por dia atingido. Os comandos do Assistente continuam funcionando.` })
  // One at a time per person (no loops).
  const { data: running } = await admin.from('ai_usage').select('id').eq('user_id', userId).eq('kind', 'assistant').eq('status', 'pending').gte('created_at', new Date(Date.now() - 60_000).toISOString()).limit(1)
  if (running?.length) return json(req, 429, { error: 'busy', message: 'Aguarde a interpretação anterior terminar.' })

  const { data: row, error: insertError } = await admin.from('ai_usage').insert({ user_id: userId, kind: 'assistant', request_id: body.requestId, status: 'pending' }).select('id').single()
  if (insertError || !row) return json(req, 409, { error: 'duplicate', message: 'Esse pedido já foi feito.' })

  try {
    const client = new Anthropic({ apiKey })
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
