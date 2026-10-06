import type { ClientStatus, ProjectKind, ProjectStatus, TaskPriority, TaskStatus, ToolBilling, ToolStatus } from './types'

export type Tone = 'neutral' | 'accent' | 'positive' | 'negative' | 'warn' | 'goal'

export interface Option<V extends string> {
  value: V
  label: string
  tone?: Tone
}

export const CLIENT_STATUS: Option<ClientStatus>[] = [
  { value: 'potential', label: 'Potencial', tone: 'goal' },
  { value: 'active', label: 'Ativo', tone: 'accent' },
  { value: 'waiting', label: 'Aguardando', tone: 'warn' },
  { value: 'done', label: 'Concluído', tone: 'positive' },
  { value: 'archived', label: 'Arquivado', tone: 'neutral' },
]

export const PROJECT_KIND: Option<ProjectKind>[] = [
  { value: 'site', label: 'Site' },
  { value: 'app', label: 'App' },
  { value: 'other', label: 'Outro' },
]

export const PROJECT_STATUS: Option<ProjectStatus>[] = [
  { value: 'idea', label: 'Ideia', tone: 'goal' },
  { value: 'notStarted', label: 'Não iniciado', tone: 'neutral' },
  { value: 'inProgress', label: 'Em andamento', tone: 'accent' },
  { value: 'waitingClient', label: 'Aguardando cliente', tone: 'warn' },
  { value: 'review', label: 'Revisão', tone: 'warn' },
  { value: 'done', label: 'Concluído', tone: 'positive' },
  { value: 'paused', label: 'Pausado', tone: 'neutral' },
]

export const TASK_STATUS: Option<TaskStatus>[] = [
  { value: 'todo', label: 'A fazer' },
  { value: 'doing', label: 'Fazendo' },
  { value: 'done', label: 'Feito' },
]

export const TASK_PRIORITY: Option<TaskPriority>[] = [
  { value: 'none', label: 'Nenhuma' },
  { value: 'low', label: 'Baixa', tone: 'neutral' },
  { value: 'medium', label: 'Média', tone: 'warn' },
  { value: 'high', label: 'Alta', tone: 'negative' },
]

export const TOOL_BILLING: Option<ToolBilling>[] = [
  { value: 'monthly', label: 'Mensal' },
  { value: 'yearly', label: 'Anual' },
  { value: 'once', label: 'Pagamento único' },
  { value: 'free', label: 'Grátis' },
]

export const TOOL_STATUS: Option<ToolStatus>[] = [
  { value: 'active', label: 'Ativa', tone: 'accent' },
  { value: 'trial', label: 'Teste', tone: 'warn' },
  { value: 'free', label: 'Gratuita', tone: 'positive' },
  { value: 'cancelled', label: 'Cancelada', tone: 'neutral' },
]

export function optionOf<V extends string>(options: Option<V>[], value: V): Option<V> {
  return options.find((o) => o.value === value) ?? options[0]
}

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-soft',
  accent: 'text-accent-hi',
  positive: 'text-income',
  negative: 'text-expense',
  warn: 'text-warn',
  goal: 'text-goal',
}

export const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-tint/[0.06] text-soft',
  accent: 'bg-accent/15 text-accent-hi',
  positive: 'bg-income/12 text-income',
  negative: 'bg-expense/12 text-expense',
  warn: 'bg-warn/12 text-warn',
  goal: 'bg-goal/14 text-goal',
}
