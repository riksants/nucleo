/**
 * Builds reminder occurrences straight from the source records. Nothing is
 * copied: when a task, routine block, meal or charge changes or is deleted,
 * its reminders change or disappear the next time this runs. Each occurrence
 * has a key that includes the source and its moment, so the same reminder is
 * never delivered twice (in the app, the key is remembered; on the server it
 * is the primary key; in the OS it is the notification tag).
 *
 * Nothing here marks anything as done or paid: a past time only means "remind",
 * never "it happened". Reminders only come from dates and times the person saved.
 */
import { isEnabled } from '../../app/modules'
import { ACTIVE_PROJECT_STATUSES, nextChargeDate, isPaidTool } from '../../data/selectors'
import { installmentViews, saleRemaining } from '../../data/sales'
import { nextChargeOf } from '../../data/subscriptions'
import type { DataState, MealPlan, ReminderKind, ReminderKindPref, ReminderPrefs, ReminderRule, ReminderWhen, RoutinePlan, Settings } from '../../data/types'
import { addDaysToDate, deviceTimeZone, isTime, wallClock, weekdayOfDate, zonedToInstant } from '../../lib/zoned'
import { typeLabel, weeksWithMeals } from '../../core/meals'
import { stepDone, taskMap } from '../../core/plans'
import { weekStart } from '../../core/period'
import { indexCompletions, routineStatus, statusOf } from '../../core/completions'
import { habitsDue, recurringOn, recurringTime } from '../../core/habits'
import { habitHostOn } from '../../core/habitLink'

export const KINDS: ReminderKind[] = ['events', 'tasks', 'habits', 'routine', 'recurring', 'payments', 'receivables', 'deadlines', 'meals', 'focus']

/** The per-kind defaults of the old settings (before the main switch existed). */
export const DEFAULT_REMINDERS: ReminderPrefs & {
  rules: Record<ReminderKind, ReminderRule>
} = {
  rules: {
    tasks: {
      enabled: false,
      leadMin: 15,
      daysBefore: 1,
      at: '09:00',
      onDay: true,
    },
    routine: { enabled: false, leadMin: 10, daysBefore: 0, at: '08:00' },
    meals: { enabled: false, leadMin: 10, daysBefore: 0, at: '08:00' },
    deadlines: { enabled: false, leadMin: 0, daysBefore: 1, at: '09:00' },
    payments: {
      enabled: false,
      leadMin: 0,
      daysBefore: 2,
      at: '09:00',
      onDay: true,
    },
    // New kinds (Etapa 8) start on: a habit with a time or a bill "todo dia 5" reminds without extra setup.
    habits: { enabled: true, leadMin: 10, daysBefore: 0, at: '09:00' },
    recurring: {
      enabled: true,
      leadMin: 15,
      daysBefore: 0,
      at: '09:00',
      onDay: true,
    },
    events: { enabled: true, leadMin: 30, daysBefore: 0, at: '09:00' },
    // Before the split, sales and subscribers were in "payments": the old switch of payments applies.
    receivables: {
      enabled: false,
      leadMin: 0,
      daysBefore: 2,
      at: '09:00',
      onDay: true,
    },
    focus: { enabled: true, leadMin: 0, daysBefore: 0, at: '09:00' },
  },
  showDetails: false,
}

/** Smart defaults once the main switch is on: everything relevant, with sensible lead times. */
export const SMART: Record<ReminderKind, { leadMin: number; daysBefore: number; at: string }> = {
  events: { leadMin: 30, daysBefore: 1, at: '09:00' },
  tasks: { leadMin: 15, daysBefore: 1, at: '09:00' },
  habits: { leadMin: 10, daysBefore: 0, at: '09:00' },
  routine: { leadMin: 10, daysBefore: 0, at: '09:00' },
  // Days before apply to bills only (a chore reminds on its day); an item's own "N dias antes" wins.
  recurring: { leadMin: 15, daysBefore: 2, at: '09:00' },
  payments: { leadMin: 0, daysBefore: 2, at: '09:00' },
  receivables: { leadMin: 0, daysBefore: 1, at: '09:00' },
  deadlines: { leadMin: 0, daysBefore: 1, at: '09:00' },
  meals: { leadMin: 10, daysBefore: 0, at: '09:00' },
  focus: { leadMin: 0, daysBefore: 0, at: '09:00' },
}

