/**
 * Deterministic part of the routine planner. Fixed commitments, commutes and
 * breaks are laid out here — never by the AI — and everything the AI proposes
 * is checked against them before it can be shown as a plan.
 */
import { fromMinutes, isTime, toMinutes } from './time.ts'
import type { BlockKind, Commitment, RoutineAnswers, RoutineBlock, Training, Weekday, WishActivity } from './types.ts'

export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 0]
export const DAY_SHORT: Record<Weekday, string> = { 0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb' }
export const DAY_LONG: Record<Weekday, string> = { 0: 'Domingo', 1: 'Segunda', 2: 'Terça', 3: 'Quarta', 4: 'Quinta', 5: 'Sexta', 6: 'Sábado' }

export const KIND_LABEL: Record<BlockKind, string> = {
  work: 'Trabalho',
  study: 'Estudo',
  commute: 'Deslocamento',
  meal: 'Refeição',
  training: 'Treino',
  activity: 'Atividade',
  rest: 'Descanso',
  other: 'Outro',
}

export const isWeekend = (day: Weekday) => day === 0 || day === 6

/** Awake window in minutes. Bedtime after midnight is capped at 24:00 (blocks don't cross days). */
export function dayWindow(a: RoutineAnswers, day: Weekday): { start: number; end: number } | null {
  const wake = isWeekend(day) ? a.wakeWeekend : a.wakeWeekday
  const sleep = isWeekend(day) ? a.sleepWeekend : a.sleepWeekday
  if (!isTime(wake) || !isTime(sleep)) return null
  const start = toMinutes(wake)
  let end = toMinutes(sleep)
  if (end <= start) end = 1440
  return { start, end }
}

let seq = 0
const blockId = (prefix: string, day: Weekday, extra = '') => `${prefix}-${day}${extra}`

/** Resolves start/end from leave/arrive and commute when only those were given. */
export function resolveCommitment(c: Commitment): { start: number; end: number; leave: number | null; arrive: number | null } | null {
  const commute = c.away ? Math.max(0, c.commuteMin || 0) : 0
  const leave = c.away && isTime(c.leaveAt) ? toMinutes(c.leaveAt) : null
  const arrive = c.away && isTime(c.arriveAt) ? toMinutes(c.arriveAt) : null
  const start = isTime(c.start) ? toMinutes(c.start) : leave !== null ? leave + commute : null
  const end = isTime(c.end) ? toMinutes(c.end) : arrive !== null ? arrive - commute : null
  if (start === null || end === null || end <= start) return null
  return { start, end, leave: c.away ? (leave ?? start - commute) : null, arrive: c.away ? (arrive ?? end + commute) : null }
}

function push(out: RoutineBlock[], b: Omit<RoutineBlock, 'start' | 'end'> & { start: number; end: number }) {
  if (b.end <= b.start) return
  out.push({ ...b, start: fromMinutes(b.start), end: b.end >= 1440 ? '23:59' : fromMinutes(b.end) })
}

/** Blocks that come straight from the answers: commitments, commutes, breaks and trainings. */
export function fixedBlocks(a: RoutineAnswers): RoutineBlock[] {
  const out: RoutineBlock[] = []
  for (const c of a.commitments) {
    const r = resolveCommitment(c)
    if (!r) continue
    const kind: BlockKind = c.kind === 'work' ? 'work' : c.kind === 'study' ? 'study' : 'other'
    const hasBreak = isTime(c.breakStart) && isTime(c.breakEnd) && toMinutes(c.breakStart) > r.start && toMinutes(c.breakEnd) < r.end && toMinutes(c.breakEnd) > toMinutes(c.breakStart)
    for (const day of c.days) {
      const base = { day, fixed: c.fixed, title: c.title || KIND_LABEL[kind] }
      if (r.leave !== null && r.leave < r.start) push(out, { ...base, id: blockId(`go-${c.id}`, day), kind: 'commute', title: `Ida · ${base.title}`, start: r.leave, end: r.start })
      if (hasBreak) {
        push(out, { ...base, id: blockId(c.id, day, 'a'), kind, start: r.start, end: toMinutes(c.breakStart) })
        push(out, { ...base, id: blockId(`brk-${c.id}`, day), kind: 'meal', title: 'Almoço / intervalo', start: toMinutes(c.breakStart), end: toMinutes(c.breakEnd) })
        push(out, { ...base, id: blockId(c.id, day, 'b'), kind, start: toMinutes(c.breakEnd), end: r.end })
      } else {
        push(out, { ...base, id: blockId(c.id, day), kind, start: r.start, end: r.end })
      }
      if (r.arrive !== null && r.arrive > r.end) push(out, { ...base, id: blockId(`back-${c.id}`, day), kind: 'commute', title: `Volta · ${base.title}`, start: r.end, end: r.arrive })
    }
  }
  for (const t of a.trainings) {
    if (!isTime(t.start) || !t.durationMin) continue
    const start = toMinutes(t.start)
    const commute = t.away ? Math.max(0, t.commuteMin || 0) : 0
    for (const day of t.days) {
      const base = { day, fixed: t.fixed, title: t.modality || 'Treino' }
      if (commute) push(out, { ...base, id: blockId(`tgo-${t.id}`, day), kind: 'commute', title: `Ida · ${base.title}`, start: start - commute, end: start })
      push(out, { ...base, id: blockId(t.id, day), kind: 'training', start, end: start + t.durationMin })
      if (commute) push(out, { ...base, id: blockId(`tback-${t.id}`, day), kind: 'commute', title: `Volta · ${base.title}`, start: start + t.durationMin, end: start + t.durationMin + commute })
    }
  }
  return sortBlocks(out)
}

export function sortBlocks(blocks: RoutineBlock[]): RoutineBlock[] {
  const order = (d: Weekday) => WEEKDAYS.indexOf(d)
  return [...blocks].sort((x, y) => order(x.day) - order(y.day) || toMinutes(x.start) - toMinutes(y.start))
}

export interface Conflict {
  day: Weekday
  message: string
  ids: string[]
}

const span = (b: RoutineBlock) => ({ s: toMinutes(b.start), e: b.end === '23:59' ? 1440 : toMinutes(b.end) })

/** Overlaps, blocks outside the awake window and invalid times. */
export function findConflicts(blocks: RoutineBlock[], a: RoutineAnswers): Conflict[] {
  const out: Conflict[] = []
  for (const day of WEEKDAYS) {
    const list = blocks.filter((b) => b.day === day).sort((x, y) => span(x).s - span(y).s)
    const win = dayWindow(a, day)
    for (const b of list) {
      if (!isTime(b.start) || !isTime(b.end) || span(b).e <= span(b).s) {
        out.push({ day, message: `“${b.title}” tem horário inválido`, ids: [b.id] })
        continue
      }
      if (win && (span(b).s < win.start || span(b).e > win.end)) {
        out.push({ day, message: `“${b.title}” (${b.start}–${b.end}) fica fora do horário acordado (${fromMinutes(win.start)}–${win.end >= 1440 ? '24:00' : fromMinutes(win.end)})`, ids: [b.id] })
      }
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const x = span(list[i])
        const y = span(list[j])
        if (y.s >= x.e) break
        out.push({ day, message: `“${list[i].title}” (${list[i].start}–${list[i].end}) e “${list[j].title}” (${list[j].start}–${list[j].end}) se sobrepõem`, ids: [list[i].id, list[j].id] })
      }
    }
  }
  return out
}

