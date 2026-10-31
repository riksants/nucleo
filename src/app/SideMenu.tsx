import { pendingCount } from '../core/automation/activity'
import { todayIn, zoneOf } from '../core/period'
import { AnimatePresence, motion, type PanInfo } from 'framer-motion'
import { ChevronRight, FileClock, FileInput, Search, SlidersHorizontal, Sparkles, UserRound, Wand2, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../data/store'
import type { CollectionName } from '../data/types'
import { usePrefersReducedMotion, useScrollLock } from '../lib/hooks'
import { EASE_OUT_SOFT } from '../lib/motion'
import { useSession } from '../features/account/session'
import { syncLabel } from '../features/account/SyncBadge'
import { closeMenu, useMenuOpen } from './menu'
import { isEnabled, MODULE_BY_ID, MODULE_GROUPS } from './modules'
import { useRoute, type RoutePath } from './router'
import { ASSISTANT, secondarySections, SETTINGS } from './sections'
import { LOGO_ACCENT, LOGO_LIGHT, LOGO_VIEWBOX } from './logoMark'

/** How many items a section holds, shown at the end of its row. */
const COUNT_OF: Partial<Record<RoutePath, CollectionName>> = {
  '/clients': 'clients',
  '/goals': 'goals',
  '/tools': 'tools',
  '/accounts': 'accounts',
  '/notes': 'notes',
  '/portfolio': 'portfolio',
  '/sales': 'sales',
  '/subscribers': 'subscribers',
}

interface Entry {
  href: string
  path: RoutePath
  label: string
  icon: LucideIcon
  count?: number
  onClick?(e: MouseEvent): void
}

/** Closes past this drag to the left, or on a quick flick (px/s). */
const DISMISS_DISTANCE = 80
const DISMISS_VELOCITY = 420

/** The logo exactly as the app icon: the white and vermilion "N" on a coal tile. */
export function LogoTile({ className = 'size-9' }: { className?: string }) {
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-[28%] bg-[#0a0a0b] ${className}`}>
      <svg viewBox={LOGO_VIEWBOX} className="size-[62%]">
        <path d={LOGO_LIGHT} fill="#ffffff" />
        <path d={LOGO_ACCENT} fill="var(--color-brand)" />
      </svg>
    </span>
  )
}

function Row({ entry, current }: { entry: Entry; current: boolean }) {
  const Icon = entry.icon
  return (
    <a
      href={entry.href}
      onClick={(e) => {
        entry.onClick?.(e)
        closeMenu()
      }}
      aria-current={current ? 'page' : undefined}
      className={`tap relative flex min-h-12 items-center gap-3.5 px-4 py-2 ${current ? 'bg-accent/[0.08]' : ''}`}
    >
      {current && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent" />}
      <Icon size={20} className={`shrink-0 ${current ? 'text-accent-hi' : 'text-soft'}`} />
      <span className={`min-w-0 flex-1 truncate text-[15px] ${current ? 'font-semibold text-accent-hi' : ''}`}>{entry.label}</span>
      {entry.count !== undefined && entry.count > 0 && <span className="num shrink-0 text-[14px] text-faint">{entry.count}</span>}
      <ChevronRight size={18} className="shrink-0 text-accent-hi" />
    </a>
  )
}

/**
 * The side menu (phone): everything that is not in the tab bar, grouped by what it is for, plus the account and
 * preferences. Opens from the left over a dim; closes on the X, a tap outside, Esc, a swipe to the left or
 * choosing an item. Sections the person hid never show here.
 */
export function SideMenu() {
  const open = useMenuOpen()
  const { path } = useRoute()
  const { data, settings } = useStore()
  const { configured, userId, email, openAuth } = useSession()
  const { syncStatus } = useStore()
  const reduce = usePrefersReducedMotion()
  const panel = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)
  useScrollLock(open)

  // Any navigation closes it (back button, a link elsewhere) — except the old "Mais" link, which lands on Início
  // with the menu open on purpose.
  const lastPath = useRef(path)
  useEffect(() => {
    if (path !== '/more' && lastPath.current !== '/more') closeMenu()
    lastPath.current = path
  }, [path])

  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement
    // Focus moves into the menu; Tab stays inside it; Esc closes. Focus goes back to the menu button after.
    // No ring for a touch or click open (focusVisible: false); the keyboard still shows where it is.
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true, focusVisible: false } as FocusOptions))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return closeMenu()
      if (e.key !== 'Tab' || !panel.current) return
      const items = [...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus())
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus())
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const back = opener.current
      if (back instanceof HTMLElement && back.isConnected) back.focus()
    }
  }, [open])

  const here = new Set(secondarySections(settings).map((s) => s.path))
  const groups: { title: string; entries: Entry[] }[] = MODULE_GROUPS.map((g) => ({
    title: g.title,
    entries: g.ids
      .map((id) => MODULE_BY_ID[id])
      .filter((m) => here.has(m.path))
      .map((m) => {
        const key = COUNT_OF[m.path]
        return { href: `#${m.path}`, path: m.path, label: m.label, icon: m.icon, count: key ? data[key].length : undefined }
      }),
  }))
  const pending = pendingCount(data, todayIn(zoneOf(settings)))
  groups.push({
    title: 'Automações',
    entries: [
      { href: '#/automations', path: '/automations', label: 'Feito pelo Núcleo', icon: Sparkles, count: pending || undefined },
      { href: '#/rules', path: '/rules', label: 'Minhas regras', icon: Wand2 },
      { href: '#/intake', path: '/intake' as RoutePath, label: 'Importação inteligente', icon: FileInput },
      ...(isEnabled(settings, 'finance') ? [{ href: '#/imports', path: '/imports' as RoutePath, label: 'Extratos importados', icon: FileClock }] : []),
    ],
  })
  const signIn = !userId && configured
  groups.push({
    title: 'Conta e preferências',
    entries: [
      {
        href: signIn ? '#/account' : '#/settings',
        path: '/account',
        label: 'Conta',
        icon: UserRound,
        onClick: signIn ? (e) => (e.preventDefault(), openAuth('signin')) : undefined,
      },
      { href: `#${ASSISTANT.path}`, path: ASSISTANT.path, label: ASSISTANT.label, icon: ASSISTANT.icon },
      { href: `#${SETTINGS.path}`, path: SETTINGS.path, label: SETTINGS.label, icon: SETTINGS.icon },
      { href: '#/settings?painel=secoes', path: '/settings?painel=secoes' as RoutePath, label: 'Personalizar seções', icon: SlidersHorizontal },
    ],
  })

  const initial = (email ?? '').trim().charAt(0).toUpperCase()
  const who = userId ? (email ?? 'Conectado') : 'Neste aparelho'
  const whoDetail = userId ? syncLabel(syncStatus) : configured ? 'Entrar ou criar conta' : 'Seus dados ficam só aqui'

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -DISMISS_DISTANCE || info.velocity.x < -DISMISS_VELOCITY) closeMenu()
  }

  const slide = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.18 } }
    : {
        initial: { x: '-100%' },
        animate: { x: 0, transition: { duration: 0.32, ease: EASE_OUT_SOFT } },
        exit: { x: '-100%', transition: { duration: 0.22, ease: [0.4, 0, 1, 1] as const } },
      }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <motion.div
            className="absolute inset-0 bg-black/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={closeMenu}
          />
          <motion.div
            ref={panel}
            {...slide}
            drag={reduce ? false : 'x'}
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.9, right: 0 }}
            dragMomentum={false}
            onDragEnd={onDragEnd}
            className="absolute inset-y-0 left-0 flex w-[min(86vw,22rem)] flex-col overflow-hidden rounded-r-[1.5rem] bg-bg shadow-[8px_0_40px_-12px_var(--color-shade)]"
          >
            {/* Profile on the brand band, like the header of every screen. */}
            <div className="band shrink-0 px-5 pt-[calc(env(safe-area-inset-top)+10px)] pb-5">
              <div className="flex h-11 items-center justify-between">
                <LogoTile className="size-8" />
                <button type="button" data-autofocus onClick={closeMenu} aria-label="Fechar menu" className="press hit relative -mr-1.5 grid size-10 place-items-center rounded-full hover:bg-coal/[0.08]">
                  <X size={24} strokeWidth={2} />
                </button>
              </div>
              <a
                href="#/account"
                onClick={(e) => {
                  if (signIn) (e.preventDefault(), openAuth('signin'))
                  closeMenu()
                }}
                className="press mt-4 flex cursor-pointer items-center gap-3.5"
              >
                <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-full bg-coal text-[22px] font-semibold text-paper">
                  {initial || <UserRound size={24} />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[17px] leading-tight font-semibold tracking-[-0.02em]">{who}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-coal/75">{whoDetail}</span>
                </span>
              </a>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
              <a
                href="#/search"
                onClick={closeMenu}
                className="tap mb-2 flex h-11 items-center gap-2.5 rounded-full border border-line bg-surface px-4 text-[15px] text-faint"
              >
                <Search size={18} className="text-accent-hi" />
                Buscar em tudo
              </a>
              {groups
                .filter((g) => g.entries.length > 0)
                .map((g) => (
                  <section key={g.title} className="mt-5">
                    <h2 className="mb-2 px-1 text-[15px] font-semibold tracking-[-0.01em]">{g.title}</h2>
                    <nav aria-label={g.title} className="card divide-y divide-line overflow-hidden">
                      {g.entries.map((e) => (
                        <Row key={e.href} entry={e} current={`#${path}` === e.href} />
                      ))}
                    </nav>
                  </section>
                ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