/** How one kind reminds, after defaults, old settings and the person's choices. */
export interface KindTiming {
  enabled: boolean
  /** Items with a time. */
  when: ReminderWhen
  /** Items with only a date (in the old settings these could differ from timed ones). */
  whenDated: ReminderWhen
  leadMin: number
  daysBefore: number
  at: string
}

export interface EffectivePrefs {
  /** Main switch (old settings without it: on when any kind was on). */
  on: boolean
  /** The person never turned the main switch on: the old per-kind behaviour is kept exactly. */
  legacy: boolean
  when: ReminderWhen
  followUp: boolean
  showDetails: boolean
  quiet: ReminderPrefs['quiet']
  kinds: Record<ReminderKind, KindTiming>
}

const clampMin = (n: unknown, fallback: number, max: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : fallback)
const isWhen = (w: unknown): w is ReminderWhen => w === 'before' || w === 'at' || w === 'both'

/** Old settings: what differs from the old defaults is a choice the person made, and is kept. */
function legacyChoice(kind: ReminderKind, stored: Partial<Record<ReminderKind, ReminderRule>> | undefined): ReminderKindPref {
  const src = kind === 'receivables' ? stored?.payments : stored?.[kind]
  if (!src) return {}
  const old = DEFAULT_REMINDERS.rules[kind === 'receivables' ? 'payments' : kind]
  const out: ReminderKindPref = {}
  // Switched off something that was on by default: on purpose. (Off by default is not a choice.)
  if (src.enabled === false && old.enabled) out.enabled = false
  if (typeof src.leadMin === 'number' && src.leadMin !== old.leadMin) out.leadMin = src.leadMin
  if (typeof src.daysBefore === 'number' && src.daysBefore !== old.daysBefore) out.daysBefore = src.daysBefore
  if (isTime(src.at) && src.at !== old.at && old.daysBefore > 0) out.at = src.at
  return out
}

export function effectivePrefs(settings: Pick<Settings, 'reminders'>): EffectivePrefs {
  const r = settings.reminders
  const legacy = typeof r?.on !== 'boolean'
  const stored = r?.rules
  const kinds = {} as Record<ReminderKind, KindTiming>
  const when: ReminderWhen = isWhen(r?.when) ? r.when : 'before'
  for (const kind of KINDS) {
    if (legacy) {
      // Exactly the old behaviour: timed items remind before; date-only ones days before (and on the day).
      const rule = {
        ...DEFAULT_REMINDERS.rules[kind === 'receivables' ? 'payments' : kind],
        ...(kind === 'receivables' ? stored?.payments : stored?.[kind]),
      }
      const dated: ReminderWhen = rule.daysBefore > 0 ? (rule.onDay ? 'both' : 'before') : 'at'
      kinds[kind] = {
        enabled: rule.enabled,
        when: 'before',
        whenDated: kind === 'recurring' ? 'both' : dated,
        leadMin: clampMin(rule.leadMin, 0, 720),
        daysBefore: clampMin(rule.daysBefore, 0, 30),
        at: isTime(rule.at) ? rule.at : '09:00',
      }
      continue
    }
    const pref = { ...legacyChoice(kind, stored), ...(r?.kinds?.[kind] ?? {}) }
    const k = isWhen(pref.when) ? pref.when : when
    const smart = SMART[kind]
    kinds[kind] = {
      enabled: pref.enabled !== false,
      when: k,
      whenDated: k,
      leadMin: clampMin(pref.leadMin, smart.leadMin, 720),
      daysBefore: clampMin(pref.daysBefore, smart.daysBefore, 30),
      at: pref.at && isTime(pref.at) ? pref.at : smart.at,
    }
  }
  const on = legacy ? Object.values(kinds).some((k) => k.enabled) : r!.on === true
  return {
    on,
    legacy,
    when,
    followUp: legacy ? false : r?.followUp !== false,
    showDetails: r?.showDetails ?? false,
    quiet: r?.quiet ?? null,
    kinds,
  }
}

