/**
 * Rotina (Etapa 2): adding and changing activities without ever touching the other blocks of the plan, the
 * same activity on several days, a sentence to fill the form, and the evidence that can suggest (or, when the
 * person turned it on, mark) a block as done. Pure functions: the screens only save what these return.
 */
import type { BlockKind, Completion, DataState, Habit, RoutineBlock, RoutinePlan, Weekday } from '../data/types'
import { parseCapture } from './capture'
import { completionId } from './completions'
import { occursOn } from './recurrence'
import { weekdayOfDate } from './period'

export const ROUTINE_ID = 'routine-current'

/** A plan to add to when the person never answered the questionnaire (nothing else is created). */
export function emptyRoutine(): Omit<RoutinePlan, 'createdAt' | 'updatedAt'> {
  return { id: ROUTINE_ID, status: 'approved', source: 'manual', blocks: [], notes: '', done: {} }
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

const KIND_WORDS: [BlockKind, RegExp][] = [
  ['training', /\b(treino|treinar|academia|musculacao|corrida|correr|natacao|nadar|pilates|yoga|crossfit|futebol|bike|pedal|caminhada|luta|jiu|muay)\b/],
  ['study', /\b(estud\w*|aula|curso|faculdade|leitura|ler|ingles|idioma|revis\w*)\b/],
  ['work', /\b(trabalh\w*|expediente|escritorio|reuniao|clientes?|projeto)\b/],
  ['meal', /\b(cafe|almoc\w*|jantar|lanche|ceia|refeic\w*)\b/],
  ['commute', /\b(desloc\w*|transito|onibus|metro|ir para|volta para casa)\b/],
  ['rest', /\b(descans\w*|dormir|sono|cochilo|pausa|relax\w*)\b/],
]

/** The kind an activity probably is, by its name (only a starting point; the person can change it). */
export function kindFromTitle(title: string): BlockKind {
  const t = fold(title)
  return KIND_WORDS.find(([, re]) => re.test(t))?.[0] ?? 'activity'
}

const sameText = (a: string, b: string) => fold(a) === fold(b)

/** The same activity on other days: same name, same times and kind (how the questionnaire and "vários dias" create it). */
export function sameActivity(plan: Pick<RoutinePlan, 'blocks'>, block: RoutineBlock): RoutineBlock[] {
  return plan.blocks.filter((b) => b.id === block.id || (sameText(b.title, block.title) && b.start === block.start && b.end === block.end && b.kind === block.kind))
}

export interface ActivityInput {
  title: string
  kind: BlockKind
  start: string
  end: string
  days: Weekday[]
  remindMin?: number | false
}

/**
 * New activity on one or more days. Only appends: the existing blocks stay exactly as they are; a day that
 * already has the very same activity (name and times) is skipped, so nothing is doubled.
 */
export function addActivity(plan: RoutinePlan, input: ActivityInput, newId: () => string): { plan: RoutinePlan; added: RoutineBlock[] } {
  const added: RoutineBlock[] = []
  for (const day of [...new Set(input.days)]) {
    if (plan.blocks.some((b) => b.day === day && sameText(b.title, input.title) && b.start === input.start && b.end === input.end)) continue
    added.push({ id: newId(), day, start: input.start, end: input.end, title: input.title.trim(), kind: input.kind, fixed: false, ...(input.remindMin !== undefined ? { remindMin: input.remindMin } : {}) })
  }
  return { plan: { ...plan, blocks: [...plan.blocks, ...added] }, added }
}

export type Scope = 'one' | 'all'

/**
 * Changes one block, or every block of the same activity ("todos os dias com esta atividade"). Days, ids and
 * the marks already made are kept; every other block of the plan is left untouched.
 */
export function updateActivity(plan: RoutinePlan, block: RoutineBlock, changes: Partial<Pick<RoutineBlock, 'title' | 'kind' | 'start' | 'end' | 'remindMin'>>, scope: Scope): RoutinePlan {
  const targets = new Set((scope === 'all' ? sameActivity(plan, block) : [block]).map((b) => b.id))
  return { ...plan, blocks: plan.blocks.map((b) => (targets.has(b.id) ? { ...b, ...changes } : b)) }
}

/** Moves one block to another weekday (only that block). */
export function moveBlock(plan: RoutinePlan, block: RoutineBlock, day: Weekday): RoutinePlan {
  return { ...plan, blocks: plan.blocks.map((b) => (b.id === block.id ? { ...b, day } : b)) }
}

/** "Duplicar para…": copies to the chosen days that don't have it yet. */
export function duplicateActivity(plan: RoutinePlan, block: RoutineBlock, days: Weekday[], newId: () => string): { plan: RoutinePlan; added: RoutineBlock[] } {
  return addActivity(plan, { title: block.title, kind: block.kind, start: block.start, end: block.end, days: days.filter((d) => d !== block.day), ...(block.remindMin !== undefined ? { remindMin: block.remindMin } : {}) }, newId)
}

/** Removes one block, or the same activity on every day. Nothing else changes (marks stay in their records). */
export function removeActivity(plan: RoutinePlan, block: RoutineBlock, scope: Scope): RoutinePlan {
  const targets = new Set((scope === 'all' ? sameActivity(plan, block) : [block]).map((b) => b.id))
  return { ...plan, blocks: plan.blocks.filter((b) => !targets.has(b.id)) }
}

const DAY_RE = /\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)s?(?:-feiras?)?\b/g
const DAY_INDEX: Record<string, Weekday> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 }

