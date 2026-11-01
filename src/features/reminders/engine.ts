/**
 * Builds reminder occurrences straight from the source records. Nothing is
 * copied: when a task, routine block, meal or charge changes or is deleted,
 * its reminders change or disappear the next time this runs. Each occurrence
 * has a key that includes the source and its moment, so the same reminder is
 * never delivered twice (in the app, the key is remembered; on the server it
 * is the primary key; in the OS it is the notification tag).
 *
 * Every key is `<source>:<date><suffix>` (`task:t1:2026-10-30T15:00:15`). The
 * same suffixes describe the repeating series sent to the server
 * (`buildSeries`), so the server renews them with exactly the keys the app
 * would use: never a duplicate, whoever writes first.
 *
 * Nothing here marks anything as done or paid: a past time only means "remind",
 * never "it happened". Reminders only come from dates and times the person saved,
 * and their text only from fields the record really has.
 */
import { isEnabled } from '../../app/modules'
import { ACTIVE_PROJECT_STATUSES, nextChargeDate, isPaidTool } from '../../data/selectors'
import { installmentViews, saleRemaining } from '../../data/sales'
import { nextChargeOf } from '../../data/subscriptions'
import type {
  DataState,
  MealPlan,
  RecurrenceRule,
  ReminderAlert,
  ReminderKind,
  ReminderKindPref,
  ReminderPrefs,
  ReminderPrivacy,
  ReminderRule,
  ReminderWhen,
  RoutinePlan,
  Settings,
} from '../../data/types'
import { formatMoney } from '../../lib/money'
import { addDaysToDate, deviceTimeZone, isTime, toMinutes, wallClock, weekdayOfDate, zonedToInstant } from '../../lib/zoned'
import { typeLabel, weeksWithMeals } from '../../core/meals'
import { stepDone, taskMap } from '../../core/plans'
import { weekStart } from '../../core/period'
import { indexCompletions, routineStatus, statusOf } from '../../core/completions'
import { habitsDue, recurringOn, recurringTime } from '../../core/habits'
import { habitHostOn } from '../../core/habitLink'

export const KINDS: ReminderKind[] = ['events', 'tasks', 'habits', 'routine', 'recurring', 'payments', 'receivables', 'deadlines', 'meals', 'focus', 'app']

/** The per-kind defaults of the old settings (before the main switch existed). */
export const DEFAULT_REMINDERS: ReminderPrefs & {
  rules: Record<ReminderKind, ReminderRule>
} = {
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
    // Before the split, sales and subscribers were in "payments": the old switch of payments applies.
    receivables: { enabled: false, leadMin: 0, daysBefore: 2, at: '09:00', onDay: true },
    focus: { enabled: true, leadMin: 0, daysBefore: 0, at: '09:00' },
    // Etapa 5: notices of the app itself (a rule waiting for confirmation, an automation that failed).
    app: { enabled: true, leadMin: 0, daysBefore: 0, at: '09:00' },
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
  app: { leadMin: 0, daysBefore: 0, at: '09:00' },
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
  /** @deprecated read `privacy`. */
  showDetails: boolean
  privacy: ReminderPrivacy
  quiet: ReminderPrefs['quiet']
  kinds: Record<ReminderKind, KindTiming>
}

const clampMin = (n: unknown, fallback: number, max: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : fallback)
const isWhen = (w: unknown): w is ReminderWhen => w === 'before' || w === 'at' || w === 'both'
export const isPrivacy = (p: unknown): p is ReminderPrivacy => p === 'complete' || p === 'noAmounts' || p === 'discreet'

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
  // "app" (Etapa 5) didn't exist in the old per-kind settings: it follows the others.
  const on = legacy ? Object.entries(kinds).some(([k, v]) => k !== 'app' && v.enabled) : r!.on === true
  return {
    on,
    legacy,
    when,
    followUp: legacy ? false : r?.followUp !== false,
    showDetails: r?.showDetails ?? false,
    privacy: isPrivacy(r?.privacy) ? r.privacy : 'noAmounts',
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
  /** Lock-screen text, after the privacy choice (never passwords or vault data). */
  title: string
  body: string
  /** Full text with amounts: only shown inside the app. */
  detail: string
  /** Specific text without amounts. */
  plain: string
  url: string
  /** Set by the person on the record itself (never folded into a group on the lock screen). */
  custom: boolean
  /** `collection:id` of the record it is about (the center opens it). */
  source?: string
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
  app: 'O Núcleo tem um aviso para você',
}
/** Follow-ups say "pending" without saying what (lock screen, discreet). */
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

/**
 * Lock-screen texts for a privacy choice. The title is always the app ("Núcleo"); the body is the
 * whole, specific message (what, when, who, how much — as the privacy choice allows), so nothing
 * is said twice and nothing depends on the title. `title` (the item's short name) stays for the app.
 */
export function lockText(privacy: ReminderPrivacy, kind: ReminderKind, _title: string, full: string, plain: string, late = false) {
  if (privacy === 'discreet') return { title: 'Núcleo', body: (late && GENERIC_LATE[kind]) || GENERIC[kind] }
  return { title: 'Núcleo', body: privacy === 'complete' ? full : plain }
}