/** @deprecated kept for older callers: the stored prefs with the old defaults filled in. */
export function reminderPrefs(settings: Pick<Settings, 'reminders'>): ReminderPrefs {
  const r = settings.reminders
  return {
    ...(r ?? {}),
    showDetails: r?.showDetails ?? false,
    rules: { ...DEFAULT_REMINDERS.rules, ...(r?.rules ?? {}) },
    quiet: r?.quiet ?? null,
  }
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
  payments: 'Você tem uma conta a pagar',
  receivables: 'Você tem um valor a receber',
  habits: 'Hora de um hábito',
  recurring: 'Um item recorrente está chegando',
  events: 'Você tem um compromisso',
  focus: 'Sua sessão de foco chegou à meta',
}
/** Follow-ups say "pending" without saying what (lock screen). */
const GENERIC_LATE: Partial<Record<ReminderKind, string>> = {
  tasks: 'Uma tarefa ficou pendente',
  deadlines: 'Um prazo passou',
  payments: 'Confirme se uma conta foi paga',
  receivables: 'Há uma cobrança pendente',
  recurring: 'Uma conta ficou pendente',
  habits: 'Ainda há hábitos para hoje',
}

/** A running focus timer (lives on the device): only a habit session with a goal has an end to remind. */
export interface FocusRun {
  habitId?: string | null
  startedAt: string
  elapsedMs: number
  runningSince: number | null
}

