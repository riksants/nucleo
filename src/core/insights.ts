/**
 * Smart suggestions (Etapa 6). Computed on the fly from real records, never
 * stored; only what the person did with each one (dismissed / snoozed /
 * accepted) lives in settings. Every suggestion says why, with real numbers.
 * Neutral language; no medical or investment advice; Score is only context.
 * Only recent periods are read (today, this week, the last few days, this month).
 */
import { isEnabled } from '../app/modules'
import type { DataState, InsightMark, Settings } from '../data/types'
import { formatMoney } from '../lib/money'
import { buildAgenda } from './agenda'
import { indexCompletions, statusOf } from './completions'
import { monthOf, monthSummary } from './finance'
import { categoryLabel } from './financeCategories'
import { goalPlan } from './financeGoals'
import { habitsDue } from './habits'
import { mealsOfWeek, weekDays } from './meals'
import { percent, rangeMetrics, weekMetrics } from './metrics'
import { addDaysToDate, nowIn, weekStart, weekdayOfDate, zoneOf } from './period'
import { planProgress, stepDone, stepsOf, taskMap } from './plans'
import { conflictsOf } from './timeline'
import { dayName, weekRange } from './reorganize'
import { buildList } from './shopping'
import { goalProgress } from './weekGoals'

export type InsightPriority = 'high' | 'medium' | 'low'
export type InsightArea = 'tasks' | 'agenda' | 'habits' | 'goals' | 'finance' | 'plans' | 'meals' | 'week'

/** What tapping the suggestion's button does (handled by the Assistant). */
export type InsightAction =
  | { kind: 'reorganizeDay' }
  | { kind: 'reorganizeWeek' }
  | { kind: 'replan'; key: string; date: string }
  | { kind: 'open'; path: string; params?: Record<string, string> }

export interface Insight {
  /** Stable while the situation is the same; changes when the facts change. */
  key: string
  area: InsightArea
  priority: InsightPriority
  title: string
  /** "Por quê?" */
  why: string
  action?: { label: string; do: InsightAction }
  /** Sort helper inside the same priority (sooner first). */
  when: string
}