/** Task / appointment: "Entregar o site às 15:00", "… hoje às 15:00", "… amanhã", "… ficou pendente". */
function whenText(name: string, p: Phase, time?: string): string {
  if ('late' in p) return `${name} ficou pendente`
  if ('at' in p) return time ? `${name} às ${time}` : `${name} hoje`
  return `${name} ${rel(p, time)}`
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

/* ------------------------------------------------------------------ texts */

/** When a reminder fires, relative to its item. */
export type Phase = { at: true } | { min: number } | { days: number } | { late: true }
/** Money only in the full text: `m(' de R$ 21,90')` is '' in the text without amounts. */
type Money = (s: string) => string

const daysWord = (n: number) => (n === 1 ? 'amanhã' : `em ${n} dias`)

/** "hoje às 15:00", "amanhã", "em 2 dias, às 09:00"… — always from the item's own date/time. */
export function rel(p: Phase, time?: string): string {
  if ('min' in p) {
    if (!time) return 'em breve'
    // `min` minutes before a time: same day unless the lead crosses midnight.
    return toMinutes(time) >= p.min ? `hoje às ${time}` : `amanhã às ${time}`
  }
  if ('days' in p) {
    if (p.days <= 0) return time ? `hoje às ${time}` : 'hoje'
    return time ? `${daysWord(p.days)}, às ${time}` : daysWord(p.days)
  }
  if ('late' in p) return 'ficou pendente'
  return time ? `agora, às ${time}` : 'hoje'
}

/* ------------------------------------------------------------------ specs (shared by occurrences and series) */

/** One reminder of an item, relative to the item's date: fires at (date + dayOffset, time) − minus minutes. */
export interface Spec {
  suffix: string
  dayOffset: number
  time: string
  minus: number
  phase: Phase
  custom: boolean
}

/** The person's own alerts, sanitised (an invalid one is ignored, never guessed). */
export function validAlerts(alerts: unknown): ReminderAlert[] {
  if (!Array.isArray(alerts)) return []
  const out: ReminderAlert[] = []
  for (const a of alerts.slice(0, 8)) {
    if (!a || typeof a !== 'object' || typeof (a as { id?: unknown }).id !== 'string') continue
    const x = a as ReminderAlert
    if (x.type === 'at') out.push({ id: x.id, type: 'at' })
    else if (x.type === 'min' && Number.isFinite(x.minutes) && x.minutes >= 0 && x.minutes <= 10080) out.push({ id: x.id, type: 'min', minutes: Math.round(x.minutes) })
    else if (x.type === 'day' && Number.isFinite(x.days) && x.days >= 0 && x.days <= 60 && isTime(x.at)) out.push({ id: x.id, type: 'day', days: Math.round(x.days), at: x.at })
  }
  return out
}

/** Specs of an item with a time (`time`): the person's alerts, or the kind's timing. */
function timedSpecs(t: KindTiming, time: string, alerts: ReminderAlert[], opts: { leadMin?: number; when?: ReminderWhen } = {}): Spec[] {
  if (alerts.length) {
    return alerts.map((a): Spec => {
      if (a.type === 'min' && a.minutes > 0) return { suffix: `T${time}:c${a.minutes}`, dayOffset: 0, time, minus: a.minutes, phase: { min: a.minutes }, custom: true }
      if (a.type === 'day') return { suffix: `T${time}:c${a.days}d${a.at}`, dayOffset: -a.days, time: a.at, minus: 0, phase: { days: a.days }, custom: true }
      return { suffix: `T${time}:c0`, dayOffset: 0, time, minus: 0, phase: { at: true }, custom: true }
    })
  }
  const lead = opts.leadMin ?? t.leadMin
  const when = lead <= 0 ? 'at' : (opts.when ?? t.when)
  const out: Spec[] = []
  if (when !== 'at') out.push({ suffix: `T${time}:${lead}`, dayOffset: 0, time, minus: lead, phase: { min: lead }, custom: false })
  if (when !== 'before') out.push({ suffix: `T${time}:0`, dayOffset: 0, time, minus: 0, phase: { at: true }, custom: false })
  return out
}

/** Specs of an item with only a date: the person's alerts, or days before / on the day at the kind's time. */
function datedSpecs(t: KindTiming, alerts: ReminderAlert[], opts: { daysBefore?: number; when?: ReminderWhen } = {}): Spec[] {
  if (alerts.length) {
    return alerts.map((a): Spec => {
      if (a.type === 'day') return { suffix: `:c${a.days}d${a.at}`, dayOffset: -a.days, time: a.at, minus: 0, phase: { days: a.days }, custom: true }
      // "Minutes before" has no meaning without a time: on the day, at the reminder time.
      return { suffix: `:c0@${t.at}`, dayOffset: 0, time: t.at, minus: 0, phase: { days: 0 }, custom: true }
    })
  }
  const days = opts.daysBefore ?? t.daysBefore
  const when = days <= 0 ? 'at' : (opts.when ?? t.whenDated)
  const out: Spec[] = []
  if (when !== 'at') out.push({ suffix: `:${days}:${t.at}`, dayOffset: -days, time: t.at, minus: 0, phase: { days }, custom: false })
  if (when !== 'before') out.push({ suffix: `:0:${t.at}`, dayOffset: 0, time: t.at, minus: 0, phase: { days: 0 }, custom: false })
  return out
}

/* ------------------------------------------------------------------ context */

interface Ctx {
  tz: string
  now: Date
  until: Date
  /** Local dates that can hold a moment of the window (cheap string check before any time-zone math). */
  firstDate: string
  lastDate: string
  prefs: EffectivePrefs
  out: Occurrence[]
  money: (cents: number, currency: string) => string
}

interface Item {
  kind: ReminderKind
  /** `task:t1` — the key is `<prefix>:<date><suffix>`. */
  prefix: string
  /** Lock-screen title (never money). */
  title: string
  /** The item's text for one moment; `m` adds money only to the full text. */
  text(p: Phase, m: Money): string
  url: string
  source?: string
  /**
   * When the item was saved. If the "before" moment had already passed by then (a task created 5
   * minutes before its time), the "at" reminder is used instead, so it isn't lost. Never decided by
   * the clock alone: a reminder that simply went by doesn't turn into a second one.
   */
  changedAt?: string
  alerts?: unknown
  off?: boolean
}

const FULL: Money = (s) => s
const PLAIN: Money = () => ''

function inWindow(ctx: Ctx, fireAt: Date) {
  return fireAt.getTime() > ctx.now.getTime() - PAST_GRACE && fireAt <= ctx.until
}

function push(ctx: Ctx, o: Omit<Occurrence, 'title' | 'body' | 'fireAt'> & { at: Date; safeTitle: string; late?: boolean }): boolean {
  const fireAt = outsideQuiet(o.at, ctx.prefs.quiet, ctx.tz)
  if (!inWindow(ctx, fireAt)) return false
  const lock = lockText(ctx.prefs.privacy, o.kind, o.safeTitle, o.detail, o.plain, o.late)
  ctx.out.push({ key: o.key, kind: o.kind, fireAt, title: lock.title, body: lock.body, detail: o.detail, plain: o.plain, url: o.url, custom: o.custom, ...(o.source ? { source: o.source } : {}) })
  return true
}

function momentOf(ctx: Ctx, date: string, s: Pick<Spec, 'dayOffset' | 'time' | 'minus'>) {
  return new Date(zonedToInstant(addDaysToDate(date, s.dayOffset), s.time, ctx.tz).getTime() - s.minus * 60_000)
}

function emit(ctx: Ctx, it: Item, date: string, specs: Spec[]) {
  for (const s of specs) {
    const local = addDaysToDate(date, s.dayOffset)
    // Far outside the window (quiet hours move a moment by less than a day): skip the time-zone math.
    if (local < ctx.firstDate || local > ctx.lastDate) continue
    push(ctx, {
      key: `${it.prefix}:${date}${s.suffix}`,
      kind: it.kind,
      at: momentOf(ctx, date, s),
      safeTitle: it.title,
      detail: it.text(s.phase, FULL),
      plain: it.text(s.phase, PLAIN),
      url: it.url,
      custom: s.custom,
      source: it.source,
    })
  }
}

/** Default specs whose "before" moment passed before the item was saved become "at" (nothing is lost). */
function rescueMissed(ctx: Ctx, it: Item, date: string, specs: Spec[], atSpec: Spec): Spec[] {
  if (ctx.prefs.legacy || !it.changedAt) return specs
  const saved = Date.parse(it.changedAt)
  let missed = false
  const kept = specs.filter((s) => {
    if (s.custom || 'at' in s.phase || ('days' in s.phase && s.phase.days === 0)) return true
    if (saved > momentOf(ctx, date, s).getTime()) {
      missed = true
      return false
    }
    return true
  })
  if (missed && !kept.some((s) => s.suffix === atSpec.suffix)) kept.push(atSpec)
  return kept
}

/** Item with a time: minutes before / at the time / the person's alerts. */
function timed(ctx: Ctx, it: Item, date: string, time: string, opts: { leadMin?: number; when?: ReminderWhen } = {}) {
  if (it.off) return
  const t = ctx.prefs.kinds[it.kind]
  const specs = timedSpecs(t, time, validAlerts(it.alerts), opts)
  emit(ctx, it, date, rescueMissed(ctx, it, date, specs, { suffix: `T${time}:0`, dayOffset: 0, time, minus: 0, phase: { at: true }, custom: false }))
}

/** Item with only a date: days before at the reminder time / on the day / the person's alerts. */
function dated(ctx: Ctx, it: Item, date: string, opts: { daysBefore?: number; when?: ReminderWhen } = {}) {
  if (it.off) return
  const t = ctx.prefs.kinds[it.kind]
  const specs = datedSpecs(t, validAlerts(it.alerts), opts)
  emit(ctx, it, date, rescueMissed(ctx, it, date, specs, { suffix: `:0:${t.at}`, dayOffset: 0, time: t.at, minus: 0, phase: { days: 0 }, custom: false }))
}

/** One more reminder the day after, if it is still pending (never repeated: one key per item and date). */
function followUp(ctx: Ctx, it: Item, date: string) {
  if (!ctx.prefs.followUp || it.off) return
  const next = addDaysToDate(date, 1)
  if (next < ctx.firstDate || next > ctx.lastDate) return
  push(ctx, {
    key: `${it.prefix}:${date}:late`,
    kind: it.kind,
    at: zonedToInstant(addDaysToDate(date, 1), ctx.prefs.kinds[it.kind].at, ctx.tz),
    safeTitle: it.title,
    detail: it.text({ late: true }, FULL),
    plain: it.text({ late: true }, PLAIN),
    url: it.url,
    custom: false,
    source: it.source,
    late: true,
  })
}

/* ------------------------------------------------------------------ the items of each area */

const quote = (s: string) => `“${s}”`

function moneyOf(ctx: Pick<Ctx, 'money'>, cents: number | undefined, currency: string | undefined) {
  return typeof cents === 'number' && cents > 0 && currency ? ctx.money(cents, currency) : ''
}

export function buildOccurrences(data: DataState, settings: Settings, opts: { now?: Date; days?: number; focus?: FocusRun | null } = {}): Occurrence[] {
  const now = opts.now ?? new Date()
  const prefs = effectivePrefs(settings)
  if (!prefs.on) return []
  const tz = settings.timeZone || deviceTimeZone()
  const span = opts.days ?? 14
  const today = wallClock(now, tz).date
  const ctx: Ctx = {
    tz,
    now,
    until: new Date(now.getTime() + span * 86_400_000),
    firstDate: addDaysToDate(today, -2),
    lastDate: addDaysToDate(today, span + 2),
    prefs,
    out: [],
    money: (c, cur) => formatMoney(c, cur),
  }
  const on = (kind: ReminderKind) => prefs.kinds[kind].enabled
  const yesterday = addDaysToDate(today, -1)
  const dates = Array.from({ length: span + 1 }, (_, i) => addDaysToDate(today, i))
  const runs = data.automationRuns ?? []
  const index = indexCompletions(data.completions ?? [])

  // ---------------------------------------------------------------- Tarefas
  if (on('tasks') && isEnabled(settings, 'tasks')) {
    for (const t of data.tasks) {
      if (t.status === 'done' || !t.dueDate) continue
      const time = t.dueTime && isTime(t.dueTime) ? t.dueTime : undefined
      const it: Item = {
        kind: 'tasks',
        prefix: `task:${t.id}`,
        title: t.title,
        text: (p) => whenText(t.title, p, time),
        url: `#/tasks?open=${t.id}`,
        source: `tasks:${t.id}`,
        changedAt: t.updatedAt,
        alerts: t.alerts,
        off: t.alertsOff,
      }
      if (time) timed(ctx, it, t.dueDate, time)
      else dated(ctx, it, t.dueDate)
      followUp(ctx, { ...it, title: `Atrasada: ${t.title}` }, t.dueDate)
    }
  }

  // ---------------------------------------------------------------- Agenda (a past time never means it happened)
  if (on('events') && isEnabled(settings, 'agenda')) {
    for (const e of data.events ?? []) {
      if (!e.date || e.date < today) continue
      const time = isTime(e.start) ? e.start : undefined
      const it: Item = {
        kind: 'events',
        prefix: `event:${e.id}`,
        title: e.title,
        text: (p) => whenText(e.title, p, time),
        url: `#/agenda?open=${e.id}`,
        source: `events:${e.id}`,
        changedAt: e.updatedAt,
        alerts: e.alerts,
        off: e.alertsOff,
      }
      if (time) timed(ctx, it, e.date, time)
      else dated(ctx, it, e.date)
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
        timed(ctx, routineItem(b), date, b.start, typeof b.remindMin === 'number' ? { leadMin: b.remindMin } : {})
      }
    }
  }

  // ---------------------------------------------------------------- Alimentação (o cardápio só no texto completo)
  const meals = data.mealPlans.find((p) => p.id === 'meals-current') as MealPlan | undefined
  const realWeeks = weeksWithMeals(data.meals ?? [])
  if (on('meals') && isEnabled(settings, 'meals') && (meals || realWeeks.size)) {
    for (const date of dates) {
      const day = weekdayOfDate(date)
      // A week with real meals uses them instead of the AI model (no duplicate reminders).
      if (realWeeks.has(weekStart(date))) {
        for (const m of data.meals) {
          if (m.date !== date || !isTime(m.time) || m.done) continue
          timed(ctx, mealEntryItem(settings, m), date, m.time)
        }
        continue
      }
      for (const m of meals?.meals ?? []) {
        if (m.day !== day || !isTime(m.time)) continue
        timed(ctx, planMealItem(m), date, m.time)
      }
    }
  }

  // ---------------------------------------------------------------- Prazos: projetos, vida, etapas e metas financeiras
  if (on('deadlines')) {
    for (const { it, date, late } of deadlineItems(ctx, data, settings)) {
      dated(ctx, it, date)
      if (late) followUp(ctx, { ...it, title: it.title.replace(/^Prazo:/, 'Prazo vencido:') }, date)
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
      dated(ctx, toolItem(ctx, t), date, typeof t.remindDays === 'number' ? { daysBefore: t.remindDays } : {})
    }
    // Charged and still waiting for the person ("A pagar" in Feito pelo Núcleo): one reminder the next day.
    for (const r of runs) {
      if (r.automation !== 'toolCharge' || r.status !== 'pending' || (r.date !== yesterday && r.date !== today)) continue
      const t = data.tools.find((x) => x.id === r.origin.id)
      if (!t || t.status === 'paused') continue
      const price = moneyOf(ctx, t.price, t.currency)
      followUp(ctx, { ...toolItem(ctx, t), title: `Pagou? ${t.name}`, text: (_p, m) => `Confirme se pagou ${t.name}${m(price ? ` (${price})` : '')}` }, r.date)
    }
  }

  // ---------------------------------------------------------------- A receber: vendas (parcelas) e assinantes
  if (on('receivables')) {
    if (isEnabled(settings, 'sales')) {
      for (const { it, due } of saleItems(ctx, data, today)) {
        if (due >= today) dated(ctx, it, due)
        followUp(ctx, { ...it, title: it.title.replace(/^Receber:/, 'Cobrança atrasada:') }, due)
      }
    }
    if (isEnabled(settings, 'subscribers')) {
      const plans = new Map(data.subPlans.map((p) => [p.id, p]))
      for (const s of data.subscribers) {
        // "Considerar pago na data": nothing to charge, so nothing to remind.
        if (s.status !== 'active' || s.paymentMode === 'autoPaid') continue
        const date = nextChargeOf(s, plans.get(s.planId), now)
        if (!date) continue
        dated(ctx, subscriberItem(ctx, s, plans.get(s.planId)), date)
      }
      for (const r of runs) {
        if (r.automation !== 'subscriberCharge' || r.status !== 'pending' || (r.date !== yesterday && r.date !== today)) continue
        const s = data.subscribers.find((x) => x.id === r.origin.id)
        if (!s) continue
        const price = moneyOf(ctx, r.amount, r.currency)
        followUp(ctx, { ...subscriberItem(ctx, s, plans.get(s.planId)), title: `Cobrança pendente: ${s.name}`, text: (_p, m) => `A assinatura de ${s.name}${m(price ? ` (${price})` : '')} ainda não foi recebida` }, r.date)
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
        timed(ctx, habitItem(h), date, h.time)
      }
      // One evening nudge per day, only while something is still open (never one per habit).
      if (prefs.followUp && pending) {
        const text = pending === 1 ? 'Ainda dá tempo: falta 1 hábito hoje' : `Ainda dá tempo: faltam ${pending} hábitos hoje`
        push(ctx, {
          key: `habits-open:${date}`,
          kind: 'habits',
          at: zonedToInstant(date, '20:00', tz),
          safeTitle: pending === 1 ? 'Falta 1 hábito hoje' : `Faltam ${pending} hábitos hoje`,
          detail: text,
          plain: text,
          url: '#/habits',
          custom: false,
          late: true,
        })
      }
    }
  }

  // ---------------------------------------------------------------- Recorrentes e contas
  if (on('recurring') && isEnabled(settings, 'recurring')) {
    // Look a little further ahead so "2 dias antes" of an item just past the window is not missed.
    const horizon = Array.from({ length: dates.length + 7 }, (_, i) => addDaysToDate(today, i))
    for (const r of data.recurring ?? []) {
      if (!r.active) continue
      for (const date of horizon) {
        if (!recurringOn(r, date) || statusOf(index, 'recurring', r.id, date) !== 'pending') continue
        for (const [d, specs] of recurringSpecs(prefs, r, date)) emit(ctx, recurringItem(r), d, specs)
      }
      // A bill still open the day after: one reminder (not for chores, which would only nag).
      if (r.bill && recurringOn(r, yesterday) && statusOf(index, 'recurring', r.id, yesterday) === 'pending')
        followUp(ctx, { ...recurringItem(r), title: `Conta pendente: ${r.title}` }, yesterday)
    }
  }

  // ---------------------------------------------------------------- Modo foco: a habit session reaching its goal
  const run = opts.focus
  if (on('focus') && run?.habitId && run.runningSince !== null) {
    const h = (data.habits ?? []).find((x) => x.id === run.habitId)
    const goalMs = (h?.minutes ?? 0) * 60_000
    if (h && goalMs > run.elapsedMs) {
      const end = new Date(run.runningSince + goalMs - run.elapsedMs)
      const text = `${h.minutes} min de ${h.name}: meta atingida. Pode encerrar a sessão.`
      push(ctx, { key: `focus:${h.id}:${run.startedAt}:${h.minutes}`, kind: 'focus', at: end, safeTitle: `Meta atingida: ${h.name}`, detail: text, plain: text, url: '#/habits', custom: false })
    }
  }

  // ---------------------------------------------------------------- Avisos do próprio app (regras, automações)
  if (on('app')) for (const n of appNotices(data, now)) push(ctx, { ...n, at: n.at, custom: false })

  // Same key twice (shouldn't happen) is kept once.
  const seen = new Set<string>()
  return ctx.out.filter((o) => (seen.has(o.key) ? false : (seen.add(o.key), true))).sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
}