export interface RoutineDraft {
  title: string
  kind: BlockKind
  start: string
  end: string
  days: Weekday[]
  /** An hour that could be morning or afternoon ("às 7"): asked, never guessed. */
  timeOptions?: [string, string]
}

/**
 * "Academia segunda, quarta e sexta das 7h às 8h" → Academia · treino · seg/qua/sex · 07:00–08:00.
 * Only what was written: no days → none chosen; no end → one hour after the start.
 */
export function parseRoutineLine(text: string, today: string): RoutineDraft {
  const d = parseCapture(text, today)
  const folded = fold(text)
  let days: Weekday[] = []
  if (d.rule?.type === 'daily') days = [0, 1, 2, 3, 4, 5, 6]
  else if (d.rule?.type === 'weekdays') days = d.rule.days
  else days = [...new Set([...folded.matchAll(DAY_RE)].map((m) => DAY_INDEX[m[1]]))]
  // Weekday names left in the title ("segunda, quarta") are taken out of it.
  const title = d.title
    .replace(/\b(segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)s?(-feiras?)?\b/gi, '')
    .replace(/(\s*(,|\be\b)\s*)+$/i, '')
    .replace(/^\s*(,|\be\b)\s*/i, '')
    .replace(/\s*,\s*(,\s*)*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/[,\s]+$/, '')
    .trim()
  const cap = title ? title[0].toUpperCase() + title.slice(1) : ''
  const start = d.time ?? ''
  const end = d.end ?? (start ? plusHour(start) : '')
  return { title: cap, kind: kindFromTitle(cap || text), start, end, days: [...days].sort(), ...(d.timeOptions ? { timeOptions: d.timeOptions } : {}) }
}

function plusHour(t: string) {
  const m = Math.min(Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + 60, 23 * 60 + 59)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ evidence */

export interface Evidence {
  /** The habit whose mark (by hand or by a focus session that reached its goal) backs the block. */
  habit: Habit
  /** Completion key used as `via`, so undoing the habit undoes what was marked from it. */
  via: string
}

/** Does this habit back this block? Linked to its kind (Etapa 1), or a training/study habit for that kind of block. */
function backs(habit: Habit, block: RoutineBlock): boolean {
  if (block.kind !== 'training' && block.kind !== 'study') return false
  if (habit.link?.kind === 'routine') return habit.link.blockKind === block.kind
  return !habit.link && habit.category === block.kind
}

/** Real records of that day that back a routine block (never the clock). */
export function evidenceFor(data: Pick<DataState, 'habits' | 'completions'>, block: RoutineBlock, date: string): Evidence | null {
  if (weekdayOfDate(date) !== block.day) return null
  for (const habit of data.habits) {
    if (!habit.active || !backs(habit, block) || !occursOn(habit.rule, habit.startDate, date)) continue
    const c = data.completions.find((x) => x.id === completionId('habit', habit.id, date))
    // A habit marked *from* this routine block is not evidence for it (no loop).
    if (c?.status === 'done' && !c.via?.startsWith('routine:')) return { habit, via: completionId('habit', habit.id, date) }
  }
  return null
}

/**
 * When a habit is marked done: the routine blocks of that day it backs, still open, to mark (only used when the
 * person turned "Marcar a rotina com registros" on). The first block of each kind, so one session marks one block.
 */
export function blocksBackedBy(plan: RoutinePlan | undefined, habit: Habit, date: string, completions: Completion[]): RoutineBlock[] {
  if (!plan) return []
  const day = weekdayOfDate(date)
  const open = plan.blocks
    .filter((b) => b.day === day && backs(habit, b))
    .filter((b) => !completions.some((c) => c.id === completionId('routine', b.id, date)) && !plan.done[date]?.includes(b.id))
    .sort((a, b) => a.start.localeCompare(b.start))
  return open.slice(0, 1)
}
