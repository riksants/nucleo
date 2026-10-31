/**
 * The notification center's list: what is scheduled (computed from the records, exact), what was
 * sent (the server's history, kept 30 days and synced across devices) and what was shown inside
 * the app. Each entry says only what is known: "Enviado" means a push service accepted it — the
 * Núcleo can't know whether the phone showed it or the person read it. "Lida" is only set by the
 * person (opening it here or marking it).
 */
import { useSyncExternalStore } from 'react'
import { readPref, writePref } from '../../lib/prefs'
import { supabase } from '../../lib/supabase'
import type { ReminderKind } from '../../data/types'
import type { Occurrence } from '../reminders/engine'

export type EntryState = 'scheduled' | 'sent' | 'failed' | 'nodevice' | 'expired' | 'processed' | 'inApp'
export type EntryOrigin = 'mine' | 'auto' | 'app' | 'test'

export interface FeedEntry {
  key: string
  at: Date
  title: string
  text: string
  url: string
  kind: ReminderKind | ''
  origin: EntryOrigin
  state: EntryState
  grouped: boolean
  seen: boolean
  dismissed: boolean
  error: string | null
  /** Comes from the server history (marks sync across devices). */
  server: boolean
}

export const STATE_LABEL: Record<EntryState, string> = {
  scheduled: 'Agendado',
  sent: 'Enviado',
  failed: 'Falhou',
  nodevice: 'Não enviado · nenhum aparelho',
  expired: 'Não enviado a tempo',
  processed: 'Processado',
  inApp: 'Mostrado no app',
}

export const STATE_HINT: Record<EntryState, string> = {
  scheduled: 'Vai ser enviado no horário.',
  sent: 'O serviço de notificações do aparelho aceitou o envio. O Núcleo não tem como saber se ele apareceu na tela ou se você viu.',
  failed: 'O serviço de notificações recusou o envio para todos os aparelhos.',
  nodevice: 'Nenhum aparelho desta conta estava com notificações ligadas na hora.',
  expired: 'O servidor não conseguiu enviar dentro de 6 horas (por exemplo, fora do ar). Não é enviado atrasado.',
  processed: 'Enviado antes do histórico existir: o resultado não foi guardado.',
  inApp: 'Apareceu dentro do Núcleo, com o app aberto.',
}

export const ORIGIN_LABEL: Record<EntryOrigin, string> = {
  mine: 'Seu lembrete',
  auto: 'Automático',
  app: 'Aviso do app',
  test: 'Teste',
}

/* ------------------------------------------------------------------ local log (no account, or before the server history) */

interface LocalEntry {
  key: string
  at: number
  title: string
  text: string
  url: string
  kind: ReminderKind
  custom: boolean
}
interface Marks {
  [key: string]: { seen?: number; dismissed?: number }
}

const KEEP_MS = 30 * 86_400_000
let owner = 'local'
const logKey = () => `noticeLog:${owner}`
const marksKey = () => `noticeMarks:${owner}`

/** Local records are kept per account on this device (never shown to another account). */
export function setFeedOwner(uid: string | null) {
  owner = uid ?? 'local'
  emit()
}

function readLog(): LocalEntry[] {
  const cutoff = Date.now() - KEEP_MS
  return readPref<LocalEntry[]>(logKey(), []).filter((e) => e.at > cutoff)
}
function readMarks(): Marks {
  return readPref<Marks>(marksKey(), {})
}

/** Called when the app shows a reminder itself (in-app banner). */
export function logShown(list: Occurrence[], at = Date.now()) {
  if (!list.length) return
  const log = readLog()
  const known = new Set(log.map((e) => e.key))
  for (const o of list)
    if (!known.has(o.key)) log.push({ key: o.key, at, title: o.title === 'Núcleo' ? o.plain : o.title, text: o.detail, url: o.url, kind: o.kind, custom: o.custom })
  writePref(logKey(), log.slice(-300))
  emit()
}

/* ------------------------------------------------------------------ server history */

interface ServerRow {
  key: string
  fire_at: string
  title: string
  body: string
  detail: string
  url: string
  kind: string
  custom: boolean
  origin: string
  status: string
  sent_at: string | null
  grouped: boolean
  dismissed_at: string | null
  seen_at: string | null
  last_error: string | null
}

let history: ServerRow[] = []
/** null = not loaded / not available (older server or no account). */
let historyAvailable = false
let upcoming: Occurrence[] = []
let version = 0
const listeners = new Set<() => void>()
function emit() {
  version++
  listeners.forEach((l) => l())
}

export function setUpcoming(list: Occurrence[]) {
  upcoming = list
  emit()
}

/** Loads the last 30 days sent by the server (signed in). Never throws. */
export async function refreshHistory(signedIn: boolean): Promise<void> {
  if (!supabase || !signedIn) {
    history = []
    historyAvailable = false
    emit()
    return
  }
  const since = new Date(Date.now() - KEEP_MS).toISOString()
  const { data, error } = await supabase
    .from('scheduled_notifications')
    .select('key,fire_at,title,body,detail,url,kind,custom,origin,status,sent_at,grouped,dismissed_at,seen_at,last_error')
    .gt('fire_at', since)
    .lte('fire_at', new Date().toISOString())
    .order('fire_at', { ascending: false })
    .limit(400)
  if (error) {
    // Older server (Etapa 5 migration not applied yet): the local log is used.
    historyAvailable = false
  } else {
    history = (data ?? []) as ServerRow[]
    historyAvailable = true
  }
  emit()
}

