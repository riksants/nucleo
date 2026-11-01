/**
 * NÚCLEO IA — transport to the `nucleo-ia` function. The login token goes in the Authorization
 * header (supabase-js); the server takes the user from it. Nothing else identifies the person.
 *
 * Off unless the build says VITE_NUCLEO_IA=on (production stays exactly as it is until the
 * function is published with authorization).
 */
import { supabase } from '../../lib/supabase'
import type { TurnError, TurnRequest, TurnResponse } from '../../../supabase/functions/_shared/ia/protocol.ts'
import type { Transport } from '../../core/assistant/ia/client'

export const NUCLEO_IA = import.meta.env.VITE_NUCLEO_IA === 'on'

export const iaTransport: Transport = async (body: TurnRequest) => {
  if (!supabase) return { ok: false, status: 0, error: { error: 'auth', message: 'A IA precisa de uma conta conectada.' } }
  const { data, error } = await supabase.functions.invoke<TurnResponse>('nucleo-ia', { body })
  if (!error && data) return { ok: true, data }
  let payload: TurnError = { error: 'upstream', message: 'A IA não respondeu agora. Os comandos do Assistente continuam funcionando.' }
  let status = 0
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    status = ctx.status
    try {
      const p = (await ctx.json()) as Partial<TurnError>
      if (p.error && p.message) payload = { error: p.error, message: p.message }
    } catch {
      // not JSON
    }
  }
  return { ok: false, status, error: payload }
}

export async function currentUid(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}