/* ------------------------------------------------------------------ item builders (one place per area) */

type Block = RoutinePlan['blocks'][number]

function routineItem(b: Block): Item {
  const label = b.kind === 'commute' ? `${b.title} — hora de sair` : b.title
  return {
    kind: 'routine',
    prefix: `routine:${b.id}`,
    title: label,
    text: (p) => (b.kind === 'commute' ? `${b.title}: hora de sair ${'at' in p ? `(${b.start})` : rel(p, b.start)}` : `${b.title} começa ${'at' in p ? `às ${b.start}` : rel(p, b.start)}`),
    url: `#/routine?open=${b.id}`,
  }
}

function mealEntryItem(settings: Settings, m: DataState['meals'][number]): Item {
  const title = typeLabel(settings, m.type) || m.name || 'Refeição'
  const menu = [m.name && m.name !== title ? m.name : '', m.description].filter(Boolean).join(' — ') || m.ingredients.slice(0, 6).join(', ')
  return {
    kind: 'meals',
    prefix: `mealEntry:${m.id}`,
    title,
    // The menu is personal (health): only in the full text.
    text: (p, mm) => `${title} ${'at' in p ? `às ${m.time}` : `planejado para ${rel(p, m.time)}`}${mm(menu ? `: ${menu}` : '')}`,
    url: `#/meals?open=${m.id}`,
    source: `meals:${m.id}`,
  }
}

