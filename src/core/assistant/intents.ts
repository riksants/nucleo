/**
 * Deterministic command reader (Portuguese). Turns a sentence into a
 * structured intent; it never touches data. The optional AI interpreter
 * (off by default) returns the same Intent shape, validated by `parseIntent`.
 */
import { Intent, parseIntent } from '../../../supabase/functions/_shared/assistant/intent.ts'
import { addDaysToDate, weekdayOfDate } from '../period'

export { Intent, parseIntent }

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[?!.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/** "hoje", "amanhã", "depois de amanhã", "sexta", "dia 15", "15/10", "até dezembro" → date (or null). */
export function readDate(t: string, today: string): { date: string; match: string } | null {
  let m = t.match(/\bdepois de amanha\b/)
  if (m) return { date: addDaysToDate(today, 2), match: m[0] }
  m = t.match(/\bamanha\b/)
  if (m) return { date: addDaysToDate(today, 1), match: m[0] }
  m = t.match(/\bhoje\b/)
  if (m) return { date: today, match: m[0] }
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  if (m) {
    const y0 = Number(today.slice(0, 4))
    let y = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : y0
    const mo = Number(m[2])
    const d = Number(m[1])
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= lastDay(y, mo)) {
      let date = `${y}-${pad(mo)}-${pad(d)}`
      if (!m[3] && date < today) date = `${++y}-${pad(mo)}-${pad(d)}`
      return { date, match: m[0] }
    }
  }
  m = t.match(/\b(?:(?:na|no|nesta|neste|proxima|proximo)\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\b/)
  if (m) {
    const target = WEEKDAYS.indexOf(m[1])
    const diff = (target - weekdayOfDate(today) + 7) % 7
    return { date: addDaysToDate(today, diff), match: m[0] }
  }
  m = t.match(/\bdia (\d{1,2})\b/)
  if (m) {
    const d = Number(m[1])
    let y = Number(today.slice(0, 4))
    let mo = Number(today.slice(5, 7))
    if (d < Number(today.slice(8, 10))) {
      mo++
      if (mo > 12) {
        mo = 1
        y++
      }
    }
    if (d >= 1 && d <= lastDay(y, mo)) return { date: `${y}-${pad(mo)}-${pad(d)}`, match: m[0] }
  }
  m = t.match(new RegExp(`\\b(?:ate|em|para) (?:o fim de |o final de )?(${MONTHS.join('|')})(?: de (\\d{4}))?\\b`))
  if (m) {
    const mo = MONTHS.indexOf(m[1]) + 1
    let y = m[2] ? Number(m[2]) : Number(today.slice(0, 4))
    if (!m[2] && `${y}-${pad(mo)}-${pad(lastDay(y, mo))}` < today) y++
    return { date: `${y}-${pad(mo)}-${pad(lastDay(y, mo))}`, match: m[0] }
  }
  return null
}

/** "às 18h", "18:30", "as 9", "18h30" → "HH:MM" (or null). */
export function readTime(t: string): { time: string; match: string } | null {
  const m = t.match(/\b(?:as |a partir das |pelas )?([01]?\d|2[0-3])(?:(?::|h)([0-5]\d)|h)\b/) ?? t.match(/\bas ([01]?\d|2[0-3])\b/)
  if (!m) return null
  return { time: `${pad(Number(m[1]))}:${m[2] ?? '00'}`, match: m[0] }
}

/** "R$5.000", "5000 reais", "5 mil", "R$ 1.234,56" → cents. */
export function readMoney(t: string): number | null {
  const m = t.match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(mil)?\s*(?:reais)?/)
  if (!m || (!t.includes('r$') && !m[3] && !/reais/.test(t))) return null
  let v = Number(m[1].replace(/\./g, '')) + (m[2] ? Number(m[2].padEnd(2, '0')) / 100 : 0)
  if (m[3]) v *= 1000
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
/** Original casing of a piece found in the normalized text (best effort). */
function original(source: string, norm: string, piece: string): string {
  const i = norm.indexOf(piece)
  return i >= 0 ? source.trim().slice(i, i + piece.length) : piece
}

const EVENT_WORDS = ['reuniao', 'consulta', 'dentista', 'medico', 'compromisso', 'aula', 'entrevista', 'call', 'encontro', 'evento', 'exame', 'jantar', 'almoco', 'festa', 'voo']

/** Sentence → intent. Patterns first; anything unclear → unknown (never a guess that writes). */
export function readIntent(text: string, today: string): Intent {
  const src = text.trim().replace(/\s+/g, ' ')
  const t = strip(src)
  if (!t) return { type: 'unknown' }
  if (/^(ajuda|help|o que (voce|vc) (faz|sabe fazer)|comandos)$/.test(t)) return { type: 'help' }

  if (/\b(re)?organiz\w*|distribu\w*\b/.test(t) && /\b(dia|hoje)\b/.test(t)) return { type: 'reorganizeDay' }
  if (/\b(re)?organiz\w*|distribu\w*\b/.test(t) && /\bsemana\b/.test(t)) return { type: 'reorganizeWeek' }

  // Writes (checked before reads, they are more specific)
  let m = t.match(/^(?:apaga|apague|exclui|exclua|remove|remova|deleta|delete)\s+(?:a\s+)?tarefa\s+(.+)$/)
  if (m) return { type: 'deleteTask', query: original(src, t, m[1]) }
  m = t.match(/^(?:conclui|concluir|marca como feita|marcar como feita|terminei|finaliza)\s+(?:a\s+)?(?:tarefa\s+)?(.+)$/)
  if (m) return { type: 'completeTask', query: original(src, t, m[1]) }
  m = t.match(/^(?:move|mova|mover|passa|passe|joga|empurra|adia|adie|remarca|remarque)\s+(?:a\s+)?(?:tarefa\s+)?(.+?)\s+(?:para|pra)\s+(.+)$/)
  if (m) {
    const d = readDate(m[2], today)
    const tm = readTime(m[2])
    if (d) return { type: 'moveTask', query: original(src, t, m[1]), date: d.date, ...(tm ? { time: tm.time } : {}) }
  }

  // Finance goal: "quero guardar R$5.000 até dezembro" (with a date) — weekly when "esta semana"
  if (/\b(guardar|juntar|economizar)\b/.test(t)) {
    const value = readMoney(t)
    if (value && /\b(esta|nesta|essa) semana\b/.test(t)) return { type: 'createWeeklyGoal', metric: 'finance.saved', target: value, title: '' }
    const d = readDate(t, today)
    if (value && d && d.date > today) {
      const nm = t.match(/\b(?:para|pra) (?:a |o |uma |um )?(?!o fim|o final)([a-z ]{3,40}?)(?: ate| em|$)/)
      return { type: 'createFinanceGoal', name: nm ? cap(original(src, t, nm[1]).trim()) : `Guardar até ${d.date.slice(8, 10)}/${d.date.slice(5, 7)}`, target: value, deadline: d.date }
    }
  }

  // Weekly goal: "cria uma meta de treinar 4 vezes esta semana"
  m = t.match(/\bmeta (?:semanal )?de (treinar|estudar|ler|concluir|fazer) (\d{1,3}) ?(vezes|dias|tarefas|x)?\b/)
  if (m) {
    const metric = m[1] === 'treinar' ? 'training.days' : m[1] === 'estudar' ? 'study.days' : m[1] === 'concluir' || m[3] === 'tarefas' ? 'tasks.completed' : null
    return { type: 'createWeeklyGoal', metric, target: Number(m[2]), title: cap(`${m[1]} ${m[2]} ${m[3] === 'x' || !m[3] ? 'vezes' : m[3]}`) }
  }

  // Habit: "cria um hábito de beber água"
  m = t.match(/\b(?:cria|crie|criar|novo|adiciona)\s+(?:um\s+)?habito\s+(?:de\s+)?(.+)$/)
  if (m) return { type: 'createHabit', name: cap(original(src, t, m[1])) }

  // Appointment: "tenho reunião amanhã às 18h"
  if (/^(tenho|vou ter|marca|marque|agenda|agende)\b/.test(t) && EVENT_WORDS.some((w) => t.includes(w))) {
    const d = readDate(t, today)
    const tm = readTime(t)
    if (d && tm) {
      let title = t
        .replace(/^(tenho|vou ter|marca|marque|agenda|agende)\s+(uma?\s+)?/, '')
        .replace(d.match, '')
        .replace(tm.match, '')
        .replace(/\s+(as|a|no|na|de)\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim()
      title = original(src, t, title) || title
      const end = `${pad(Math.min(23, Number(tm.time.slice(0, 2)) + 1))}:${tm.time.slice(3)}`
      return { type: 'createEvent', title: cap(title), date: d.date, start: tm.time, end }
    }
  }

  // Task: "coloca comprar passagem nas minhas tarefas", "cria tarefa ligar pro banco amanhã"
  m = t.match(/^(?:coloca|coloque|adiciona|adicione|poe|bota|inclui)\s+(.+?)\s+(?:nas?|em)\s+(?:minhas\s+)?tarefas\b(.*)$/) ?? t.match(/^(?:cria|crie|criar|nova|anota|anote)\s+(?:uma\s+)?tarefa:?\s+(.+?)()$/) ?? t.match(/^(?:me )?lembr\w* de\s+(.+?)()$/)
  if (m) {
    let rest = `${m[1]} ${m[2] ?? ''}`.trim()
    const d = readDate(rest, today)
    const tm = readTime(rest)
    if (d) rest = rest.replace(d.match, '')
    if (tm) rest = rest.replace(tm.match, '')
    rest = rest.replace(/\s+(para|pra|no|na|de|as)\s*$/, '').replace(/\s+/g, ' ').trim()
    if (rest) return { type: 'createTask', title: cap(original(src, t, rest) || rest), ...(d ? { date: d.date } : {}), ...(tm ? { time: tm.time } : {}) }
  }

  // Reads
  if (/\bo que mudou\b/.test(t)) return { type: 'changes', period: /\bmes\b/.test(t) ? 'month' : 'week' }
  if (/\b(gast\w*|financeiro|dinheiro|saldo)\b/.test(t)) return { type: 'finance', period: /\bmes\b/.test(t) || /resumo financeiro/.test(t) ? 'month' : 'week' }
  if (/\bmetas?\b/.test(t)) return { type: 'goals' }
  m = t.match(/\b(?:como (?:esta|anda|vai)|status d[oa]|ver)\s+(?:o |a |meu |minha )*(?:projeto|objetivo)\s+(?:da |do |de |sobre )?(.+)$/)
  if (m) return { type: 'plan', query: original(src, t, m[1]) }
  if (/\b(sugest\w*|atencao|alertas?)\b/.test(t)) return { type: 'insights' }
  if (/\b(minha semana|resumo da semana|esta semana|essa semana|semana)\b/.test(t) && !/\b(tenho|agenda)\b.*\b(amanha|hoje)\b/.test(t)) return { type: 'week' }
  const d = readDate(t, today)
  if (d && /\b(tenho|agenda|fazer|compromissos?|tarefas?|programado|o que)\b/.test(t)) return { type: 'day', date: d.date }
  if (/\b(o que (eu )?tenho|agenda|meu dia)\b/.test(t)) return { type: 'day', date: today }
  return { type: 'unknown' }
}
