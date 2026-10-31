/**
 * Cadastro inteligente: one natural sentence → the fields of a task, appointment, habit or recurring item, for the
 * person to check in the usual form. Local word rules on top of the Assistente's date/time reader (no AI, works
 * offline). Only what was written is used: a missing date stays missing, an hour that could be morning or
 * afternoon ("às 3") is asked, and nothing is saved here.
 */
import type { RecurrenceRule, Weekday } from '../data/types'
import { readDate, readTime } from './assistant/intents'
import { addDaysToDate } from './period'
import { removePhrase } from './quickParse'

export type CaptureKind = 'task' | 'event' | 'habit' | 'recurring'

export interface CaptureDraft {
  kind: CaptureKind
  title: string
  /** Task: due date · appointment: its day · recurring/habit: first day (only when written). */
  date?: string
  time?: string
  end?: string
  rule?: RecurrenceRule
  /** Habit session length ("20 minutos"). */
  minutes?: number
  /** "até sexta": the date is a deadline. */
  deadline?: boolean
  /** Questions before the form: an hour that could be either (03:00 or 15:00)… */
  timeOptions?: [string, string]
  /** …an appointment without a day… */
  needsDate?: boolean
  /** …"toda semana" without the weekday, "todo mês" without the day. */
  needsWeekday?: boolean
  needsMonthDay?: boolean
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[?!;]+/g, ' ')
    .replace(/[.,](?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const pad = (n: number) => String(n).padStart(2, '0')
const DAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
const DAY = `(domingo|segunda|terca|quarta|quinta|sexta|sabado)s?(?:-feiras?)?`

const EVENT_WORDS = ['reuniao', 'consulta', 'dentista', 'medico', 'medica', 'compromisso', 'aula', 'entrevista', 'call', 'encontro', 'evento', 'exame', 'jantar', 'almoco', 'festa', 'voo', 'treino', 'academia', 'cabeleireiro', 'barbeiro', 'terapia', 'fisioterapia', 'show', 'cinema']
const LEAD = /^(?:eu\s+)?(?:tenho que|tenho de|tenho|vou ter|preciso de|preciso|quero|queria|me lembra de|me lembre de|lembrar de|lembra de|lembrete|agendar|agenda|marcar|marca|criar|cria)\s+/
const HABIT = /\b(?:criar |crie |cria |comecar |ter )?(?:o |um |uma )?(?:novo )?habito (?:de |do |da )?/

interface Found {
  /** The folded words to remove from the title. */
  match: string
}

function readRule(t: string): (Found & { rule?: RecurrenceRule; needsWeekday?: boolean; needsMonthDay?: boolean }) | null {
  let m = t.match(/\b(?:todo mes (?:no )?dia|todo dia|mensalmente (?:no )?dia|no dia) (\d{1,2})(?: de (?:cada|todo) mes)?\b/) ?? t.match(/\bdia (\d{1,2}) de (?:cada|todo) mes\b/)
  if (m && (/^(todo|mensal)/.test(m[0]) || /mes$/.test(m[0]))) {
    const d = Number(m[1])
    if (d >= 1 && d <= 31) return { match: m[0], rule: { type: 'monthly', dayOfMonth: d } }
  }
  m = t.match(/\ba cada (\d{1,2}) (dias|semanas)\b/)
  if (m && Number(m[1]) >= 1) return { match: m[0], rule: { type: 'interval', every: Number(m[1]), unit: m[2] === 'dias' ? 'day' : 'week' } }
  m = t.match(/\b(?:de segunda a sexta|dias uteis|em dias de semana|durante a semana)\b/)
  if (m) return { match: m[0], rule: { type: 'weekdays', days: [1, 2, 3, 4, 5] } }
  m = t.match(new RegExp(`\\b(?:toda|todas as|todo|todos os|as|aos|nas|nos) ${DAY}((?:\\s*(?:,|e)?\\s*(?:as |aos |nas |nos |a |na |no )?${DAY})*)`))
  if (m && /^(toda|todo)/.test(m[0]) || (m && /s(-feiras)?\b/.test(m[0].split(' ')[1] ?? ''))) {
    const days = [...new Set([...m[0].matchAll(new RegExp(DAY, 'g'))].map((x) => DAYS.indexOf(x[1]) as Weekday))].sort()
    return { match: m[0], rule: { type: 'weekdays', days } }
  }
  // Etapa 4: a list of two or more days ("treino segunda, quarta e sexta") repeats on those days.
  m = t.match(new RegExp(`\\b${DAY}(?:\\s*(?:,|e)?\\s*${DAY})+\\b`))
  if (m) {
    const days = [...new Set([...m[0].matchAll(new RegExp(DAY, 'g'))].map((x) => DAYS.indexOf(x[1]) as Weekday))].sort()
    if (days.length >= 2) return { match: m[0], rule: { type: 'weekdays', days } }
  }
  m = t.match(/\b(?:todos os dias|todo dia|diariamente|por dia|cada dia|uma vez por dia|1 vez por dia)\b/)
  if (m) return { match: m[0], rule: { type: 'daily' } }
  m = t.match(/\b(?:toda semana|todas as semanas|semanalmente|uma vez por semana|1 vez por semana|por semana)\b/)
  if (m) return { match: m[0], needsWeekday: true }
  m = t.match(/\b(?:todo mes|todos os meses|mensalmente|uma vez por mes|por mes)\b/)
  if (m) return { match: m[0], needsMonthDay: true }
  return null
}

function readDuration(t: string): (Found & { minutes: number }) | null {
  let m = t.match(/\b(\d{1,3}) ?(?:min|mins|minuto|minutos)\b/)
  if (m && Number(m[1]) > 0) return { match: m[0], minutes: Number(m[1]) }
  m = t.match(/\b(uma|meia|\d) ?(?:hora|horas)\b/)
  if (m) return { match: m[0], minutes: m[1] === 'meia' ? 30 : m[1] === 'uma' ? 60 : Number(m[1]) * 60 }
  return null
}

type Period = 'morning' | 'afternoon' | 'night' | null

function readPeriod(t: string): (Found & { period: Period }) | null {
  const m = t.match(/\b(?:da|de|pela|a|na) (manha|madrugada|tarde|noite)\b/)
  if (!m) return null
  return { match: m[0], period: m[1] === 'manha' || m[1] === 'madrugada' ? 'morning' : m[1] === 'tarde' ? 'afternoon' : 'night' }
}

function shift(time: string, period: Period): string {
  const h = Number(time.slice(0, 2))
  if ((period === 'afternoon' || period === 'night') && h < 12) return `${pad(h + 12)}${time.slice(2)}`
  return time
}

const plusHour = (time: string) => {
  const m = Math.min(Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + 60, 23 * 60 + 59)
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export function parseCapture(text: string, today: string): CaptureDraft {
  let title = text.trim().replace(/\s+/g, ' ')
  let t = fold(title)
  const cut = (phrase: string) => {
    title = removePhrase(title, phrase.trim())
    t = fold(title)
  }

  const habit = HABIT.exec(t)
  if (habit) cut(habit[0])
  const lead = LEAD.exec(t)
  const said = lead?.[0].trim() ?? ''
  if (lead) cut(lead[0])
  // "quero criar o hábito de…" also starts with the lead word.
  const habit2 = !habit ? HABIT.exec(t) : null
  if (habit2) cut(habit2[0])
  const isHabit = Boolean(habit || habit2)

  const draft: CaptureDraft = { kind: 'task', title: '' }

  const duration = readDuration(t)
  if (duration) {
    draft.minutes = duration.minutes
    cut(duration.match)
  }
  const rule = readRule(t)
  if (rule) {
    if (rule.rule) draft.rule = rule.rule
    if (rule.needsWeekday) draft.needsWeekday = true
    if (rule.needsMonthDay) draft.needsMonthDay = true
    cut(rule.match)
  }

  // A range first ("das 15h às 16h30"), then a single time.
  const period = readPeriod(t)
  const range = t.match(/\b(?:das|de) ([01]?\d|2[0-3])(?:[:h]([0-5]\d))?h? (?:as|ate|a) ([01]?\d|2[0-3])(?:[:h]([0-5]\d))?h?\b/)
  let time: string | undefined
  let explicitZero = false
  if (range) {
    time = `${pad(Number(range[1]))}:${range[2] ?? '00'}`
    draft.end = `${pad(Number(range[3]))}:${range[4] ?? '00'}`
    explicitZero = /^0/.test(range[1])
    cut(range[0])
  } else if (/\bmeio[ -]dia\b/.test(t)) {
    time = '12:00'
    explicitZero = true
    cut(t.match(/\b(?:ao |as |a )?meio[ -]dia\b/)![0])
  } else {
    const tm = readTime(t)
    if (tm) {
      time = tm.time
      explicitZero = /\b0\d/.test(tm.match) || Number(tm.time.slice(0, 2)) === 0
      cut(tm.match)
    }
  }
  if (time) {
    if (period) {
      time = shift(time, period.period)
      if (draft.end) draft.end = shift(draft.end, period.period)
      cut(period.match)
    } else {
      const h = Number(time.slice(0, 2))
      // "às 3" is probably 15:00, but it isn't written: ask instead of guessing.
      if (h >= 1 && h <= 6 && !explicitZero) draft.timeOptions = [time, `${pad(h + 12)}${time.slice(2)}`]
    }
  } else if (period) {
    // "à noite" without an hour: a moment of the day is not a time. Kept in the title? No: just dropped.
    cut(period.match)
  }
  if (draft.end && time && draft.end <= time) delete draft.end

  const date = readDate(t, today)
  if (date) {
    draft.date = date.date
    // "até sexta", "antes do dia 10": a deadline (the word goes with the date).
    const prep = t.slice(0, t.indexOf(date.match)).match(/\b(?:ate|antes de|antes do|antes da)(?: o| a| na| no)?\s*$/)
    if (prep) draft.deadline = true
    cut(prep ? `${prep[0].trim()} ${date.match}` : date.match)
  }

  if (!draft.timeOptions && time) draft.time = time

  const words = fold(text)
  const eventy = EVENT_WORDS.some((w) => new RegExp(`\\b${w}\\b`).test(words))
  if (isHabit) draft.kind = 'habit'
  else if (draft.rule || draft.needsWeekday || draft.needsMonthDay) draft.kind = 'recurring'
  else if (!draft.deadline && (eventy || ((said === 'tenho' || said === 'vou ter') && (time || draft.timeOptions)))) draft.kind = 'event'
  else draft.kind = 'task'

  if (draft.kind === 'event') {
    if (!draft.date) draft.needsDate = true
    if (draft.time && !draft.end) draft.end = plusHour(draft.time)
  }
  if (draft.kind === 'task' && (draft.time || draft.timeOptions) && !draft.date) draft.needsDate = true
  if (draft.kind !== 'habit') delete draft.minutes

  title = title
    .replace(/\s+/g, ' ')
    .replace(/^(?:de|do|da|para|pra|a|o|um|uma)\s+/i, '')
    .replace(/\s+(?:as|às|para|pra|no|na|de|do|da|em|até|ate|e|que)\s*$/i, '')
    .replace(/^[,;:\s-]+|[,;:.!?\s-]+$/g, '')
  draft.title = cap(title)
  return draft
}

/** Applies the answers of the preview to the draft (an hour chosen, a day picked). */
export function answerCapture(draft: CaptureDraft, answer: { time?: string; date?: string; weekday?: Weekday; monthDay?: number }): CaptureDraft {
  const next = { ...draft }
  if (answer.time) {
    next.time = answer.time
    delete next.timeOptions
    if (next.kind === 'event' && !next.end) next.end = plusHour(answer.time)
    else if (next.kind === 'event' && next.end && next.end <= answer.time) next.end = plusHour(answer.time)
  }
  if (answer.date) {
    next.date = answer.date
    delete next.needsDate
  }
  if (answer.weekday !== undefined) {
    next.rule = { type: 'weekdays', days: [answer.weekday] }
    delete next.needsWeekday
  }
  if (answer.monthDay) {
    next.rule = { type: 'monthly', dayOfMonth: answer.monthDay }
    delete next.needsMonthDay
  }
  return next
}

/** True while something important is still missing (the form would otherwise be opened half-filled). */
export function captureQuestions(d: CaptureDraft): ('time' | 'date' | 'weekday' | 'monthDay')[] {
  return [d.timeOptions && 'time', d.needsDate && 'date', d.needsWeekday && 'weekday', d.needsMonthDay && 'monthDay'].filter(Boolean) as ('time' | 'date' | 'weekday' | 'monthDay')[]
}

/** "amanhã", "hoje", "sex., 6 nov." — for the preview chips. */
export function dayWords(date: string, today: string): string {
  if (date === today) return 'Hoje'
  if (date === addDaysToDate(today, 1)) return 'Amanhã'
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}