function planMealItem(m: MealPlan['meals'][number]): Item {
  const menu = m.items.slice(0, 6).join(', ')
  return {
    kind: 'meals',
    prefix: `meal:${m.id}`,
    title: m.label,
    text: (p, mm) => `${m.label} ${'at' in p ? `às ${m.time}` : `planejado para ${rel(p, m.time)}`}${mm(menu ? `: ${menu}` : '')}`,
    url: '#/meals',
  }
}

function habitItem(h: DataState['habits'][number]): Item {
  const extra = h.minutes ? ` (${h.minutes} min)` : ''
  return {
    kind: 'habits',
    prefix: `habit:${h.id}`,
    title: h.name,
    text: (p) => ('at' in p ? `Hora de ${h.name} — ${h.time}${extra}` : `${h.name}${extra} ${rel(p, h.time)}`),
    url: `#/habits?open=${h.id}`,
    source: `habits:${h.id}`,
    alerts: h.alerts,
    off: h.alertsOff,
  }
}

function recurringItem(r: DataState['recurring'][number]): Item {
  return {
    kind: 'recurring',
    prefix: `recurring:${r.id}`,
    title: r.bill ? `Conta: ${r.title}` : r.title,
    text: (p) => {
      // A bill reads as an action, without repeating the verb ("Pagar aluguel" stays "Pagar aluguel").
      const what = r.bill && !/^pagar\s/i.test(r.title) ? `Pagar ${r.title}` : r.title
      if ('late' in p) return `${what} ${r.bill ? 'ainda está pendente' : 'ficou pendente'}`
      if ('at' in p) return `${what} ${isTime(r.time) ? `às ${r.time}` : 'hoje'}`
      return r.bill ? `${what} ${rel(p)}` : `${r.title} ${rel(p, 'min' in p ? r.time : undefined)}`
    },
    url: `#/recurring?open=${r.id}`,
    source: `recurring:${r.id}`,
    alerts: r.alerts,
    off: r.alertsOff,
  }
}

