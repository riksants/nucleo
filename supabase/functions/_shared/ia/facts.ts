/**
 * NÚCLEO IA — facts with a seal, and the guard that keeps invented values out of an answer.
 *
 * Every value a lookup returns is a fact with an id. The model writes `{f3}`; the app replaces it
 * with the exact value + seal. Any money value, percentage, date or clock time written in the
 * answer that did NOT come from a fact is replaced by "‹valor não confirmado›" and counted as a
 * failure (quality tests require zero).
 */

/**
 * proposto: a value of a preview (Etapa 3) — what WILL be written if the person confirms.
 * informado: a value the person typed in the question (Etapa 4, `calcular`) — not a record of the app.
 */
export type Seal = 'confirmado' | 'previsto' | 'ausente' | 'proposto' | 'informado'
/** What stands for a value in the history (the model is told it is a deliberate omission, not an error). */
export const HISTORY_VALUE = '(valor omitido do histórico)'

export type FactKind = 'dinheiro' | 'data' | 'horario' | 'compromisso' | 'contagem' | 'porcentagem' | 'texto'

export interface Fact {
  id: string
  kind: FactKind
  /** What it is: "Gasto com Mercado em outubro de 2026". */
  label: string
  /** Exactly as shown: "R$ 612,40", "qua, 05/11 · 10:00 · Reunião Vânia". */
  display: string
  seal: Seal
  /** For forecasts and totals: what the number is based on ("9 lançamentos"). */
  base?: string
  /** Screen of the app that shows it. */
  open?: { path: string; params?: Record<string, string> }
  /** Exact amount behind a money fact (integer cents), for `calcular`. Never sent to the model. */
  amount?: { cents: number; currency: string }
}

/** What the model sees for each fact (no internal ids, no links). */
export const factForModel = (f: Fact) => ({ id: f.id, rotulo: f.label, valor: f.display, selo: f.seal, ...(f.base ? { base: f.base } : {}) })

/** `shown`: the value as the model wrote it, when it equals a fact of this turn (confirmed by that fact). */
export type Segment = { t: 'text'; s: string } | { t: 'fact'; fact: Fact; shown?: string } | { t: 'blocked'; s: string } | { t: 'missing'; id: string }

const MONTHS = 'janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro'

/**
 * Values that must come from a fact. Plain counts ("3 compras") are allowed; so are years alone
 * and ordinals.
 */
const GUARDED = new RegExp(
  [
    // money with a symbol or code, before or after: R$ 10, 10 reais, € 3,50, US$ 4, 120 EUR
    // (a number never ends in . or , — the sentence's own punctuation stays out)
    String.raw`(?:R\$|US\$|€|\$|£|AED|BRL|EUR|USD|GBP)\s?-?\d(?:[\d.,]*\d)?`,
    String.raw`-?\d(?:[\d.,]*\d)?\s?(?:reais|real|euros?|d[oó]lares?|R\$|€|AED|BRL|EUR|USD|GBP)\b`,
    // decimals that look like amounts: 612,40  1.234,56  1,234.56
    String.raw`\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?\b`,
    String.raw`\b\d+,\d{1,2}\b`,
    // percentages
    String.raw`-?\d+(?:[.,]\d+)?\s?%`,
    // clock times: 10:00, 9h, 18h30, 9 horas
    String.raw`\b\d{1,2}:\d{2}\b`,
    String.raw`\b\d{1,2}h(?:\d{2})?\b`,
    String.raw`\b\d{1,2}\s?horas?\b`,
    // big plain numbers (4+ digits, not a year 19xx/20xx): allowed only when a count fact has them
    String.raw`\b(?!(?:19|20)\d{2}\b)\d{4,}\b`,
    // dates: 05/11, 5/11/2026, 2026-11-05, 5 de novembro
    String.raw`\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b`,
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    String.raw`\b\d{1,2}\s+de\s+(?:${MONTHS})\b`,
  ].join('|'),
  'gi',
)


const MONTH_NUM: Record<string, string> = { janeiro: '01', fevereiro: '02', marco: '03', 'março': '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' }
const CURRENCY_TAIL = /(?:R\$|US\$|€|\$|£|AED|BRL|EUR|USD|GBP)\s*$/
const squash = (x: string) => x.replace(/\s+/g, '').replace(/[−–]/g, '-').toLowerCase()
const pad2 = (n: string) => n.padStart(2, '0')