/** Free intervals of a day after the given blocks, keeping `buffer` minutes around each. */
export function freeWindows(blocks: RoutineBlock[], a: RoutineAnswers, day: Weekday): { start: number; end: number }[] {
  const win = dayWindow(a, day)
  if (!win) return []
  const buffer = Math.max(0, a.bufferMin || 0)
  const busy = blocks
    .filter((b) => b.day === day)
    .map(span)
    .sort((x, y) => x.s - y.s)
  const out: { start: number; end: number }[] = []
  let cursor = win.start
  for (const b of busy) {
    const until = b.s - buffer
    if (until > cursor) out.push({ start: cursor, end: Math.min(until, win.end) })
    cursor = Math.max(cursor, b.e + buffer)
  }
  if (win.end > cursor) out.push({ start: cursor, end: win.end })
  return out.filter((w) => w.end > w.start)
}

const PERIOD_RANGE: Record<WishActivity['period'], [number, number]> = {
  any: [0, 1440],
  morning: [5 * 60, 12 * 60],
  afternoon: [12 * 60, 18 * 60],
  evening: [18 * 60, 24 * 60],
}

/** Days on which the activity fits at least once (respecting period and rest days). */
export function daysThatFit(activity: WishActivity, blocks: RoutineBlock[], a: RoutineAnswers): Weekday[] {
  const [ps, pe] = PERIOD_RANGE[activity.period]
  return WEEKDAYS.filter((day) => {
    if (a.restDays.includes(day)) return false
    return freeWindows(blocks, a, day).some((w) => Math.min(w.end, pe) - Math.max(w.start, ps) >= activity.durationMin)
  })
}

export interface FitProblem {
  activityId: string
  message: string
}

/**
 * Checks before calling the AI whether everything requested can fit. When it
 * can't, the person chooses what to cut — the AI never decides that silently.
 */