/** Specs of one occurrence of a recurring item (its own time, its "N dias antes", the person's alerts). */
function recurringSpecs(prefs: EffectivePrefs, r: DataState['recurring'][number], date: string): [string, Spec[]][] {
  if (r.alertsOff) return []
  const t = prefs.kinds.recurring
  const alerts = validAlerts(r.alerts)
  // The item's own "avisar N dias antes" wins; otherwise bills remind 2 days before, the rest on the day.
  const before = r.remindDays ?? (r.bill ? (prefs.legacy ? 2 : t.daysBefore) : 0)
  // The time of this occurrence ("só esta" may have changed it): the key carries it, so a change replaces the old reminder.
  const time = recurringTime(r, date)
  if (isTime(time)) {
    const specs = timedSpecs(t, time, alerts, { ...(prefs.legacy ? { when: 'before' as const } : {}), ...(typeof r.remindMin === 'number' ? { leadMin: r.remindMin } : {}) })
    if (!alerts.length && before > 0 && (prefs.legacy || t.when !== 'at')) specs.push({ suffix: `:${before}:${t.at}`, dayOffset: -before, time: t.at, minus: 0, phase: { days: before }, custom: false })
    return [[date, specs]]
  }
  return [[date, datedSpecs(t, alerts, { daysBefore: before })]]
}

function toolItem(ctx: Pick<Ctx, 'money'>, t: DataState['tools'][number]): Item {
  const price = moneyOf(ctx, t.price, t.currency)
  return {
    kind: 'payments',
    prefix: `tool:${t.id}`,
    title: `Pagar: ${t.name}`,
    text: (p, m) => ('late' in p ? `Confirme se pagou ${t.name}${m(price ? ` (${price})` : '')}` : `A assinatura ${t.name}${m(price ? ` de ${price}` : '')} vence ${rel(p)}`),
    url: `#/tools?open=${t.id}`,
    source: `tools:${t.id}`,
    alerts: t.alerts,
    off: t.alertsOff,
  }
}

