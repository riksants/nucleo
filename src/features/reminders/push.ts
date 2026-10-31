/**
 * Web Push: the only way a PWA shows notifications with the app closed.
 * - Android/desktop Chrome, Edge, Firefox: works in the browser and installed.
 * - iPhone/iPad: only iOS/iPadOS 16.4+ and only from the app added to the Home
 *   Screen; the permission must be requested from a tap.
 * Scheduling happens on the server (pg_cron → push-dispatch), never with page timers.
 */
import { parseQuota, quotaMessage } from '../../data/quota'
import { readPref, writePref } from '../../lib/prefs'
import { supabase } from '../../lib/supabase'
import type { Occurrence, Series } from './engine'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
/** This device asked for notifications (so a lost subscription is renewed at the next opening). */
const WANTED_KEY = 'pushWanted'

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

async function subscribeAndClaim(): Promise<void> {
  if (!supabase || !VAPID_PUBLIC_KEY) throw new Error('Notificações push não configuradas neste app.')
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY) }))
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  const { error } = await supabase.rpc('claim_push_endpoint', { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth })
  if (error) {
    const quota = parseQuota(error.message)
    throw new Error(quota ? quotaMessage(quota) : error.message)
  }
}

/** Must be called from a tap (iOS requires a user gesture for the permission prompt). */
export async function enablePush(): Promise<void> {
  if (!supabase || !VAPID_PUBLIC_KEY) throw new Error('Notificações push não configuradas neste app.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Permissão negada. Você pode liberar nas configurações do aparelho.')
  await subscribeAndClaim()
  writePref(WANTED_KEY, true)
}

/**
 * At each opening (signed in): makes sure the server still has this device. The push service can
 * replace or expire a subscription, and the dispatcher drops endpoints that stopped answering;
 * without this, notifications would silently stop until the person turned them on again.
 * Never asks for permission (that needs a tap) and does nothing on a device that never opted in.
 */
