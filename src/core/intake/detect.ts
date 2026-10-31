/**
 * Importação inteligente (Etapa 4) — step 2: what a document probably is, and the records it would become.
 * Each detector is local and explains itself; the best ones are offered, the person chooses and corrects.
 *
 * Nothing is lost silently: every line of the document is either part of an item (kept as written — times,
 * quantities, exercises, sets, reps, loads, notes) or listed as "não reconhecido", and those lines can be kept
 * in a note. Nothing is invented: a missing day, time or value stays missing.
 *
 * A future NÚCLEO IA is just one more detector returning the same `Proposal` (validated the same way).
 */
import type { MealType, RecurrenceRule, Weekday } from '../../data/types'
import { readDate, readTime } from '../assistant/intents'
import { parseCapture } from '../capture'
import { guessMapping } from '../import/csv'
import { readPastedLines } from '../import/pasted'
import { parseMealText } from '../mealText'
import { weekStart } from '../period'
import { foldSame } from '../smart/amount'

export type TargetId = 'meals' | 'training' | 'schedule' | 'finance' | 'project' | 'shopping' | 'note'

export const TARGET_LABEL: Record<TargetId, string> = {
  meals: 'Plano alimentar → Alimentação',
  training: 'Treino → Recorrentes e ficha em Anotações',
  schedule: 'Agenda e rotina → Compromissos, Recorrentes e Tarefas',
  finance: 'Movimentações → Importar extrato',
  project: 'Planejamento → Projeto com tarefas',
  shopping: 'Lista de compras → Alimentação',
  note: 'Só guardar como anotação',
}

export type IntakeItem =
  | { key: string; kind: 'meal'; include: boolean; date: string; time: string; type: string; name: string; ingredients: string[]; source: string; problem?: string }
  | { key: string; kind: 'recurring'; include: boolean; title: string; rule: RecurrenceRule; time: string; notes: string; source: string }
  | { key: string; kind: 'event'; include: boolean; title: string; date: string; start: string; end: string; source: string }
  | { key: string; kind: 'task'; include: boolean; title: string; dueDate: string; dueTime: string; notes: string; source: string }
  | { key: string; kind: 'note'; include: boolean; title: string; body: string; source: string }
  | { key: string; kind: 'shopping'; include: boolean; name: string; qty: string; unit: string; source: string }
  | { key: string; kind: 'project'; include: boolean; name: string; dueDate: string; notes: string; source: string }

export interface Unrecognised {
  line: string
  why: string
}

export interface Proposal {
  target: TargetId
  /** 0..1: how much of the document this reading explains. */
  score: number
  items: IntakeItem[]
  unrecognised: Unrecognised[]
  /** What the person should know ("dias não encontrados: escolha no recorrente"). */
  notes: string[]
}

export interface DetectCtx {
  today: string
  mealTypes: MealType[]
  /** For the allergy check of meals (same as the meal form). */
  mealProblem?(foods: string[]): string | null
  /** File name or "Texto colado" (a default title). */
  title: string
}

const DAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
const DAY_RE = /\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)s?(?:-feiras?)?\b/g
const fold = (s: string) => foldSame(s).replace(/\s+/g, ' ').trim()
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const keyOf = (target: TargetId, i: number) => `${target}:${i}`

const weekdaysIn = (line: string): Weekday[] => [...new Set([...fold(line).matchAll(DAY_RE)].map((m) => DAYS.indexOf(m[1]) as Weekday))].sort()

// ---------------------------------------------------------------- treino

const SETS = /(\d{1,2})\s*(?:x|×|séries?\s*(?:de)?|series?\s*(?:de)?)\s*(\d{1,3}(?:\s*(?:-|–|a)\s*\d{1,3})?)\s*(?:rep\w*|repeti\w*)?/i
const LOAD = /\b\d+(?:[.,]\d+)?\s*(?:kg|quilos?|lbs?)\b/i
const REST = /\b(descanso|intervalo|pausa)\b/i
const NOTE = /^\s*(obs|observa\w*|nota|dica|importante|aten\w*)\b\s*[:\-–]?/i

