/**
 * Calendário de Vida: a month view built on the fly from the original records.
 * Nothing is copied — day items come from the agenda (tasks, appointments,
 * routine, habits, recurring, meals) and deadlines point at their record
 * (personal projects, objectives, steps, work projects, finance goals, paid
 * tools). Only the weeks on screen are computed.
 */
import { isEnabled } from '../app/modules'
import { ACTIVE_PROJECT_STATUSES, isPaidTool } from '../data/selectors'
import type { DataState, FinanceGoal, LifePlan, PlanStep, Project, Settings, Tool } from '../data/types'
import { buildAgenda, type AgendaItem } from './agenda'
import { monthBounds, type MonthId } from './finance'
import { stepDone, taskMap } from './plans'
import { addDaysToDate, weekStart } from './period'

export type MarkType = 'plan' | 'step' | 'workProject' | 'financeGoal' | 'tool'

/** A dated thing that is not a day item: a deadline or a charge. */
export interface CalendarMark {
  key: string
  date: string
  type: MarkType
  title: string
  label: string
  ref:
    | { kind: 'plan'; plan: LifePlan }
    | { kind: 'step'; step: PlanStep; plan: LifePlan }
    | { kind: 'workProject'; project: Project }
    | { kind: 'financeGoal'; goal: FinanceGoal }
    | { kind: 'tool'; tool: Tool }
}

/** Monday-first weeks covering the month (5 or 6 rows). */
export function monthGrid(month: MonthId): { from: string; to: string; dates: string[] } {
  const { from, to } = monthBounds(month)
  const start = weekStart(from)
  const end = addDaysToDate(weekStart(to), 6)
  const dates: string[] = []
  for (let d = start; d <= end; d = addDaysToDate(d, 1)) dates.push(d)
  return { from: start, to: end, dates }
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** Charge dates of a paid tool between from and to (monthly/yearly, clamped to month end). */
export function chargesBetween(tool: Tool, from: string, to: string): string[] {
  if (!isPaidTool(tool) || tool.status !== 'active' || !/^\d{4}-\d{2}-\d{2}$/.test(tool.nextCharge)) return []
  const [y0, m0, d0] = tool.nextCharge.split('-').map(Number)
  const out: string[] = []
  const step = tool.billing === 'monthly' ? 1 : 12
  // The stored date is the first known charge: nothing before it; start near the range.
  const startY = Number(from.slice(0, 4))
  const startM = Number(from.slice(5, 7))
  let k = Math.max(0, Math.floor(((startY - y0) * 12 + (startM - m0)) / step) - 1)
  for (let guard = 0; guard < 40; guard++, k++) {
    const total = m0 - 1 + k * step
    const y = y0 + Math.floor(total / 12)
    const m = (((total % 12) + 12) % 12) + 1
    const date = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d0, daysIn(y, m))).padStart(2, '0')}`
    if (date > to) break
    if (date >= from) out.push(date)
  }
  return out
}

export function calendarMarks(data: DataState, settings: Settings, from: string, to: string): CalendarMark[] {
  const out: CalendarMark[] = []
  const inRange = (d: string) => Boolean(d) && d >= from && d <= to
  if (isEnabled(settings, 'life')) {
    const open = (p: LifePlan) => p.status !== 'done' && p.status !== 'archived'
    const plans = new Map(data.lifePlans.map((p) => [p.id, p]))
    for (const plan of data.lifePlans) {
      if (open(plan) && inRange(plan.deadline)) out.push({ key: `plan:${plan.id}`, date: plan.deadline, type: 'plan', title: plan.title, label: plan.kind === 'objective' ? 'Prazo do objetivo' : 'Prazo do projeto pessoal', ref: { kind: 'plan', plan } })
    }
    const tasks = taskMap(data.tasks)
    for (const step of data.planSteps) {
      const plan = plans.get(step.planId)
      if (!plan || !open(plan) || !inRange(step.deadline) || stepDone(step, tasks)) continue
      out.push({ key: `step:${step.id}`, date: step.deadline, type: 'step', title: step.title, label: `Etapa · ${plan.title}`, ref: { kind: 'step', step, plan } })
    }
  }
  if (isEnabled(settings, 'projects')) {
    for (const project of data.projects) {
      if (ACTIVE_PROJECT_STATUSES.has(project.status) && inRange(project.dueDate)) out.push({ key: `project:${project.id}`, date: project.dueDate, type: 'workProject', title: project.name, label: 'Prazo do projeto de trabalho', ref: { kind: 'workProject', project } })
    }
  }
  if (isEnabled(settings, 'finance')) {
    for (const goal of data.financeGoals ?? []) {
      if (goal.status === 'active' && goal.saved < goal.target && inRange(goal.deadline)) out.push({ key: `fgoal:${goal.id}`, date: goal.deadline, type: 'financeGoal', title: goal.name, label: 'Prazo da meta financeira', ref: { kind: 'financeGoal', goal } })
    }
  }
  if (isEnabled(settings, 'tools')) {
    for (const tool of data.tools) for (const date of chargesBetween(tool, from, to)) out.push({ key: `tool:${tool.id}:${date}`, date, type: 'tool', title: tool.name, label: 'Cobrança', ref: { kind: 'tool', tool } })
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)))
}

export interface CalendarMonth {
  month: MonthId
  dates: string[]
  items: Map<string, AgendaItem[]>
  marks: Map<string, CalendarMark[]>
}

/** Everything for the visible weeks of one month (computed once per month shown). */
export function calendarMonth(data: DataState, settings: Settings, month: MonthId, now = new Date()): CalendarMonth {
  const grid = monthGrid(month)
  const items = new Map<string, AgendaItem[]>()
  for (const i of buildAgenda(data, settings, grid.from, grid.to, now)) items.set(i.date, [...(items.get(i.date) ?? []), i])
  const marks = new Map<string, CalendarMark[]>()
  for (const m of calendarMarks(data, settings, grid.from, grid.to)) marks.set(m.date, [...(marks.get(m.date) ?? []), m])
  return { month, dates: grid.dates, items, marks }
}

export type IndicatorTone = 'task' | 'event' | 'training' | 'money' | 'deadline'

/**
 * Short indicators for a day cell ("2 tarefas", "treino", "conta", "prazo").
 * Daily habits and routine blocks stay out of the cell (they would be on every
 * day) and show up when the day is opened.
 */
export function dayIndicators(items: AgendaItem[], marks: CalendarMark[]): { label: string; tone: IndicatorTone }[] {
  const out: { label: string; tone: IndicatorTone }[] = []
  const tasks = items.filter((i) => i.kind === 'task' && i.status !== 'done').length
  const events = items.filter((i) => i.kind === 'event').length
  const training = items.some((i) => (i.kind === 'routine' && i.blockKind === 'training') || (i.kind === 'habit' && i.source.kind === 'habit' && i.source.habit.category === 'training'))
  const money = marks.filter((m) => m.type === 'tool').length
  const deadlines = marks.filter((m) => m.type !== 'tool').length
  if (events) out.push({ label: events === 1 ? '1 compromisso' : `${events} compromissos`, tone: 'event' })
  if (tasks) out.push({ label: tasks === 1 ? '1 tarefa' : `${tasks} tarefas`, tone: 'task' })
  if (training) out.push({ label: 'treino', tone: 'training' })
  if (money) out.push({ label: money === 1 ? 'conta' : `${money} contas`, tone: 'money' })
  if (deadlines) out.push({ label: deadlines === 1 ? 'prazo' : `${deadlines} prazos`, tone: 'deadline' })
  return out
}
