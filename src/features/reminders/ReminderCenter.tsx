import { AnimatePresence, motion } from 'framer-motion'
import { Bell, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../../lib/hooks'
import { useStore } from '../../data/store'
import { readPref, writePref } from '../../lib/prefs'
import { useSession } from '../account/session'
import { buildOccurrences, buildSeries, effectivePrefs, type FocusRun, type Occurrence } from './engine'
import { syncAllowsAutomations } from '../../data/useAutomations'
import { deviceTimeZone } from '../../lib/zoned'
import { FOCUS_EVENT, FOCUS_KEY } from '../focus/timer'
import { currentSubscription, refreshPush, syncSchedule } from './push'
import { EASE_OUT_SOFT } from '../../lib/motion'
import { logShown, refreshHistory, setFeedOwner, setUpcoming, updateBadge, useFeedVersion } from '../notifications/feed'

const SHOWN_KEY = 'shownReminders'

function shownMap(): Record<string, number> {
  const map = readPref<Record<string, number>>(SHOWN_KEY, {})
  const cutoff = Date.now() - 3 * 86_400_000
  return Object.fromEntries(Object.entries(map).filter(([, at]) => at > cutoff))
}

/**
 * In-app reminders (always available, also when notifications are off or not
 * supported) and the server mirror used for notifications with the app closed.
 */
export function ReminderCenter() {
  const { data, settings, ready, syncStatus, repository } = useStore()
  const { userId } = useSession()
  const [visible, setVisible] = useState<Occurrence[]>([])
  const reduce = usePrefersReducedMotion()
  // The running focus timer lives on this device; its goal end is a reminder too (also with the app closed).
  const [focus, setFocus] = useState<FocusRun | null>(() => readPref<FocusRun | null>(FOCUS_KEY, null))
  useEffect(() => {
    const read = () => setFocus(readPref<FocusRun | null>(FOCUS_KEY, null))
    window.addEventListener(FOCUS_EVENT, read)
    return () => window.removeEventListener(FOCUS_EVENT, read)
  }, [])
  const occurrences = useMemo(() => (ready ? buildOccurrences(data, settings, { focus }) : []), [data, settings, ready, focus])
  const latest = useRef(occurrences)
  latest.current = occurrences
  const prefs = effectivePrefs(settings)
  const anyEnabled = prefs.on && Object.values(prefs.kinds).some((k) => k.enabled)

  useEffect(() => {
    if (!ready) return
    const tick = async () => {
      const now = Date.now()
      const shown = shownMap()
      const due = latest.current.filter((o) => o.fireAt.getTime() <= now && o.fireAt.getTime() > now - 15 * 60_000 && !shown[o.key])
      if (!due.length) return
      for (const o of due) shown[o.key] = now
      writePref(SHOWN_KEY, shown)
      logShown(due, now)
      setVisible((v) => [...v, ...due].slice(-3))
      // App open in the background and no push on this device: show it through the service worker.
      if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted' && !(await currentSubscription())) {
        const reg = await navigator.serviceWorker?.getRegistration()
        for (const o of due) await reg?.showNotification(o.title, { body: o.body, tag: o.key, data: { url: o.url } })
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 30_000)
    return () => window.clearInterval(timer)
  }, [ready])

  // Messages from the service worker: a tapped notification opens its screen; a push that arrives
  // while the app is on screen is not shown twice (in-app banner + system notification).
  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    const onMessage = async (e: MessageEvent) => {
      const msg = e.data as { type?: string; url?: string; key?: string } | null
      if (msg?.type === 'nucleo-open' && typeof msg.url === 'string' && msg.url.startsWith('#/')) {
        window.location.hash = msg.url.slice(1)
      } else if (msg?.type === 'nucleo-push' && msg.key) {
        const shown = shownMap()
        if (shown[msg.key]) {
          const reg = await sw.getRegistration()
          for (const n of (await reg?.getNotifications({ tag: msg.key })) ?? []) n.close()
        } else writePref(SHOWN_KEY, { ...shown, [msg.key]: Date.now() })
        // A push arrived: the server's history now has it (a moment later, after the result is stored).
        window.setTimeout(() => void refreshHistory(true), 4000)
      }
    }
    sw.addEventListener('message', onMessage)
    return () => sw.removeEventListener('message', onMessage)
  }, [])

  // Central de notificações: what is coming (exact, from the records) and the server's history.
  const feedVersion = useFeedVersion()
  useEffect(() => setFeedOwner(userId), [userId])
  useEffect(() => setUpcoming(occurrences), [occurrences])
  useEffect(() => updateBadge(), [feedVersion])
  useEffect(() => {
    const load = () => void refreshHistory(Boolean(userId))
    load()
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(load, 5 * 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [userId])

  // Signed in: keep this device's push subscription known to the server (renewed if it expired).
  useEffect(() => {
    if (userId && navigator.onLine) refreshPush().catch(() => {})
  }, [userId])

  // Mirror to the server (signed in only). Debounced; also clears everything when all reminders are off.
  // Only when this device is fully synced (nothing waiting to go up); the server still checks the
  // revision and answers 'stale' if another device changed something meanwhile: then this device
  // syncs and tries again, it never writes reminders from old data.
  const idle = syncAllowsAutomations(syncStatus)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!ready || !userId || !idle) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      if (!navigator.onLine) return
      try {
        const now = new Date()
        const basis = { cursor: (await repository.syncBasis?.())?.cursor ?? null, settingsAt: settings.updatedAt ?? null }
        const result = await syncSchedule({
          occurrences: anyEnabled ? occurrences : [],
          series: anyEnabled ? buildSeries(data, settings, { now }) : [],
          until: new Date(now.getTime() + 14 * 86_400_000),
          tz: settings.timeZone || deviceTimeZone(),
          quiet: prefs.quiet ?? null,
          basis,
        })
        if (result === 'stale' && !cancelled) {
          await repository.syncNow?.()
          window.setTimeout(() => !cancelled && setRetry((n) => n + 1), 20_000)
        }
      } catch {
        // Offline or the server refused: the next change or opening tries again (nothing is lost here).
      }
    }, 3000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [occurrences, data, settings, repository, prefs.quiet, userId, ready, anyEnabled, idle, retry])

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+10px)] z-[65] flex flex-col items-center gap-2 px-4 lg:pl-[20.5rem]">
      <AnimatePresence>
        {visible.map((o) => (
          <motion.div
            key={o.key}
            initial={{ opacity: 0, transform: reduce ? 'translateY(0px)' : 'translateY(-12px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            exit={{ opacity: 0, transform: reduce ? 'translateY(0px)' : 'translateY(-8px)' }}
            transition={{ duration: 0.22, ease: EASE_OUT_SOFT }}
            style={{ '--glass-base': 'var(--color-elevated)' } as React.CSSProperties}
            className="glass-smoke glass-panel pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[1.25rem] border border-line-strong py-2.5 pr-2 pl-3.5"
            role="status"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-on-accent">
              <Bell size={16} />
            </span>
            <a href={o.url} onClick={() => setVisible((v) => v.filter((x) => x.key !== o.key))} className="min-w-0 flex-1 text-[15px] leading-snug">
              {o.detail}
            </a>
            <button type="button" aria-label="Dispensar" onClick={() => setVisible((v) => v.filter((x) => x.key !== o.key))} className="grid size-8 shrink-0 place-items-center rounded-full text-faint hover:text-ink">
              <X size={16} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
