/**
 * Builds reminder occurrences straight from the source records. Nothing is
 * copied: when a task, routine block, meal or charge changes or is deleted,
 * its reminders change or disappear the next time this runs. Each occurrence
 * has a key that includes the source and its moment, so the same reminder is
 * never delivered twice (in the app, the key is remembered; on the server it
 * is the primary key; in the OS it is the notification tag).
 */
import { isEnabled } from '../../app/modules'
import { ACTIVE_PROJECT_STATUSES, nextChargeDate, isPaidTool } from '../../data/selectors'
import { saleRemaining } from '../../data/sales'
import { nextChargeOf } from '../../data/subscriptions'
import type { DataState, MealPlan, ReminderKind, ReminderPrefs, ReminderRule, RoutinePlan, Settings } from '../../data/types'
import { addDaysToDate, deviceTimeZone, isTime, wallClock, weekdayOfDate, zonedToInstant } from '../../lib/zoned'
import { typeLabel, weeksWithMeals } from '../../core/meals'
import { stepDone, taskMap } from '../../core/plans'
import { weekStart } from '../../core/period'
import { indexCompletions, routineStatus, statusOf } from '../../core/completions'
import { habitsDue, recurringOn } from '../../core/habits'

export const DEFAULT_REMINDERS: ReminderPrefs = {
  rules: {
    tasks: { enabled: false, leadMin: 15, daysBefore: 1, at: '09:00', onDay: true },
    routine: { enabled: false, leadMin: 10, daysBefore: 0, at: '08:00' },
    meals: { enabled: false, leadMin: 10, daysBefore: 0, at: '08:00' },
    deadlines: { enabled: false, leadMin: 0, daysBefore: 1, at: '09:00' },
    payments: { enabled: false, leadMin: 0, daysBefore: 2, at: '09:00', onDay: true },
    // New kinds (Etapa 8) start on: a habit with a time or a bill "todo dia 5" reminds without extra setup.
    habits: { enabled: true, leadMin: 10, daysBefore: 0, at: '09:00' },
    recurring: { enabled: true, leadMin: 15, daysBefore: 0, at: '09:00', onDay: true },
    events: { enabled: true, leadMin: 30, daysBefore: 0, at: '09:00' },
  },
  showDetails: false,
}

export function reminderPrefs(settings: Pick<Settings, 'reminders'>): ReminderPrefs {
  const r = settings.reminders
  return { showDetails: r?.showDetails ?? false, rules: { ...DEFAULT_REMINDERS.rules, ...(r?.rules ?? {}) }, quiet: r?.quiet ?? null }
}

export interface Occurrence {
  key: string
  kind: ReminderKind
  fireAt: Date
  /** Lock-screen text: generic unless the person allowed details; never amounts or health data. */
  title: string
  body: string
  /** Full text, only shown inside the app. */
  detail: string
  url: string
}

const GENERIC: Record<ReminderKind, string> = {
  tasks: 'Você tem uma tarefa ou compromisso',
  routine: 'Hora de um item da sua rotina',
  meals: 'Lembrete de refeição',
  deadlines: 'Um prazo está chegando',
  payments: 'Há um pagamento ou cobrança próximo',
  habits: 'Hora de um hábito',
  recurring: 'Um item recorrente está chegando',
  events: 'Você tem um compromisso',
}

interface Ctx {
  tz: string
  now: Date
  until: Date
  prefs: ReminderPrefs
  out: Occurrence[]
}

/** Inside the quiet hours, the moment moves to their end (same reminder, same key: never lost, never twice). */
export function outsideQuiet(fireAt: Date, quiet: ReminderPrefs['quiet'], tz: string): Date {
  if (!quiet || !isTime(quiet.from) || !isTime(quiet.to) || quiet.from === quiet.to) return fireAt
  const { date, time } = wallClock(fireAt, tz)
  const overnight = quiet.from > quiet.to
  const inside = overnight ? time >= quiet.from || time < quiet.to : time >= quiet.from && time < quiet.to
  if (!inside) return fireAt
  // Late evening (22:30 with 22:00→07:00) waits until tomorrow 07:00; early morning until today 07:00.
  const day = overnight && time >= quiet.from ? addDaysToDate(date, 1) : date
  return zonedToInstant(day, quiet.to, tz)
}