export async function refreshPush(): Promise<void> {
  if (!supabase || !VAPID_PUBLIC_KEY || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (!(await currentSubscription()) && !readPref(WANTED_KEY, false)) return
  await subscribeAndClaim()
  writePref(WANTED_KEY, true)
}

/** Stops this device from receiving this account's notifications (used on logout too). */
export async function forgetPushOnThisDevice(): Promise<void> {
  writePref(WANTED_KEY, false)
  const sub = await currentSubscription()
  if (!sub) return
  if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

/**
 * Ends push on this device and closes the notifications already shown. No server call, so it
 * also works after the session ended (the dispatcher drops the dead endpoint on its next send).
 */
export async function silencePushOnThisDevice(): Promise<void> {
  writePref(WANTED_KEY, false)
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return
  for (const n of await reg.getNotifications()) n.close()
  await (await reg.pushManager.getSubscription())?.unsubscribe()
}

const MAX_SCHEDULED = 900
const OWNED_FOCUS = 'pushFocusKeys'

export interface ScheduleBasis {
  /** Newest server change this device downloaded (records). */
  cursor: string | null
  /** This device's settings version. */
  settingsAt: string | null
}

export interface ScheduleInput {
  occurrences: Occurrence[]
  series: Series[]
  /** Until when `occurrences` is the exact list (the server only adds after this). */
  until: Date
  tz: string
  quiet: { from: string; to: string } | null
  basis: ScheduleBasis
}

/** ok · stale: the server has newer data than this device (nothing was written) · legacy: older server, old path used. */
export type ScheduleResult = 'ok' | 'stale' | 'legacy'

type ServerRow = { key: string; fire_at: string; title: string; body: string; url: string; detail?: string; kind?: string; custom?: boolean; origin?: string }

const rowOf = (o: Occurrence) => ({
  key: o.key,
  fire_at: o.fireAt.toISOString(),
  title: o.title.slice(0, 120),
  body: o.body.slice(0, 240),
  url: o.url,
  kind: o.kind,
  custom: o.custom,
  detail: o.detail.slice(0, 300),
})

/** Comparable form of a series (the server returns "09:00:00" for times and nulls for empty dates). */
export function seriesSig(s: { template: unknown; rule: unknown; start?: unknown; end?: unknown; skip?: unknown; dayOffset: unknown; time: unknown; minus: unknown; kind: unknown; custom?: unknown; title: unknown; body: unknown; detail?: unknown; url?: unknown }) {
  return JSON.stringify([s.template, s.rule, s.start || null, s.end || null, s.skip ?? [], Number(s.dayOffset), String(s.time).slice(0, 5), Number(s.minus), s.kind, !!s.custom, s.title, s.body, s.detail ?? '', s.url ?? ''])
}

type PgError = { code?: string; message?: string } | null
const missingFunction = (e: PgError, name: string) => !!e && (e.code === 'PGRST202' || new RegExp(`${name}|could not find the function`, 'i').test(e.message ?? ''))
const missingColumn = (e: PgError) => !!e && (e.code === '42703' || /column .* does not exist/i.test(e.message ?? ''))

/** What needs to change on the server so it matches this device (pure; tested on its own). */
export function planSchedule(input: Pick<ScheduleInput, 'occurrences' | 'series' | 'until'>, existing: ServerRow[], serverSeries: Map<string, string>, ownFocus: Set<string>, now = Date.now()) {
  const wantedList = input.occurrences.filter((o) => o.fireAt.getTime() > now).slice(0, MAX_SCHEDULED)
  const wanted = new Set(wantedList.map((o) => o.key))
  const untilMs = input.until.getTime()
  // A focus timer belongs to the device running it: other devices never remove it. Tests stay too.
  const deletes = existing
    .filter((r) => !wanted.has(r.key) && r.origin !== 'test' && Date.parse(r.fire_at) <= untilMs && (!r.key.startsWith('focus:') || ownFocus.has(r.key)))
    .map((r) => r.key)
  const known = new Map(existing.map((r) => [r.key, r]))
  const upserts = wantedList.map(rowOf).filter((row) => {
    const was = known.get(row.key)
    return (
      !was ||
      (was.origin ?? 'app') !== 'app' ||
      Date.parse(was.fire_at) !== Date.parse(row.fire_at) ||
      was.title !== row.title ||
      was.body !== row.body ||
      was.url !== row.url ||
      (was.detail ?? '') !== row.detail ||
      !!was.custom !== row.custom ||
      (was.kind ?? '') !== row.kind
    )
  })
  const seriesKeys = new Set(input.series.map((s) => s.key))
  const seriesUp = input.series.filter((s) => serverSeries.get(s.key) !== seriesSig(s))
  const seriesDel = [...serverSeries.keys()].filter((k) => !seriesKeys.has(k))
  return { upserts, deletes, seriesUp, seriesDel, focus: wantedList.filter((o) => o.kind === 'focus').map((o) => o.key) }
}

/**
 * Mirrors this device's reminders to the server, so they arrive with the app closed:
 * the exact list of the next 14 days plus the series the server renews after that.
 *
 * Revision (Etapa 5): everything goes in one call, with the version of the data this device has.
 * The server refuses ('stale') when the account has anything newer, so an outdated device never
 * overwrites, recreates or deletes reminders. Only changes are sent.
 */
export async function syncSchedule(input: ScheduleInput): Promise<ScheduleResult> {
  if (!supabase) return 'ok'
  const nowIso = new Date().toISOString()
  const sel = await supabase.from('scheduled_notifications').select('key,fire_at,title,body,url,detail,kind,custom,origin').is('sent_at', null).gt('fire_at', nowIso)
  if (missingColumn(sel.error)) return legacySync(input.occurrences)
  if (sel.error) throw new Error(sel.error.message)
  const ser = await supabase.from('notification_series').select('key,template,rule,start_date,end_date,skip,day_offset,at_time,minus_min,kind,custom,title,body,detail,url')
  if (ser.error) throw new Error(ser.error.message)
  const serverSeries = new Map(
    ((ser.data ?? []) as Record<string, unknown>[]).map((r) => [
      r.key as string,
      seriesSig({ template: r.template, rule: r.rule, start: r.start_date, end: r.end_date, skip: r.skip, dayOffset: r.day_offset, time: r.at_time, minus: r.minus_min, kind: r.kind, custom: r.custom, title: r.title, body: r.body, detail: r.detail, url: r.url }),
    ]),
  )
  const plan = planSchedule(input, (sel.data ?? []) as ServerRow[], serverSeries, new Set(readPref<string[]>(OWNED_FOCUS, [])))

  const { data, error } = await supabase.rpc('sync_notifications', {
    p_cursor: input.basis.cursor,
    p_settings_at: input.basis.settingsAt,
    p_until: input.until.toISOString(),
    p_upserts: plan.upserts,
    p_deletes: plan.deletes,
    p_series: plan.seriesUp,
    p_series_deletes: plan.seriesDel,
    p_state: { tz: input.tz, quietFrom: input.quiet?.from ?? null, quietTo: input.quiet?.to ?? null },
  })
  if (missingFunction(error, 'sync_notifications')) return legacySync(input.occurrences)
  if (error) {
    const quota = parseQuota(error.message)
    throw new Error(quota ? quotaMessage(quota) : error.message)
  }
  if ((data as { status?: string } | null)?.status === 'stale') return 'stale'
  writePref(OWNED_FOCUS, plan.focus)
  return 'ok'
}

/** Before the Etapa 5 migration: direct writes, as before (the server has no revision check yet). */
async function legacySync(occurrences: Occurrence[]): Promise<ScheduleResult> {
  if (!supabase) return 'legacy'
  const now = new Date().toISOString()
  const { data: existing, error } = await supabase.from('scheduled_notifications').select('key,fire_at,title,body,url').is('sent_at', null).gt('fire_at', now)
  if (error) throw new Error(error.message)
  const wanted = new Set(occurrences.map((o) => o.key))
  const stale = (existing ?? []).map((r) => r.key as string).filter((k) => !wanted.has(k))
  for (let i = 0; i < stale.length; i += 100) {
    await supabase.from('scheduled_notifications').delete().in('key', stale.slice(i, i + 100)).is('sent_at', null)
  }
  const known = new Map((existing ?? []).map((r) => [r.key as string, r as { fire_at: string; title: string; body: string; url: string }]))
  const changed = occurrences
    .filter((o) => o.fireAt.getTime() > Date.now())
    .slice(0, MAX_SCHEDULED)
    .map((o) => ({ key: o.key, fire_at: o.fireAt.toISOString(), title: o.title.slice(0, 120), body: o.body.slice(0, 240), url: o.url }))
    .filter((row) => {
      const was = known.get(row.key)
      return !was || Date.parse(was.fire_at) !== Date.parse(row.fire_at) || was.title !== row.title || was.body !== row.body || was.url !== row.url
    })
  for (let i = 0; i < changed.length; i += 200) {
    const rows = changed.slice(i, i + 200)
    const { error: upsertError } = await supabase.from('scheduled_notifications').upsert(rows, { onConflict: 'user_id,key' })
    if (upsertError) throw new Error(upsertError.message)
  }
  return 'legacy'
}

/** "Enviar teste": a real push through the server (cron → função → serviço de push), in up to a minute. */
export async function sendTestPush(): Promise<void> {
  if (!supabase) throw new Error('Notificações push não configuradas neste app.')
  const { error } = await supabase.rpc('send_test_notification')
  if (missingFunction(error, 'send_test_notification')) throw new Error('O servidor ainda não tem o teste de notificação (atualização pendente).')
  if (error) throw new Error(parseQuota(error.message) ? 'Você já enviou 5 testes na última hora. Tente mais tarde.' : error.message)
}
