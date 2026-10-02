/**
 * The Assistant's controlled actions. Reads answer from the person's own
 * records (local, offline-friendly); writes only build a proposal — the app
 * applies it with its normal save/remove after the person confirms. There is
 * no action to delete money movements, goals, projects, meals or accounts.
 */
import { isEnabled } from '../../app/modules'
import { newId } from '../../data/store'
import type { DataState, HabitCategory, LifePlan, Settings, Task } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { itemLabel } from '../agenda'
import { computeChanges } from '../changes'
import { mealsMorningLine, morningSentence, planDay } from '../day'
import { monthForecast, monthLabel, monthOf, monthSummary, weekMoney } from '../finance'
import { categoryLabel } from '../financeCategories'
import { goalPlan, startHistory } from '../financeGoals'
import { forecastText, monthComparisonText, weekMoneySentences } from '../financeText'
import { ASSISTANT_LIMIT, computeInsights, visibleInsights } from '../insights'
import { weekMetrics } from '../metrics'
import { addDaysToDate, nowIn, weekStart, zoneOf } from '../period'
import { KIND_LABEL, PLAN_STATUS_LABEL, planProgress, stepDone, stepsOf, taskMap } from '../plans'
import { dayName, reorganizeDay, reorganizeWeek } from '../reorganize'
import { computeScore } from '../score'
import { flattenMetrics } from '../snapshots'
import { goalProgress } from '../weekGoals'
import { summarySentences } from '../weekSummary'
import type { Intent } from './intents'
import { proposalId, type Proposal } from './proposal'

export interface Reply {
  lines: string[]
  list?: { title: string; meta?: string }[]
  proposal?: Proposal
  link?: { label: string; path: string; params?: Record<string, string> }
}

export interface Ctx {
  data: DataState
  settings: Settings
  now: Date
}

export const EXAMPLES = ['O que tenho hoje?', 'O que tenho amanhã?', 'Organiza meu dia', 'Organiza minha semana', 'Quanto gastei esta semana?', 'Resumo financeiro', 'Como estão minhas metas?', 'O que mudou neste mês?', 'Coloca comprar passagem nas minhas tarefas', 'Tenho reunião amanhã às 18h', 'Cria uma meta de treinar 4 vezes', 'Quero guardar R$ 5.000 até dezembro', 'Cria um hábito de beber água', 'Como está meu projeto da viagem?']

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** Finds by name: an exact match wins; otherwise the only one containing the words. */
export function findByName<T>(list: T[], name: (x: T) => string, query: string): { one: T | null; many: T[] } {
  const q = norm(query)
  const exact = list.filter((x) => norm(name(x)) === q)
  if (exact.length === 1) return { one: exact[0], many: exact }
  const words = q.split(' ').filter((w) => w.length > 1)
  const hits = list.filter((x) => {
    const n = norm(name(x))
    return n.includes(q) || (words.length > 0 && words.every((w) => n.includes(w)))
  })
  return { one: hits.length === 1 ? hits[0] : null, many: hits }
}

const HABIT_PRESETS: [RegExp, HabitCategory][] = [
  [/agua/, 'water'],
  [/trein|academia|corr|musculac/, 'training'],
  [/estud/, 'study'],
  [/\bler\b|leitura|livro/, 'reading'],
  [/dormir|sono/, 'sleep'],
  [/medit/, 'meditation'],
  [/comer|alimenta|refeic/, 'food'],
]

function create(collection: 'tasks' | 'events' | 'habits' | 'weeklyGoals' | 'financeGoals', record: Record<string, unknown>, label: string, title: string, summary: string): Proposal {
  return { id: proposalId(), kind: 'create', title, summary, notes: [], changes: [{ id: `new:${collection}`, label, ops: [{ op: 'save', collection, record: { id: newId(), ...record } as never, before: null }] }] }
}

function whenText(date: string | undefined, time: string | undefined, today: string): string {
  if (!date) return 'sem data'
  return `${dayName(date, today)}${date > addDaysToDate(today, 1) ? ` (${ddmm(date)})` : ''}${time ? ` às ${time}` : ''}`
}

function openTasks(data: DataState): Task[] {
  return data.tasks.filter((t) => t.status !== 'done')
}

function ambiguous(what: string, many: { title: string }[]): Reply {
  if (!many.length) return { lines: [`Não encontrei ${what} com esse nome.`] }
  return { lines: [`Encontrei ${many.length} ${what === 'tarefa' ? 'tarefas' : 'itens'} parecidos. Qual deles?`], list: many.slice(0, 5).map((x) => ({ title: x.title })) }
}

