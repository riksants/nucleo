import { motion } from 'framer-motion'
import { CloudOff } from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'
import { isRouteAllowed, MODULE_BY_PATH } from './app/modules'
import { navigate, useRoute, type RoutePath } from './app/router'
import { Shell } from './app/Shell'
import { useStore } from './data/store'
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
import { MealsPage } from './features/planner/MealsPage'
import { PlannerPage } from './features/planner/PlannerPage'
import { RoutinePage } from './features/planner/RoutinePage'
import { PortfolioPage } from './features/portfolio/PortfolioPage'
import { ProjectsPage } from './features/projects/ProjectsPage'
import { ReminderCenter } from './features/reminders/ReminderCenter'
import { RemindersPage } from './features/reminders/RemindersPage'
import { SalesPage } from './features/sales/SalesPage'
import { SearchPage } from './features/search/SearchPage'
import { ModulePicker } from './features/settings/ModulePicker'
import { SettingsPage } from './features/settings/SettingsPage'
import { SubscribersPage } from './features/subscribers/SubscribersPage'
import { TasksPage } from './features/tasks/TasksPage'
import { TodayPage } from './features/today/TodayPage'
import { ToolsPage } from './features/tools/ToolsPage'
import { isEnabled } from './app/modules'
import { Button } from './ui/Button'
import { Sheet } from './ui/Sheet'

const PAGES: Record<RoutePath, ComponentType> = {
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

/** One-time introduction of the new sections for people who used the app before. Nothing changes until they choose. */
function NewSectionsSheet() {
  const { settings, updateSettings } = useStore()
  const [open, setOpen] = useState(true)
  const close = () => {
    setOpen(false)
    void updateSettings({ modulesReviewed: true })
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
      <p className="pb-4 text-[15px] leading-relaxed text-soft">Hoje, Vendas, Assinantes, Rotina e Alimentação chegaram desligadas. Ligue só o que quiser usar — dá para mudar depois em Configurações, e esconder nunca apaga dados.</p>
      <ModulePicker value={settings.modules ?? {}} onChange={(modules) => updateSettings({ modules })} isOn={(id) => isEnabled(settings, id)} />
    </Sheet>
  )
}

export function App() {
  const { ready, settings, loadError, retryLoad } = useStore()
  const { userId, signOut } = useSession()
  const { path } = useRoute()
  const migration = useMigrationCandidate(userId)
  useSearchShortcut()

  if (loadError) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-white/[0.06] text-soft">
          <CloudOff size={22} />
        </div>
        <p className="text-[17px] font-semibold tracking-tight">Não foi possível carregar seus dados</p>
        <p className="mt-1.5 max-w-80 text-[15px] leading-relaxed text-soft">{userId ? 'Na primeira vez neste aparelho é preciso internet para baixar a conta.' : loadError}</p>
        <div className="mt-6 flex gap-3">
          <Button onClick={retryLoad}>Tentar de novo</Button>
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

  // A hidden section is not reachable by link either (its data stays intact).
  const allowed = isRouteAllowed(settings, path)
  const Page = allowed ? (PAGES[path] ?? HomePage) : HomePage
  const hiddenLabel = !allowed ? MODULE_BY_PATH[path]?.label : null
  return (
    <Shell>
      <motion.div key={path} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
        {hiddenLabel && (
          <p className="mb-5 rounded-2xl bg-white/[0.04] px-4 py-3 text-[14px] text-soft">
            A seção {hiddenLabel} está escondida. Ative em Configurações → Seções visíveis.
          </p>
        )}
        <Page />
      </motion.div>
      {!settings.modulesReviewed && <NewSectionsSheet />}
      <ReminderCenter />
    </Shell>
  )
}