function detectTraining(lines: string[]): Proposal {
  type Block = { title: string; days: Weekday[]; time: string; exercises: string[]; notes: string[]; header: string }
  const blocks: Block[] = []
  const unrecognised: Unrecognised[] = []
  let cur: Block | null = null
  let exercises = 0
  for (const line of lines) {
    const f = fold(line)
    if (SETS.test(line) || (LOAD.test(line) && /[a-z]{3}/i.test(line))) {
      if (!cur) blocks.push((cur = { title: 'Treino', days: [], time: '', exercises: [], notes: [], header: '' }))
      cur.exercises.push(line.trim().replace(/^[-•*\d.)\s]+(?=\D)/, ''))
      exercises++
      continue
    }
    if (NOTE.test(line) || REST.test(f)) {
      if (cur) cur.notes.push(line.trim())
      else unrecognised.push({ line, why: 'observação antes de qualquer treino' })
      continue
    }
    const isHeader = /\b(treino|ficha|dia|divisao|aerobico|cardio)\b/.test(f) || weekdaysIn(line).length > 0 || /^[A-E]\s*[:\-–)]/.test(line.trim()) || /:\s*$/.test(line)
    if (isHeader && line.trim().length <= 80) {
      const tm = readTime(f)
      blocks.push((cur = { title: cap(line.trim().replace(/[:\-–]+\s*$/, '')), days: weekdaysIn(line), time: tm?.time ?? '', exercises: [], notes: [], header: line }))
      continue
    }
    unrecognised.push({ line, why: 'não parece exercício nem título de treino' })
  }
  const items: IntakeItem[] = []
  const notes: string[] = []
  let k = 0
  for (const b of blocks.filter((x) => x.exercises.length)) {
    const sheet = [...b.exercises.map((e) => `- [ ] ${e}`), ...(b.notes.length ? ['', ...b.notes.map((n) => `- ${n}`)] : [])].join('\n')
    items.push({ key: keyOf('training', k++), kind: 'note', include: true, title: `Ficha: ${b.title}`, body: [b.header && b.header !== b.title ? b.header : '', sheet].filter(Boolean).join('\n'), source: b.header || b.title })
    if (b.days.length) items.push({ key: keyOf('training', k++), kind: 'recurring', include: true, title: b.title, rule: { type: 'weekdays', days: b.days }, time: b.time, notes: b.exercises.join('\n'), source: b.header })
    else notes.push(`“${b.title}”: os dias da semana não estão no documento — a ficha vai para Anotações; crie o recorrente com os dias quando quiser.`)
  }
  for (const b of blocks.filter((x) => !x.exercises.length)) unrecognised.push({ line: b.header || b.title, why: 'título sem exercícios embaixo' })
  return { target: 'training', score: lines.length ? Math.min(1, (exercises * 1.2) / lines.length) : 0, items, unrecognised, notes }
}

// ---------------------------------------------------------------- refeições

const MEAL_WORD = /\b(cafe da manha|desjejum|colacao|lanche|almoco|jantar|ceia|pre[- ]treino|pos[- ]treino|refeicao)\b/

function detectMeals(lines: string[], ctx: DetectCtx): Proposal {
  const week = weekStart(ctx.today)
  const drafts = parseMealText(lines.join('\n'), { date: ctx.today, week, types: ctx.mealTypes })
  const items: IntakeItem[] = []
  const unrecognised: Unrecognised[] = []
  const used = new Set<string>()
  drafts.forEach((d, i) => {
    // A meal needs a meal word or type ("Almoço", "Lanche"): a time or a list alone is not a meal (a training sheet has both).
    const meaningful = Boolean(d.type) || MEAL_WORD.test(fold(d.source))
    used.add(d.source)
    if (!meaningful) {
      unrecognised.push({ line: d.source, why: 'não tem horário, tipo de refeição nem alimentos' })
      return
    }
    const problem = ctx.mealProblem?.([d.name, ...d.ingredients]) ?? null
    items.push({ key: keyOf('meals', i), kind: 'meal', include: !problem, date: d.date, time: d.time, type: d.type, name: d.name, ingredients: d.ingredients, source: d.source, ...(problem ? { problem } : {}) })
  })
  const headings = lines.filter((l) => !used.has(l.trim()) && weekdaysIn(l).length).length
  const notes = headings ? [] : ['O documento não separa por dia da semana: as refeições vão para hoje. Mude a data na Alimentação, se precisar.']
  return { target: 'meals', score: lines.length ? Math.min(1, (items.length + headings) / lines.length) : 0, items, unrecognised, notes }
}