export function feasibility(a: RoutineAnswers): { problems: FitProblem[]; fixedConflicts: Conflict[] } {
  const fixed = fixedBlocks(a)
  const fixedConflicts = findConflicts(fixed, a)
  const problems: FitProblem[] = []
  let freeTotal = 0
  for (const day of WEEKDAYS) if (!a.restDays.includes(day)) freeTotal += freeWindows(fixed, a, day).reduce((s, w) => s + (w.end - w.start), 0)
  let wanted = 0
  for (const act of a.activities) {
    const days = daysThatFit(act, fixed, a)
    wanted += act.timesPerWeek * act.durationMin
    if (days.length < act.timesPerWeek) {
      problems.push({
        activityId: act.id,
        message: days.length
          ? `“${act.name}” (${act.timesPerWeek}× de ${act.durationMin} min) só cabe em ${days.length} dia(s) da semana.`
          : `“${act.name}” (${act.durationMin} min) não cabe em nenhum dia${act.period !== 'any' ? ' no período escolhido' : ''}.`,
      })
    }
  }
  if (wanted > freeTotal) {
    problems.push({ activityId: '', message: `As atividades pedem ${Math.round(wanted / 60)} h por semana, mas há só ${Math.round(freeTotal / 60)} h livres (já contando intervalos).` })
  }
  return { problems, fixedConflicts }
}

export interface Sanitized {
  blocks: RoutineBlock[]
  rejected: string[]
}

/**
 * Accepts AI-proposed blocks one by one: each must fit a free window, not
 * overlap anything, respect rest days and not exceed the requested frequency.
 * Fixed blocks are always the ones built from the answers, whatever the AI returned.
 */
export function mergeProposal(a: RoutineAnswers, proposed: RoutineBlock[]): Sanitized {
  const fixed = fixedBlocks(a)
  const accepted: RoutineBlock[] = [...fixed]
  const rejected: string[] = []
  const countByName = new Map<string, number>()
  const wanted = new Map(a.activities.map((x) => [x.name.trim().toLowerCase(), x]))
  for (const raw of proposed) {
    if (raw.fixed) continue // fixed blocks come from the answers, never from the AI
    const b: RoutineBlock = { ...raw, id: raw.id || `ai-${++seq}`, fixed: false }
    const label = `${DAY_SHORT[b.day] ?? '?'} ${b.start}–${b.end} ${b.title}`
    if (!WEEKDAYS.includes(b.day) || !isTime(b.start) || !isTime(b.end) || toMinutes(b.end) <= toMinutes(b.start)) {
      rejected.push(`${label}: horário inválido`)
      continue
    }
    if (a.restDays.includes(b.day) && b.kind !== 'rest' && b.kind !== 'meal') {
      rejected.push(`${label}: dia de descanso`)
      continue
    }
    const want = wanted.get(b.title.trim().toLowerCase())
    if (want) {
      const n = (countByName.get(want.id) ?? 0) + 1
      if (n > want.timesPerWeek) {
        rejected.push(`${label}: passaria de ${want.timesPerWeek}× por semana`)
        continue
      }
    }
    const trial = [...accepted, b]
    if (findConflicts(trial, a).some((c) => c.ids.includes(b.id))) {
      rejected.push(`${label}: conflita com outro horário`)
      continue
    }
    accepted.push(b)
    if (want) countByName.set(want.id, (countByName.get(want.id) ?? 0) + 1)
  }
  return { blocks: sortBlocks(accepted), rejected }
}

/** What still doesn't appear in the plan as often as requested. */
export function missingActivities(a: RoutineAnswers, blocks: RoutineBlock[]): string[] {
  return a.activities
    .map((act) => {
      const n = blocks.filter((b) => b.title.trim().toLowerCase() === act.name.trim().toLowerCase()).length
      return n < act.timesPerWeek ? `${act.name}: ${n} de ${act.timesPerWeek}× por semana` : null
    })
    .filter((x): x is string => x !== null)
}

export function emptyRoutineAnswers(): RoutineAnswers {
  return {
    wakeWeekday: '07:00',
    sleepWeekday: '23:00',
    wakeWeekend: '08:30',
    sleepWeekend: '23:30',
    commitments: [],
    trainings: [],
    competitions: '',
    activities: [],
    bufferMin: 10,
    restDays: [],
    goals: '',
  }
}

export function newCommitment(): Commitment {
  return { id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: 'Trabalho', kind: 'work', days: [1, 2, 3, 4, 5], start: '', end: '', away: true, leaveAt: '08:00', arriveAt: '18:00', commuteMin: 30, breakStart: '12:00', breakEnd: '13:00', fixed: true }
}

export function newTraining(): Training {
  return { id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, modality: '', days: [], start: '18:30', durationMin: 60, away: true, commuteMin: 15, fixed: true }
}

export function newActivity(): WishActivity {
  return { id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: '', timesPerWeek: 3, durationMin: 30, period: 'any', priority: 'medium' }
}
