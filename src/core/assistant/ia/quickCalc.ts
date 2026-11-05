/**
 * Simple savings calculations answered by the APP itself — instant, free, offline, exact.
 *
 * "Quanto preciso guardar por mês para juntar R$ 150 mil até dezembro de 2027?" needs no data and no AI:
 * one amount the person typed, one deadline the person typed, a division. Anything else (an existing goal,
 * money already saved, interest, several amounts or dates) is left to the AI.
 *
 * Rule (said in the answer): monthly deposits from THIS month to the deadline month, inclusive; weekly
 * deposits = whole weeks until the deadline; starting from zero, no interest; rounded UP to the cent
 * (saving that amount reaches the target).
 */
import { FactBook, type Fact } from '../../../../supabase/functions/_shared/ia/facts.ts'
import { formatMoney } from '../../../lib/money'
import { questionDates, questionFacts } from './calc'

const ASK = /\bquanto\s+(eu\s+)?(preciso|precisaria|tenho que|teria que|devo|deveria)\s+(guardar|juntar|economizar|poupar|separar|reservar)\b/
/** Needs the person's data or assumptions the app does not know: the AI answers. */
const NEEDS_DATA = /\bmeta\b|\bmetas\b|j[aá] (tenho|guardei|juntei|economizei)|tenho guardad|rend(a|imento|er)|juros|investi|poupan[cç]a rende|cdi|selic|infla[cç]/

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const monthLabel = (y: number, m: number) => `${MONTHS[m - 1]} de ${y}`
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

export interface QuickAnswer {
  lines: string[]
}

export function quickSavings(question: string, today: string): QuickAnswer | null {
  const q = question.toLowerCase()
  if (!ASK.test(q) || NEEDS_DATA.test(q)) return null
  const book = new FactBook()
  questionFacts(question, book, { baseCurrency: 'BRL' })
  const money = [...book.all.values()].filter((f) => f.kind === 'dinheiro')
  const dates = new FactBook()
  questionDates(question, dates, today)
  const when = [...dates.all.values()]
  if (money.length !== 1 || when.length !== 1 || !money[0].amount || money[0].amount.cents <= 0) return null

  const ty = Number(today.slice(0, 4))
  const tm = Number(today.slice(5, 7))
  const deadline = deadlineOf(when[0], today)
  if (!deadline) return null
  const [dy, dm, dd] = deadline
  const months = (dy - ty) * 12 + (dm - tm) + 1
  const days = Math.round((Date.UTC(dy, dm - 1, dd) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  if (months < 1 || days < 1 || months > 600) return null

  const { cents, currency } = money[0].amount
  const perMonth = Math.ceil(cents / months)
  const weeks = Math.max(1, Math.ceil(days / 7))
  const perWeek = Math.ceil(cents / weeks)
  const total = formatMoney(cents, currency)
  const until = when[0].month ? `até ${when[0].display}` : `até ${String(dd).padStart(2, '0')}/${String(dm).padStart(2, '0')}/${dy}`
  const weekly = /por semana|semanal/.test(q)
  const first = weekly
    ? `Para juntar ${total} ${until}, guarde ${formatMoney(perWeek, currency)} por semana (${weeks} ${weeks === 1 ? 'semana' : 'semanas'}).`
    : `Para juntar ${total} ${until}, guarde ${formatMoney(perMonth, currency)} por mês.`
  const basis = weekly
    ? 'Partindo do zero e sem rendimentos, arredondado para cima ao centavo.'
    : `São ${months} ${months === 1 ? 'mês' : 'meses'}, contando este (${monthLabel(ty, tm)}) até ${monthLabel(dy, dm)}, partindo do zero e sem rendimentos.`
  return { lines: [first, basis] }
}

/** [year, month, day] of the deadline the person typed, in the future (a month → its last day). */
function deadlineOf(f: Fact, today: string): [number, number, number] | null {
  if (f.month) {
    const [y, m] = f.month.split('-').map(Number)
    return [y, m, lastDay(y, m)]
  }
  const m = f.display.match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/)
  if (!m) return null
  const d = Number(m[1])
  const mo = Number(m[2])
  let y = m[3] ? Number(m[3]) : Number(today.slice(0, 4))
  if (!m[3] && `${y}-${m[2]}-${m[1]}` <= today) y += 1
  if (d > lastDay(y, mo)) return null
  return `${y}-${m[2]}-${m[1]}` > today ? [y, mo, d] : null
}
