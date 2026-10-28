import { motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { navigate, useRoute, type RoutePath } from './router'
import { useStore } from '../data/store'
import { LOGO_ACCENT, LOGO_LIGHT, LOGO_VIEWBOX } from './logoMark'
import { isEnabled, MODULE_BY_ID, MODULE_BY_PATH, MODULE_GROUPS } from './modules'
import { usePrimaryAction, type PrimaryAction } from './primaryAction'
import { ChevronLeft, Menu, Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { SyncBadge } from '../features/account/SyncBadge'
import { QuickCaptureButton, SidebarCapture } from '../features/inbox/QuickCapture'
import { ASSISTANT, primarySections, SEARCH, secondarySections, SETTINGS, type Section } from './sections'
import { openMenu, useMenuOpen } from './menu'
import { LogoTile, SideMenu } from './SideMenu'

/** Active-tab indicator: critically damped (damping ratio ≈ 1), so it settles in ~0.2 s without overshooting. */
const INDICATOR_SPRING = { type: 'spring', stiffness: 500, damping: 45 } as const

/** The NÚCLEO "N" — the same drawing as the app icon and the opening. The light piece follows the text color,
 *  so the mark reads on both themes; the other piece is always the brand vermilion. */
export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} className={className} aria-hidden>
      <path d={LOGO_LIGHT} fill="currentColor" />
      <path d={LOGO_ACCENT} fill="var(--color-brand)" />
    </svg>
  )
}

/** "NÚCLEO" set like the site's wordmark: tight caps, wide tracking. */
export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`font-semibold tracking-[0.14em] ${className}`}>NÚCLEO</span>
}

/**
 * Tab bar (phone): Início + the sections the person chose. Light: icons and names in a quiet tone, the current one
 * in vermilion with a short bar on top that slides between tabs. Everything else lives in the side menu.
 */
function BottomNav({ path }: { path: RoutePath }) {
  const { settings } = useStore()
  const primary = primarySections(settings)
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-nav/85 backdrop-blur-xl backdrop-saturate-150 reduce-transparency:bg-nav reduce-transparency:backdrop-filter-none lg:hidden" aria-label="Navegação principal">
      <div className="mx-auto grid max-w-lg px-2" style={{ paddingBottom: 'max(6px, env(safe-area-inset-bottom))', gridTemplateColumns: `repeat(${primary.length}, minmax(0, 1fr))` }}>
        {primary.map((s) => {
          const active = s.path === path
          const Icon = s.icon
          return (
            <a
              key={s.path}
              href={`#${s.path}`}
              aria-current={active ? 'page' : undefined}
              className={`press relative flex flex-col items-center gap-1 pt-2.5 pb-1.5 text-[12px] tracking-[-0.01em] transition-colors duration-150 ${active ? 'font-semibold text-accent-hi' : 'font-medium text-faint'}`}
            >
              {active && <motion.span layoutId="nav-bar" aria-hidden className="absolute top-0 h-[3px] w-10 rounded-b-full bg-accent" transition={INDICATOR_SPRING} />}
              <Icon size={24} strokeWidth={active ? 2.4 : 2} />
              {s.shortLabel ?? s.label}
            </a>
          )
        })}
      </div>
    </nav>
  )
}

function SideLink({ section, path }: { section: Section; path: RoutePath }) {
  const active = section.path === path
  const Icon = section.icon
  return (
    <a
      href={`#${section.path}`}
      aria-current={active ? 'page' : undefined}
      className={`relative flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium tracking-[-0.01em] transition-colors ${
        active ? 'text-accent-hi' : 'text-soft hover:bg-tint/[0.03] tap hover:text-ink'
      }`}
    >
      {/* Where you are: a soft vermilion tint with a bar on the left, sliding to the new item. */}
      {active && (
        <motion.span layoutId="side-pill" className="absolute inset-0 rounded-xl bg-accent/[0.1]" transition={INDICATOR_SPRING}>
          <span aria-hidden className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-accent" />
        </motion.span>
      )}
      <Icon size={20} strokeWidth={active ? 2.4 : 2} className="relative" />
      <span className="relative min-w-0 flex-1 truncate pr-3">{section.label}</span>
    </a>
  )
}

/** Computer: the same organization as the side menu, always open on the left. */
function Sidebar({ path }: { path: RoutePath }) {
  const { settings } = useStore()
  const here = new Set(secondarySections(settings).map((s) => s.path))
  const groups = MODULE_GROUPS.map((g) => ({ title: g.title, sections: g.ids.map((id) => MODULE_BY_ID[id]).filter((m) => here.has(m.path)) })).filter((g) => g.sections.length > 0)
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-bg lg:flex" aria-label="Navegação">
      <div className="band flex items-center gap-3 px-6 py-5">
        <LogoTile className="size-8" />
        <Wordmark className="text-[15px]" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-4 pt-5 pb-6">
        <button
          type="button"
          onClick={() => navigate('/search')}
          className="mb-5 flex h-10 items-center gap-2.5 rounded-xl border border-line bg-surface px-3 text-sm text-faint transition-colors hover:border-line-strong hover:text-soft"
        >
          <SEARCH.icon size={16} className="text-accent-hi" />
          Buscar em tudo
          <kbd className="ml-auto rounded-md border border-line px-1.5 font-mono text-[11px]">/</kbd>
        </button>
        <SidebarCapture />
        <nav className="flex flex-col gap-0.5">
          <SideLink section={ASSISTANT} path={path} />
          {primarySections(settings).map((s) => (
            <SideLink key={s.path} section={s} path={path} />
          ))}
        </nav>
        <div className="-mx-1 mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 [scrollbar-width:thin]">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="mt-6 mb-2 px-3 text-[13px] font-semibold text-ink">{g.title}</div>
              <nav className="flex flex-col gap-0.5" aria-label={g.title}>
                {g.sections.map((s) => (
                  <SideLink key={s.path} section={s} path={path} />
                ))}
              </nav>
            </div>
          ))}
        </div>
        <div className="space-y-2 pt-4">
          <SyncBadge />
          <SideLink section={SETTINGS} path={path} />
        </div>
      </div>
    </aside>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const { path } = useRoute()
  const { settings } = useStore()
  return (
    <div className="min-h-dvh">
      <Sidebar path={path} />
      <main
        className={`px-5 lg:ml-64 lg:px-10 lg:pt-10 lg:pb-16 ${
          // Extra room so the quick-capture button never covers the end of a list.
          isEnabled(settings, 'inbox') ? 'pb-[calc(env(safe-area-inset-bottom)+164px)]' : 'pb-[calc(env(safe-area-inset-bottom)+96px)]'
        }`}
      >
        <div className="mx-auto w-full max-w-lg lg:max-w-5xl">{children}</div>
      </main>
      <QuickCaptureButton />
      <BottomNav path={path} />
      <SideMenu />
    </div>
  )
}

