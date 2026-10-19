/**
 * Reads a rule sentence ("Sempre que eu receber de um projeto, guarda 20% para impostos") into a
 * SKETCH: what was understood, with names still as written (goals are found later, never guessed).
 * Deterministic and offline. Whatever it can't read stays empty, and the Assistant asks.
 * It never writes: the sketch becomes a rule only through the preview and "Confirmar e criar regra".
 */
import type { Currency, RuleCondition, RuleTrigger, TaskPriority, Weekday } from '../../data/types'

export type SketchAction =
  | { kind: 'reservePercent'; percent: number; goal: string | null }
  | { kind: 'reserveFixed'; amount: number; currency: Currency | null; goal: string | null }
  | { kind: 'createTask'; title: string; dueDays: number | null; priority: TaskPriority }
  | { kind: 'addInbox'; text: string }
  | { kind: 'createNote'; title: string }

export type SketchCondition = Extract<RuleCondition, { field: 'amount' }> | (Omit<Extract<RuleCondition, { field: 'amount' }>, 'currency'> & { currency: null })

export interface RuleSketch {
  /** The sentence as typed (shown back to the person). */
  text: string
  trigger: RuleTrigger | null
  conditions: SketchCondition[]
  actions: SketchAction[]
  /** Choices already made by tapping a question (goal per action index; currency of the value). */
  goals?: Record<number, string>
  currency?: Currency
}

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[!?.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
/** Original casing of a piece of the normalized text (accents are kept). */
const original = (source: string, norm: string, piece: string) => {
  const i = norm.indexOf(piece)
  return i >= 0 ? source.slice(i, i + piece.length) : piece
}

/** Looks like a rule: "sempre que / toda vez que / quando … + an action", or a date rule. */
const RULE_START = /\b(sempre que|toda vez que|cada vez que|quando|todo dia \d{1,2}|todo mes|toda (segunda|terca|quarta|quinta|sexta|sabado|domingo)|todas as (segundas|tercas|quartas|quintas|sextas|sabados|domingos))\b/
const ACTION_VERB = /\b(guarda|guarde|guardar|reserva|reserve|reservar|separa|separe|separar|cria|crie|criar|adiciona|adicione|coloca|coloque|anota|anote|manda|joga|bota|poe)\b/

const WEEKDAYS: Record<string, Weekday> = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 }

const CURRENCY_WORDS: [RegExp, Currency][] = [
  [/r\$|\breais\b|\breal\b|\bbrl\b/, 'BRL'],
  [/€|\beuros?\b|\beur\b/, 'EUR'],
  [/us\$|\bdolar(es)?\b|\busd\b/, 'USD'],
  [/\baed\b|\bdirhams?\b/, 'AED'],
]

/** "€1.000", "1000 euros", "R$ 3.500,50", "2 mil reais" → cents + currency (null when not said). */
export function readAmount(t: string): { cents: number; currency: Currency | null; match: string } | null {
  const m = t.match(/(r\$|€|us\$|\$)?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(mil|k)?\s*(reais|real|euros?|dolares|dolar|dirhams?|brl|eur|usd|aed)?/)
  if (!m || (!m[1] && !m[4] && !m[5] && !/\d{2,}/.test(m[2]))) return null
  let v = Number(m[2].replace(/\./g, '')) + (m[3] ? Number(m[3].padEnd(2, '0')) / 100 : 0)
  if (m[4]) v *= 1000
  if (!Number.isFinite(v) || v <= 0) return null
  const said = `${m[1] ?? ''} ${m[5] ?? ''}`
  const currency = CURRENCY_WORDS.find(([re]) => re.test(said))?.[1] ?? (m[1] === '$' ? 'USD' : null)
  return { cents: Math.round(v * 100), currency, match: m[0] }
}

