/**
 * Called every minute by pg_cron (see supabase/cron.sql) with a shared secret.
 * Not callable by app users: it requires DISPATCH_SECRET and uses the
 * service_role key, which exists only here as a function secret.
 */
import { createClient } from '@supabase/supabase-js'
import { dispatch, type DueRow, type Subscription } from '../_shared/push/dispatch.ts'
import { sendWebPush, type Vapid } from '../_shared/push/webpush.ts'

Deno.serve(async (req) => {
  const secret = Deno.env.get('DISPATCH_SECRET')
  if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) return new Response('forbidden', { status: 403 })

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!publicKey || !privateKey) return new Response('vapid not configured', { status: 503 })
  const vapid: Vapid = { subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', publicKey, privateKey }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  try {
    const result = await dispatch({
      async claim(limit) {
        const { data, error } = await admin.rpc('claim_due_notifications', { p_limit: limit })
        if (error) throw new Error(error.message)
        return (data ?? []) as DueRow[]
      },
      async subscriptionsFor(userIds) {
        const { data, error } = await admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', userIds)
        if (error) throw new Error(error.message)
        return (data ?? []) as Subscription[]
      },
      async send(sub, payload) {
        // TTL 1h: a reminder that can't be delivered within an hour is dropped, not delivered late.
        const res = await sendWebPush(sub, payload, vapid, { ttl: 3600, urgency: 'high' })
        return { gone: res.gone }
      },
      async removeSubscription(id) {
        await admin.from('push_subscriptions').delete().eq('id', id)
      },
      onError(err) {
        console.error('push-dispatch send:', err instanceof Error ? err.message : String(err))
      },
    })
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('push-dispatch:', err instanceof Error ? err.message : String(err))
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'erro' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
