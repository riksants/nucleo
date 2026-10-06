import { CloudOff } from 'lucide-react'
import { Suspense, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { lazyPage, whenIdle, type PreloadablePage } from './app/lazyPage'
import { ALL_MODULE_IDS, enabledModules, isRouteAllowed, MODULE_BY_PATH, unseenModules } from './app/modules'
import { navigate, useRoute, type RoutePath } from './app/router'
import { Shell } from './app/Shell'
import { DATABASE_BLOCKED } from './data/repository'
import { useStore } from './data/store'
import { useReceiptReconciler } from './data/useReceipts'
import { useTheme } from './lib/theme'
import { AccountPage } from './features/account/AccountPage'
import { MigrationOffer, useMigrationCandidate } from './features/account/MigrationOffer'
import { useSession } from './features/account/session'
import { AccountsPage } from './features/accounts/AccountsPage'
import { ClientsPage } from './features/clients/ClientsPage'
import { FinancePage } from './features/finance/FinancePage'
import { GoalsPage } from './features/goals/GoalsPage'
import { HomePage } from './features/home/HomePage'
import { MorePage } from './features/more/MorePage'
import { NotesPage } from './features/notes/NotesPage'
import { Onboarding } from './features/onboarding/Onboarding'
import { PlannerPage } from './features/planner/PlannerPage'
import { RoutinePage } from './features/planner/RoutinePage'
import { PortfolioPage } from './features/portfolio/PortfolioPage'
import { ProjectsPage } from './features/projects/ProjectsPage'
import { ReminderCenter } from './features/reminders/ReminderCenter'
import { RemindersPage } from './features/reminders/RemindersPage'
import { SearchPage } from './features/search/SearchPage'
import { ModulePicker } from './features/settings/ModulePicker'
import { SettingsPage } from './features/settings/SettingsPage'
import { SubscribersPage } from './features/subscribers/SubscribersPage'
import { TasksPage } from './features/tasks/TasksPage'
import { TodayPage } from './features/today/TodayPage'
import { ToolsPage } from './features/tools/ToolsPage'
import { isEnabled } from './app/modules'
import { nowIn, zoneOf } from './core/period'
import { readPref, writePref } from './lib/prefs'
import { Button } from './ui/Button'
import { Sheet } from './ui/Sheet'

// These sections load on demand, outside the initial bundle; the enabled ones are preloaded when the phone is idle.
const InboxPage = lazyPage(() => import('./features/inbox/InboxPage').then((m) => m.InboxPage))
const RecurringPage = lazyPage(() => import('./features/recurring/RecurringPage').then((m) => m.RecurringPage))
const AssistantPage = lazyPage(() => import('./features/assistant/AssistantPage').then((m) => m.AssistantPage))
const MealsPage = lazyPage(() => import('./features/meals/MealsHome').then((m) => m.MealsPage))
const LifePage = lazyPage(() => import('./features/life/LifePage').then((m) => m.LifePage))
const WeekPage = lazyPage(() => import('./features/week/WeekPage').then((m) => m.WeekPage))
const FocusPage = lazyPage(() => import('./features/focus/FocusPage').then((m) => m.FocusPage))
const AgendaPage = lazyPage(() => import('./features/agenda/AgendaPage').then((m) => m.AgendaPage))
const SalesPage = lazyPage(() => import('./features/sales/SalesPage').then((m) => m.SalesPage))
const HabitsPage = lazyPage(() => import('./features/habits/HabitsPage').then((m) => m.HabitsPage))

const PAGES: Record<RoutePath, ComponentType | LazyExoticComponent<ComponentType>> = {
  '/': HomePage,
  '/finance': FinancePage,
  '/projects': ProjectsPage,
  '/tasks': TasksPage,
  '/more': MorePage,
  '/clients': ClientsPage,
  '/goals': GoalsPage,
  '/tools': ToolsPage,
  '/accounts': AccountsPage,
  '/notes': NotesPage,
  '/portfolio': PortfolioPage,
  '/settings': SettingsPage,
  '/search': SearchPage,
  '/today': TodayPage,
  '/sales': SalesPage,
  '/subscribers': SubscribersPage,
  '/routine': RoutinePage,
  '/meals': MealsPage,
  '/planner': PlannerPage,
  '/account': AccountPage,
  '/reminders': RemindersPage,
  '/inbox': InboxPage,
  '/habits': HabitsPage,
  '/recurring': RecurringPage,
  '/agenda': AgendaPage,
  '/focus': FocusPage,
  '/week': WeekPage,
  '/life': LifePage,
  '/assistant': AssistantPage,
}

function useSearchShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.key !== '/' || e.metaKey || e.ctrlKey || target.closest('input, textarea, select, [contenteditable]')) return
      e.preventDefault()
      navigate('/search')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/**
 * One-time introduction of new sections for people who used the app before.
 * Shows only sections they haven't been told about; nothing is switched on unless they choose.
 */
