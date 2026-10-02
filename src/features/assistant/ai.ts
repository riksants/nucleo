import { supabase } from '../../lib/supabase'
import { newRequestId } from '../planner/api'

/**
 * Calls the optional interpreter (Edge Function "assistant"). Sends ONLY the
 * sentence and today's date — no records, no settings, no credentials. The
 * key lives on the server; the browser never sees it.
 */
export async function interpretWithAi(text: string, today: string): Promise<unknown> {
  if (!supabase) throw new Error('O interpretador com IA precisa de uma conta conectada.')
  const { data, error } = await supabase.functions.invoke<{ intent: unknown }>('assistant', { body: { requestId: newRequestId(), text, today, consent: true } })
  if (error) {
    let message = 'A IA não respondeu agora. Os comandos do Assistente continuam funcionando.'
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const payload = (await ctx.json()) as { message?: string }
        if (payload.message) message = payload.message
      } catch {
        // not JSON
      }
    }
    throw new Error(message)
  }
  return data?.intent
}

export const aiAvailable = () => Boolean(supabase)
