import { AnimatePresence, motion } from 'framer-motion'
import { Bell, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../../lib/hooks'
import { useStore } from '../../data/store'
import { readPref, writePref } from '../../lib/prefs'
import { useSession } from '../account/session'
import { buildOccurrences, effectivePrefs, type FocusRun, type Occurrence } from './engine'
import { FOCUS_EVENT, FOCUS_KEY } from '../focus/timer'
import { currentSubscription, refreshPush, syncSchedule } from './push'
import { EASE_OUT_SOFT } from '../../lib/motion'

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
  const { data, settings, ready } = useStore()
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
      }
    }
    sw.addEventListener('message', onMessage)
    return () => sw.removeEventListener('message', onMessage)
  }, [])

  // Signed in: keep this device's push subscription known to the server (renewed if it expired).
  useEffect(() => {
    if (userId && navigator.onLine) refreshPush().catch(() => {})
  }, [userId])

  // Mirror to the server (signed in only). Debounced; also clears everything when all reminders are off.
  useEffect(() => {
    if (!ready || !userId) return
    const timer = window.setTimeout(() => {
      if (navigator.onLine) syncSchedule(anyEnabled ? occurrences : []).catch(() => {})
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [occurrences, userId, ready, anyEnabled])

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+10px)] z-[65] flex flex-col items-center gap-2 px-4 lg:pl-64">
      <AnimatePresence>
        {visible.map((o) => (
          <motion.div
            key={o.key}
            initial={{ opacity: 0, transform: reduce ? 'translateY(0px)' : 'translateY(-12px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            exit={{ opacity: 0, transform: reduce ? 'translateY(0px)' : 'translateY(-8px)' }}
            transition={{ duration: 0.22, ease: EASE_OUT_SOFT }}
            className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[1.25rem] border border-line-strong bg-elevated/95 py-2.5 pr-2 pl-3.5 shadow-xl shadow-shade/50 backdrop-blur-md reduce-transparency:bg-elevated reduce-transparency:backdrop-blur-none"
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
