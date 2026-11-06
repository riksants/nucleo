import { useUnreadNotifications } from '../features/notifications/NotificationsBell'
import { pendingCount } from '../core/automation/activity'
import { todayIn, zoneOf } from '../core/period'
import { AnimatePresence, motion, type PanInfo } from 'framer-motion'
import { Bell, ChevronRight, Crosshair, FileInput, Repeat, Search, SlidersHorizontal, Wand2, X, type LucideIcon } from 'lucide-react'
import { useDeferredValue, useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../data/store'
import type { CollectionName, ModuleId } from '../data/types'
import { usePrefersReducedMotion, useScrollLock } from '../lib/hooks'
import { EASE_OUT_SOFT } from '../lib/motion'
import { useSession } from '../features/account/session'
import { syncLabel } from '../features/account/SyncBadge'
import { SearchResults, useSearchGroups } from '../features/search/SearchResults'
import { closeMenu, useMenuOpen } from './menu'
import { isEnabled, MODULE_BY_ID } from './modules'
import { useRoute, type RoutePath } from './router'
import { ASSISTANT } from './sections'
import { LOGO_ACCENT, LOGO_LIGHT, LOGO_VIEWBOX } from './logoMark'

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

/** One line of the menu: an icon, the name, a short explanation only where the name is not enough, a count. */
export interface MenuEntry {
  key: string
  label: string
  hint?: string
  icon: LucideIcon
  href: string
  /** Screens that belong to this line (the line is "where you are" on any of them). */
  paths: RoutePath[]
  count?: number
  onClick?(e: MouseEvent): void
}

/** How many items a section holds, shown at the end of its line. */
const COUNT_OF: Partial<Record<ModuleId, CollectionName>> = {
  clients: 'clients',
  goals: 'goals',
  tools: 'tools',
  accounts: 'accounts',
  notes: 'notes',
  portfolio: 'portfolio',
  sales: 'sales',
  subscribers: 'subscribers',
  projects: 'projects',
}

/**
 * Everything the app does, grouped by what it is for — the same in the phone menu (☰) and the computer sidebar.
 * Hidden sections never show (their data stays). "Hoje" lives inside the Agenda; Hábitos and Recorrentes inside
 * Rotina; the imports in one Importar; Feito pelo Núcleo and Minhas regras in Automações.
 */
export function useMenuGroups(): { title: string; entries: MenuEntry[] }[] {
  const { data, settings } = useStore()
  const unread = useUnreadNotifications()
  const on = (id: ModuleId) => isEnabled(settings, id)
  const mod = (id: ModuleId, hint?: string, extra: RoutePath[] = []): MenuEntry | null => {
    if (!on(id)) return null
    const m = MODULE_BY_ID[id]
    const key = COUNT_OF[id]
    return { key: id, label: m.label, hint, icon: m.icon, href: `#${m.path}`, paths: [m.path, ...extra], count: key ? data[key].length : undefined }
  }
  const openTasks = data.tasks.filter((t) => t.status !== 'done').length
  const openInbox = data.inbox.filter((i) => i.status === 'open').length
  const routineHome = (['routine', 'habits', 'recurring'] as const).find(on)
  const rotina: MenuEntry | null = routineHome
    ? {
        key: 'rotina',
        label: 'Rotina',
        hint: 'Atividades, hábitos e recorrentes',
        icon: Repeat,
        href: `#${MODULE_BY_ID[routineHome].path}`,
        paths: ['/routine', '/habits', '/recurring', '/planner'],
      }
    : null
  const pending = pendingCount(data, todayIn(zoneOf(settings)))
  const groups: { title: string; entries: (MenuEntry | null)[] }[] = [
    {
      title: 'Dia a dia',
      entries: [
        mod('agenda', undefined, ['/today']),
        on('tasks') ? { ...mod('tasks')!, count: openTasks || undefined } : null,
        rotina,
        mod('meals', 'Refeições e lista de compras'),
        on('inbox') ? { ...mod('inbox', 'Para organizar depois')!, count: openInbox || undefined } : null,
      ],
    },
    {
      title: 'Finanças',
      entries: [mod('finance', undefined, ['/imports', '/import']), mod('sales'), mod('subscribers', 'Planos dos seus produtos'), mod('tools', 'O que você paga todo mês'), mod('goals', 'Compras planejadas e reservas')],
    },
    { title: 'Trabalho', entries: [mod('projects'), mod('clients'), mod('portfolio', 'Trabalhos entregues')] },
    { title: 'Planejamento', entries: [mod('week', 'Score, metas e desafios'), mod('life', 'Projetos pessoais e objetivos')] },
    { title: 'Guardados', entries: [mod('notes'), mod('accounts')] },
    {
      title: 'Ferramentas',
      entries: [
        { key: 'assistant', label: ASSISTANT.label, icon: ASSISTANT.icon, href: `#${ASSISTANT.path}`, paths: [ASSISTANT.path] },
        { key: 'automations', label: 'Automações', hint: 'Histórico e regras', icon: Wand2, href: '#/automations', paths: ['/automations', '/rules'], count: pending || undefined },
        { key: 'import', label: 'Importar', hint: 'Extratos e arquivos', icon: FileInput, href: '#/intake', paths: ['/intake'] },
        { key: 'notifications', label: 'Notificações e lembretes', icon: Bell, href: '#/notifications', paths: ['/notifications', '/reminders'], count: unread || undefined },
        on('tasks') ? { key: 'focus', label: 'Modo Foco', hint: 'Uma tarefa por vez', icon: Crosshair, href: '#/focus', paths: ['/focus'] } : null,
      ],
    },
    {
      title: 'Ajustes',
      entries: [{ key: 'customize', label: 'Personalizar', hint: 'Início, barra e seções', icon: SlidersHorizontal, href: '#/settings?painel=secoes', paths: [] }],
    },
  ]
  return groups.map((g) => ({ title: g.title, entries: g.entries.filter((e): e is MenuEntry => !!e) })).filter((g) => g.entries.length > 0)
}

function MenuRow({ entry, current }: { entry: MenuEntry; current: boolean }) {
  const Icon = entry.icon
  return (
    <a
      href={entry.href}
      onClick={(e) => {
        entry.onClick?.(e)
        closeMenu()
      }}
      aria-current={current ? 'page' : undefined}
      className={`tap relative flex min-h-[46px] items-center gap-3 rounded-xl px-3 py-1.5 ${current ? 'bg-accent/[0.1]' : 'hover:bg-tint/[0.04]'}`}
    >
      {current && <span aria-hidden className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-accent" />}
      <Icon size={20} className={`shrink-0 ${current ? 'text-accent-hi' : 'text-soft'}`} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[16px] leading-tight ${current ? 'font-semibold text-accent-hi' : 'font-medium'}`}>{entry.label}</span>
        {entry.hint && <span className="mt-0.5 block truncate text-[13px] text-faint">{entry.hint}</span>}
      </span>
      {entry.count !== undefined && entry.count > 0 && <span className="num shrink-0 text-[14px] font-medium text-faint">{entry.count}</span>}
    </a>
  )
}

/**
 * The menu's content (phone drawer and computer sidebar): the search over everything at the top, then every section
 * grouped by what it is for. While searching, the results take the place of the groups.
 */
export function MenuBody({ autoFocusSearch = false }: { autoFocusSearch?: boolean }) {
  const { path } = useRoute()
  const groups = useMenuGroups()
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const results = useSearchGroups(deferred)
  const isCurrent = (e: MenuEntry) => e.paths.includes(path)
  return (
    <>
      <form
        role="search"
        className="px-4 pt-3"
        onSubmit={(e) => {
          e.preventDefault()
          const first = results[0]?.rows[0]
          if (first) (closeMenu(), first.go())
        }}
      >
        <label className="relative block">
          <span className="sr-only">Buscar em tudo</span>
          <Search size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            data-autofocus={autoFocusSearch ? '' : undefined}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar em tudo"
            enterKeyHint="search"
            autoComplete="off"
            className="h-11 w-full rounded-[13px] border border-line bg-surface pr-10 pl-10 text-[16px] text-ink placeholder:text-faint focus:border-accent/70 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" aria-label="Limpar busca" onClick={() => setQuery('')} className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-full text-faint hover:text-ink">
              <X size={16} />
            </button>
          )}
        </label>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-1 pb-[calc(env(safe-area-inset-bottom)+20px)] [scrollbar-width:thin]">
        {query.trim() ? (
          <div className="px-1 pt-3">
            <SearchResults query={deferred} groups={results} onGo={closeMenu} columns={false} />
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.title}>
              <h2 className="mt-4 mb-1 px-3 text-[13px] font-semibold tracking-[0.06em] text-faint uppercase">{g.title}</h2>
              <nav aria-label={g.title} className="flex flex-col">
                {g.entries.map((e) => (
                  <MenuRow key={e.key} entry={e} current={isCurrent(e)} />
                ))}
              </nav>
            </section>
          ))
        )}
      </div>
    </>
  )
}

/** "Você": the person, the sync state, and the way to the account and preferences. */
export function YouCard({ onNavigate }: { onNavigate?(): void }) {
  const { syncStatus } = useStore()
  const { configured, userId, email } = useSession()
  const initial = (email ?? '').trim().charAt(0).toUpperCase()
  // Signed in: who (the e-mail) and the sync state; otherwise what lives there.
  const detail = userId ? `${email ?? 'Conta'} · ${syncLabel(syncStatus)}` : configured ? 'Neste aparelho · conta, avisos e ajustes' : 'Conta, avisos e ajustes'
  return (
    <a href="#/settings" onClick={onNavigate} className="you-card press flex items-center gap-3 rounded-2xl px-3 py-2.5">
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-coal text-[16px] font-semibold text-paper">
        {initial || 'V'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] leading-tight font-semibold">Você</span>
        <span className="mt-0.5 block truncate text-[13px] text-coal/75">{detail}</span>
      </span>
      <ChevronRight size={18} className="shrink-0" />
    </a>
  )
}

/** Closes past this drag to the left, or on a quick flick (px/s). */
const DISMISS_DISTANCE = 80
const DISMISS_VELOCITY = 420

/**
 * The side menu (phone): the search and every section, grouped by what it is for, with "Você" on top. Opens from
 * the left over a dim; closes on the X, a tap outside, Esc, a swipe to the left or choosing an item.
 */
export function SideMenu() {
  const open = useMenuOpen()
  const { path } = useRoute()
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
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true, focusVisible: false } as FocusOptions))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return closeMenu()
      if (e.key !== 'Tab' || !panel.current) return
      const items = [...panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input')]
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
          <motion.div className="absolute inset-0 bg-black/55" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} onClick={closeMenu} />
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
            <div className="band shrink-0 px-4 pt-[calc(env(safe-area-inset-top)+6px)] pb-3">
              <div className="flex h-12 items-center gap-2.5">
                <LogoTile className="size-8" />
                <span className="flex-1 text-[14px] font-semibold tracking-[0.16em]">NÚCLEO</span>
                <button type="button" data-autofocus onClick={closeMenu} aria-label="Fechar menu" className="press hit relative -mr-1.5 grid size-10 place-items-center rounded-full hover:bg-coal/[0.08]">
                  <X size={24} strokeWidth={2} />
                </button>
              </div>
              <div className="mt-1">
                <YouCard onNavigate={closeMenu} />
              </div>
            </div>
            <MenuBody />
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
