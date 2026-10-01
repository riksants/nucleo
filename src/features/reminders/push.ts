/**
 * Web Push: the only way a PWA shows notifications with the app closed.
 * - Android/desktop Chrome, Edge, Firefox: works in the browser and installed.
 * - iPhone/iPad: only iOS/iPadOS 16.4+ and only from the app added to the Home
 *   Screen; the permission must be requested from a tap.
 * Scheduling happens on the server (pg_cron → push-dispatch), never with page timers.
 */
import { supabase } from '../../lib/supabase'
import type { Occurrence } from './engine'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: 'no-api' | 'ios-needs-install' | 'ios-too-old' | 'not-configured' | 'no-account' | 'denied' }

export function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

function iosVersion(): number | null {
  const m = navigator.userAgent.match(/OS (\d+)_(\d+)/)
  return m ? Number(m[1]) + Number(m[2]) / 10 : null
}

export function pushSupport(signedIn: boolean): PushSupport {
  if (isIOS()) {
    const v = iosVersion()
    if (v !== null && v < 16.4) return { ok: false, reason: 'ios-too-old' }
    if (!isStandalone()) return { ok: false, reason: 'ios-needs-install' }
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, reason: 'no-api' }
  if (!VAPID_PUBLIC_KEY || !supabase) return { ok: false, reason: 'not-configured' }
  if (!signedIn) return { ok: false, reason: 'no-account' }
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }
  return { ok: true }
}

function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

/** Must be called from a tap (iOS requires a user gesture for the permission prompt). */
export async function enablePush(): Promise<void> {
  if (!supabase || !VAPID_PUBLIC_KEY) throw new Error('Notificações push não configuradas neste app.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Permissão negada. Você pode liberar nas configurações do aparelho.')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY) }))
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  const { error } = await supabase.rpc('claim_push_endpoint', { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth })
  if (error) throw new Error(error.message)
}

/** Stops this device from receiving this account's notifications (used on logout too). */
export async function forgetPushOnThisDevice(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

/**
 * Mirrors the next 14 days of reminders to the server, so they can be sent
 * with the app closed. Removed or changed sources disappear from the server
 * too. Keys are unique per account, so running this on two devices is harmless.
 */
export async function syncSchedule(occurrences: Occurrence[]): Promise<void> {
  if (!supabase) return
  const now = new Date().toISOString()
  const { data: existing, error } = await supabase.from('scheduled_notifications').select('key').is('sent_at', null).gt('fire_at', now)
  if (error) throw new Error(error.message)
  const wanted = new Set(occurrences.map((o) => o.key))
  const stale = (existing ?? []).map((r) => r.key as string).filter((k) => !wanted.has(k))
  for (let i = 0; i < stale.length; i += 100) {
    await supabase.from('scheduled_notifications').delete().in('key', stale.slice(i, i + 100)).is('sent_at', null)
  }
  const future = occurrences.filter((o) => o.fireAt.getTime() > Date.now())
  for (let i = 0; i < future.length; i += 200) {
    const rows = future.slice(i, i + 200).map((o) => ({ key: o.key, fire_at: o.fireAt.toISOString(), title: o.title.slice(0, 120), body: o.body.slice(0, 240), url: o.url }))
    const { error: upsertError } = await supabase.from('scheduled_notifications').upsert(rows, { onConflict: 'user_id,key' })
    if (upsertError) throw new Error(upsertError.message)
  }
}