function subscriberItem(ctx: Pick<Ctx, 'money'>, s: DataState['subscribers'][number], plan: DataState['subPlans'][number] | undefined): Item {
  const price = plan ? moneyOf(ctx, plan.price, plan.currency) : ''
  return {
    kind: 'receivables',
    prefix: `sub:${s.id}`,
    title: `Cobrar: ${s.name}`,
    text: (p, m) => ('late' in p ? `A assinatura de ${s.name} ainda não foi recebida` : `Cobrar a assinatura de ${s.name}${m(price ? ` (${price})` : '')} ${rel(p)}`),
    url: `#/subscribers?open=${s.id}`,
    source: `subscribers:${s.id}`,
    alerts: s.alerts,
    off: s.alertsOff,
  }
}

function saleItems(ctx: Pick<Ctx, 'money'>, data: DataState, today: string): { it: Item; due: string }[] {
  const clients = new Map(data.clients.map((c) => [c.id, c.name]))
  const out: { it: Item; due: string }[] = []
  for (const s of data.sales) {
    const rest = saleRemaining(s)
    if (rest <= 0) continue
    const who = (s.clientId && clients.get(s.clientId)) || s.clientName
    const dues: { due: string; open: number; n?: number }[] = s.installments?.length
      ? installmentViews(s, today)
          .filter((v) => v.state !== 'paid')
          .map((v) => ({ due: v.due, open: v.amount - v.paid, n: v.index + 1 }))
      : s.dueDate
        ? [{ due: s.dueDate, open: rest }]
        : []
    for (const d of dues) {
      const amount = moneyOf(ctx, d.open, s.currency)
      const part = d.n ? `a parcela ${d.n} de ${s.product}` : `o restante de ${s.product}`
      const what = (m: Money) => (m(amount) ? (d.n ? `${amount} (parcela ${d.n}) de ${s.product}` : `os ${amount} restantes de ${s.product}`) : part)
      out.push({
        due: d.due,
        it: {
          kind: 'receivables',
          prefix: `sale:${s.id}`,
          title: `Receber: ${s.product}`,
          text: (p, m) => {
            if ('late' in p) return who ? `${who} ainda não pagou ${what(m)} (venceu)` : `Venceu: ${what(m)} ainda não recebido`
            return who ? `${who} precisa pagar ${what(m)} ${rel(p)}` : `Receber ${what(m)} ${rel(p)}`
          },
          url: `#/sales?open=${s.id}`,
          source: `sales:${s.id}`,
          changedAt: s.updatedAt,
          alerts: s.alerts,
          off: s.alertsOff,
        },
      })
    }
  }
  return out
}

function deadlineItems(ctx: Pick<Ctx, 'money'>, data: DataState, settings: Settings): { it: Item; date: string; late?: boolean }[] {
  const out: { it: Item; date: string; late?: boolean }[] = []
  if (isEnabled(settings, 'projects')) {
    for (const p of data.projects) {
      if (!p.dueDate || !ACTIVE_PROJECT_STATUSES.has(p.status)) continue
      out.push({
        date: p.dueDate,
        late: true,
        it: {
          kind: 'deadlines',
          prefix: `project:${p.id}`,
          title: `Prazo: ${p.name}`,
          text: (ph) => ('late' in ph ? `O prazo do projeto ${p.name} passou` : `O prazo do projeto ${p.name} termina ${rel(ph)}`),
          url: `#/projects?open=${p.id}`,
          source: `projects:${p.id}`,
          changedAt: p.updatedAt,
          alerts: p.alerts,
          off: p.alertsOff,
        },
      })
    }
  }
  if (isEnabled(settings, 'life')) {
    const tasks = taskMap(data.tasks)
    const open = (p: { status: string }) => p.status === 'active' || p.status === 'planning'
    for (const p of data.lifePlans ?? []) {
      if (!p.deadline || !open(p)) continue
      const what = p.kind === 'objective' ? 'objetivo' : 'projeto'
      out.push({
        date: p.deadline,
        it: {
          kind: 'deadlines',
          prefix: `plan:${p.id}`,
          title: `Prazo: ${p.title}`,
          text: (ph) => `O prazo do ${what} ${p.title} termina ${rel(ph)}`,
          url: `#/life?open=${p.id}`,
          source: `lifePlans:${p.id}`,
          alerts: p.alerts,
          off: p.alertsOff,
        },
      })
    }
    const plans = new Map((data.lifePlans ?? []).map((p) => [p.id, p]))
    for (const s of data.planSteps ?? []) {
      const p = plans.get(s.planId)
      if (!s.deadline || !p || !open(p) || stepDone(s, tasks)) continue
      out.push({
        date: s.deadline,
        it: {
          kind: 'deadlines',
          prefix: `step:${s.id}`,
          title: `Etapa: ${s.title}`,
          text: (ph) => `O prazo da etapa ${quote(s.title)} (${p.title}) termina ${rel(ph)}`,
          url: `#/life?open=${p.id}`,
          source: `lifePlans:${p.id}`,
          alerts: s.alerts,
          off: s.alertsOff,
        },
      })
    }
  }
  if (isEnabled(settings, 'finance')) {
    for (const g of data.financeGoals ?? []) {
      if (g.status !== 'active' || !g.deadline || g.saved >= g.target) continue
      const missing = moneyOf(ctx, g.target - g.saved, g.currency)
      out.push({
        date: g.deadline,
        it: {
          kind: 'deadlines',
          prefix: `fgoal:${g.id}`,
          title: `Meta: ${g.name}`,
          text: (ph, m) => `O prazo da meta ${g.name} termina ${rel(ph)}${m(missing ? ` — faltam ${missing}` : '')}`,
          url: `#/finance?goal=${g.id}`,
          source: `financeGoals:${g.id}`,
          alerts: g.alerts,
          off: g.alertsOff,
        },
      })
    }
  }
  return out
}