// ---------------------------------------------------------------- agenda, rotina e estudos

function detectSchedule(lines: string[], ctx: DetectCtx): Proposal {
  const items: IntakeItem[] = []
  const unrecognised: Unrecognised[] = []
  let hits = 0
  lines.forEach((line, i) => {
    const c = parseCapture(line.replace(/\t+/g, ' ').replace(/^[-•*\d.)\s]+(?=\D)/, ''), ctx.today)
    const timed = Boolean(c.rule || c.date || c.time || c.timeOptions)
    if (!timed || !c.title) {
      unrecognised.push({ line, why: 'sem dia, data ou horário' })
      return
    }
    hits++
    const time = c.time ?? c.timeOptions?.[0] ?? ''
    if (c.rule) items.push({ key: keyOf('schedule', i), kind: 'recurring', include: true, title: c.title, rule: c.rule, time, notes: '', source: line })
    else if (c.kind === 'event' && c.date && time) items.push({ key: keyOf('schedule', i), kind: 'event', include: true, title: c.title, date: c.date, start: time, end: c.end ?? '', source: line })
    else items.push({ key: keyOf('schedule', i), kind: 'task', include: true, title: c.title, dueDate: c.date ?? '', dueTime: c.date ? time : '', notes: '', source: line })
  })
  const notes = items.some((x) => x.kind !== 'recurring' && !('date' in x && x.date) && !('dueDate' in x && x.dueDate)) ? ['Linhas com horário mas sem dia viraram tarefas sem data: escolha o dia depois.'] : []
  return { target: 'schedule', score: lines.length ? hits / lines.length : 0, items, unrecognised, notes }
}

// ---------------------------------------------------------------- projeto (etapas e prazos)

const STEP = /^\s*(?:\d{1,2}[.)-]|[-•*]|etapa\s*\d*|fase\s*\d*|passo\s*\d*|entrega\b|semana\s*\d+)/i

function detectProject(lines: string[], ctx: DetectCtx): Proposal {
  const items: IntakeItem[] = []
  const unrecognised: Unrecognised[] = []
  const first = lines.find((l) => !STEP.test(l)) ?? ctx.title
  let steps = 0
  let last = ''
  lines.forEach((line, i) => {
    if (line === first) return
    if (!STEP.test(line) && !/\b(ate|prazo|entrega)\b/.test(fold(line))) {
      unrecognised.push({ line, why: 'não parece uma etapa' })
      return
    }
    steps++
    const f = fold(line)
    const d = readDate(f, ctx.today)
    const title = cap(line.replace(STEP, '').replace(/^[\s:–-]+/, '').replace(/\s*[-–(]?\s*(?:ate|até|prazo:?|entrega:?)\s*[\d/]+\)?\s*$/i, '').trim()) || line.trim()
    if (d && d.date > last) last = d.date
    items.push({ key: keyOf('project', i + 1), kind: 'task', include: true, title, dueDate: d?.date ?? '', dueTime: '', notes: line.trim() === title ? '' : `No documento: ${line.trim()}`, source: line })
  })
  items.unshift({ key: keyOf('project', 0), kind: 'project', include: true, name: cap(first.replace(/[:\-–]+\s*$/, '').trim()).slice(0, 80), dueDate: last, notes: '', source: first })
  // Numbered or named steps ("1.", "Etapa 2") are what a plan looks like: they win a tie with a plain agenda.
  const numbered = lines.filter((l) => /^\s*(?:\d{1,2}[.)-]|etapa|fase|passo)/i.test(l)).length
  return { target: 'project', score: lines.length ? Math.min(1, steps / lines.length + (numbered >= 2 ? 0.15 : 0)) : 0, items, unrecognised, notes: ['As etapas viram tarefas do projeto, com o prazo escrito em cada uma (sem prazo, ficam sem data).'] }
}

