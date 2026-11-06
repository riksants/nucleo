import { motion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { navigate, useRoute, type RoutePath } from './router'
import { useStore } from '../data/store'
import { LOGO_ACCENT, LOGO_LIGHT, LOGO_VIEWBOX } from './logoMark'
import { MODULE_BY_PATH } from './modules'
import { usePrimaryAction, type PrimaryAction } from './primaryAction'
import { ChevronLeft, Menu, Plus, type LucideIcon } from 'lucide-react'
import { useIsDesktop, useKeyboardOpen } from '../lib/hooks'
import { SyncBadge } from '../features/account/SyncBadge'
import { ASSISTANT, primarySections, type Section } from './sections'
import { openMenu, useMenuOpen } from './menu'
import { LogoTile, MenuBody, SideMenu, YouCard } from './SideMenu'
import { useNewParam } from '../features/useOpenParam'
import { CreateSheet } from '../features/daily/CreateSheet'

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

/** The tabs: Início, the three sections the person chose and the Assistente. */
function tabsOf(settings: Parameters<typeof primarySections>[0]): Section[] {
  return [...primarySections(settings), ASSISTANT]
}

/**
 * Tab bar (phone): a floating glass capsule away from the edges and the bottom, short names under the icons and a
 * light rounded surface behind the current tab. It steps aside while the keyboard is open. Everything else lives in
 * the menu (☰).
 */
function BottomNav({ path }: { path: RoutePath }) {
  const { settings } = useStore()
  const keyboard = useKeyboardOpen()
  const tabs = tabsOf(settings)
  return (
    <nav
      aria-label="Navegação principal"
      data-hidden={keyboard}
      className="tabbar-glass fixed! bottom-[calc(env(safe-area-inset-bottom)+10px)] left-1/2 z-40 grid h-16 w-[min(100%-24px,460px)] -translate-x-1/2 gap-0.5 rounded-full p-[5px] lg:hidden"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((s) => {
        const active = s.path === path
        const Icon = s.icon
        return (
          <a
            key={s.path}
            href={`#${s.path}`}
            aria-current={active ? 'page' : undefined}
            className={`press relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-full text-[12px] tracking-[-0.01em] ${active ? 'font-bold text-(--tab-on-ink)' : 'font-semibold text-(--tab-ink)'}`}
          >
            {active && <motion.span layoutId="tab-pill" aria-hidden className="absolute inset-0 rounded-full bg-(--tab-on-bg) [box-shadow:var(--tab-on-shadow)]" transition={INDICATOR_SPRING} />}
            <Icon size={24} strokeWidth={active ? 2.4 : 2} className="relative" />
            <span className="relative max-w-full truncate px-0.5">{s.shortLabel ?? s.label}</span>
          </a>
        )
      })}
    </nav>
  )
}