const RANK: Record<InsightPriority, number> = { high: 0, medium: 1, low: 2 }
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function computeInsights(data: DataState, settings: Settings, now = new Date()): Insight[] {
  const n = nowIn(zoneOf(settings), now)
  const today = n.date
  const on = (m: Parameters<typeof isEnabled>[1]) => isEnabled(settings, m)
  const out: Insight[] = []
  const week = weekStart(today)

  // ---- Tasks: due today, overdue, a crowded day in the week
  if (on('tasks')) {
    const open = data.tasks.filter((t) => t.status !== 'done')
    const dueToday = open.filter((t) => t.dueDate === today)
    const highToday = dueToday.filter((t) => t.priority === 'high')
    if (dueToday.length >= 2 && highToday.length) {
      const t = highToday[0]
      out.push({ key: `due:${today}:${t.id}:${dueToday.length}`, area: 'tasks', priority: 'high', when: today, title: `“${t.title}” vence hoje`, why: `Ela vence hoje e há mais ${plural(dueToday.length - 1, 'tarefa', 'tarefas')} para hoje.`, action: { label: 'Organizar meu dia', do: { kind: 'reorganizeDay' } } })
    }
    const overdue = open.filter((t) => t.dueDate && t.dueDate < today)
    if (overdue.length) out.push({ key: `overdue:${today}:${overdue.length}`, area: 'tasks', priority: 'medium', when: today, title: `${plural(overdue.length, 'tarefa ficou', 'tarefas ficaram')} com data passada`, why: `${overdue.slice(0, 3).map((t) => `“${t.title}”`).join(', ')}${overdue.length > 3 ? '…' : ''} — a data já passou e ainda estão abertas.`, action: { label: 'Organizar meu dia', do: { kind: 'reorganizeDay' } } })
    const days = weekRange(today)
    const count = new Map(days.map((d) => [d, open.filter((t) => t.dueDate === d && !t.dueTime).length]))
    const busiest = days.reduce((a, b) => (count.get(b)! > count.get(a)! ? b : a), days[0])
    const lightest = days.filter((d) => d < busiest).reduce<string | null>((a, b) => (a === null || count.get(b)! < count.get(a)! ? b : a), null)
    if (lightest && count.get(busiest)! >= 3 && count.get(busiest)! - count.get(lightest)! >= 3) {
      out.push({ key: `crowded:${week}:${busiest}:${count.get(busiest)}`, area: 'tasks', priority: 'medium', when: busiest, title: `Você deixou ${count.get(busiest)} tarefas para ${dayName(busiest, today)}. Quer distribuir durante a semana?`, why: `${dayName(busiest, today)} tem ${count.get(busiest)} tarefas sem horário e ${dayName(lightest, today)} tem ${count.get(lightest)}.`, action: { label: 'Organizar minha semana', do: { kind: 'reorganizeWeek' } } })
    }
  }

  // ---- Agenda: conflicts today and in the next 2 days
  const items = buildAgenda(data, settings, today, addDaysToDate(today, 2), now)
  for (const c of conflictsOf(items)) {
    if (c.date === today && c.a.end <= Number(n.time.slice(0, 2)) * 60 + Number(n.time.slice(3, 5))) continue
    const flex = !c.b.fixed ? c.b : !c.a.fixed ? c.a : null
    out.push({
      key: c.key,
      area: 'agenda',
      priority: c.level === 'high' && c.date <= addDaysToDate(today, 1) ? 'high' : 'medium',
      when: c.date,
      title: `Dois itens no mesmo horário ${dayName(c.date, today)}`,
      why: `“${c.a.title}” (${c.a.item.start}) e “${c.b.title}” (${c.b.item.start}) se sobrepõem.${flex ? ` “${flex.title}” é flexível.` : ' Os dois são compromissos fixos.'}`,
      action: flex ? { label: 'Sugerir novo horário', do: { kind: 'replan', key: flex.key, date: c.date } } : undefined,
    })
  }

  // ---- Habits: pending on the last 3 days it was scheduled
  if (on('habits')) {
    const index = indexCompletions(data.completions)
    for (const h of data.habits.filter((x) => x.active)) {
      const due: string[] = []
      for (let d = addDaysToDate(today, -1), i = 0; due.length < 3 && i < 14; d = addDaysToDate(d, -1), i++) if (d >= h.startDate && habitsDue([h], d).length) due.push(d)
      if (due.length === 3 && due.every((d) => statusOf(index, 'habit', h.id, d) === 'pending')) {
        out.push({ key: `habit:${h.id}:${due[0]}`, area: 'habits', priority: 'low', when: due[0], title: `“${h.name}” ficou pendente nos últimos 3 dias em que estava programado`, why: `Sem marcação em ${due.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`).join(', ')}. Talvez os dias ou o horário precisem de ajuste.`, action: { label: 'Ver hábitos', do: { kind: 'open', path: '/habits' } } })
      }
    }
  }

  // ---- Weekly goals at risk (auto-measured goals of this week)
  if (on('week')) {
    const goals = data.weeklyGoals.filter((g) => g.week === week && g.status === 'active' && g.kind !== 'manual' && g.kind !== 'money')
    if (goals.length) {
      const m = weekMetrics(data, settings, week, now)
      const daysLeft = 7 - ((weekdayOfDate(today) + 6) % 7)
      for (const g of goals) {
        const p = goalProgress(g, m)
        if (p.achieved || p.noData || g.kind === 'percent') continue
        const missing = g.target - p.value
        if (missing <= 0) continue
        const tight = missing >= daysLeft
        if (!tight && daysLeft > 3) continue
        out.push({ key: `goal:${g.id}:${p.value}:${daysLeft}`, area: 'goals', priority: missing > daysLeft ? 'medium' : 'low', when: today, title: `Sua meta “${g.title}” está em ${p.value} de ${g.target}`, why: missing > daysLeft ? `Faltam ${missing} e restam ${plural(daysLeft, 'dia', 'dias')} na semana. Essa meta pode precisar de ajuste.` : `Faltam ${missing} e restam ${plural(daysLeft, 'dia', 'dias')} na semana.`, action: { label: 'Ver semana', do: { kind: 'open', path: '/week' } } })
      }
    }
  }

  // ---- Finance: goals with a deadline, and a category above last month's same period
  if (on('finance')) {
    for (const g of (data.financeGoals ?? []).filter((x) => x.status === 'active')) {
      const p = goalPlan(g, today)
      if (p.reached || p.due || p.onPace !== false || !p.perWeek) continue
      out.push({ key: `fgoal:${g.id}:${week}`, area: 'finance', priority: p.daysLeft <= 30 ? 'medium' : 'low', when: g.deadline, title: `Sua meta “${g.name}” exige aproximadamente ${formatMoney(p.perWeek, g.currency)} por semana para chegar ao prazo`, why: `Faltam ${formatMoney(p.missing, g.currency)} e ${plural(p.daysLeft, 'dia', 'dias')} até ${g.deadline.slice(8, 10)}/${g.deadline.slice(5, 7)}. O valor guardado está abaixo do ritmo previsto desde o início.`, action: { label: 'Ver metas financeiras', do: { kind: 'open', path: '/finance' } } })
    }
    if (Number(today.slice(8, 10)) >= 7) {
      const s = monthSummary(data, settings, monthOf(today), now)
      if (s.comparison) {
        const prev = s.comparison.previous.byCategory
        const up = Object.entries(s.totals.byCategory)
          .filter(([c, v]) => c && prev[c] > 0 && v >= prev[c] * 1.3 && v - prev[c] >= 5000)
          .sort((a, b) => b[1] - prev[b[0]] - (a[1] - prev[a[0]]))[0]
        if (up) {
          const cur = settings.baseCurrency
          out.push({ key: `spend:${monthOf(today)}:${up[0]}`, area: 'finance', priority: 'low', when: today, title: `Você gastou mais em ${categoryLabel(settings, up[0])} do que no mesmo período do mês passado`, why: `Até o dia ${Number(today.slice(8, 10))}: ${formatMoney(up[1], cur)} agora e ${formatMoney(prev[up[0]], cur)} no mesmo período do mês passado.`, action: { label: 'Ver resumo do mês', do: { kind: 'open', path: '/finance', params: { view: 'month' } } } })
        }
      }
    }
  }

  // ---- Personal projects and objectives
  if (on('life')) {
    const tasks = taskMap(data.tasks)
    for (const plan of data.lifePlans.filter((p) => p.status === 'active' || p.status === 'planning')) {
      const what = plan.kind === 'objective' ? 'objetivo' : 'projeto'
      const steps = stepsOf(data.planSteps, plan.id)
      const open = steps.filter((s) => !stepDone(s, tasks))
      for (const s of open) {
        if (!s.deadline) continue
        if (s.deadline < today) out.push({ key: `step-late:${s.id}:${s.deadline}`, area: 'plans', priority: 'medium', when: s.deadline, title: `A etapa “${s.title}” passou da data`, why: `Era para ${s.deadline.slice(8, 10)}/${s.deadline.slice(5, 7)} e ainda está aberta, no ${what} ${plan.title}.`, action: { label: 'Abrir', do: { kind: 'open', path: '/life', params: { open: plan.id } } } })
        else if (s.deadline <= addDaysToDate(today, 2)) out.push({ key: `step-soon:${s.id}:${s.deadline}`, area: 'plans', priority: s.deadline === today ? 'high' : 'medium', when: s.deadline, title: s.deadline === today ? `A etapa “${s.title}” vence hoje` : `Seu ${what} tem uma etapa vencendo ${dayName(s.deadline, today)}`, why: `“${s.title}”, do ${what} ${plan.title}, vence em ${s.deadline.slice(8, 10)}/${s.deadline.slice(5, 7)}.`, action: { label: 'Abrir', do: { kind: 'open', path: '/life', params: { open: plan.id } } } })
      }
      const pr = planProgress(plan, data.planSteps, tasks)
      if (plan.deadline && plan.deadline >= today && plan.deadline <= addDaysToDate(today, 7) && (pr.percent ?? 0) < 100) {
        out.push({ key: `plan-soon:${plan.id}:${plan.deadline}`, area: 'plans', priority: plan.deadline <= addDaysToDate(today, 2) ? 'high' : 'medium', when: plan.deadline, title: `O prazo do ${what} “${plan.title}” está próximo`, why: `Prazo em ${plan.deadline.slice(8, 10)}/${plan.deadline.slice(5, 7)}; ${pr.source === 'steps' ? `${pr.done} de ${pr.total} etapas concluídas` : pr.percent !== null ? `${pr.percent}% (manual)` : 'sem etapas definidas'}.`, action: { label: 'Abrir', do: { kind: 'open', path: '/life', params: { open: plan.id } } } })
      }
      if (plan.kind === 'objective' && plan.status === 'active' && !open.length) {
        out.push({ key: `no-next:${plan.id}:${steps.length}`, area: 'plans', priority: 'low', when: today, title: `Seu objetivo “${plan.title}” está sem nenhuma próxima etapa definida`, why: steps.length ? `As ${steps.length} etapas cadastradas já foram concluídas.` : 'Ainda não há etapas cadastradas.', action: { label: 'Definir etapa', do: { kind: 'open', path: '/life', params: { open: plan.id } } } })
      }
      // No movement for 14 days (plan or steps changed, a step done).
      const last = [plan.updatedAt, ...steps.map((s) => s.updatedAt), ...steps.map((s) => s.doneAt ?? '')].sort().pop() ?? plan.updatedAt
      const lastDay = last.slice(0, 10)
      if (plan.status === 'active' && lastDay && lastDay <= addDaysToDate(today, -14)) {
        out.push({ key: `stale:${plan.id}:${lastDay}`, area: 'plans', priority: 'low', when: lastDay, title: `O ${what} “${plan.title}” está sem movimento há algum tempo`, why: `Última atualização em ${lastDay.slice(8, 10)}/${lastDay.slice(5, 7)}, há mais de 14 dias.`, action: { label: 'Abrir', do: { kind: 'open', path: '/life', params: { open: plan.id } } } })
      }
    }
  }

  // ---- Meals (organisation only)
  if (on('meals')) {
    const thisWeek = mealsOfWeek(data.meals ?? [], week)
    if (thisWeek.length) {
      const empty = weekDays(week).filter((d) => d > today && !thisWeek.some((m) => m.date === d))
      if (empty.length) out.push({ key: `meals-gap:${week}:${empty.join(',')}`, area: 'meals', priority: 'low', when: empty[0], title: `Você ainda não planejou refeições para ${dayName(empty[0], today)}${empty.length > 1 ? ` e mais ${plural(empty.length - 1, 'dia', 'dias')}` : ''}`, why: `A semana tem refeições planejadas em ${plural(new Set(thisWeek.map((m) => m.date)).size, 'dia', 'dias')}, mas não em ${empty.map((d) => dayName(d, today)).join(', ')}.`, action: { label: 'Abrir Alimentação', do: { kind: 'open', path: '/meals' } } })
      const pendingItems = buildList(thisWeek, data.shoppingItems ?? [], week).filter((r) => !r.checked).length
      if (pendingItems >= 3) out.push({ key: `shopping:${week}:${pendingItems}`, area: 'meals', priority: 'low', when: today, title: `Existem ${pendingItems} itens na lista de compras`, why: 'Itens das refeições desta semana e os que você adicionou, ainda não marcados como comprados.', action: { label: 'Ver lista', do: { kind: 'open', path: '/meals', params: { view: 'shopping' } } } })
      const todays = thisWeek.filter((m) => m.date === today)
      if (todays.length && Number(n.time.slice(0, 2)) >= 20) {
        const done = todays.filter((m) => m.done).length
        if (done < todays.length) out.push({ key: `meals-today:${today}:${done}`, area: 'meals', priority: 'low', when: today, title: `Você planejou ${plural(todays.length, 'refeição', 'refeições')} hoje e marcou ${done} como ${done === 1 ? 'realizada' : 'realizadas'}`, why: 'Só para o registro do dia ficar completo, se quiser.', action: { label: 'Abrir Alimentação', do: { kind: 'open', path: '/meals' } } })
      }
    }
  }

  // ---- Week planning (Sunday) and habits trend (context, not the Score formula)
  if (weekdayOfDate(today) === 0 && on('week')) {
    const next = addDaysToDate(week, 7)
    const planned = data.tasks.some((t) => t.dueDate >= next && t.dueDate <= addDaysToDate(next, 6)) || data.events.some((e) => e.date >= next && e.date <= addDaysToDate(next, 6))
    if (!planned) out.push({ key: `plan-week:${next}`, area: 'week', priority: 'low', when: today, title: 'Quer preparar a próxima semana?', why: 'Ainda não há tarefas nem compromissos com data para a próxima semana.', action: { label: 'Planejar semana', do: { kind: 'open', path: '/week', params: { view: 'plan' } } } })
  }
  if (on('habits') && weekdayOfDate(today) !== 1) {
    const cur = rangeMetrics(data, settings, week, today, now).habitsNoTraining
    const prev = rangeMetrics(data, settings, addDaysToDate(week, -7), addDaysToDate(today, -7), now).habitsNoTraining
    const a = percent(prev)
    const b = percent(cur)
    if (cur.expected >= 3 && prev.expected >= 3 && a !== null && b !== null && a - b >= 20) {
      out.push({ key: `habits-trend:${week}:${b}`, area: 'habits', priority: 'low', when: today, title: 'O cumprimento de hábitos diminuiu em relação à semana anterior', why: `Nos mesmos dias: ${a}% na semana anterior e ${b}% nesta.`, action: { label: 'Ver semana', do: { kind: 'open', path: '/week' } } })
    }
  }

  return out.sort((x, y) => RANK[x.priority] - RANK[y.priority] || x.when.localeCompare(y.when) || x.key.localeCompare(y.key))
}

/** Hide what the person dismissed, accepted or snoozed (until the date). */
export function visibleInsights(list: Insight[], state: Settings['insightState'], today: string): Insight[] {
  return list.filter((i) => {
    const m = state?.[i.key]
    if (!m) return true
    if (m.s === 'snoozed') return Boolean(m.until && m.until <= today)
    return false
  })
}

export const HOME_LIMIT = 3
export const ASSISTANT_LIMIT = 8

/** Old marks go away after 30 days; at most 200 are kept (newest first). */
export function pruneInsightState(state: Record<string, InsightMark> | undefined, now = new Date()): Record<string, InsightMark> {
  const limit = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const keep = Object.entries(state ?? {})
    .filter(([, m]) => m.at >= limit)
    .sort((a, b) => (a[1].at < b[1].at ? 1 : -1))
    .slice(0, 200)
  return Object.fromEntries(keep)
}

export function markInsight(state: Settings['insightState'], key: string, mark: Omit<InsightMark, 'at'>, now = new Date()): Record<string, InsightMark> {
  return pruneInsightState({ ...(state ?? {}), [key]: { ...mark, at: now.toISOString() } }, now)
}
