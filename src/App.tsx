import { motion } from 'framer-motion'
import { useEffect, type ComponentType } from 'react'
import { navigate, useRoute, type RoutePath } from './app/router'
import { Shell } from './app/Shell'
import { useStore } from './data/store'
import { AccountsPage } from './features/accounts/AccountsPage'
import { ClientsPage } from './features/clients/ClientsPage'
import { FinancePage } from './features/finance/FinancePage'
import { GoalsPage } from './features/goals/GoalsPage'
import { HomePage } from './features/home/HomePage'
import { MorePage } from './features/more/MorePage'
import { NotesPage } from './features/notes/NotesPage'
import { Onboarding } from './features/onboarding/Onboarding'
import { PortfolioPage } from './features/portfolio/PortfolioPage'
import { ProjectsPage } from './features/projects/ProjectsPage'
import { SearchPage } from './features/search/SearchPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { TasksPage } from './features/tasks/TasksPage'
import { ToolsPage } from './features/tools/ToolsPage'

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

export function App() {
  const { ready, settings } = useStore()
  const { path } = useRoute()
  useSearchShortcut()

  if (!ready) return null
  if (!settings.onboarded) return <Onboarding />

  const Page = PAGES[path] ?? HomePage
  return (
    <Shell>
      <motion.div key={path} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
        <Page />
      </motion.div>
    </Shell>
  )
}