/** Computer: the menu (☰) is a sidebar that is always open, with the same groups and the search. */
function Sidebar() {
  const [create, setCreate] = useState(false)
  return (
    <aside className="fixed inset-y-3 left-3 z-40 hidden w-[19rem] flex-col overflow-hidden rounded-[1.5rem] border border-line bg-bg shadow-[0_10px_40px_-24px_var(--color-shade)] lg:flex" aria-label="Navegação">
      <div className="band shrink-0 px-4 pt-4 pb-3">
        <div className="flex h-10 items-center gap-2.5">
          <LogoTile className="size-8" />
          <Wordmark className="flex-1 text-[14px]" />
          <button type="button" onClick={() => setCreate(true)} className="band-pill">
            <Plus size={16} strokeWidth={2.4} />
            Novo
          </button>
        </div>
        <div className="mt-2.5">
          <YouCard />
        </div>
      </div>
      <MenuBody />
      <div className="shrink-0 border-t border-line px-4 py-3">
        <SyncBadge />
      </div>
      <CreateSheet open={create} onClose={() => setCreate(false)} />
    </aside>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const { path } = useRoute()
  // The sidebar exists only on the computer (on the phone the same content is the menu ☰): no hidden copy of it.
  const desktop = useIsDesktop()
  return (
    <div className="min-h-dvh">
      {desktop && <Sidebar />}
      {/* Room under the content for the floating bar (and the safe area): the last item is always reachable. */}
      <main className="px-5 pb-[calc(env(safe-area-inset-bottom)+104px)] lg:ml-[20.5rem] lg:px-10 lg:pt-6 lg:pb-16">
        <div className="mx-auto w-full max-w-lg lg:max-w-5xl">{children}</div>
      </main>
      <BottomNav path={path} />
      <SideMenu />
    </div>
  )
}

/**
 * The phone's way around: Início, the tab-bar sections and every section of the menu open the menu (top-level
 * screens); other screens (Configurações, Busca, Conta…) go back where you came from, and a view inside a section
 * goes back to the section.
 */
function useBack(): { label: string; go(): void } | null {
  const { path, params } = useRoute()
  const { settings } = useStore()
  // A view inside a section (Finanças → Resumo do mês, Semana → Planejar) goes back to the section.
  if (params.get('view')) return { label: 'Voltar', go: () => navigate(path) }
  const topLevel: RoutePath[] = ['/', '/assistant', '/automations', '/rules', '/intake', '/notifications', '/settings']
  if (topLevel.includes(path) || MODULE_BY_PATH[path] || primarySections(settings).some((s) => s.path === path)) return null
  return { label: 'Voltar', go: () => (history.length > 1 ? history.back() : navigate('/')) }
}

/** Menu (☰) on top-level screens, back (‹) on inner ones. Phone only: the computer has the sidebar. */
export function HeaderNavButton({ className = '' }: { className?: string }) {
  const back = useBack()
  const open = useMenuOpen()
  return back ? (
    <button type="button" onClick={back.go} aria-label={back.label} className={`press hit relative -ml-2 flex h-10 shrink-0 items-center gap-0.5 rounded-full pr-2 text-[16px] font-semibold lg:hidden ${className}`}>
      <ChevronLeft size={24} strokeWidth={2.4} />
      {back.label}
    </button>
  ) : (
    <button type="button" onClick={openMenu} aria-label="Abrir menu" aria-haspopup="dialog" aria-expanded={open} className={`press hit relative -ml-2 grid size-10 shrink-0 place-items-center rounded-full hover:bg-coal/[0.08] lg:hidden ${className}`}>
      <Menu size={24} />
    </button>
  )
}

/** The screen's main action as a pill on the orange band: its full, specific name ("Nova tarefa", "Novo projeto"). */
function PrimaryPill({ action, compact }: { action: PrimaryAction; compact?: boolean }) {
  return (
    <button type="button" onClick={action.onPress} disabled={action.disabled} className={`band-pill ${compact ? 'h-[34px]! text-[14px]!' : ''}`}>
      <Plus size={16} strokeWidth={2.4} />
      {action.aria}
    </button>
  )
}

/**
 * Phone: once the title scrolls away, a compact orange bar stays at the top with the menu (or the way back), the
 * screen's name and its main action.
 */
function CompactBar({ title, visible, primary }: { title: string; visible: boolean; primary?: PrimaryAction }) {
  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={`band fixed inset-x-0 top-0 z-30 pt-[env(safe-area-inset-top)] shadow-[0_6px_16px_-10px_rgb(0_0_0/0.45)] transition-[opacity,transform] duration-200 lg:hidden ${visible ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-full opacity-0'}`}
    >
      <div className="relative mx-auto flex h-[50px] max-w-lg items-center gap-2 px-5">
        {visible && <HeaderNavButton />}
        <span className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-[-0.02em]">{title}</span>
        {visible && primary && <PrimaryPill action={primary} compact />}
      </div>
    </div>
  )
}

/** A figure shown on the band under the title (e.g. "3 · a fazer"): the screen's state at a glance. */
export interface HeaderStat {
  label: string
  value: ReactNode
}

/**
 * Standard page header: the orange band, sized by what the screen needs.
 * - Phone: the menu (or back), the screen's own buttons and its main action on the top line; the title under it.
 *   The page lifts over the band with rounded corners.
 * - `primary`: what this screen creates, by name ("Nova tarefa"). Also on the compact bar while scrolling.
 * - `overlap`: the band leaves room at the bottom for a card that sits half over it (Finanças' balance).
 * - `compact`: one line only (Assistente: the conversation comes first).
 * - `eyebrow`, `stats`, `below`: a small line above the title, the screen's figures, a control under them.
 */
