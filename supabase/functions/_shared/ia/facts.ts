/**
 * NÚCLEO IA — facts with a seal, and the guard that keeps invented values out of an answer.
 *
 * Every value a lookup returns is a fact with an id. The model writes `{f3}`; the app replaces it
 * with the exact value + seal. Any money value, percentage, date or clock time written in the
 * answer that did NOT come from a fact is replaced by "‹valor não confirmado›" and counted as a
 * failure (quality tests require zero).
 */

export type Seal = 'confirmado' | 'previsto' | 'ausente'
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
}

/** What the model sees for each fact (no internal ids, no links). */
export const factForModel = (f: Fact) => ({ id: f.id, rotulo: f.label, valor: f.display, selo: f.seal, ...(f.base ? { base: f.base } : {}) })

export type Segment = { t: 'text'; s: string } | { t: 'fact'; fact: Fact } | { t: 'blocked'; s: string } | { t: 'missing'; id: string }

const MONTHS = 'janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro'

/**
 * Values that must come from a fact. Plain counts ("3 compras") are allowed; so are years alone
 * and ordinals.
 */
const GUARDED = new RegExp(
  [
    // money with a symbol or code, before or after: R$ 10, 10 reais, € 3,50, US$ 4, 120 EUR
    String.raw`(?:R\$|US\$|€|\$|£|AED|BRL|EUR|USD|GBP)\s?-?\d[\d.,]*`,
    String.raw`-?\d[\d.,]*\s?(?:reais|real|euros?|d[oó]lares?|R\$|€|AED|BRL|EUR|USD|GBP)\b`,
    // decimals that look like amounts: 612,40  1.234,56  1,234.56
    String.raw`\b\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?\b`,
    String.raw`\b\d+,\d{1,2}\b`,
    // percentages
    String.raw`-?\d+(?:[.,]\d+)?\s?%`,
    // clock times: 10:00, 9h, 18h30, 9 horas
    String.raw`\b\d{1,2}:\d{2}\b`,
    String.raw`\b\d{1,2}h(?:\d{2})?\b`,
    String.raw`\b\d{1,2}\s?horas?\b`,
    // dates: 05/11, 5/11/2026, 2026-11-05, 5 de novembro
    String.raw`\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b`,
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    String.raw`\b\d{1,2}\s+de\s+(?:${MONTHS})\b`,
  ].join('|'),
  'gi',
)

/** Splits an answer into text, facts and blocked (unconfirmed) values. */
export function renderAnswer(text: string, facts: ReadonlyMap<string, Fact>): { segments: Segment[]; blocked: string[]; missing: string[]; used: string[] } {
  const segments: Segment[] = []
  const blocked: string[] = []
  const missing: string[] = []
  const used: string[] = []
  const pushText = (raw: string) => {
    // stray braces left around a reference never show
    const s = raw.replace(/[{}]/g, '')
    if (!s) return
    let last = 0
    for (const m of s.matchAll(GUARDED)) {
      const at = m.index ?? 0
      if (at > last) segments.push({ t: 'text', s: s.slice(last, at) })
      segments.push({ t: 'blocked', s: m[0] })
      blocked.push(m[0])
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
  return segments.map((s) => (s.t === 'text' ? s.s : s.t === 'fact' ? s.fact.display : '‹valor não confirmado›')).join('')
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