/**
 * The phone's way around: Início, the tab-bar sections and every section of the menu open the menu (top-level
 * screens); other screens (Configurações, Busca, Conta, Automações…) go back where you came from, and a view
 * inside a section goes back to the section.
 */
function useBack(): { label: string; go(): void } | null {
  const { path, params } = useRoute()
  const { settings } = useStore()
  // A view inside a section (Financeiro → Resumo do mês, Semana → Planejar) goes back to the section.
  if (params.get('view')) return { label: 'Voltar', go: () => navigate(path) }
  if (path === '/' || MODULE_BY_PATH[path] || primarySections(settings).some((s) => s.path === path)) return null
  return { label: 'Voltar', go: () => (history.length > 1 ? history.back() : navigate('/')) }
}

/** Menu (☰) on top-level screens, back (‹) on inner ones. Phone only: the computer has the sidebar. */
export function HeaderNavButton({ className = '' }: { className?: string }) {
  const back = useBack()
  const open = useMenuOpen()
  return back ? (
    <button type="button" onClick={back.go} aria-label={back.label} className={`press hit relative -ml-2 flex h-10 items-center gap-0.5 rounded-full pr-2 text-[16px] font-semibold lg:hidden ${className}`}>
      <ChevronLeft size={24} strokeWidth={2.4} />
      {back.label}
    </button>
  ) : (
    <button type="button" onClick={openMenu} aria-label="Abrir menu" aria-haspopup="dialog" aria-expanded={open} className={`press hit relative -ml-2 grid size-10 place-items-center rounded-full hover:bg-coal/[0.08] lg:hidden ${className}`}>
      <Menu size={24} />
    </button>
  )
}

/**
 * Phone: once the big title scrolls away, a compact vermilion bar with the screen's name (and the menu or the way
 * back) stays at the top.
 */
function CompactBar({ title, visible }: { title: string; visible: boolean }) {
  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={`band fixed inset-x-0 top-0 z-30 pt-[env(safe-area-inset-top)] shadow-[0_6px_16px_-10px_rgb(0_0_0/0.45)] transition-opacity duration-200 lg:hidden ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
    >
      <div className="relative mx-auto flex h-12 max-w-lg items-center justify-center px-14">
        {/* Only while shown, so the page never has a second, invisible menu/back button. */}
        {visible && (
          <span className="absolute left-5">
            <HeaderNavButton />
          </span>
        )}
        <span className="truncate text-[17px] font-semibold tracking-[-0.02em]">{title}</span>
      </div>
    </div>
  )
}

/**
 * Standard page header: the vermilion band with the menu (or back), big title, optional subtitle and actions.
 * `primary`: what this screen creates — the floating "+" on the phone, a button here on the computer.
 * `overlap`: the band leaves room at the bottom for a card that sits half over it (Financeiro's balance).
 */
export function PageHeader({ title, subtitle, actions, primary, overlap }: { title: string; subtitle?: ReactNode; actions?: ReactNode; primary?: PrimaryAction; overlap?: boolean }) {
  usePrimaryAction(primary)
  // The compact bar shows once the big title has scrolled under the top edge.
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    const el = titleRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setCollapsed(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: '-56px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <>
      <CompactBar title={title} visible={collapsed} />
      <header
        className={`band -mx-5 px-5 pt-[calc(env(safe-area-inset-top)+6px)] lg:mx-0 lg:rounded-[1.75rem] lg:px-8 lg:pt-7 ${
          overlap ? 'pb-20 lg:mb-8 lg:pb-8' : 'mb-6 pb-6 lg:mb-8 lg:pb-8'
        }`}
      >
        <div className="flex h-12 items-center lg:hidden">
          <HeaderNavButton />
        </div>
        <div className="mt-1 flex items-end justify-between gap-4 lg:mt-0">
          <div className="min-w-0">
            <h1 ref={titleRef} className="text-[30px] leading-[1.08] font-semibold tracking-[-0.04em] lg:text-[40px]">
              {title}
            </h1>
            {subtitle && <p className="mt-1 text-[15px] text-coal/75">{subtitle}</p>}
          </div>
          {(actions || primary) && (
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              {/* On the phone this action is the floating "+" (one per screen). */}
              {primary && (
                <span className="hidden lg:block">
                  <Button icon={<Plus size={18} />} onClick={primary.onPress} disabled={primary.disabled} aria-label={primary.aria}>
                    {primary.label}
                  </Button>
                </span>
              )}
            </div>
          )}
        </div>
      </header>
    </>
  )
}
