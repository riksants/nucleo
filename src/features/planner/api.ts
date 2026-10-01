import type { MealsResult, PlannerRequest, RoutineResult } from '../../../supabase/functions/_shared/planner/ai.ts'
import { supabase } from '../../lib/supabase'

export interface PlannerResponse {
  model: string
  generatedAt: string
  routine?: RoutineResult
  meals?: MealsResult
  replayed?: boolean
}

export class PlannerError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

/** Calls the Edge Function. The same requestId is reused on retry so nothing runs twice. */
export async function requestPlan(body: PlannerRequest): Promise<PlannerResponse> {
  if (!supabase) throw new PlannerError('A IA precisa de uma conta conectada.', 'not-configured')
  const { data, error } = await supabase.functions.invoke<PlannerResponse>('planner', { body })
  if (error) {
    let message = 'Não foi possível gerar agora. Você pode montar à mão.'
    let code = 'unknown'
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = (await ctx.json()) as { message?: string; error?: string }
        if (payload.message) message = payload.message
        if (payload.error) code = payload.error
      } catch {
        // not JSON
      }
    } else if (error.name === 'FunctionsFetchError') {
      message = 'Sem conexão com o servidor.'
      code = 'offline'
    }
    throw new PlannerError(message, code)
  }
  if (!data) throw new PlannerError('Resposta vazia do servidor.', 'invalid')
  return data
}

export function newRequestId(): string {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}