const KINDS = new Set(['events', 'tasks', 'habits', 'routine', 'recurring', 'payments', 'receivables', 'deadlines', 'meals', 'focus', 'app'])
const kindOf = (k: string): ReminderKind | '' => (KINDS.has(k) ? (k as ReminderKind) : '')

function originOf(kind: string, custom: boolean, origin?: string): EntryOrigin {
  if (origin === 'test') return 'test'
  if (custom) return 'mine'
  return kind === 'app' ? 'app' : 'auto'
}

function serverState(r: ServerRow): EntryState {
  if (r.status === 'sent' || r.status === 'failed' || r.status === 'nodevice' || r.status === 'expired') return r.status
  return r.sent_at ? 'processed' : 'expired'
}

/** Everything, newest first among the past; upcoming soonest first. Pure apart from the module state. */
export function feedEntries(now = Date.now()): { past: FeedEntry[]; upcoming: FeedEntry[] } {
  const marks = readMarks()
  const past: FeedEntry[] = []
  const seenKeys = new Set<string>()
  if (historyAvailable) {
    for (const r of history) {
      seenKeys.add(r.key)
      const m = marks[r.key]
      past.push({
        key: r.key,
        at: new Date(r.fire_at),
        title: r.title === 'Núcleo' ? r.detail || r.body : r.title,
        text: r.detail || r.body,
        url: r.url,
        kind: kindOf(r.kind),
        origin: originOf(r.kind, r.custom, r.origin),
        state: serverState(r),
        grouped: r.grouped,
        seen: !!r.seen_at || !!m?.seen,
        dismissed: !!r.dismissed_at || !!m?.dismissed,
        error: r.last_error,
        server: true,
      })
    }
  }
  for (const e of readLog()) {
    if (seenKeys.has(e.key)) continue
    const m = marks[e.key]
    past.push({ key: e.key, at: new Date(e.at), title: e.title, text: e.text, url: e.url, kind: e.kind, origin: originOf(e.kind, e.custom), state: 'inApp', grouped: false, seen: !!m?.seen, dismissed: !!m?.dismissed, error: null, server: false })
  }
  past.sort((a, b) => b.at.getTime() - a.at.getTime())
  const next = upcoming
    .filter((o) => o.fireAt.getTime() > now)
    .map(
      (o): FeedEntry => ({
        key: o.key,
        at: o.fireAt,
        title: o.title === 'Núcleo' ? o.plain : o.title,
        text: o.detail,
        url: o.url,
        kind: o.kind,
        origin: originOf(o.kind, o.custom),
        state: 'scheduled',
        grouped: false,
        seen: true,
        dismissed: false,
        error: null,
        server: false,
      }),
    )
  return { past, upcoming: next }
}

export const isUnread = (e: FeedEntry) => e.state !== 'scheduled' && !e.seen && !e.dismissed

export function unreadCount(): number {
  return feedEntries().past.filter(isUnread).length
}

/** Re-renders on any change of the feed. */
export function useFeedVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version,
  )
}

/* ------------------------------------------------------------------ the person's marks */

async function markServer(keys: string[] | null, action: 'seen' | 'dismiss' | 'restore'): Promise<boolean> {
  if (!supabase || !historyAvailable) return false
  const { error } = await supabase.rpc('mark_notifications', { p_keys: keys, p_action: action })
  if (error) return false
  const at = new Date().toISOString()
  const hit = (k: string) => keys === null || keys.includes(k)
  history = history.map((r) =>
    !hit(r.key)
      ? r
      : action === 'seen'
        ? { ...r, seen_at: r.seen_at ?? at }
        : action === 'dismiss'
          ? { ...r, dismissed_at: at, seen_at: r.seen_at ?? at }
          : { ...r, dismissed_at: null },
  )
  return true
}

function markLocal(keys: string[], patch: (m: Marks[string]) => Marks[string]) {
  const marks = readMarks()
  for (const k of keys) marks[k] = patch(marks[k] ?? {})
  // Old marks go with the log.
  const live = new Set([...readLog().map((e) => e.key), ...history.map((r) => r.key), ...keys])
  writePref(marksKey(), Object.fromEntries(Object.entries(marks).filter(([k]) => live.has(k))))
}

export async function markSeen(keys: string[] | null) {
  const list = keys ?? feedEntries().past.filter(isUnread).map((e) => e.key)
  if (!list.length) return
  await markServer(keys === null ? null : list, 'seen')
  markLocal(list, (m) => ({ ...m, seen: m.seen ?? Date.now() }))
  emit()
}

export async function dismiss(keys: string[]) {
  await markServer(keys, 'dismiss')
  markLocal(keys, (m) => ({ ...m, dismissed: Date.now(), seen: m.seen ?? Date.now() }))
  emit()
}

export async function restore(keys: string[]) {
  await markServer(keys, 'restore')
  markLocal(keys, (m) => ({ ...m, dismissed: undefined }))
  emit()
}

/** The app icon's number (where the system supports it): only what is unread here. */
export function updateBadge() {
  const n = unreadCount()
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  if (n > 0) nav.setAppBadge?.(n).catch(() => {})
  else nav.clearAppBadge?.().catch(() => {})
}
