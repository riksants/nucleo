/**
 * Personal projects and objectives (one collection, `kind` tells them apart)
 * and their steps. Progress is never invented: with steps it is derived from
 * them; without steps only the person's manual value exists.
 */
import type { DataState, LifePlan, PlanKind, PlanStatus, PlanStep, Task } from '../data/types'

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  planning: 'Planejando',
  active: 'Em andamento',
  done: 'Concluído',
  paused: 'Pausado',
  archived: 'Arquivado',
}

export const KIND_LABEL: Record<PlanKind, { one: string; many: string; feminine: boolean }> = {
  project: { one: 'Projeto pessoal', many: 'Projetos pessoais', feminine: false },
  objective: { one: 'Objetivo', many: 'Objetivos', feminine: false },
}

export interface PlanTemplate {
  id: string
  label: string
  kinds: PlanKind[]
  /** Suggested steps — offered only when the person asks, and they choose which ones. */
  steps: string[]
}

/**
 * Local suggestions (no AI). The Etapa 6 AI can plug in by returning the same
 * shape (see `suggestSteps`).
 */
export const PLAN_TEMPLATES: PlanTemplate[] = [
  { id: 'travel', label: 'Viagem', kinds: ['project'], steps: ['Definir orçamento', 'Comprar transporte', 'Reservar hospedagem', 'Separar documentos', 'Montar roteiro'] },
  { id: 'move', label: 'Mudança', kinds: ['project', 'objective'], steps: ['Definir orçamento', 'Escolher o lugar', 'Organizar documentos', 'Contratar transporte', 'Avisar contas e endereço'] },
  { id: 'car', label: 'Comprar carro', kinds: ['project', 'objective'], steps: ['Definir orçamento', 'Pesquisar modelos', 'Fazer test drive', 'Simular financiamento ou juntar o valor', 'Fechar a compra'] },
  { id: 'house', label: 'Comprar casa', kinds: ['project', 'objective'], steps: ['Definir orçamento', 'Juntar entrada', 'Pesquisar bairros', 'Visitar imóveis', 'Simular financiamento', 'Fechar a compra'] },
  { id: 'wedding', label: 'Casamento', kinds: ['project'], steps: ['Definir orçamento', 'Escolher data e local', 'Lista de convidados', 'Fornecedores', 'Convites'] },
  { id: 'business', label: 'Abrir negócio', kinds: ['project', 'objective'], steps: ['Validar a ideia', 'Planejar custos', 'Formalizar a empresa', 'Montar presença online', 'Primeiros clientes'] },
  { id: 'language', label: 'Aprender idioma', kinds: ['project', 'objective'], steps: ['Escolher curso ou método', 'Estudar o básico', 'Praticar conversação', 'Fazer um teste de nível'] },
  { id: 'exam', label: 'Estudar para prova', kinds: ['project', 'objective'], steps: ['Ver o conteúdo cobrado', 'Montar cronograma', 'Estudar por temas', 'Fazer simulados', 'Revisar'] },
  { id: 'renovation', label: 'Reforma', kinds: ['project'], steps: ['Definir o que mudar', 'Orçamentos', 'Escolher profissional', 'Comprar materiais', 'Acompanhar a obra'] },
  { id: 'health', label: 'Saúde e esporte', kinds: ['objective'], steps: ['Definir a meta', 'Montar plano de treino', 'Acompanhar evolução', 'Fazer avaliação'] },
  { id: 'money', label: 'Dinheiro', kinds: ['objective'], steps: ['Definir o valor', 'Separar quanto guardar por mês', 'Acompanhar a cada mês'] },
  { id: 'other', label: 'Outro', kinds: ['project', 'objective'], steps: [] },
]

export const templateOf = (id: string) => PLAN_TEMPLATES.find((t) => t.id === id) ?? null

/** Steps suggested for a plan: local template only, minus what already exists. */
export function suggestSteps(plan: Pick<LifePlan, 'category'>, existing: Pick<PlanStep, 'title'>[]): string[] {
  const have = new Set(existing.map((s) => s.title.trim().toLowerCase()))
  return (templateOf(plan.category)?.steps ?? []).filter((t) => !have.has(t.toLowerCase()))
}

export function stepsOf(steps: PlanStep[], planId: string): PlanStep[] {
  return steps.filter((s) => s.planId === planId).sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt))
}

/**
 * A step is done when marked done, or — if it has a linked task — when that
 * task is done. Only the task stores that completion (one source of truth).
 */
export function stepDone(step: PlanStep, tasks: Map<string, Task> | Task[]): boolean {
  if (step.status === 'done') return true
  if (!step.taskId) return false
  const task = Array.isArray(tasks) ? tasks.find((t) => t.id === step.taskId) : tasks.get(step.taskId)
  return task?.status === 'done'
}

/** When a step became done (its own mark, or the linked task's completion). */
export function stepDoneAt(step: PlanStep, tasks: Map<string, Task>): string | null {
  if (step.status === 'done') return step.doneAt
  const task = step.taskId ? tasks.get(step.taskId) : undefined
  return task?.status === 'done' ? task.completedAt : null
}

export interface PlanProgress {
  /** automatic = from steps; manual = the person's value; none = nothing to show. */
  source: 'steps' | 'manual' | 'none'
  done: number
  total: number
  percent: number | null
}

export function planProgress(plan: LifePlan, steps: PlanStep[], tasks: Map<string, Task> | Task[]): PlanProgress {
  const mine = steps.filter((s) => s.planId === plan.id)
  if (mine.length) {
    const done = mine.filter((s) => stepDone(s, tasks)).length
    return { source: 'steps', done, total: mine.length, percent: Math.round((done / mine.length) * 100) }
  }
  const manual = plan.manualProgress
  if (typeof manual === 'number' && manual >= 0) return { source: 'manual', done: 0, total: 0, percent: Math.min(100, Math.round(manual)) }
  return { source: 'none', done: 0, total: 0, percent: null }
}

export const taskMap = (tasks: Task[]) => new Map(tasks.map((t) => [t.id, t]))

/** Next order value for a new step at the end. */
export function nextOrder(steps: PlanStep[], planId: string): number {
  const mine = steps.filter((s) => s.planId === planId)
  return mine.length ? Math.max(...mine.map((s) => s.order)) + 1 : 0
}

/**
 * Moving a step up/down swaps it with its neighbour. Returns only the records
 * that change (usually two), each with a distinct order.
 */
export function moveStep(steps: PlanStep[], planId: string, stepId: string, dir: -1 | 1): PlanStep[] {
  const list = stepsOf(steps, planId)
  const i = list.findIndex((s) => s.id === stepId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return []
  // Normalise orders first (older records could share a value), then swap.
  const normal = list.map((s, k) => ({ ...s, order: k }))
  const a = normal[i]
  const b = normal[j]
  const changed = new Map<string, PlanStep>()
  for (const s of normal) if (list.find((x) => x.id === s.id)!.order !== s.order) changed.set(s.id, s)
  changed.set(a.id, { ...a, order: j })
  changed.set(b.id, { ...b, order: i })
  return [...changed.values()]
}

/** Objective → personal project: same record, same steps and tasks; only kind changes. */
export function convertToProject(plan: LifePlan, title: string, now = new Date()): LifePlan {
  return { ...plan, kind: 'project', title: title.trim() || plan.title, convertedFrom: 'objective', convertedAt: now.toISOString() }
}

export function plansOf(data: Pick<DataState, 'lifePlans'>, kind: PlanKind): LifePlan[] {
  return data.lifePlans.filter((p) => p.kind === kind)
}