interface Ctx {
  tz: string
  now: Date
  until: Date
  prefs: EffectivePrefs
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

const PAST_GRACE = 10 * 60_000

function inWindow(ctx: Ctx, fireAt: Date) {
  return fireAt.getTime() > ctx.now.getTime() - PAST_GRACE && fireAt <= ctx.until
}

function add(ctx: Ctx, kind: ReminderKind, key: string, at: Date, safeTitle: string, detail: string, url: string, late = false): boolean {
  const fireAt = outsideQuiet(at, ctx.prefs.quiet, ctx.tz)
  if (!inWindow(ctx, fireAt)) return false
  const details = ctx.prefs.showDetails
  ctx.out.push({
    key,
    kind,
    fireAt,
    title: details ? safeTitle : 'Núcleo',
    body: details ? detail : (late && GENERIC_LATE[kind]) || GENERIC[kind],
    detail,
    url,
  })
  return true
}

function minus(d: Date, min: number) {
  return new Date(d.getTime() - Math.max(0, min) * 60_000)
}

interface Item {
  kind: ReminderKind
  /** Key prefix: the source and its moment (`task:t1:2026-10-30T15:00`, `sale:s1:2026-11-05`). */
  base: string
  title: string
  /** Text for "before" / "at" (in the app, or on the lock screen when details are allowed). */
  before: string
  at: string
  url: string
  /**
   * When the item was saved. If the "before" moment had already passed by then (a task created 5
   * minutes before its time), the "at" reminder is used instead, so it isn't lost. Never decided by
   * the clock alone: a reminder that simply went by doesn't turn into a second one.
   */
  changedAt?: string
}

function savedAfter(it: Item, moment: Date) {
  return !!it.changedAt && Date.parse(it.changedAt) > moment.getTime()
}

/**
 * Item with a time: "before" = minutes before, "at" = at the time, "both". When the "before" moment
 * already passed (created a few minutes before), the "at" reminder is used so nothing is lost.
 */
function timed(ctx: Ctx, it: Item, moment: Date, opts: { leadMin?: number; when?: ReminderWhen } = {}) {
  const t = ctx.prefs.kinds[it.kind]
  const lead = opts.leadMin ?? t.leadMin
  const when = lead <= 0 ? 'at' : (opts.when ?? t.when)
  const early = minus(moment, lead)
  const missed = !ctx.prefs.legacy && savedAfter(it, early)
  if (when !== 'at' && !missed) add(ctx, it.kind, `${it.base}:${lead}`, early, it.title, it.before, it.url)
  if (when !== 'before' || missed) add(ctx, it.kind, `${it.base}:0`, moment, it.title, it.at, it.url)
}

/** Item with only a date: "before" = days before at the reminder time, "at" = on the day at that time. */
function dated(ctx: Ctx, it: Item, date: string, opts: { daysBefore?: number; when?: ReminderWhen } = {}) {
  const t = ctx.prefs.kinds[it.kind]
  const days = opts.daysBefore ?? t.daysBefore
  const when = days <= 0 ? 'at' : (opts.when ?? t.whenDated)
  const early = zonedToInstant(addDaysToDate(date, -days), t.at, ctx.tz)
  const missed = !ctx.prefs.legacy && savedAfter(it, early)
  if (when !== 'at' && !missed) add(ctx, it.kind, `${it.base}:${days}:${t.at}`, early, it.title, it.before, it.url)
  if (when !== 'before' || missed) add(ctx, it.kind, `${it.base}:0:${t.at}`, zonedToInstant(date, t.at, ctx.tz), it.title, it.at, it.url)
}

/** One more reminder the day after, if it is still pending (never repeated: one key per item and date). */
function followUp(ctx: Ctx, it: Item, date: string, text: string) {
  if (!ctx.prefs.followUp) return
  add(ctx, it.kind, `${it.base}:late`, zonedToInstant(addDaysToDate(date, 1), ctx.prefs.kinds[it.kind].at, ctx.tz), it.title, text, it.url, true)
}

const days = (n: number) => (n === 1 ? '1 dia' : `${n} dias`)

export function buildOccurrences(data: DataState, settings: Settings, opts: { now?: Date; days?: number; focus?: FocusRun | null } = {}): Occurrence[] {
  const now = opts.now ?? new Date()
  const prefs = effectivePrefs(settings)
  if (!prefs.on) return []
  const tz = settings.timeZone || deviceTimeZone()
  const span = opts.days ?? 14
  const ctx: Ctx = {
    tz,
    now,
    until: new Date(now.getTime() + span * 86_400_000),
    prefs,
    out: [],
  }
  const on = (kind: ReminderKind) => prefs.kinds[kind].enabled
  const today = wallClock(now, tz).date
  const yesterday = addDaysToDate(today, -1)
  const dates = Array.from({ length: span + 1 }, (_, i) => addDaysToDate(today, i))
  const runs = data.automationRuns ?? []
  const index = indexCompletions(data.completions ?? [])

  // ---------------------------------------------------------------- Tarefas
  if (on('tasks') && isEnabled(settings, 'tasks')) {
    for (const t of data.tasks) {
      if (t.status === 'done' || !t.dueDate) continue
      const url = `#/tasks?open=${t.id}`
      if (t.dueTime && isTime(t.dueTime)) {
        timed(
          ctx,
          {
            kind: 'tasks',
            base: `task:${t.id}:${t.dueDate}T${t.dueTime}`,
            title: t.title,
            before: `${t.title} às ${t.dueTime}`,
            at: `Agora: ${t.title}`,
            url,
            changedAt: t.updatedAt,
          },
          zonedToInstant(t.dueDate, t.dueTime, tz),
        )
      } else {
        const d = prefs.kinds.tasks.daysBefore
        dated(
          ctx,
          {
            kind: 'tasks',
            base: `task:${t.id}:${t.dueDate}`,
            title: t.title,
            before: d === 1 ? `Amanhã: ${t.title}` : `Em ${days(d)}: ${t.title}`,
            at: `Hoje: ${t.title}`,
            url,
            changedAt: t.updatedAt,
          },
          t.dueDate,
        )
      }
      followUp(
        ctx,
        {
          kind: 'tasks',
          base: `task:${t.id}:${t.dueDate}`,
          title: `Atrasada: ${t.title}`,
          before: '',
          at: '',
          url,
        },
        t.dueDate,
        `Ficou pendente: ${t.title}`,
      )
    }
  }

  // ---------------------------------------------------------------- Agenda (a past time never means it happened)
  if (on('events') && isEnabled(settings, 'agenda')) {
    for (const e of data.events ?? []) {
      if (!e.date || e.date < today) continue
      const url = `#/agenda?open=${e.id}`
      if (isTime(e.start))
        timed(
          ctx,
          {
            kind: 'events',
            base: `event:${e.id}:${e.date}T${e.start}`,
            title: e.title,
            before: `${e.start} · ${e.title}`,
            at: `Agora: ${e.title}`,
            url,
            changedAt: e.updatedAt,
          },
          zonedToInstant(e.date, e.start, tz),
        )
      else
        dated(
          ctx,
          {
            kind: 'events',
            base: `event:${e.id}:${e.date}`,
            title: e.title,
            before: `Amanhã: ${e.title}`,
            at: `Hoje: ${e.title}`,
            url,
            changedAt: e.updatedAt,
          },
          e.date,
        )
    }
  }

  // ---------------------------------------------------------------- Rotina: início (ao terminar, só "Horário encerrado" no app)
  const routine = data.routinePlans.find((p) => p.id === 'routine-current') as RoutinePlan | undefined
  if (on('routine') && routine && isEnabled(settings, 'routine')) {
    for (const date of dates) {
      const day = weekdayOfDate(date)
      for (const b of routine.blocks) {
        // Already marked as done (early), or this activity's reminder is off: nothing to remind.
        if (b.day !== day || b.kind === 'meal' || !isTime(b.start) || b.remindMin === false || routineStatus(index, routine, b.id, date) === 'done') continue
        const label = b.kind === 'commute' ? `${b.title} — hora de sair` : b.title
        timed(
          ctx,
          {
            kind: 'routine',
            base: `routine:${b.id}:${date}T${b.start}`,
            title: label,
            before: `${b.start} · ${label}`,
            at: `Agora: ${label}`,
            url: '#/today',
          },
          zonedToInstant(date, b.start, tz),
          typeof b.remindMin === 'number' ? { leadMin: b.remindMin } : {},
        )
        // When a block ends it just reads "Horário encerrado" in Hoje: no "concluiu?" is asked.
      }
    }
  }

  // ---------------------------------------------------------------- Alimentação (only the meal's name, never the menu)
  const meals = data.mealPlans.find((p) => p.id === 'meals-current') as MealPlan | undefined
  const realWeeks = weeksWithMeals(data.meals ?? [])
  if (on('meals') && isEnabled(settings, 'meals') && (meals || realWeeks.size)) {
    for (const date of dates) {
      const day = weekdayOfDate(date)
      // A week with real meals uses them instead of the AI model (no duplicate reminders).
      if (realWeeks.has(weekStart(date))) {
        for (const m of data.meals) {
          if (m.date !== date || !isTime(m.time)) continue
          const title = typeLabel(settings, m.type) || 'Refeição'
          timed(
            ctx,
            {
              kind: 'meals',
              base: `mealEntry:${m.id}:${date}T${m.time}`,
              title,
              before: `${m.time} · ${title}`,
              at: `Hora: ${title}`,
              url: `#/meals?open=${m.id}`,
            },
            zonedToInstant(date, m.time, tz),
          )
        }
        continue
      }
      for (const m of meals?.meals ?? []) {
        if (m.day !== day || !isTime(m.time)) continue
        timed(
          ctx,
          {
            kind: 'meals',
            base: `meal:${m.id}:${date}T${m.time}`,
            title: m.label,
            before: `${m.time} · ${m.label}`,
            at: `Hora: ${m.label}`,
            url: '#/meals',
          },
          zonedToInstant(date, m.time, tz),
        )
      }
    }
  }

  // ---------------------------------------------------------------- Prazos: projetos, vida, etapas e metas financeiras
  if (on('deadlines')) {
    if (isEnabled(settings, 'projects')) {
      for (const p of data.projects) {
        if (!p.dueDate || !ACTIVE_PROJECT_STATUSES.has(p.status)) continue
        const it = {
          kind: 'deadlines' as const,
          base: `project:${p.id}:${p.dueDate}`,
          title: `Prazo: ${p.name}`,
          before: `Prazo do projeto ${p.name} em ${days(prefs.kinds.deadlines.daysBefore)}`,
          at: `Prazo do projeto ${p.name} é hoje`,
          url: `#/projects?open=${p.id}`,
          changedAt: p.updatedAt,
        }
        dated(ctx, it, p.dueDate)
        followUp(ctx, { ...it, title: `Prazo vencido: ${p.name}` }, p.dueDate, `O prazo do projeto ${p.name} passou`)
      }
    }
    if (isEnabled(settings, 'life')) {
      const tasks = taskMap(data.tasks)
      const open = (p: { status: string }) => p.status === 'active' || p.status === 'planning'
      for (const p of data.lifePlans ?? []) {
        if (!p.deadline || !open(p)) continue
        const what = p.kind === 'objective' ? 'objetivo' : 'projeto'
        dated(
          ctx,
          {
            kind: 'deadlines',
            base: `plan:${p.id}:${p.deadline}`,
            title: `Prazo: ${p.title}`,
            before: `Prazo do ${what} ${p.title}`,
            at: `Prazo do ${what} ${p.title} é hoje`,
            url: `#/life?open=${p.id}`,
          },
          p.deadline,
        )
      }
      const plans = new Map((data.lifePlans ?? []).map((p) => [p.id, p]))
      for (const s of data.planSteps ?? []) {
        const p = plans.get(s.planId)
        if (!s.deadline || !p || !open(p) || stepDone(s, tasks)) continue
        dated(
          ctx,
          {
            kind: 'deadlines',
            base: `step:${s.id}:${s.deadline}`,
            title: `Etapa: ${s.title}`,
            before: `Etapa de ${p.title}`,
            at: `Etapa de ${p.title} vence hoje`,
            url: `#/life?open=${p.id}`,
          },
          s.deadline,
        )
      }
    }
    if (isEnabled(settings, 'finance')) {
      for (const g of data.financeGoals ?? []) {
        if (g.status !== 'active' || !g.deadline || g.saved >= g.target) continue
        dated(
          ctx,
          {
            kind: 'deadlines',
            base: `fgoal:${g.id}:${g.deadline}`,
            title: `Meta: ${g.name}`,
            before: `O prazo da meta ${g.name} está chegando`,
            at: `O prazo da meta ${g.name} é hoje`,
            url: '#/finance',
          },
          g.deadline,
        )
      }
    }
  }

  // ---------------------------------------------------------------- A pagar: assinaturas e ferramentas
  if (on('payments') && isEnabled(settings, 'tools')) {
    for (const t of data.tools) {
      if (!isPaidTool(t) || t.status !== 'active' || !t.nextCharge) continue
      const date = nextChargeDate(t, now)
      // Already marked as paid ("Já paguei") or settled: no reminder for that charge.
      if (runs.some((r) => r.automation === 'toolCharge' && r.origin.id === t.id && r.date === date && r.status !== 'pending')) continue
      // The subscription's own "avisar N dias antes" wins over the general setting.
      const d = t.remindDays ?? prefs.kinds.payments.daysBefore
      dated(
        ctx,
        {
          kind: 'payments',
          base: `tool:${t.id}:${date}`,
          title: `Pagar: ${t.name}`,
          before: `Cobrança de ${t.name} em ${days(d)}`,
          at: `Cobrança de ${t.name} hoje`,
          url: `#/tools?open=${t.id}`,
        },
        date,
        typeof t.remindDays === 'number' ? { daysBefore: t.remindDays } : {},
      )
    }
    // Charged and still waiting for the person ("A pagar" in Feito pelo Núcleo): one reminder the next day.
    for (const r of runs) {
      if (r.automation !== 'toolCharge' || r.status !== 'pending' || (r.date !== yesterday && r.date !== today)) continue
      const t = data.tools.find((x) => x.id === r.origin.id)
      if (!t || t.status === 'paused') continue
      followUp(
        ctx,
        {
          kind: 'payments',
          base: `tool:${t.id}:${r.date}`,
          title: `Pagou? ${t.name}`,
          before: '',
          at: '',
          url: `#/tools?open=${t.id}`,
        },
        r.date,
        `Confirme se pagou ${t.name}`,
      )
    }
  }

  // ---------------------------------------------------------------- A receber: vendas (parcelas) e assinantes
  if (on('receivables')) {
    if (isEnabled(settings, 'sales')) {
      const clients = new Map(data.clients.map((c) => [c.id, c.name]))
      for (const s of data.sales) {
        if (saleRemaining(s) <= 0) continue
        const who = (s.clientId && clients.get(s.clientId)) || s.clientName
        const what = who ? `${who} · ${s.product}` : s.product
        const url = `#/sales?open=${s.id}`
        const dues = s.installments?.length
          ? installmentViews(s, today)
              .filter((v) => v.state !== 'paid')
              .map((v) => v.due)
          : s.dueDate
            ? [s.dueDate]
            : []
        for (const due of dues) {
          const base = `sale:${s.id}:${due}`
          if (due >= today)
            dated(
              ctx,
              {
                kind: 'receivables',
                base,
                title: `Receber: ${s.product}`,
                before: `Cobrar ${what} em ${days(prefs.kinds.receivables.daysBefore)}`,
                at: `Dia de cobrar ${what}`,
                url,
                changedAt: s.updatedAt,
              },
              due,
            )
          followUp(
            ctx,
            {
              kind: 'receivables',
              base,
              title: `Cobrança atrasada: ${s.product}`,
              before: '',
              at: '',
              url,
            },
            due,
            `Cobrança atrasada: ${what}`,
          )
        }
      }
    }
    if (isEnabled(settings, 'subscribers')) {
      const plans = new Map(data.subPlans.map((p) => [p.id, p]))
      for (const s of data.subscribers) {
        // "Considerar pago na data": nothing to charge, so nothing to remind.
        if (s.status !== 'active' || s.paymentMode === 'autoPaid') continue
        const date = nextChargeOf(s, plans.get(s.planId), now)
        if (!date) continue
        dated(
          ctx,
          {
            kind: 'receivables',
            base: `sub:${s.id}:${date}`,
            title: `Cobrar: ${s.name}`,
            before: `Cobrança da assinatura de ${s.name}`,
            at: `Dia de cobrar a assinatura de ${s.name}`,
            url: `#/subscribers?open=${s.id}`,
          },
          date,
        )
      }
      for (const r of runs) {
        if (r.automation !== 'subscriberCharge' || r.status !== 'pending' || (r.date !== yesterday && r.date !== today)) continue
        const s = data.subscribers.find((x) => x.id === r.origin.id)
        if (!s) continue
        followUp(
          ctx,
          {
            kind: 'receivables',
            base: `sub:${s.id}:${r.date}`,
            title: `Cobrança pendente: ${s.name}`,
            before: '',
            at: '',
            url: `#/subscribers?open=${s.id}`,
          },
          r.date,
          `A assinatura de ${s.name} ainda não foi recebida`,
        )
      }
    }
  }

  // ---------------------------------------------------------------- Hábitos (done/skipped ones don't remind)
  if (on('habits') && isEnabled(settings, 'habits')) {
    for (const date of dates) {
      let pending = 0
      for (const h of habitsDue(data.habits ?? [], date)) {
        if (statusOf(index, 'habit', h.id, date) !== 'pending') continue
        pending++
        // Its own reminder can be off; and when a linked item hosts it today, that item already reminds.
        if (!isTime(h.time) || h.remind === false || habitHostOn(data, settings, h, date)) continue
        timed(
          ctx,
          {
            kind: 'habits',
            base: `habit:${h.id}:${date}T${h.time}`,
            title: h.name,
            before: `${h.time} · ${h.name}${h.minutes ? ` (${h.minutes} min)` : ''}`,
            at: `Hora: ${h.name}`,
            url: `#/habits?open=${h.id}`,
          },
          zonedToInstant(date, h.time, tz),
        )
      }
      // One evening nudge per day, only while something is still open (never one per habit).
      if (prefs.followUp && pending)
        add(
          ctx,
          'habits',
          `habits-open:${date}`,
          zonedToInstant(date, '20:00', tz),
          pending === 1 ? 'Falta 1 hábito hoje' : `Faltam ${pending} hábitos hoje`,
          pending === 1 ? 'Ainda dá tempo: falta 1 hábito hoje' : `Ainda dá tempo: faltam ${pending} hábitos hoje`,
          '#/habits',
          true,
        )
    }
  }

  // ---------------------------------------------------------------- Recorrentes e contas
  if (on('recurring') && isEnabled(settings, 'recurring')) {
    const t = prefs.kinds.recurring
    // Look a little further ahead so "2 dias antes" of an item just past the window is not missed.
    const horizon = Array.from({ length: dates.length + 7 }, (_, i) => addDaysToDate(today, i))
    for (const r of data.recurring ?? []) {
      if (!r.active) continue
      // The item's own "avisar N dias antes" wins; otherwise bills remind 2 days before, the rest on the day.
      const before = r.remindDays ?? (r.bill ? (prefs.legacy ? 2 : t.daysBefore) : 0)
      const url = `#/recurring?open=${r.id}`
      const title = r.bill ? `Conta: ${r.title}` : r.title
      for (const date of horizon) {
        if (!recurringOn(r, date) || statusOf(index, 'recurring', r.id, date) !== 'pending') continue
        // The time of this occurrence ("só esta" may have changed it): the key carries it, so a change replaces the old reminder.
        const time = recurringTime(r, date)
        if (isTime(time)) {
          timed(
            ctx,
            {
              kind: 'recurring',
              base: `recurring:${r.id}:${date}T${time}`,
              title,
              before: `${time} · ${r.title}`,
              at: `Agora: ${r.title}`,
              url,
            },
            zonedToInstant(date, time, tz),
            { ...(prefs.legacy ? { when: 'before' as const } : {}), ...(typeof r.remindMin === 'number' ? { leadMin: r.remindMin } : {}) },
          )
          if (before > 0 && (prefs.legacy || t.when !== 'at'))
            add(ctx, 'recurring', `recurring:${r.id}:${date}:${before}:${t.at}`, zonedToInstant(addDaysToDate(date, -before), t.at, tz), title, `${r.title} em ${days(before)}`, url)
        } else {
          dated(
            ctx,
            {
              kind: 'recurring',
              base: `recurring:${r.id}:${date}`,
              title,
              before: `${r.title} em ${days(before)}`,
              at: `Hoje: ${r.title}`,
              url,
            },
            date,
            { daysBefore: before },
          )
        }
      }
      // A bill still open the day after: one reminder (not for chores, which would only nag).
      if (r.bill && recurringOn(r, yesterday) && statusOf(index, 'recurring', r.id, yesterday) === 'pending')
        followUp(
          ctx,
          {
            kind: 'recurring',
            base: `recurring:${r.id}:${yesterday}`,
            title: `Conta pendente: ${r.title}`,
            before: '',
            at: '',
            url,
          },
          yesterday,
          `Ficou pendente: ${r.title}`,
        )
    }
  }

  // ---------------------------------------------------------------- Modo foco: a habit session reaching its goal
  const run = opts.focus
  if (on('focus') && run?.habitId && run.runningSince !== null) {
    const h = (data.habits ?? []).find((x) => x.id === run.habitId)
    const goalMs = (h?.minutes ?? 0) * 60_000
    if (h && goalMs > run.elapsedMs) {
      const end = new Date(run.runningSince + goalMs - run.elapsedMs)
      add(ctx, 'focus', `focus:${h.id}:${run.startedAt}:${h.minutes}`, end, `Meta atingida: ${h.name}`, `${h.minutes} min de ${h.name}: meta atingida. Pode encerrar a sessão.`, '#/habits')
    }
  }

  // Same key twice (shouldn't happen) is kept once.
  const seen = new Set<string>()
  return ctx.out.filter((o) => (seen.has(o.key) ? false : (seen.add(o.key), true))).sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
}
