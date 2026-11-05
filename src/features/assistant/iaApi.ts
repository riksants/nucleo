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
import { readEvents, STREAM_TYPE, type StreamEvent } from '../../../supabase/functions/_shared/ia/stream.ts'

export const NUCLEO_IA = import.meta.env.VITE_NUCLEO_IA === 'on'

const UPSTREAM: TurnError = { error: 'upstream', message: 'A IA não respondeu agora. Os comandos do Assistente continuam funcionando.' }

/**
 * Progressive answer: same request, `Accept: application/x-ndjson`; the text pieces go to `onEvent`
 * (the app shows only guarded, complete sentences) and the last line is the usual body.
 * Where streaming is not available (old browser, a proxy), the plain JSON request is used.
 */
export const iaTransport: Transport = async (body: TurnRequest, onEvent?: (e: StreamEvent) => void) => {
  if (!supabase) return { ok: false, status: 0, error: { error: 'auth', message: 'A IA precisa de uma conta conectada.' } }
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (onEvent && base && anon && typeof ReadableStream !== 'undefined') {
    const { data: s } = await supabase.auth.getSession()
    const token = s.session?.access_token
    if (!token) return { ok: false, status: 401, error: { error: 'auth', message: 'Entre na sua conta para usar a IA.' } }
    let res: Response
    try {
      res = await fetch(`${base}/functions/v1/nucleo-ia`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: anon, 'Content-Type': 'application/json', Accept: `${STREAM_TYPE}, application/json` }, body: JSON.stringify(body) })
    } catch {
      return { ok: false, status: 0, error: UPSTREAM }
    }
    if ((res.headers.get('content-type') ?? '').includes(STREAM_TYPE) && res.body) {
      try {
        const end = await readEvents(res.body, onEvent)
        if (!end) return { ok: false, status: 0, error: UPSTREAM }
        if (end.status === 200) return { ok: true, data: end.body as TurnResponse }
        const p = end.body as Partial<TurnError>
        return { ok: false, status: end.status, error: p?.error && p.message ? { error: p.error, message: p.message } : UPSTREAM }
      } catch {
        return { ok: false, status: 0, error: UPSTREAM }
      }
    }
    try {
      const p = (await res.json()) as TurnResponse | Partial<TurnError>
      if (res.ok) return { ok: true, data: p as TurnResponse }
      const e = p as Partial<TurnError>
      return { ok: false, status: res.status, error: e.error && e.message ? { error: e.error, message: e.message } : UPSTREAM }
    } catch {
      return { ok: false, status: res.status, error: UPSTREAM }
    }
  }
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

import type { UsageRow as IaUsage } from '../../core/assistant/ia/usage'

/** The person's own level and use (ia_my_usage: only their own rows, from the verified login). */
export async function iaUsage(): Promise<IaUsage | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('ia_my_usage').maybeSingle<{ tier: string; valid_until: string | null; spent_day: number; daily: number; spent_period: number; period: number; spent_sonnet: number; sonnet_period: number; day_resets: string | null; period_resets: string | null }>()
  if (error || !data) return null
  return { tier: data.tier, validUntil: data.valid_until, spentDay: Number(data.spent_day), daily: Number(data.daily), spentPeriod: Number(data.spent_period), period: Number(data.period), spentSonnet: Number(data.spent_sonnet), sonnetPeriod: Number(data.sonnet_period), dayResets: data.day_resets ?? null, periodResets: data.period_resets ?? null }
}