export function runIntent(intent: Intent, ctx: Ctx): Reply {
  const { data, settings, now } = ctx
  const today = nowIn(zoneOf(settings), now).date
  const on = (m: Parameters<typeof isEnabled>[1]) => isEnabled(settings, m)

  switch (intent.type) {
    case 'day': {
      const plan = planDay(data, settings, now, intent.date)
      const label = intent.date === today ? 'Hoje' : intent.date === addDaysToDate(today, 1) ? 'Amanhã' : `${dayName(intent.date, today)} (${ddmm(intent.date)})`
      const list = plan.items.filter((i) => i.status !== 'skipped').map((i) => ({ title: `${i.start ? `${i.start} · ` : ''}${i.title}`, meta: `${itemLabel(i)}${i.status === 'done' ? ' · feito' : ''}` }))
      const lines = [intent.date === today ? morningSentence(plan) : list.length ? `${label}: ${list.length} ${list.length === 1 ? 'item' : 'itens'}.` : `${label} está livre.`]
      if (intent.date === today && plan.overdue.length) lines.push(`${plan.overdue.length} ${plan.overdue.length === 1 ? 'tarefa está' : 'tarefas estão'} com data passada.`)
      const meals = mealsMorningLine(plan)
      if (meals && intent.date === today) lines.push(meals)
      return { lines, list, link: { label: 'Abrir Agenda', path: on('agenda') ? '/agenda' : '/today' } }
    }
    case 'week': {
      const week = weekStart(today)
      const m = weekMetrics(data, settings, week, now)
      const lines = summarySentences(flattenMetrics(m), { current: true, currency: settings.baseCurrency })
      if (!settings.hideScore && on('week')) {
        const s = computeScore(m, data.weeklyGoals.filter((g) => g.week === week && g.status !== 'archived'))
        if (s.overall !== null) lines.push(`NÚCLEO Score até agora: ${s.overall}.`)
      }
      return { lines: lines.length ? lines : ['Ainda não há registros suficientes nesta semana para um resumo.'], link: { label: 'Abrir Semana', path: '/week' } }
    }
    case 'finance': {
      if (!on('finance')) return { lines: ['O Financeiro está desligado em Seções visíveis.'] }
      const cur = settings.baseCurrency
      if (intent.period === 'week') {
        const w = weekMoney(data, settings, weekStart(today), now)
        const lines = weekMoneySentences({ current: true, income: w.totals.income, expense: w.totals.expense, net: w.totals.net, count: w.totals.count, dailyAverage: w.dailyAverage, top: w.top ? { label: categoryLabel(settings, w.top.category), amount: w.top.amount } : null, expenseDiff: w.expenseDiff, unnecessaryCount: w.totals.unnecessaryCount, unnecessaryAmount: w.totals.unnecessaryAmount, saved: null }, cur)
        return { lines: lines.length ? lines : ['Nenhuma movimentação registrada nesta semana.'], link: { label: 'Abrir Financeiro', path: '/finance' } }
      }
      const s = monthSummary(data, settings, monthOf(today), now)
      const lines = [`${monthLabel(monthOf(today))[0].toUpperCase()}${monthLabel(monthOf(today)).slice(1)} até agora: entradas ${formatMoney(s.totals.income, cur)}, saídas ${formatMoney(s.totals.expense, cur)}, resultado ${formatMoney(s.totals.net, cur, { sign: true })}.`]
      const top = s.categories.find((c) => c.category)
      if (top) lines.push(`Maior categoria: ${categoryLabel(settings, top.category)} — ${formatMoney(top.amount, cur)}.`)
      const comp = monthComparisonText(s, cur)
      if (comp) lines.push(comp)
      lines.push(forecastText(monthForecast(data, settings, now), cur).title)
      return { lines, link: { label: 'Resumo do mês', path: '/finance', params: { view: 'month' } } }
    }
    case 'goals': {
      const week = weekStart(today)
      const m = weekMetrics(data, settings, week, now)
      const list: { title: string; meta?: string }[] = []
      for (const g of data.weeklyGoals.filter((x) => x.week === week && x.status !== 'archived')) {
        const p = goalProgress(g, m)
        list.push({ title: g.title, meta: p.achieved ? 'cumprida' : p.noData ? 'sem dados ainda' : `${g.kind === 'money' ? formatMoney(p.value, settings.baseCurrency) : p.value} de ${g.kind === 'money' ? formatMoney(p.target, settings.baseCurrency) : p.target}` })
      }
      for (const g of (data.financeGoals ?? []).filter((x) => x.status === 'active')) {
        const p = goalPlan(g, today)
        list.push({ title: g.name, meta: p.reached ? 'alcançada' : `${p.percent}% · faltam ${formatMoney(p.missing, g.currency)}${p.perMonth ? ` · ~${formatMoney(p.perMonth, g.currency)}/mês` : p.perWeek ? ` · ~${formatMoney(p.perWeek, g.currency)}/semana` : ''}` })
      }
      return { lines: [list.length ? 'Suas metas:' : 'Você ainda não tem metas desta semana nem metas financeiras ativas.'], list, link: { label: 'Abrir Semana', path: '/week' } }
    }
    case 'changes': {
      const c = computeChanges(data, settings, intent.period, now)
      if (c.notComparable) return { lines: ['Dados insuficientes: você começou a usar o NÚCLEO depois do início do período anterior.'] }
      return { lines: c.lines.length ? [c.partialNote ?? '', ...c.lines.map((l) => l.text)].filter(Boolean) : ['Dados insuficientes para comparar.'], link: { label: 'Abrir “O que mudou?”', path: '/life', params: { view: 'changes' } } }
    }
    case 'insights': {
      const list = visibleInsights(computeInsights(data, settings, now), settings.insightState, today).slice(0, ASSISTANT_LIMIT)
      return { lines: [list.length ? `${list.length} ${list.length === 1 ? 'coisa pode' : 'coisas podem'} precisar da sua atenção:` : 'Nada pedindo atenção agora.'], list: list.map((i) => ({ title: i.title, meta: i.why })) }
    }
    case 'plan': {
      const found = findByName(data.lifePlans, (p) => p.title, intent.query)
      if (!found.one) return found.many.length ? ambiguous('projeto', found.many) : { lines: [`Não encontrei projeto pessoal nem objetivo com “${intent.query}”.`] }
      const p: LifePlan = found.one
      const tasks = taskMap(data.tasks)
      const pr = planProgress(p, data.planSteps, tasks)
      const next = stepsOf(data.planSteps, p.id).find((s) => !stepDone(s, tasks))
      const lines = [`${KIND_LABEL[p.kind].one} “${p.title}”: ${PLAN_STATUS_LABEL[p.status].toLowerCase()}.`, pr.source === 'steps' ? `${pr.done} de ${pr.total} etapas concluídas (${pr.percent}%).` : pr.source === 'manual' ? `Progresso manual: ${pr.percent}%.` : 'Ainda sem etapas.']
      if (next) lines.push(`Próxima etapa: ${next.title}${next.deadline ? ` (até ${ddmm(next.deadline)})` : ''}.`)
      if (p.deadline) lines.push(`Prazo: ${ddmm(p.deadline)}.`)
      return { lines, link: { label: 'Abrir', path: '/life', params: { open: p.id } } }
    }
    case 'reorganizeDay': {
      const p = reorganizeDay(data, settings, now)
      return { lines: [p.summary], proposal: p.changes.length ? p : undefined }
    }
    case 'reorganizeWeek': {
      const p = reorganizeWeek(data, settings, now)
      return { lines: [p.summary], proposal: p.changes.length ? p : undefined }
    }
    case 'createTask': {
      const r = { title: intent.title, projectId: null, dueDate: intent.date ?? '', dueTime: intent.date && intent.time ? intent.time : '', priority: 'none', status: 'todo', completedAt: null, notes: '' }
      const p = create('tasks', r, `Tarefa: ${intent.title} · ${whenText(intent.date, intent.time, today)}`, 'Nova tarefa', `Vou criar a tarefa “${intent.title}” (${whenText(intent.date, intent.time, today)}).`)
      return { lines: [p.summary], proposal: p }
    }
    case 'createEvent': {
      const r = { title: intent.title, date: intent.date, start: intent.start, end: intent.end ?? '', notes: '' }
      const p = create('events', r, `Compromisso: ${intent.title} · ${whenText(intent.date, intent.start, today)}`, 'Novo compromisso', `Vou marcar “${intent.title}” ${whenText(intent.date, intent.start, today)}.`)
      // Tell what it would overlap (fixed things are not moved here).
      const clash = planDay(data, settings, now, intent.date).items.find((i) => i.start && i.start >= intent.start && i.start < (intent.end ?? intent.start) && i.status === 'pending')
      if (clash) p.notes.push(`Nesse horário já existe “${clash.title}”. Depois de criar, posso sugerir um novo horário para o que for flexível.`)
      return { lines: [p.summary], proposal: p }
    }
    case 'createHabit': {
      const category = HABIT_PRESETS.find(([re]) => re.test(norm(intent.name)))?.[1]
      const r = { name: intent.name, rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: today, ...(category ? { category } : {}) }
      const p = create('habits', r, `Hábito: ${intent.name} · todo dia`, 'Novo hábito', `Vou criar o hábito “${intent.name}”, todos os dias, a partir de hoje.`)
      return { lines: [p.summary], proposal: p }
    }
    case 'createWeeklyGoal': {
      const money = intent.metric === 'finance.saved'
      const title = intent.title || (money ? `Guardar ${formatMoney(intent.target, settings.baseCurrency)}` : `Meta: ${intent.target}`)
      const r = { week: weekStart(today), title, kind: money ? 'money' : intent.metric ? 'quantity' : 'manual', metric: intent.metric, target: intent.target, manualValue: 0, status: 'active', repeatKey: newId() }
      const p = create('weeklyGoals', r, `Meta da semana: ${title}`, 'Nova meta da semana', `Vou criar a meta “${title}” para esta semana${intent.metric ? ', medida automaticamente pelos seus registros' : ''}.`)
      return { lines: [p.summary], proposal: p }
    }
    case 'createFinanceGoal': {
      const cur = settings.baseCurrency
      const r = { name: intent.name, target: intent.target, saved: 0, deadline: intent.deadline, currency: cur, note: '', status: 'active', history: startHistory(0, today) }
      const p = create('financeGoals', r, `Meta financeira: ${intent.name} · ${formatMoney(intent.target, cur)} até ${ddmm(intent.deadline)}`, 'Nova meta financeira', `Vou criar a meta “${intent.name}”: ${formatMoney(intent.target, cur)} até ${ddmm(intent.deadline)}. Você atualiza o valor guardado quando quiser.`)
      return { lines: [p.summary], proposal: p }
    }
    case 'moveTask': {
      const found = findByName(openTasks(data), (t) => t.title, intent.query)
      if (!found.one) return ambiguous('tarefa', found.many)
      const t = found.one
      const after = { ...t, dueDate: intent.date, dueTime: intent.time ?? (intent.date === t.dueDate ? (t.dueTime ?? '') : '') }
      const p: Proposal = { id: proposalId(), kind: 'update', title: 'Mover tarefa', summary: `Vou mover “${t.title}” de ${whenText(t.dueDate || undefined, t.dueTime, today)} para ${whenText(after.dueDate, after.dueTime || undefined, today)}.`, notes: [], changes: [{ id: `task:${t.id}`, label: `${t.title}: ${whenText(after.dueDate, after.dueTime || undefined, today)}`, detail: `antes: ${whenText(t.dueDate || undefined, t.dueTime, today)}`, ops: [{ op: 'save', collection: 'tasks', record: after as never, before: t as never }] }] }
      return { lines: [p.summary], proposal: p }
    }
    case 'completeTask': {
      const found = findByName(openTasks(data), (t) => t.title, intent.query)
      if (!found.one) return ambiguous('tarefa', found.many)
      const t = found.one
      const after = { ...t, status: 'done', completedAt: now.toISOString() }
      const p: Proposal = { id: proposalId(), kind: 'update', title: 'Concluir tarefa', summary: `Vou marcar “${t.title}” como concluída.`, notes: [], changes: [{ id: `task:${t.id}`, label: `Concluir: ${t.title}`, ops: [{ op: 'save', collection: 'tasks', record: after as never, before: t as never }] }] }
      return { lines: [p.summary], proposal: p }
    }
    case 'deleteTask': {
      const found = findByName(data.tasks, (t) => t.title, intent.query)
      if (!found.one) return ambiguous('tarefa', found.many)
      const t = found.one
      const p: Proposal = { id: proposalId(), kind: 'delete', title: 'Excluir tarefa', summary: `Vou excluir a tarefa “${t.title}”. Isso só acontece se você confirmar.`, notes: ['A exclusão pede confirmação. Dá para desfazer logo depois.'], changes: [{ id: `task:${t.id}`, label: `Excluir: ${t.title}`, ops: [{ op: 'remove', collection: 'tasks', id: t.id, before: t as never }] }] }
      return { lines: [p.summary], proposal: p }
    }
    case 'help':
      return { lines: ['Posso consultar e organizar o que já está no NÚCLEO. Exemplos:'], list: EXAMPLES.map((e) => ({ title: e })) }
    default:
      return { lines: ['Não entendi esse pedido. Tente com outras palavras ou use um dos exemplos:'], list: EXAMPLES.slice(0, 6).map((e) => ({ title: e })) }
  }
}