function readTrigger(c: string): RuleTrigger | null {
  let m = c.match(/\btodo dia (\d{1,2})\b|\btodo mes no dia (\d{1,2})\b/)
  if (m) {
    const day = Number(m[1] ?? m[2])
    return day >= 1 && day <= 31 ? { kind: 'monthDay', day } : null
  }
  m = c.match(/\btodas? as? (segunda|terca|quarta|quinta|sexta|sabado|domingo)s?\b|\btoda (segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/)
  if (m) return { kind: 'weekDay', weekdays: [WEEKDAYS[m[1] ?? m[2]]] }
  if (/\bprojeto\b/.test(c)) {
    if (/\b(receb\w*|pag\w*|entrar|cair|cai)\b/.test(c)) return { kind: 'projectPayment' }
    if (/\b(conclu\w*|termin\w*|finaliz\w*|entreg\w*)\b/.test(c)) return { kind: 'projectDone' }
    if (/\b(cri\w*|novo|comec\w*)\b/.test(c)) return { kind: 'projectCreated' }
    return null
  }
  if (/\bvendas?\b|\bvender\b|\bvendo\b/.test(c)) {
    if (/\b(receb\w*|pag\w*)\b/.test(c)) return { kind: 'salePayment' }
    return { kind: 'saleCreated' }
  }
  if (/\bassinante\b/.test(c) && /\bpag\w*\b/.test(c)) return { kind: 'subscriberPaid' }
  if (/\btarefa\b/.test(c)) {
    if (/\b(atras\w*|venc\w*)\b/.test(c)) return { kind: 'taskOverdue' }
    if (/\b(conclu\w*|termin\w*|finaliz\w*|fizer)\b/.test(c)) return { kind: 'taskDone' }
    if (/\b(cri\w*|nova|adicion\w*)\b/.test(c)) return { kind: 'taskCreated' }
    return null
  }
  if (/\bcliente\b/.test(c) && /\b(cadastr\w*|cri\w*|novo)\b/.test(c)) return { kind: 'clientCreated' }
  if (/\bmeta\b/.test(c) && /\b(ating\w*|bat\w*|complet\w*|chegar)\b/.test(c)) return { kind: 'goalReached' }
  if (/\b(gast\w*|sair|sai|pagar uma conta)\b/.test(c)) return { kind: 'moneyOut' }
  if (/\b(receb\w*|entrar|entra|cair|cai|chegar)\b/.test(c)) return { kind: 'moneyIn' }
  return null
}

function readCondition(c: string): SketchCondition | null {
  let m = c.match(/\bentre (.+?) e (.+)$/)
  if (m) {
    const a = readAmount(m[1])
    const b = readAmount(m[2])
    if (a && b) return { field: 'amount', op: 'between', value: a.cents, value2: b.cents, currency: a.currency ?? b.currency } as SketchCondition
  }
  m = c.match(/\b(mais de|acima de|maior que|maior do que|superior a|passar de|acima dos?)\s+(.+)$/)
  if (m) {
    const a = readAmount(m[2])
    if (a) return { field: 'amount', op: 'gt', value: a.cents, currency: a.currency } as SketchCondition
  }
  m = c.match(/\b(menos de|abaixo de|menor que|menor do que|inferior a|ate)\s+(.+)$/)
  if (m) {
    const a = readAmount(m[2])
    if (a) return { field: 'amount', op: 'lt', value: a.cents, currency: a.currency } as SketchCondition
  }
  return null
}

const GOAL_TAIL = /\s*(?:para|pra|na|no|em)\s+(?:a\s+|o\s+)?(?:minha\s+|meu\s+)?(?:meta\s+(?:de\s+|do\s+|da\s+)?)?(.+)$/

function readActions(src: string, a: string): SketchAction[] {
  const parts = a.split(/\s*(?:,\s*)?\be\s+(?=(?:guarda|guarde|reserva|reserve|separa|separe|cria|crie|adiciona|adicione|coloca|coloque|anota|anote|manda|bota|poe)\b)/)
  const out: SketchAction[] = []
  for (const p of parts) {
    let m = p.match(/\b(?:guarda|guarde|guardar|reserva|reserve|reservar|separa|separe|separar|bota|poe|coloca|coloque)\s+(\d{1,3})\s?%(.*)$/)
    if (m) {
      const g = m[2].match(GOAL_TAIL)
      out.push({ kind: 'reservePercent', percent: Number(m[1]), goal: g ? cap(original(src, a, g[1]).trim()) : null })
      continue
    }
    m = p.match(/\b(?:guarda|guarde|guardar|reserva|reserve|reservar|separa|separe|separar|bota|poe|coloca|coloque)\s+(.+)$/)
    if (m) {
      const amt = readAmount(m[1])
      if (amt && !/^\s*(\d{1,3})\s?%/.test(m[1])) {
        const g = m[1].slice(m[1].indexOf(amt.match) + amt.match.length).match(GOAL_TAIL)
        out.push({ kind: 'reserveFixed', amount: amt.cents, currency: amt.currency, goal: g ? cap(original(src, a, g[1]).trim()) : null })
        continue
      }
    }
    m = p.match(/\b(?:cria|crie|criar|adiciona|adicione|coloca|coloque)\s+(?:uma\s+)?tarefa\b\s*(?:para\s+|pra\s+|de\s+|:\s*)?(.*)$/)
    if (m) {
      let rest = m[1]
      let dueDays: number | null = null
      const d = rest.match(/\s*(?:para\s+|pra\s+)?(?:daqui(?: a)?|em|dentro de)\s+(\d{1,3})\s+dias?\b/) ?? rest.match(/\s*(?:para\s+|pra\s+)?(amanha|hoje|no mesmo dia)\b/)
      if (d) {
        dueDays = /^\d/.test(d[1]) ? Number(d[1]) : d[1] === 'amanha' ? 1 : 0
        rest = rest.replace(d[0], ' ')
      }
      rest = rest.replace(/\s+/g, ' ').replace(/^(?:de |para |pra |:)/, '').trim()
      out.push({ kind: 'createTask', title: rest ? cap(original(src, a, rest)) : '', dueDays, priority: /\burgente\b/.test(rest) ? 'high' : 'none' })
      continue
    }
    m = p.match(/\b(?:cria|crie|criar|anota|anote)\s+(?:uma\s+)?nota\b\s*(?:com |de |sobre |:\s*)?(.*)$/)
    if (m) {
      out.push({ kind: 'createNote', title: m[1].trim() ? cap(original(src, a, m[1].trim())) : '' })
      continue
    }
    m = p.match(/\b(?:adiciona|adicione|coloca|coloque|manda|joga|bota|poe)\s+(.+?)\s+(?:no|ao|pro|para o|pra o|na caixa de entrada do)\s+inbox\b/)
    if (m) {
      out.push({ kind: 'addInbox', text: cap(original(src, a, m[1].trim())) })
      continue
    }
  }
  return out
}

/** A rule sentence → its sketch, or null when the sentence is not a rule (the Assistant reads it as before). */
export function readRuleSentence(text: string): RuleSketch | null {
  const src = text.trim().replace(/\s+/g, ' ').replace(/[!?.]+$/g, '')
  const t = strip(src)
  if (!RULE_START.test(t) || !ACTION_VERB.test(t)) return null
  const start = t.match(RULE_START)!
  const at = start.index!
  // The "quando" clause runs from its keyword to the first action verb after it (or a comma).
  const after = t.slice(at)
  const verb = after.slice(start[0].length).search(new RegExp(`(?:,\\s*|\\s)${ACTION_VERB.source}`))
  const clauseEnd = verb >= 0 ? at + start[0].length + verb : t.length
  let clause = t.slice(at, clauseEnd).replace(/,\s*$/, '')
  // The action may come before ("Guarda 20% para Viagem quando entrar mais de €1.000") or after it.
  const condition = readCondition(clause)
  clause = clause.replace(/^(sempre que|toda vez que|cada vez que|quando)\s+/, '')
  const actionSrc = src.slice(0, at) + ' ' + src.slice(clauseEnd)
  const actionNorm = (t.slice(0, at) + ' ' + t.slice(clauseEnd))
  return {
    text: src,
    trigger: readTrigger(clause),
    conditions: condition ? [condition] : [],
    actions: readActions(actionSrc.replace(/^[\s,]+/, ''), actionNorm.replace(/^[\s,]+/, '')).filter(Boolean),
  }
}