/**
 * A value the model wrote by itself is NOT invented when it is exactly a value a lookup returned in
 * this turn (same money with currency, same date, same time, same percentage). Then it is shown as
 * that fact. Anything else stays blocked. Ambiguous numbers (same digits in two currencies) stay blocked.
 */
function factForLiteral(literal: string, facts: ReadonlyMap<string, Fact>): Fact | null {
  const all = [...facts.values()]
  const lit = literal.trim()
  const q = squash(lit)
  // "30 de novembro" is a date (handled below), not money
  const textDate = /^\d{1,2}\s+de\s+[a-zç]+$/i.test(lit)
  // money with its currency: must equal a money fact exactly. Written without cents ("R$ 500") it must
  // equal a fact with ",00" ("R$ 500,00") — the same value, never a rounded one.
  if (!textDate && /[a-z$€£]/i.test(lit) && /\d/.test(lit) && !/%/.test(lit) && !/:|\/|h\b|hora/i.test(lit)) {
    const whole = /,\d/.test(lit) ? null : q.replace(/(\d)(?=\D*$)/, '$1,00')
    return all.find((f) => f.kind === 'dinheiro' && (squash(f.display) === q || squash(f.display) === whole)) ?? null
  }
  // bare amount "1.500,00": only when one currency has it
  if (/^\d{1,3}(?:\.\d{3})*,\d{2}$|^\d+,\d{2}$/.test(lit)) {
    const hits = all.filter((f) => f.kind === 'dinheiro' && squash(f.display).replace(/^[^\d-]+|[^\d,.]+$/g, '').replace(/^-/, '') === q)
    const currencies = new Set(hits.map((f) => f.display.replace(/[\d.,\s−-]/g, '')))
    return hits.length && currencies.size === 1 ? hits[0] : null
  }
  if (/%$/.test(lit)) return all.find((f) => f.kind === 'porcentagem' && squash(f.display).replace(/^\+/, '') === q.replace(/^\+/, '')) ?? null
  // dates → "dd/mm" (year, when written, must match the fact if the fact shows one)
  let dm: string | null = null
  let year: string | null = null
  let m = lit.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (m) {
    dm = `${pad2(m[1])}/${pad2(m[2])}`
    year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : null
  }
  m = lit.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    dm = `${m[3]}/${m[2]}`
    year = m[1]
  }
  m = lit.toLowerCase().match(/^(\d{1,2})\s+de\s+([a-zç]+)$/)
  if (m && MONTH_NUM[m[2]]) dm = `${pad2(m[1])}/${MONTH_NUM[m[2]]}`
  if (dm) {
    return all.find((f) => (f.kind === 'data' || f.kind === 'compromisso') && f.display.includes(dm!) && (!year || !/\/\d{4}/.test(f.display) || f.display.includes(`${dm}/${year}`))) ?? null
  }
  if (/^\d{1,2}:\d{2}$/.test(lit)) return all.find((f) => (f.kind === 'compromisso' || f.kind === 'horario') && f.display.includes(lit.padStart(5, '0'))) ?? null
  if (/^\d{1,2}\s?horas?$/i.test(lit)) return all.find((f) => (f.kind === 'contagem' || f.kind === 'texto') && squash(f.display) === q) ?? null
  if (/^\d{4,}$/.test(lit)) return all.find((f) => f.kind === 'contagem' && new RegExp(`(^|\\D)${lit}(\\D|$)`).test(f.display.replace(/\./g, ''))) ?? null
  return null
}