/** Notices of the app itself, from what really happened (a rule waiting, an action that failed). */
function appNotices(data: DataState, now: Date): (Omit<Occurrence, 'title' | 'body' | 'fireAt' | 'custom'> & { at: Date; safeTitle: string })[] {
  const out: (Omit<Occurrence, 'title' | 'body' | 'fireAt' | 'custom'> & { at: Date; safeTitle: string })[] = []
  // Only what just happened is sent (a minute later, so the screen it happened on can show it first).
  const recent = (iso: string | undefined) => !!iso && now.getTime() - Date.parse(iso) < 2 * 3600_000
  for (const r of data.automationRuns ?? []) {
    if (!recent(r.createdAt) || r.dismissedAt) continue
    const at = new Date(Math.max(Date.parse(r.createdAt) + 60_000, now.getTime() + 60_000))
    const name = r.rule?.name ?? r.origin.label
    // Waiting for the person: Pendências. A failed action: the activity of that rule (the run is listed there).
    const url = r.rule?.id ? `#/automations?tab=activity&rule=${r.rule.id}` : '#/automations?tab=activity'
    const pendingUrl = '#/automations?tab=pending'
    if (r.awaiting && r.status === 'pending' && !r.declined && !r.confirmedAt) {
      const text = `A regra ${quote(name)} está aguardando sua confirmação.`
      out.push({ key: `run:${r.id}:awaiting`, kind: 'app', at, safeTitle: 'Regra aguardando confirmação', detail: text, plain: text, url: pendingUrl, source: `automationRuns:${r.id}` })
    }
    if (r.notice && !r.notice.seenAt) {
      out.push({ key: `run:${r.id}:notice`, kind: 'app', at, safeTitle: r.notice.kind === 'review' ? 'Revisão pedida por uma regra' : `Aviso da regra ${name}`, detail: `Regra ${quote(name)}: ${r.notice.text}`, plain: `Regra ${quote(name)}: ${r.notice.text}`, url: pendingUrl, source: `automationRuns:${r.id}` })
    }
    const failed = (r.actions ?? []).filter((a) => !a.ok && !a.undone && !(a.attempts ?? []).some((x) => x.ok))
    if (r.automation === 'rule' && failed.length) {
      const text = `A regra ${quote(name)} não conseguiu concluir: ${failed[0].text}`
      out.push({ key: `run:${r.id}:failed`, kind: 'app', at, safeTitle: 'Uma automação falhou', detail: text, plain: text, url, source: `automationRuns:${r.id}` })
    }
  }
  return out
}

/* ------------------------------------------------------------------ series: renewed by the server */

/** The recurrence the server understands (a superset of the app's rule). */
export type SeriesRule = RecurrenceRule | { type: 'monthly'; dayOfMonth: number; months: number } | { type: 'once'; date: string }

/**
 * A reminder that keeps going after the app's 14 days: the server writes its next occurrences
 * (with the key `template` where `{d}` is the item's date) only after the moment the app
 * already covered, so the app's own exact list always wins.
 */
export interface Series {
  key: string
  template: string
  rule: SeriesRule
  start: string | null
  end: string | null
  skip: string[]
  dayOffset: number
  time: string
  minus: number
  kind: ReminderKind
  custom: boolean
  title: string
  body: string
  detail: string
  url: string
}

export const MAX_SERIES = 400

/**
 * Everything that has a future the app may not be open to schedule: repeating items as rules,
 * single dated items as `once`. Texts are fixed per series (they never depend on "today").
 * Follow-ups, the evening habit nudge and the focus timer depend on what happens, so they stay
 * with the app.
 */
