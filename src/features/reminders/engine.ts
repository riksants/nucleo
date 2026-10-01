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

export const DEFAULT_REMINDERS: ReminderPrefs = {
  rules: {
    tasks: { enabled: false, leadMin: 15, daysBefore: 0, at: '09:00' },
    routine: { enabled: false, leadMin: 10, daysBefore: 0, at: '08:00' },
    meals: { enabled: false, leadMin: 10, daysBefore: 0, at: '08:00' },
    deadlines: { enabled: false, leadMin: 0, daysBefore: 1, at: '09:00' },
    payments: { enabled: false, leadMin: 0, daysBefore: 1, at: '09:00' },
  },
  showDetails: false,
}

export function reminderPrefs(settings: Pick<Settings, 'reminders'>): ReminderPrefs {
  const r = settings.reminders
  return { showDetails: r?.showDetails ?? false, rules: { ...DEFAULT_REMINDERS.rules, ...(r?.rules ?? {}) } }
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
}

interface Ctx {
  tz: string
  now: Date
  until: Date
  prefs: ReminderPrefs
  out: Occurrence[]
}

function add(ctx: Ctx, kind: ReminderKind, key: string, fireAt: Date, safeTitle: string, detail: string, url: string) {
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
        add(ctx, 'tasks', `task:${t.id}:${t.dueDate}:${rule.daysBefore}:${rule.at}`, atDayBefore(ctx, rule, t.dueDate), t.title, `Prazo: ${t.title}`, `#/tasks?open=${t.id}`)
      }
    }
  }

  const routine = data.routinePlans.find((p) => p.id === 'routine-current') as RoutinePlan | undefined
  if (on('routine') && routine && isEnabled(settings, 'routine')) {
    const rule = prefs.rules.routine
    for (const date of dates) {
      const day = weekdayOfDate(date)
      for (const b of routine.blocks) {
        if (b.day !== day || b.kind === 'meal') continue
        const label = b.kind === 'commute' ? `${b.title} — hora de sair` : b.title
        add(ctx, 'routine', `routine:${b.id}:${date}T${b.start}:${rule.leadMin}`, minus(zonedToInstant(date, b.start, tz), rule.leadMin), label, `${b.start} · ${label}`, '#/today')
      }
    }
  }

  const meals = data.mealPlans.find((p) => p.id === 'meals-current') as MealPlan | undefined
  if (on('meals') && meals && isEnabled(settings, 'meals')) {
    const rule = prefs.rules.meals
    for (const date of dates) {
      const day = weekdayOfDate(date)
      for (const m of meals.meals) {
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

  if (on('payments')) {
    const rule = prefs.rules.payments
    if (isEnabled(settings, 'tools')) {
      for (const t of data.tools) {
        if (!isPaidTool(t) || t.status !== 'active' || !t.nextCharge) continue
        const date = nextChargeDate(t, now)
        add(ctx, 'payments', `tool:${t.id}:${date}:${rule.daysBefore}:${rule.at}`, atDayBefore(ctx, rule, date), `Cobrança: ${t.name}`, `Cobrança de ${t.name}`, `#/tools?open=${t.id}`)
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

  // Same key twice (shouldn't happen) is kept once.
  const seen = new Set<string>()
  return ctx.out.filter((o) => (seen.has(o.key) ? false : (seen.add(o.key), true))).sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
}