export function PageHeader(props: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  primary?: PrimaryAction
  overlap?: boolean
  compact?: boolean
  /** Kept for screens written before the redesign; the band no longer changes with it. */
  rich?: boolean
  eyebrow?: ReactNode
  stats?: HeaderStat[]
  /** Kept for screens written before the redesign (the faint section mark is gone: decoration only on Início). */
  icon?: LucideIcon
  below?: ReactNode
}) {
  const { title, subtitle, actions, primary, overlap, compact, eyebrow, stats, below } = props
  usePrimaryAction(primary)
  // Buscar → "Novo cliente" opens this screen with ?novo=1: same as tapping its main action.
  useNewParam(primary && !primary.disabled ? () => primary.onPress() : undefined)
  // The compact bar shows once the title has scrolled under the top edge.
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    const el = titleRef.current
    if (!el || compact || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setCollapsed(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: '-56px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [compact])

  if (compact)
    return (
      <header className="band relative -mx-5 mb-3 px-5 pt-[calc(env(safe-area-inset-top)+2px)] pb-6 lg:mx-0 lg:mb-6 lg:rounded-[1.75rem] lg:px-8 lg:py-5">
        <div className="flex h-[50px] items-center gap-2">
          <HeaderNavButton />
          <h1 ref={titleRef} className="min-w-0 flex-1 truncate text-[21px] font-semibold tracking-[-0.03em] lg:text-[28px]">
            {title}
          </h1>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
          {primary && <PrimaryPill action={primary} />}
        </div>
        <span aria-hidden className="band-lift h-4! lg:hidden" />
      </header>
    )

  return (
    <>
      <CompactBar title={title} visible={collapsed} primary={primary} />
      <header
        className={`band relative -mx-5 px-5 pt-[calc(env(safe-area-inset-top)+2px)] lg:mx-0 lg:rounded-[1.75rem] lg:px-8 lg:pt-6 ${
          overlap ? 'pb-20 lg:mb-8 lg:pb-8' : 'mb-3 pb-9 lg:mb-8 lg:pb-7'
        }`}
      >
        {/* Phone: the menu, the screen's buttons and its main action share the top line; the title gets the width. */}
        <div className="flex h-[50px] items-center gap-2 lg:hidden">
          <HeaderNavButton />
          <span className="flex-1" />
          {actions && <div className="flex min-w-0 items-center gap-2">{actions}</div>}
          {primary && <PrimaryPill action={primary} />}
        </div>
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            {eyebrow && <p className="mb-0.5 text-[13px] font-semibold tracking-[0.06em] text-coal/75 uppercase">{eyebrow}</p>}
            <h1 ref={titleRef} className="text-[27px] leading-[1.1] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere] lg:text-[38px]">
              {title}
            </h1>
            {subtitle && <p className="mt-1 text-[15px] leading-snug text-coal/80">{subtitle}</p>}
          </div>
          {(actions || primary) && (
            <div className="hidden shrink-0 items-center gap-2 lg:flex">
              {actions}
              {primary && <PrimaryPill action={primary} />}
            </div>
          )}
        </div>
        {below && <div className="mt-3">{below}</div>}
        {stats && stats.length > 0 && (
          <dl className="mt-3 grid auto-cols-fr grid-flow-col divide-x divide-coal/[0.12] rounded-2xl bg-coal/[0.06] py-2.5 lg:max-w-xl">
            {stats.map((s) => (
              <div key={s.label} className="flex min-w-0 flex-col-reverse px-3">
                <dt className="truncate text-[13px] font-medium text-coal/75">{s.label}</dt>
                <dd className="num truncate text-[18px] leading-tight font-semibold tracking-[-0.03em]">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {/* Phone: the page lifts over the band with a rounded edge. */}
        {!overlap && <span aria-hidden className="band-lift lg:hidden" />}
      </header>
    </>
  )
}
