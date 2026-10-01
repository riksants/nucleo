import {
  BadgeDollarSign,
  Briefcase,
  CalendarCheck,
  CalendarClock,
  FolderKanban,
  KeyRound,
  ListTodo,
  NotebookPen,
  Repeat,
  Salad,
  Target,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { ModuleId, Settings } from '../data/types'
import type { RoutePath } from './router'

export interface ModuleDef {
  id: ModuleId
  path: RoutePath
  label: string
  icon: LucideIcon
  description: string
  /** Existed before sections could be hidden: stays on for current users. */
  legacy: boolean
}

export const MODULES: ModuleDef[] = [
  { id: 'today', path: '/today', label: 'Hoje', icon: CalendarCheck, description: 'Tarefas, rotina, refeições e prazos do dia', legacy: false },
  { id: 'finance', path: '/finance', label: 'Financeiro', icon: Wallet, description: 'Saldo, entradas e saídas', legacy: true },
  { id: 'projects', path: '/projects', label: 'Projetos', icon: FolderKanban, description: 'Trabalhos, prazos e valores', legacy: true },
  { id: 'tasks', path: '/tasks', label: 'Tarefas', icon: ListTodo, description: 'O que fazer e compromissos', legacy: true },
  { id: 'clients', path: '/clients', label: 'Clientes', icon: Users, description: 'Contatos e histórico', legacy: true },
  { id: 'goals', path: '/goals', label: 'Metas', icon: Target, description: 'Compras que você quer fazer', legacy: true },
  { id: 'tools', path: '/tools', label: 'Ferramentas', icon: Wrench, description: 'Assinaturas que você paga', legacy: true },
  { id: 'accounts', path: '/accounts', label: 'Contas', icon: KeyRound, description: 'Acessos e senhas (cofre)', legacy: true },
  { id: 'notes', path: '/notes', label: 'Anotações', icon: NotebookPen, description: 'Notas rápidas', legacy: true },
  { id: 'portfolio', path: '/portfolio', label: 'Portfólio', icon: Briefcase, description: 'Trabalhos entregues', legacy: true },
  { id: 'sales', path: '/sales', label: 'Vendas', icon: BadgeDollarSign, description: 'Quem comprou, quanto pagou e quanto falta', legacy: false },
  { id: 'subscribers', path: '/subscribers', label: 'Assinantes', icon: Repeat, description: 'Planos e assinantes dos seus projetos', legacy: false },
  { id: 'routine', path: '/routine', label: 'Rotina', icon: CalendarClock, description: 'Agenda semanal montada com IA', legacy: false },
  { id: 'meals', path: '/meals', label: 'Alimentação', icon: Salad, description: 'Planejamento de refeições com IA', legacy: false },
]

export const MODULE_BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<ModuleId, ModuleDef>
export const MODULE_BY_PATH = Object.fromEntries(MODULES.map((m) => [m.path, m])) as Partial<Record<RoutePath, ModuleDef>>

/**
 * Whether a section is visible. Without an explicit choice, the sections that
 * already existed stay on and the new ones stay off, so nothing changes for
 * someone who used the app before.
 */
export function isEnabled(settings: Pick<Settings, 'modules'>, id: ModuleId): boolean {
  const choice = settings.modules?.[id]
  return choice ?? MODULE_BY_ID[id].legacy
}

export function enabledModules(settings: Pick<Settings, 'modules'>): ModuleDef[] {
  return MODULES.filter((m) => isEnabled(settings, m.id))
}

/** Routes always reachable even when hidden from navigation (settings, search, account…). */
export function isRouteAllowed(settings: Pick<Settings, 'modules'>, path: RoutePath): boolean {
  const mod = MODULE_BY_PATH[path]
  return !mod || isEnabled(settings, mod.id)
}