function NewSectionsSheet() {
  const { settings, updateSettings } = useStore()
  const [open, setOpen] = useState(true)
  const [shown] = useState(() => unseenModules(settings).map((m) => m.id))
  const firstTime = !settings.modulesReviewed
  const close = () => {
    setOpen(false)
    void updateSettings({ modulesReviewed: true, modulesSeen: ALL_MODULE_IDS() })
  }
  return (
    <Sheet
      open={open}
      onClose={close}
      title="Novas seções disponíveis"
      footer={
        <Button size="lg" block onClick={close}>
          Pronto
        </Button>
      }
    >
      <p className="pb-4 text-[15px] leading-relaxed text-soft">
        {firstTime ? 'Hoje, Vendas, Assinantes, Rotina e Alimentação chegaram desligadas.' : 'Chegaram seções novas, desligadas.'} Ligue só o que quiser usar — dá para mudar depois em Configurações, e esconder nunca apaga dados.
      </p>
      <ModulePicker value={settings.modules ?? {}} onChange={(modules) => updateSettings({ modules })} isOn={(id) => isEnabled(settings, id)} only={firstTime ? undefined : shown} />
    </Sheet>
  )
}

/**
 * Optional (off by default): opens Morning mode when the app is opened before
 * noon, at most once per day, in the person's time zone. Never from a deep link.
 */
function useMorningAutoOpen() {
  const { ready, settings } = useStore()
  const { path } = useRoute()
  useEffect(() => {
    if (!ready || !settings.onboarded || !settings.morningAutoOpen || !isEnabled(settings, 'today') || path !== '/') return
    const now = nowIn(zoneOf(settings))
    if (now.hour >= 12 || readPref<string>('morningAutoOpened', '') === now.date) return
    writePref('morningAutoOpened', now.date)
    navigate('/today', { mode: 'morning' })
    // Only when the app opens, not on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])
}

/**
 * Closes finished weeks (snapshot) once the app is open, without slowing the
 * start: the code loads on demand, runs once per day, and only with "Semana" on.
 */
function useWeekCloser() {
  const { ready, settings, data, save } = useStore()
  const latest = useRef(data)
  latest.current = data
  const day = nowIn(zoneOf(settings)).date
  const on = ready && settings.onboarded && isEnabled(settings, 'week')
  useEffect(() => {
    if (!on) return
    const timer = window.setTimeout(async () => {
      const { buildSnapshot, weeksToClose } = await import('./core/snapshots')
      for (const week of weeksToClose(latest.current, settings)) {
        // Fixed id = the week: written once, never rewritten automatically.
        if (latest.current.weekSnapshots.some((s) => s.id === week)) continue
        await save('weekSnapshots', buildSnapshot(latest.current, settings, week))
      }
    }, 1500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, day])
}

/**
 * Once the app is ready, loads the code of the enabled sections in the background (idle time), so opening
 * one for the first time is instant instead of a blank moment. Hidden sections are never loaded.
 */
function usePreloadSections() {
  const { ready, settings } = useStore()
  const modules = enabledModules(settings)
    .map((m) => m.path)
    .join()
  useEffect(() => {
    if (!ready) return
    return whenIdle(() => {
      for (const path of modules.split(',')) {
        const page = PAGES[path as RoutePath] as Partial<PreloadablePage> | undefined
        void page?.preload?.().catch(() => {})
      }
    })
  }, [ready, modules])
}

export function App() {
  const { ready, settings, loadError, retryLoad } = useStore()
  const { userId, signOut } = useSession()
  const { path } = useRoute()
  const migration = useMigrationCandidate(userId)
  useSearchShortcut()
  useMorningAutoOpen()
  useWeekCloser()
  usePreloadSections()
  // Payments saved without a rate get their income in Financeiro once the rate exists.
  useReceiptReconciler()
  useTheme()

  if (loadError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-tint/[0.06] text-soft">
          <CloudOff size={22} />
        </div>
        <p className="text-[17px] font-semibold tracking-tight">{loadError === DATABASE_BLOCKED ? 'Atualização esperando outra aba' : 'Não foi possível carregar seus dados'}</p>
        <p className="mt-1.5 max-w-80 text-[15px] leading-relaxed text-soft">{userId && loadError !== DATABASE_BLOCKED ? 'Na primeira vez neste aparelho é preciso internet para baixar a conta.' : loadError}</p>
        <div className="mt-6 flex gap-3">
          <Button onClick={loadError === DATABASE_BLOCKED ? () => location.reload() : retryLoad}>Tentar de novo</Button>
          {userId && (
            <Button variant="secondary" onClick={signOut}>
              Sair
            </Button>
          )}
        </div>
      </div>
    )
  }
  if (!ready || (userId && !migration.checked)) return null
  if (migration.summary) return <MigrationOffer summary={migration.summary} onDone={migration.dismiss} />
  if (!settings.onboarded) return <Onboarding />

  // Focus mode: one task on screen, without tab bar or menus.
  if (path === '/focus') {
    return (
      <Suspense fallback={null}>
        <FocusPage />
      </Suspense>
    )
  }

  // A hidden section is not reachable by link either (its data stays intact).
  const allowed = isRouteAllowed(settings, path)
  const Page = allowed ? (PAGES[path] ?? HomePage) : HomePage
  const hiddenLabel = !allowed ? MODULE_BY_PATH[path]?.label : null
  return (
    <Shell>
      {/* Switching sections is instant (core navigation, many times a day — no transition). */}
      <div key={path}>
        {hiddenLabel && (
          <p className="mb-5 rounded-2xl bg-tint/[0.04] px-4 py-3 text-[14px] text-soft">
            A seção {hiddenLabel} está escondida. Ative em Configurações → Seções visíveis.
          </p>
        )}
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      </div>
      {unseenModules(settings).length > 0 && <NewSectionsSheet />}
      <ReminderCenter />
    </Shell>
  )
}
