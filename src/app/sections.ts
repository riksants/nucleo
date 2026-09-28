import {
  Briefcase,
  CircleEllipsis,
  FolderKanban,
  House,
  KeyRound,
  ListTodo,
  NotebookPen,
  Search,
  Settings,
  Target,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { RoutePath } from './router'

export interface Section {
  path: RoutePath
  label: string
  icon: LucideIcon
}

export const PRIMARY: Section[] = [
  { path: '/', label: 'Início', icon: House },
  { path: '/finance', label: 'Financeiro', icon: Wallet },
  { path: '/projects', label: 'Projetos', icon: FolderKanban },
  { path: '/tasks', label: 'Tarefas', icon: ListTodo },
]

export const SECONDARY: Section[] = [
  { path: '/clients', label: 'Clientes', icon: Users },
  { path: '/goals', label: 'Metas', icon: Target },
  { path: '/tools', label: 'Ferramentas', icon: Wrench },
  { path: '/accounts', label: 'Contas', icon: KeyRound },
  { path: '/notes', label: 'Anotações', icon: NotebookPen },
  { path: '/portfolio', label: 'Portfólio', icon: Briefcase },
]

export const MORE: Section = { path: '/more', label: 'Mais', icon: CircleEllipsis }
export const SEARCH: Section = { path: '/search', label: 'Buscar', icon: Search }
export const SETTINGS: Section = { path: '/settings', label: 'Configurações', icon: Settings }
