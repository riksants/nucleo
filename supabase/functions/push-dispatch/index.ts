/**
 * Called every minute by pg_cron (see supabase/cron.sql) with a shared secret.
 * Not callable by app users: it requires DISPATCH_SECRET and uses the
 * service_role key, which exists only here as a function secret.
 */
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { dispatch, type DueRow, type Subscription } from '../_shared/push/dispatch.ts'

Deno.serve(async (req) => {
  const secret = Deno.env.get('DISPATCH_SECRET')
  if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) return new Response('forbidden', { status: 403 })

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
  if (!publicKey || !privateKey) return new Response('vapid not configured', { status: 503 })
  webpush.setVapidDetails(subject, publicKey, privateKey)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

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
      try {
        // TTL 1h: a reminder that can't be delivered within an hour is dropped, not delivered late.
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600, urgency: 'high' })
        return { gone: false }
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) return { gone: true }
        throw err
      }
    },
    async removeSubscription(id) {
      await admin.from('push_subscriptions').delete().eq('id', id)
    },
  })

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
})