/** Splits an answer into text, facts and blocked (unconfirmed) values. */
export function renderAnswer(text: string, facts: ReadonlyMap<string, Fact>): { segments: Segment[]; blocked: string[]; missing: string[]; used: string[] } {
  const segments: Segment[] = []
  const blocked: string[] = []
  const missing: string[] = []
  const used: string[] = []
  const pushText = (raw: string) => {
    // stray braces left around a reference never show; nor the history marker, if the model copies it
    const s0 = raw.replace(/[{}]/g, '')
    if (s0.includes(HISTORY_VALUE)) blocked.push(HISTORY_VALUE)
    const s = s0.split(HISTORY_VALUE).join('')
    if (!s) return
    let last = 0
    for (const m of s.matchAll(GUARDED)) {
      const at = m.index ?? 0
      if (at > last) segments.push({ t: 'text', s: s.slice(last, at) })
      const fact = factForLiteral(m[0], facts)
      if (fact) {
        segments.push({ t: 'fact', fact, shown: m[0] })
        used.push(fact.id)
      } else {
        segments.push({ t: 'blocked', s: m[0] })
        blocked.push(m[0])
      }
      last = at + m[0].length
    }
    if (last < s.length) segments.push({ t: 'text', s: s.slice(last) })
  }
  let last = 0
  // {f3} = a fact. Any other {…} (an internal name like {dias_restantes}) never reaches the person.
  for (const m of text.matchAll(/\{([^{}\n]{1,80})\}/g)) {
    const at = m.index ?? 0
    pushText(text.slice(last, at))
    const id = m[1].trim()
    const fact = /^f\d{1,4}$/.test(id) ? facts.get(id) : undefined
    if (fact) {
      // "R$ {f1}" where the fact already shows "R$ 400,00": the extra symbol goes away
      const prev = segments[segments.length - 1]
      if (fact.kind === 'dinheiro' && prev?.t === 'text' && CURRENCY_TAIL.test(prev.s)) prev.s = prev.s.replace(CURRENCY_TAIL, '')
      const wd = (fact.kind === 'data' || fact.kind === 'compromisso') && fact.display.match(/^(dom|seg|ter|qua|qui|sex|sáb),/)
      if (wd && prev?.t === 'text') prev.s = prev.s.replace(new RegExp(`\\b${wd[1]}[a-zçá-]*,?\\s*$`, 'i'), '')
      segments.push({ t: 'fact', fact })
      used.push(id)
    } else if (/^f\d{1,4}$/.test(id)) {
      segments.push({ t: 'missing', id })
      missing.push(id)
    } else {
      segments.push({ t: 'blocked', s: m[0] })
      blocked.push(m[0])
    }
    last = at + m[0].length
  }
  pushText(text.slice(last))
  // merge neighbouring text pieces
  const merged: Segment[] = []
  for (const seg of segments) {
    const prev = merged[merged.length - 1]
    if (seg.t === 'text' && prev?.t === 'text') prev.s += seg.s
    else merged.push(seg)
  }
  return { segments: merged, blocked, missing, used }
}

/** Plain text of an answer (facts as their values) — kept as the compact history of the turn. */
export function plainAnswer(segments: Segment[]): string {
  return segments.map((s) => (s.t === 'text' ? s.s : s.t === 'fact' ? (s.shown ?? s.fact.display) : '‹valor não confirmado›')).join('')
}

/** Ids handed out in one turn: f1, f2… in the order lookups return them. */
export class FactBook {
  private n = 0
  readonly all = new Map<string, Fact>()
  add(f: Omit<Fact, 'id'>): Fact {
    const fact = { ...f, id: `f${++this.n}` }
    this.all.set(fact.id, fact)
    return fact
  }
}

/** Light markdown the models sometimes write (**bold**, "- item") shown as plain text: no stray symbols. */
export function plainLine(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*\*/g, '').replace(/^(\s*)[-*]\s+/, '$1• ').replace(/^#{1,6}\s+/, '')
}

/**
 * The answer as kept in the conversation history: money, dates, times and percentages become HISTORY_VALUE.
 * Old numbers may have changed and must never be reused — a follow-up looks them up again.
 */
export function historyText(segments: Segment[]): string {
  return segments
    .map((s) => (s.t === 'text' ? s.s : s.t === 'fact' ? (s.fact.kind === 'texto' || s.fact.kind === 'contagem' || s.fact.kind === 'compromisso' ? (s.shown ?? s.fact.display) : HISTORY_VALUE) : HISTORY_VALUE))
    .join('')
}

/** True when a text carries a value the guard protects (money, date, time, percentage, big number). */
export function hasGuardedValue(s: string): boolean {
  GUARDED.lastIndex = 0
  const hit = GUARDED.test(s)
  GUARDED.lastIndex = 0
  return hit
}
