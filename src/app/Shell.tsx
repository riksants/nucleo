import { motion } from 'framer-motion'
import { useId, type ReactNode } from 'react'
import { navigate, useRoute, type RoutePath } from './router'
import { useStore } from '../data/store'
import { LOGO_PIECES } from './logoMark'
import { isEnabled } from './modules'
import { SyncBadge } from '../features/account/SyncBadge'
import { QuickCaptureButton, SidebarCapture } from '../features/inbox/QuickCapture'
import { ASSISTANT, MORE, primarySections, SEARCH, secondarySections, SETTINGS, type Section } from './sections'

function isActive(section: Section, path: RoutePath, primary: Section[]) {
  if (section.path === '/more') return !primary.some((s) => s.path === path)
  return section.path === path
}

/** Active-tab indicator: critically damped (damping ratio ≈ 1), so it settles in ~0.2 s without overshooting. */
const INDICATOR_SPRING = { type: 'spring', stiffness: 500, damping: 45 } as const

/** The NÚCLEO mark — the same drawing as the app icon and the opening. */
export function Logo() {
  // Gradient ids must be unique on the page (the logo can appear more than once).
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return (
    <svg viewBox="-500 -500 1000 1000" className="size-8" aria-hidden>
      <defs>
        <linearGradient id={`${id}p`} gradientUnits="userSpaceOnUse" x1="-800" y1="-700" x2="800" y2="800">
          <stop offset="0" stopColor="#7565ff" />
          <stop offset=".5" stopColor="#5c50ff" />
          <stop offset="1" stopColor="#4d41ed" />
        </linearGradient>
        <linearGradient id={`${id}l`} gradientUnits="userSpaceOnUse" x1="-800" y1="-700" x2="800" y2="800">
          <stop offset="0" stopColor="#d4ccff" />
          <stop offset=".6" stopColor="#bcb2fc" />
          <stop offset="1" stopColor="#a99aee" />
        </linearGradient>
      </defs>
      {LOGO_PIECES.map((p, i) => (
        <path key={i} d={p.d} fill={`url(#${id}${p.tone === 'purple' ? 'p' : 'l'})`} />
      ))}
    </svg>
  )
}

function BottomNav({ path }: { path: RoutePath }) {
  const { settings } = useStore()
  const primary = primarySections(settings)
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/88 backdrop-blur-xl lg:hidden" aria-label="Navegação principal">
      <div className="mx-auto grid max-w-lg px-2 pt-1.5" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))', gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }}>
        {[...primary, MORE].map((s) => {
          const active = isActive(s, path, primary)
          const Icon = s.icon
          return (
            <a
              key={s.path}
              href={`#${s.path}`}
              aria-current={active ? 'page' : undefined}
              className={`press flex flex-col items-center gap-1 rounded-2xl py-1.5 text-[12px] font-medium ${active ? 'text-ink' : 'text-faint'}`}
            >
              <span className="relative grid h-8 w-14 place-items-center">
                {active && (
                  <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-accent/16" transition={INDICATOR_SPRING} />
                )}
                <Icon size={21} strokeWidth={active ? 2.2 : 1.8} className={`relative ${active ? 'text-accent-hi' : ''}`} />
              </span>
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
      className={`relative flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors ${
        active ? 'text-ink' : 'text-soft hover:bg-white/[0.03] tap hover:text-ink'
      }`}
    >
      {active && <motion.span layoutId="side-pill" className="absolute inset-0 rounded-xl bg-white/[0.06]" transition={INDICATOR_SPRING} />}
      <Icon size={19} className={`relative ${active ? 'text-accent-hi' : ''}`} />
      <span className="relative">{section.label}</span>
    </a>
  )
}

function Sidebar({ path }: { path: RoutePath }) {
  const { settings } = useStore()
  const secondary = secondarySections(settings)
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-bg px-4 py-6 lg:flex" aria-label="Navegação">
      <div className="mb-6 flex items-center gap-3 px-2">
        <Logo />
        <span className="text-lg font-semibold tracking-tight">Núcleo</span>
      </div>
      <button
        type="button"
        onClick={() => navigate('/search')}
        className="mb-5 flex h-10 items-center gap-2.5 rounded-xl border border-line bg-surface px-3 text-sm text-faint transition-colors hover:text-soft"
      >
        <SEARCH.icon size={16} />
        Buscar em tudo
        <kbd className="ml-auto rounded-md border border-line px-1.5 text-[11px]">/</kbd>
      </button>
      <SidebarCapture />
      <nav className="flex flex-col gap-0.5">
        <SideLink section={ASSISTANT} path={path} />
        {primarySections(settings).map((s) => (
          <SideLink key={s.path} section={s} path={path} />
        ))}
      </nav>
      {secondary.length > 0 && (
        <>
          <div className="mt-6 mb-2 px-3 text-xs font-medium tracking-wide text-faint uppercase">Organização</div>
          <nav className="flex flex-col gap-0.5">
            {secondary.map((s) => (
              <SideLink key={s.path} section={s} path={path} />
            ))}
          </nav>
        </>
      )}
      <div className="mt-auto space-y-2 pt-6">
        <SyncBadge />
        <SideLink section={SETTINGS} path={path} />
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
        className={`px-5 pt-[calc(env(safe-area-inset-top)+14px)] lg:ml-64 lg:px-10 lg:pt-10 lg:pb-16 ${
          // Extra room so the quick-capture button never covers the end of a list.
          isEnabled(settings, 'inbox') ? 'pb-[calc(env(safe-area-inset-bottom)+172px)]' : 'pb-[calc(env(safe-area-inset-bottom)+104px)]'
        }`}
      >
        <div className="mx-auto w-full max-w-lg lg:max-w-5xl">{children}</div>
      </main>
      <QuickCaptureButton />
      <BottomNav path={path} />
    </div>
  )
}

/** Standard page header: big title, optional subtitle and actions. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4 lg:mb-8">
      <div className="min-w-0">
        <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.03em] lg:text-[34px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
