/**
 * POST /functions/v1/planner — generates a routine and/or meal plan.
 *
 * - Requires a signed-in user (JWT checked with Supabase Auth).
 * - ANTHROPIC_API_KEY and the service_role key exist only as function secrets.
 * - Daily limit per user, one generation at a time, and the same requestId
 *   never runs twice (a retry returns the stored result).
 * - The output is validated and filtered here (conflicts, allergies) before it
 *   is returned; the app runs the same checks again before showing it.
 */
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import {
  callPlanner,
  finishMeals,
  finishRoutine,
  PlannerInvalid,
  PlannerRefusal,
  PlannerRequest,
  screeningProblem,
  type BothOutput,
  type MealOutput,
  type RoutineOutput,
} from '../_shared/planner/ai.ts'
import { fixedBlocks } from '../_shared/planner/schedule.ts'
import type { MealAnswers, RoutineAnswers } from '../_shared/planner/types.ts'
import type { z } from 'zod'

const DAILY_LIMIT = Number(Deno.env.get('PLANNER_DAILY_LIMIT') ?? '10')
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
  if (!apiKey) return json(req, 503, { error: 'not-configured', message: 'A IA ainda não foi configurada no servidor.' })

  // Who is calling: the user's own JWT, verified by Supabase Auth.
  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json(req, 401, { error: 'auth', message: 'Entre na sua conta para usar a IA.' })
  const userId = userData.user.id

  let body: PlannerRequest
  try {
    const parsed = PlannerRequest.safeParse(await req.json())
    if (!parsed.success) return json(req, 400, { error: 'input', message: 'Respostas inválidas ou sem consentimento.' })
    body = parsed.data
  } catch {
    return json(req, 400, { error: 'input', message: 'Pedido inválido.' })
  }
  if ((body.mode !== 'meals' && !body.routine) || (body.mode !== 'routine' && !body.meals)) {
    return json(req, 400, { error: 'input', message: 'Faltam respostas do questionário.' })
  }
  const screening = screeningProblem(body)
  if (screening === 'clinical') return json(req, 422, { error: 'clinical', message: 'Para necessidades clínicas, o planejamento deve ser feito com nutricionista.' })
  if (screening === 'fixed-conflicts') return json(req, 422, { error: 'conflicts', message: 'Há compromissos fixos que se sobrepõem. Corrija antes de gerar.' })

  const admin = createClient(url, service, { auth: { persistSession: false } })

  // Same request again (retry, double tap): return what was already produced.
  const { data: existing } = await admin.from('ai_usage').select('status,result').eq('user_id', userId).eq('request_id', body.requestId).maybeSingle()
  if (existing?.status === 'ok') return json(req, 200, { ...existing.result, replayed: true })
  if (existing?.status === 'pending') return json(req, 409, { error: 'busy', message: 'Essa geração já está em andamento.' })

  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { count } = await admin.from('ai_usage').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since).neq('status', 'error')
  if ((count ?? 0) >= DAILY_LIMIT) return json(req, 429, { error: 'limit', message: `Limite de ${DAILY_LIMIT} gerações por dia atingido. Você ainda pode editar o plano à mão.` })

  const { data: running } = await admin
    .from('ai_usage')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .gte('created_at', new Date(Date.now() - 3 * 60_000).toISOString())
    .limit(1)
  if (running?.length) return json(req, 409, { error: 'busy', message: 'Já existe uma geração em andamento. Aguarde terminar.' })

  // The unique (user_id, request_id) constraint makes a concurrent duplicate fail here.
  const { data: row, error: insertError } = await admin.from('ai_usage').insert({ user_id: userId, kind: body.mode, request_id: body.requestId, status: 'pending' }).select('id').single()
  if (insertError || !row) return json(req, 409, { error: 'busy', message: 'Essa geração já está em andamento.' })

  try {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 120_000 })
    const { output, model } = await callPlanner(client, body)
    const result: Record<string, unknown> = { model, generatedAt: new Date().toISOString() }
    const routineOut = body.mode === 'both' ? (output as z.infer<typeof BothOutput>).routine : body.mode === 'routine' ? (output as z.infer<typeof RoutineOutput>) : null
    const mealOut = body.mode === 'both' ? (output as z.infer<typeof BothOutput>).meals : body.mode === 'meals' ? (output as z.infer<typeof MealOutput>) : null
    const routineAnswers = body.routine as RoutineAnswers | undefined
    if (routineOut && routineAnswers) result.routine = finishRoutine(routineAnswers, routineOut)
    if (mealOut && body.meals) {
      const blocks = (result.routine as { blocks?: unknown } | undefined)?.blocks ?? (routineAnswers ? fixedBlocks(routineAnswers) : undefined)
      result.meals = finishMeals(body.meals as MealAnswers, mealOut, routineAnswers && blocks ? { answers: routineAnswers, blocks: blocks as never } : undefined)
    }
    await admin.from('ai_usage').update({ status: 'ok', result }).eq('id', row.id)
    return json(req, 200, result)
  } catch (err) {
    await admin.from('ai_usage').update({ status: 'error' }).eq('id', row.id)
    // Never log the answers themselves (health data); only the error class.
    console.error('planner failed', err instanceof Error ? err.name : 'unknown')
    if (err instanceof PlannerRefusal) return json(req, 422, { error: 'refusal', message: err.message })
    if (err instanceof PlannerInvalid) return json(req, 502, { error: 'invalid', message: `${err.message} Tente de novo ou edite à mão.` })
    if (err instanceof Anthropic.RateLimitError) return json(req, 503, { error: 'busy', message: 'A IA está ocupada agora. Tente em alguns minutos.' })
    if (err instanceof Anthropic.APIConnectionError) return json(req, 503, { error: 'offline', message: 'Não foi possível falar com a IA agora.' })
    if (err instanceof Anthropic.APIError) return json(req, 502, { error: 'api', message: 'A IA respondeu com erro. Tente de novo mais tarde.' })
    return json(req, 500, { error: 'unknown', message: 'Falha inesperada ao gerar.' })
  }
})