function add(ctx: Ctx, kind: ReminderKind, key: string, at: Date, safeTitle: string, detail: string, url: string) {
  const fireAt = outsideQuiet(at, ctx.prefs.quiet, ctx.tz)
  if (fireAt <= new Date(ctx.now.getTime() - 10 * 60_000) || fireAt > ctx.until) return
  const details = ctx.prefs.showDetails
  ctx.out.push({ key, kind, fireAt, title: details ? safeTitle : 'Núcleo', body: details ? detail : GENERIC[kind], detail, url })
}

/** Date-only items: N days before, at the chosen time of day. */
function atDayBefore(ctx: Ctx, rule: ReminderRule, date: string): Date {
  return zonedToInstant(addDaysToDate(date, -Math.max(0, rule.daysBefore)), isTime(rule.at) ? rule.at : '09:00', ctx.tz)
}

function minus(d: Date, min: number) {
  return new Date(d.getTime() - Math.max(0, min) * 60_000)
}

export function buildOccurrences(data: DataState, settings: Settings, opts: { now?: Date; days?: number } = {}): Occurrence[] {
  const now = opts.now ?? new Date()
  const prefs = reminderPrefs(settings)
  const tz = settings.timeZone || deviceTimeZone()
  const ctx: Ctx = { tz, now, until: new Date(now.getTime() + (opts.days ?? 14) * 86_400_000), prefs, out: [] }
  const on = (kind: ReminderKind) => prefs.rules[kind].enabled
  const today = wallClock(now, tz).date
  const dates = Array.from({ length: (opts.days ?? 14) + 1 }, (_, i) => addDaysToDate(today, i))

  if (on('tasks') && isEnabled(settings, 'tasks')) {
    const rule = prefs.rules.tasks
    for (const t of data.tasks) {
      if (t.status === 'done' || !t.dueDate) continue
      if (t.dueTime && isTime(t.dueTime)) {
        add(ctx, 'tasks', `task:${t.id}:${t.dueDate}T${t.dueTime}:${rule.leadMin}`, minus(zonedToInstant(t.dueDate, t.dueTime, tz), rule.leadMin), t.title, `${t.title} às ${t.dueTime}`, `#/tasks?open=${t.id}`)
      } else {
        add(ctx, 'tasks', `task:${t.id}:${t.dueDate}:${rule.daysBefore}:${rule.at}`, atDayBefore(ctx, rule, t.dueDate), t.title, rule.daysBefore === 1 ? `Amanhã: ${t.title}` : `Prazo: ${t.title}`, `#/tasks?open=${t.id}`)
        if (rule.onDay && rule.daysBefore > 0) add(ctx, 'tasks', `task:${t.id}:${t.dueDate}:0:${rule.at}`, atDayBefore(ctx, { ...rule, daysBefore: 0 }, t.dueDate), t.title, `Hoje: ${t.title}`, `#/tasks?open=${t.id}`)
      }
    }
  }

  const routine = data.routinePlans.find((p) => p.id === 'routine-current') as RoutinePlan | undefined
  if (on('routine') && routine && isEnabled(settings, 'routine')) {
    const rule = prefs.rules.routine
    const routineIndex = indexCompletions(data.completions ?? [])
    for (const date of dates) {
      const day = weekdayOfDate(date)
      for (const b of routine.blocks) {
        if (b.day !== day || b.kind === 'meal') continue
        const label = b.kind === 'commute' ? `${b.title} — hora de sair` : b.title
        add(ctx, 'routine', `routine:${b.id}:${date}T${b.start}:${rule.leadMin}`, minus(zonedToInstant(date, b.start, tz), rule.leadMin), label, `${b.start} · ${label}`, '#/today')
        // When it ends, a quick "concluiu?" (never marks anything: the answer is the person's, in Hoje).
        if (b.kind !== 'commute' && b.kind !== 'rest' && isTime(b.end) && b.end > b.start && routineStatus(routineIndex, routine, b.id, date) === 'pending')
          add(ctx, 'routine', `routine-end:${b.id}:${date}T${b.end}`, zonedToInstant(date, b.end, tz), `${b.title}: concluiu?`, `${b.title} terminou às ${b.end}. Você concluiu?`, '#/today?mode=day')
      }
    }
  }

  const meals = data.mealPlans.find((p) => p.id === 'meals-current') as MealPlan | undefined
  const realWeeks = weeksWithMeals(data.meals ?? [])
  if (on('meals') && isEnabled(settings, 'meals') && (meals || realWeeks.size)) {
    const rule = prefs.rules.meals
    for (const date of dates) {
      const day = weekdayOfDate(date)
      // A week with real meals uses them instead of the AI model (no duplicate reminders).
      if (realWeeks.has(weekStart(date))) {
        for (const m of data.meals) {
          if (m.date !== date || !isTime(m.time)) continue
          // Only the type ("Almoço"): what you eat is health data and stays inside the app.
          const title = typeLabel(settings, m.type) || 'Refeição'
          add(ctx, 'meals', `mealEntry:${m.id}:${date}T${m.time}:${rule.leadMin}`, minus(zonedToInstant(date, m.time, tz), rule.leadMin), title, `${m.time} · ${title}`, '#/meals')
        }
        continue
      }
      for (const m of meals?.meals ?? []) {
        if (m.day !== day || !isTime(m.time)) continue
        // Only the meal's name: what you eat is health data and stays inside the app.
        add(ctx, 'meals', `meal:${m.id}:${date}T${m.time}:${rule.leadMin}`, minus(zonedToInstant(date, m.time, tz), rule.leadMin), m.label, `${m.time} · ${m.label}`, '#/meals')
      }
    }
  }

  if (on('deadlines') && isEnabled(settings, 'projects')) {
    const rule = prefs.rules.deadlines
    for (const p of data.projects) {
      if (!p.dueDate || !ACTIVE_PROJECT_STATUSES.has(p.status)) continue
      add(ctx, 'deadlines', `project:${p.id}:${p.dueDate}:${rule.daysBefore}:${rule.at}`, atDayBefore(ctx, rule, p.dueDate), `Prazo: ${p.name}`, `Prazo do projeto ${p.name}`, `#/projects?open=${p.id}`)
    }
  }

  // Etapa 6: deadlines of personal projects, objectives and their steps (same "Prazos" rule).
  if (on('deadlines') && isEnabled(settings, 'life')) {
    const rule = prefs.rules.deadlines
    const tasks = taskMap(data.tasks)
    const open = (p: { status: string }) => p.status === 'active' || p.status === 'planning'
    for (const p of data.lifePlans ?? []) {
      if (!p.deadline || !open(p)) continue
      const what = p.kind === 'objective' ? 'objetivo' : 'projeto'
      add(ctx, 'deadlines', `plan:${p.id}:${p.deadline}:${rule.daysBefore}:${rule.at}`, atDayBefore(ctx, rule, p.deadline), `Prazo: ${p.title}`, `Prazo do ${what} ${p.title}`, `#/life?open=${p.id}`)
    }
    const plans = new Map((data.lifePlans ?? []).map((p) => [p.id, p]))
    for (const s of data.planSteps ?? []) {
      const p = plans.get(s.planId)
      if (!s.deadline || !p || !open(p) || stepDone(s, tasks)) continue
      add(ctx, 'deadlines', `step:${s.id}:${s.deadline}:${rule.daysBefore}:${rule.at}`, atDayBefore(ctx, rule, s.deadline), `Etapa: ${s.title}`, `Etapa de ${p.title}`, `#/life?open=${p.id}`)
    }
  }

  if (on('payments')) {
    const rule = prefs.rules.payments
    if (isEnabled(settings, 'tools')) {
      for (const t of data.tools) {
        if (!isPaidTool(t) || t.status !== 'active' || !t.nextCharge) continue
        const date = nextChargeDate(t, now)
        // Already marked as paid ("Já paguei") or settled: no reminder for that charge.
        if ((data.automationRuns ?? []).some((r) => r.automation === 'toolCharge' && r.origin.id === t.id && r.date === date && r.status !== 'pending')) continue
        add(ctx, 'payments', `tool:${t.id}:${date}:${rule.daysBefore}:${rule.at}`, atDayBefore(ctx, rule, date), `Cobrança: ${t.name}`, rule.daysBefore ? `Cobrança de ${t.name} em ${rule.daysBefore} ${rule.daysBefore === 1 ? 'dia' : 'dias'}` : `Cobrança de ${t.name}`, `#/tools?open=${t.id}`)
        if (rule.onDay && rule.daysBefore > 0) add(ctx, 'payments', `tool:${t.id}:${date}:0:${rule.at}`, atDayBefore(ctx, { ...rule, daysBefore: 0 }, date), `Cobrança hoje: ${t.name}`, `Cobrança de ${t.name} hoje`, `#/tools?open=${t.id}`)
      }
    }
    if (isEnabled(settings, 'sales')) {
      for (const s of data.sales) {
        if (!s.dueDate || saleRemaining(s) <= 0) continue
        add(ctx, 'payments', `sale:${s.id}:${s.dueDate}:${rule.daysBefore}:${rule.at}`, atDayBefore(ctx, rule, s.dueDate), `Receber: ${s.product}`, `Prazo para receber: ${s.product}`, `#/sales?open=${s.id}`)
      }
    }
    if (isEnabled(settings, 'subscribers')) {
      const plans = new Map(data.subPlans.map((p) => [p.id, p]))
      for (const s of data.subscribers) {
        if (s.status !== 'active') continue
        const date = nextChargeOf(s, plans.get(s.planId), now)
        if (!date) continue
        add(ctx, 'payments', `sub:${s.id}:${date}:${rule.daysBefore}:${rule.at}`, atDayBefore(ctx, rule, date), `Cobrar: ${s.name}`, `Cobrança da assinatura de ${s.name}`, `#/subscribers?open=${s.id}`)
      }
    }
  }

  // Etapa 8: habits with a time, recurring items (bills earlier) and appointments. Done/skipped/moved ones don't remind.
  const index = indexCompletions(data.completions ?? [])
  if (on('habits') && isEnabled(settings, 'habits')) {
    const rule = prefs.rules.habits
    for (const date of dates) {
      for (const h of habitsDue(data.habits ?? [], date)) {
        if (!isTime(h.time) || statusOf(index, 'habit', h.id, date) !== 'pending') continue
        add(ctx, 'habits', `habit:${h.id}:${date}T${h.time}:${rule.leadMin}`, minus(zonedToInstant(date, h.time, tz), rule.leadMin), h.name, `${h.time} · ${h.name}${h.minutes ? ` (${h.minutes} min)` : ''}`, '#/habits')
      }
    }
  }
  if (on('recurring') && isEnabled(settings, 'recurring')) {
    const rule = prefs.rules.recurring
    // Look a little further ahead so "2 dias antes" of an item just past the window is not missed.
    const horizon = Array.from({ length: dates.length + 7 }, (_, i) => addDaysToDate(today, i))
    for (const r of data.recurring ?? []) {
      if (!r.active) continue
      const before = r.remindDays ?? (r.bill ? 2 : 0)
      for (const date of horizon) {
        if (!recurringOn(r, date) || statusOf(index, 'recurring', r.id, date) !== 'pending') continue
        const title = r.bill ? `Conta: ${r.title}` : r.title
        if (isTime(r.time)) add(ctx, 'recurring', `recurring:${r.id}:${date}T${r.time}:${rule.leadMin}`, minus(zonedToInstant(date, r.time, tz), rule.leadMin), title, `${r.time} · ${r.title}`, '#/recurring')
        else add(ctx, 'recurring', `recurring:${r.id}:${date}:0:${rule.at}`, atDayBefore(ctx, { ...rule, daysBefore: 0 }, date), title, `Hoje: ${r.title}`, '#/recurring')
        if (before > 0) add(ctx, 'recurring', `recurring:${r.id}:${date}:${before}:${rule.at}`, atDayBefore(ctx, { ...rule, daysBefore: before }, date), title, `${r.title} em ${before} ${before === 1 ? 'dia' : 'dias'}`, '#/recurring')
      }
    }
  }
  if (on('events') && isEnabled(settings, 'agenda')) {
    const rule = prefs.rules.events
    for (const e of data.events ?? []) {
      if (!e.date || e.date < today) continue
      if (isTime(e.start)) add(ctx, 'events', `event:${e.id}:${e.date}T${e.start}:${rule.leadMin}`, minus(zonedToInstant(e.date, e.start, tz), rule.leadMin), e.title, `${e.start} · ${e.title}`, `#/agenda?open=${e.id}`)
      else add(ctx, 'events', `event:${e.id}:${e.date}:0:${rule.at}`, atDayBefore(ctx, { ...rule, daysBefore: 0 }, e.date), e.title, `Hoje: ${e.title}`, `#/agenda?open=${e.id}`)
    }
  }

  // Same key twice (shouldn't happen) is kept once.
  const seen = new Set<string>()
  return ctx.out.filter((o) => (seen.has(o.key) ? false : (seen.add(o.key), true))).sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
}
