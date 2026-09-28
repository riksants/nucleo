import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { navigate, useRoute, type RoutePath } from './router'
import { MORE, PRIMARY, SEARCH, SECONDARY, SETTINGS, type Section } from './sections'

function isActive(section: Section, path: RoutePath) {
  if (section.path === '/more') return path === '/more' || SECONDARY.some((s) => s.path === path) || path === '/settings'
  return section.path === path
}

export function Logo() {
  return (
    <svg viewBox="0 0 64 64" className="size-8" aria-hidden>
      <rect width="64" height="64" rx="16" fill="#18181d" />
      <circle cx="32" cy="32" r="15" fill="none" stroke="var(--color-accent)" strokeWidth="5" />
      <circle cx="32" cy="32" r="5.5" fill="var(--color-ink)" />
    </svg>
  )
}

function BottomNav({ path }: { path: RoutePath }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/88 backdrop-blur-xl lg:hidden" aria-label="Navegação principal">
      <div className="mx-auto grid max-w-lg grid-cols-5 px-2 pt-1.5" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
        {[...PRIMARY, MORE].map((s) => {
          const active = isActive(s, path)
          const Icon = s.icon
          return (
            <a
              key={s.path}
              href={`#${s.path}`}
              aria-current={active ? 'page' : undefined}
              className={`press flex flex-col items-center gap-1 rounded-2xl py-1.5 text-[11.5px] font-medium ${active ? 'text-ink' : 'text-faint'}`}
            >
              <span className="relative grid h-8 w-14 place-items-center">
                {active && (
                  <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-accent/16" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
                )}
                <Icon size={21} strokeWidth={active ? 2.2 : 1.8} className={`relative ${active ? 'text-accent-hi' : ''}`} />
              </span>
              {s.label}
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
        active ? 'text-ink' : 'text-soft hover:bg-white/[0.03] hover:text-ink'
      }`}
    >
      {active && <motion.span layoutId="side-pill" className="absolute inset-0 rounded-xl bg-white/[0.06]" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
      <Icon size={19} className={`relative ${active ? 'text-accent-hi' : ''}`} />
      <span className="relative">{section.label}</span>
    </a>
  )
}

function Sidebar({ path }: { path: RoutePath }) {
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
      <nav className="flex flex-col gap-0.5">
        {PRIMARY.map((s) => (
          <SideLink key={s.path} section={s} path={path} />
        ))}
      </nav>
      <div className="mt-6 mb-2 px-3 text-xs font-medium tracking-wide text-faint uppercase">Organização</div>
      <nav className="flex flex-col gap-0.5">
        {SECONDARY.map((s) => (
          <SideLink key={s.path} section={s} path={path} />
        ))}
      </nav>
      <div className="mt-auto">
        <SideLink section={SETTINGS} path={path} />
      </div>
    </aside>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const { path } = useRoute()
  return (
    <div className="min-h-dvh">
      <Sidebar path={path} />
      <main
        className="px-5 pt-[calc(env(safe-area-inset-top)+14px)] pb-[calc(env(safe-area-inset-bottom)+104px)] lg:ml-64 lg:px-10 lg:pt-10 lg:pb-16"
      >
        <div className="mx-auto w-full max-w-lg lg:max-w-5xl">{children}</div>
      </main>
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