export function buildSeries(data: DataState, settings: Settings, opts: { now?: Date } = {}): Series[] {
  const now = opts.now ?? new Date()
  const prefs = effectivePrefs(settings)
  if (!prefs.on) return []
  const tz = settings.timeZone || deviceTimeZone()
  const today = wallClock(now, tz).date
  const ctx = { money: (c: number, cur: string) => formatMoney(c, cur) }
  const on = (kind: ReminderKind) => prefs.kinds[kind].enabled
  const repeating: Series[] = []
  const once: (Series & { at: string })[] = []
  const index = indexCompletions(data.completions ?? [])

  const make = (it: Item, s: Spec, rule: SeriesRule, extra: { start?: string | null; end?: string | null; skip?: string[] } = {}): Series => {
    const detail = it.text(s.phase, FULL)
    const plain = it.text(s.phase, PLAIN)
    const lock = lockText(prefs.privacy, it.kind, it.title, detail, plain)
    return {
      key: `${it.prefix}|${rule.type === 'once' ? rule.date : ''}${s.suffix}`,
      template: `${it.prefix}:{d}${s.suffix}`,
      rule,
      start: extra.start ?? null,
      end: extra.end ?? null,
      skip: [...new Set(extra.skip ?? [])].filter((d) => d >= today).sort().slice(0, 60),
      dayOffset: s.dayOffset,
      time: s.time,
      minus: s.minus,
      kind: it.kind,
      custom: s.custom,
      title: lock.title.slice(0, 120),
      body: lock.body.slice(0, 240),
      detail: detail.slice(0, 300),
      url: it.url,
    }
  }
  const single = (it: Item, date: string, specs: Spec[]) => {
    if (it.off || date < today) return
    for (const s of specs) once.push({ ...make(it, s, { type: 'once', date }), at: date })
  }
  const doneDates = (source: 'habit' | 'recurring' | 'routine', id: string, from: string) =>
    (data.completions ?? []).filter((c) => c.source === source && c.sourceId === id && c.date >= from).map((c) => c.date)

  if (on('tasks') && isEnabled(settings, 'tasks')) {
    for (const t of data.tasks) {
      if (t.status === 'done' || !t.dueDate) continue
      const time = t.dueTime && isTime(t.dueTime) ? t.dueTime : undefined
      const it: Item = { kind: 'tasks', prefix: `task:${t.id}`, title: t.title, text: (p) => whenText(t.title, p, time), url: `#/tasks?open=${t.id}`, alerts: t.alerts, off: t.alertsOff }
      single(it, t.dueDate, time ? timedSpecs(prefs.kinds.tasks, time, validAlerts(t.alerts)) : datedSpecs(prefs.kinds.tasks, validAlerts(t.alerts)))
    }
  }
  if (on('events') && isEnabled(settings, 'agenda')) {
    for (const e of data.events ?? []) {
      if (!e.date || e.date < today) continue
      const time = isTime(e.start) ? e.start : undefined
      const it: Item = { kind: 'events', prefix: `event:${e.id}`, title: e.title, text: (p) => whenText(e.title, p, time), url: `#/agenda?open=${e.id}`, alerts: e.alerts, off: e.alertsOff }
      single(it, e.date, time ? timedSpecs(prefs.kinds.events, time, validAlerts(e.alerts)) : datedSpecs(prefs.kinds.events, validAlerts(e.alerts)))
    }
  }
  if (on('deadlines')) for (const { it, date } of deadlineItems(ctx, data, settings)) single(it, date, datedSpecs(prefs.kinds.deadlines, validAlerts(it.alerts)))
  if (on('receivables') && isEnabled(settings, 'sales')) for (const { it, due } of saleItems(ctx, data, today)) single(it, due, datedSpecs(prefs.kinds.receivables, validAlerts(it.alerts)))

  const routine = data.routinePlans.find((p) => p.id === 'routine-current') as RoutinePlan | undefined
  if (on('routine') && routine && isEnabled(settings, 'routine')) {
    for (const b of routine.blocks) {
      if (b.kind === 'meal' || !isTime(b.start) || b.remindMin === false) continue
      const marked = Object.entries(routine.done ?? {}).filter(([d, ids]) => d >= today && ids.includes(b.id)).map(([d]) => d)
      const skip = [...doneDates('routine', b.id, today), ...marked]
      for (const s of timedSpecs(prefs.kinds.routine, b.start, [], typeof b.remindMin === 'number' ? { leadMin: b.remindMin } : {}))
        repeating.push(make(routineItem(b), s, { type: 'weekdays', days: [b.day] }, { skip }))
    }
  }
  const meals = data.mealPlans.find((p) => p.id === 'meals-current') as MealPlan | undefined
  if (on('meals') && isEnabled(settings, 'meals')) {
    const realWeeks = weeksWithMeals(data.meals ?? [])
    const skip = [...realWeeks].filter((w) => addDaysToDate(w, 6) >= today).flatMap((w) => Array.from({ length: 7 }, (_, i) => addDaysToDate(w, i)))
    for (const m of meals?.meals ?? []) {
      if (!isTime(m.time)) continue
      for (const s of timedSpecs(prefs.kinds.meals, m.time, [])) repeating.push(make(planMealItem(m), s, { type: 'weekdays', days: [m.day] }, { skip }))
    }
    for (const m of data.meals ?? []) if (isTime(m.time) && !m.done) single(mealEntryItem(settings, m), m.date, timedSpecs(prefs.kinds.meals, m.time, []))
  }
  if (on('habits') && isEnabled(settings, 'habits')) {
    for (const h of data.habits ?? []) {
      // Linked habits are reminded by their host on the days it happens: the app handles them.
      if (!h.active || !isTime(h.time) || h.remind === false || h.alertsOff || h.link) continue
      for (const s of timedSpecs(prefs.kinds.habits, h.time, validAlerts(h.alerts))) repeating.push(make(habitItem(h), s, h.rule, { start: h.startDate || null, skip: doneDates('habit', h.id, today) }))
    }
  }
  if (on('recurring') && isEnabled(settings, 'recurring')) {
    for (const r of data.recurring ?? []) {
      if (!r.active || r.alertsOff || (r.endDate && r.endDate < today)) continue
      // Dates the rule alone doesn't describe (moved, own time, already marked) are left to `once` series.
      const overrides = [...Object.keys(r.moved ?? {}), ...Object.values(r.moved ?? {}), ...Object.keys(r.times ?? {})]
      const skip = [...overrides, ...doneDates('recurring', r.id, today)]
      const [[, specs]] = recurringSpecs(prefs, r, '0000-00-00')
      for (const s of specs) repeating.push(make(recurringItem(r), s, r.rule, { start: r.startDate || null, end: r.endDate ?? null, skip }))
      for (const d of new Set(overrides)) {
        if (d < today || !recurringOn(r, d) || statusOf(index, 'recurring', r.id, d) !== 'pending') continue
        for (const [date, sp] of recurringSpecs(prefs, r, d)) single(recurringItem(r), date, sp)
      }
    }
  }
  if (on('payments') && isEnabled(settings, 'tools')) {
    const runs = data.automationRuns ?? []
    for (const t of data.tools) {
      if (!isPaidTool(t) || t.status !== 'active' || !t.nextCharge) continue
      const next = nextChargeDate(t, now)
      const specs = datedSpecs(prefs.kinds.payments, validAlerts(t.alerts), typeof t.remindDays === 'number' ? { daysBefore: t.remindDays } : {})
      const paid = runs.filter((r) => r.automation === 'toolCharge' && r.origin.id === t.id && r.status !== 'pending').map((r) => r.date)
      if (t.billing === 'monthly' || t.billing === 'yearly') {
        const rule: SeriesRule = { type: 'monthly', dayOfMonth: t.chargeDay ?? Number(next.slice(8, 10)), months: t.billing === 'monthly' ? 1 : 12 }
        for (const s of specs) if (!t.alertsOff) repeating.push(make(toolItem(ctx, t), s, rule, { start: next, skip: paid }))
      } else if (!paid.includes(next)) single(toolItem(ctx, t), next, specs)
    }
  }
  if (on('receivables') && isEnabled(settings, 'subscribers')) {
    const plans = new Map(data.subPlans.map((p) => [p.id, p]))
    for (const s of data.subscribers) {
      const plan = plans.get(s.planId)
      if (s.status !== 'active' || s.paymentMode === 'autoPaid' || !plan || s.alertsOff) continue
      const next = nextChargeOf(s, plan, now)
      if (!next) continue
      const rule: SeriesRule = { type: 'monthly', dayOfMonth: s.chargeDay ?? Number(next.slice(8, 10)), months: plan.interval === 'monthly' ? 1 : 12 }
      for (const sp of datedSpecs(prefs.kinds.receivables, validAlerts(s.alerts))) repeating.push(make(subscriberItem(ctx, s, plan), sp, rule, { start: next }))
    }
  }

  // Bounded: repeating ones first (they are the ones that would stop), then the soonest single dates.
  once.sort((a, b) => a.at.localeCompare(b.at))
  const all = [...repeating, ...once.map(({ at: _at, ...s }) => s)]
  const seen = new Set<string>()
  return all.filter((s) => (seen.has(s.key) ? false : (seen.add(s.key), true))).slice(0, MAX_SERIES)
}