// ---------------------------------------------------------------- lista de compras

const QTY = /^\s*(?:[-•*□☐]\s*)?(\d+(?:[.,]\d+)?|meia|meio|uma?|duas?|dois|tres)?\s*(kg|g|gr|l|lt|ml|un|und|unid|unidades?|pct|pacotes?|cx|caixas?|dz|duzias?|latas?|garrafas?|macos?)?\s*(?:de\s+)?(.+?)\s*$/i

function detectShopping(lines: string[]): Proposal {
  const items: IntakeItem[] = []
  const unrecognised: Unrecognised[] = []
  let hits = 0
  const header = (l: string) => /\b(lista( de compras)?|compras|mercado|supermercado|feira)\b\s*:?\s*$/.test(fold(l))
  lines.forEach((line, i) => {
    if (header(line)) return
    const f = fold(line)
    if (line.trim().length > 60 || readTime(f) || weekdaysIn(line).length || /\d{1,2}\/\d{1,2}/.test(f) || SETS.test(line) || NOTE.test(line)) {
      unrecognised.push({ line, why: 'não parece um item de compra' })
      return
    }
    const m = line.match(QTY)
    const name = cap((m?.[3] ?? line).replace(/^[-•*□☐]\s*/, '').trim())
    if (!name) return
    hits++
    items.push({ key: keyOf('shopping', i), kind: 'shopping', include: true, name: name.slice(0, 120), qty: (m?.[1] ?? '').trim(), unit: (m?.[2] ?? '').trim(), source: line })
  })
  const boost = lines.some(header) ? 0.25 : 0
  return { target: 'shopping', score: lines.length ? Math.min(1, hits / lines.length * 0.85 + boost) : 0, items, unrecognised, notes: [] }
}

// ---------------------------------------------------------------- finanças

function detectFinance(lines: string[], table: string[][] | null, ctx: DetectCtx): Proposal {
  if (table && table.length > 1) {
    const g = guessMapping({ delimiter: ';', rows: table, lineNos: table.map((_, i) => i + 1) })
    const ok = !g.missing.length
    return { target: 'finance', score: ok ? 0.95 : 0, items: [], unrecognised: [], notes: ok ? ['A planilha tem data e valor: ela vai para Importar extrato, com a prévia de sempre (duplicadas, transferências, categorias).'] : [] }
  }
  const r = readPastedLines(lines.join('\n'), ctx.today)
  const n = r?.lines.length ?? 0
  return { target: 'finance', score: lines.length ? n / lines.length : 0, items: [], unrecognised: [], notes: n ? [`${n} linha${n === 1 ? '' : 's'} com data e valor: vão para Importar extrato, com a prévia de sempre.`] : [] }
}

// ---------------------------------------------------------------- everything

/** Every reading that makes sense, best first. "Só guardar como anotação" is always offered last. */
export function detect(input: { lines: string[]; table?: string[][] | null }, ctx: DetectCtx): Proposal[] {
  const lines = input.table ? input.table.map((r) => r.filter(Boolean).join('\t')).filter(Boolean) : input.lines
  const proposals = [detectFinance(lines, input.table ?? null, ctx), detectTraining(lines), detectMeals(lines, ctx), detectSchedule(lines, ctx), detectProject(lines, ctx), detectShopping(lines)]
    .filter((p) => p.score >= 0.34 && (p.items.length || p.target === 'finance'))
    .sort((a, b) => b.score - a.score)
  proposals.push({ target: 'note', score: 0, items: [{ key: 'note:0', kind: 'note', include: true, title: cap(ctx.title.replace(/\.[a-z0-9]{2,4}$/i, '')).slice(0, 80) || 'Documento importado', body: lines.join('\n'), source: ctx.title }], unrecognised: [], notes: ['O documento inteiro vira uma anotação, exatamente como está.'] })
  return proposals
}
