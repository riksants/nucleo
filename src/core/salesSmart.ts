/**
 * Vendas, the smart parts (pure, tested): reading a sentence ("Vendi um tênis pra João por 300, ele deu 100 e paga
 * o resto sexta"), searching sales by words/dates/status, installments that add up exactly, which installments a
 * payment settles, the WhatsApp charge text and repeating sales. Local word rules only (no AI): a sentence is turned
 * into a draft the person checks — nothing is saved by typing, and what isn't said is left empty, never guessed.
 */
import { readDate } from './assistant/intents'
import { addDaysToDate, weekdayOfDate } from './period'
import { shiftMonths } from './automation/dates'
import { clientKey, installmentViews, isLate, nextDue, personName, saleRemaining, saleStatus, settles } from '../data/sales'

export { installmentViews, isLate, nextDue, settles }
export type { InstallmentState, InstallmentView } from '../data/sales'
import type { Cents, Currency, Installment, Sale, SaleItem } from '../data/types'

// ---------- text helpers

/** Lowercase without accents, same length as the input (so positions map back to the original). */
export function foldKeep(s: string): string {
  return [...s].map((c) => (c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() || c)[0] ?? c).join('')
}

const NUMBER_WORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, doze: 12, meia: 6 }

/** "300", "1.500", "1500,50", "1,5 mil", "2 mil" → cents. */
export function parseAmount(raw: string): Cents | null {
  const m = raw.trim().match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?(\s*mil)?$/)
  if (!m) return null
  let v = Number(m[1].replace(/\./g, '')) + (m[2] ? Number(m[2].padEnd(2, '0')) / 100 : 0)
  if (m[3]) v *= 1000
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null
}

const NUM = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?(?:\s*mil)?)`
const CUR = String.raw`(?:r\$|us\$|€|\$)?\s*`

export function currencyIn(t: string): Currency | null {
  if (/r\$|\breais\b|\breal\b/.test(t)) return 'BRL'
  if (/€|\beuros?\b/.test(t)) return 'EUR'
  if (/us\$|\bdolar(es)?\b|\busd\b/.test(t)) return 'USD'
  if (/\bdirhams?\b|\baed\b/.test(t)) return 'AED'
  return null
}

// ---------- reading a sentence

export interface SaleDraft {
  clientName: string
  product: string
  quantity: number
  /** Unit price × quantity, when said. */
  total: Cents | null
  paid: Cents | null
  dueDate: string
  installments: number
  currency: Currency | null
}

export type Reading = { kind: 'create'; draft: SaleDraft; missing: ('client' | 'product' | 'total')[] } | { kind: 'search' } | { kind: 'ambiguous'; draft: SaleDraft }

const SALE_VERBS = /\b(vendi|vendemos|vendeu|vendo|fiz uma venda|venda de|venda pra|venda para|registrar venda|nova venda)\b/
const BOUGHT = /\b([a-z]+(?:\s+(?:da|de|do)?\s*[a-z]+)?)\s+comprou\b/
const STOP_NAME = new Set(['sexta', 'segunda', 'terca', 'quarta', 'quinta', 'sabado', 'domingo', 'amanha', 'hoje', 'semana', 'mes', 'dia', 'pagar', 'receber', 'ele', 'ela', 'mim', 'voce', 'vista', 'prazo', 'o', 'a'])
const STOP_AFTER = /\s+(?:por|de|que|e|com|no|na|em|pelo|pela|ele|ela|pagou|deu|vai|paga|ate|pra|para|pro|ao|a)\b|[,.;!?]/

function cleanTail(s: string): string {
  const cut = s.search(STOP_AFTER)
  return (cut >= 0 ? s.slice(0, cut) : s).trim()
}

/** Reads a sentence. `today` in the person's time zone; `knownNames` (clients and past buyers) help find who. */
export function readSaleText(text: string, today: string, knownNames: string[] = []): Reading {
  const src = text.trim()
  const t = foldKeep(src)
  const orig = (from: number, piece: string) => src.slice(from, from + piece.length)
  const hasVerb = SALE_VERBS.test(t) || BOUGHT.test(t)
  const anyNumber = /\d/.test(t)

  // who
  let clientName = ''
  const known = knownNames
    .map((n) => ({ n, f: foldKeep(n.trim()) }))
    .filter((x) => x.f.length >= 2)
    .sort((a, b) => b.f.length - a.f.length)
    .find((x) => new RegExp(`(^|[^a-z])${x.f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(t))
  if (known) clientName = known.n.trim()
  if (!clientName) {
    const m = t.match(/\b(?:pra|para|pro|ao|a)\s+(?:o |a |seu |sua |dona |sr\.? |sra\.? )?([a-z]+(?:\s+(?:da |de |do |dos |das )?[a-z]+)?)/)
    if (m && m.index !== undefined) {
      const name = cleanTail(m[1])
      const first = name.split(' ')[0]
      if (name && !STOP_NAME.has(first) && !/^\d/.test(name)) clientName = orig(m.index + m[0].length - m[1].length, name)
    }
  }
  if (!clientName) {
    const m = t.match(BOUGHT)
    if (m && m.index !== undefined && !STOP_NAME.has(m[1].split(' ')[0])) clientName = orig(m.index, m[1])
  }

  // what and how many
  let product = ''
  let quantity = 1
  const pm = t.match(/\b(?:vendi|vendemos|vendeu|vendo|venda de|comprou)\s+(?:(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|doze|meia)\s+)?(?:o |a |os |as |uns |umas )?(.+)/)
  if (pm && pm.index !== undefined) {
    const q = pm[1]
    if (q) quantity = /^\d+$/.test(q) ? Number(q) : (NUMBER_WORDS[q] ?? 1)
    const tail = cleanTail(pm[2].replace(/^(?:pra|para|pro|ao)\s+\S+\s*/, ''))
    if (tail && !/^\d/.test(tail)) {
      const at = pm.index + pm[0].length - pm[2].length + pm[2].indexOf(tail)
      product = orig(at, tail)
    }
  }

  // how much
  let total: Cents | null = null
  const tm = t.match(new RegExp(String.raw`\b(?:por|no valor de|total de|custou|de)\s+${CUR}${NUM}(\s*(?:reais|euros?|dolares)?)?(\s+cada)?`))
  if (tm) {
    const v = parseAmount(tm[1])
    if (v) total = tm[3] ? v * quantity : v
  }

  // received
  let paid: Cents | null = null
  const paidM = t.match(new RegExp(String.raw`\b(?:deu|pagou|adiantou|me pagou|entrada de|deu de entrada|ja pagou|recebi|ja recebi)\s+${CUR}${NUM}`))
  if (paidM) paid = parseAmount(paidM[1])
  else if (/\b(pagou tudo|ja pagou|pagou a vista|a vista|quitou|pagou na hora|ja recebi tudo|recebi tudo)\b/.test(t)) paid = total
  if (paid !== null && total !== null && paid > total) paid = total

  // when the rest is due
  let dueDate = ''
  const owes = /\b(resto|restante|paga|pagar|pagara|vence|vencimento|ate|prazo|acerta|acertar|fica de pagar)\b/.test(t)
  const date = readDate(t, today)
  if (date && (owes || (paid !== null && total !== null && paid < total))) dueDate = date.date

  const im = t.match(/\b(?:em\s+)?(\d{1,2})\s*(?:x|vezes|parcelas)\b/)
  const installments = im ? Math.min(Number(im[1]), 48) : 0

  const draft: SaleDraft = { clientName, product, quantity, total, paid, dueDate, installments, currency: currencyIn(t) }
  if (hasVerb) {
    const missing = [!clientName && 'client', !product && 'product', !total && 'total'].filter(Boolean) as ('client' | 'product' | 'total')[]
    return { kind: 'create', draft, missing }
  }
  // A name with an amount ("João 300") could be either: ask, keeping the text.
  if (anyNumber && t.split(/\s+/).length >= 2 && (clientName || total)) return { kind: 'ambiguous', draft }
  return { kind: 'search' }
}

// ---------- searching sales

export interface SaleSearch {
  status: 'overdue' | 'open' | 'paid' | 'partial' | null
  from: string
  to: string
  /** What the dates mean, for the chip ("sexta, 24/10"). */
  dateLabel: string
  words: string[]
}

const SEARCH_STOP = new Set(['venda', 'vendas', 'de', 'do', 'da', 'dos', 'das', 'que', 'as', 'os', 'a', 'o', 'minhas', 'meus', 'com', 'em', 'no', 'na', 'e', 'para', 'pra', 'todas', 'todos', 'feitas', 'feita', 'ver', 'mostrar'])
const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']
const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export function readSearch(text: string, today: string): SaleSearch {
  let t = foldKeep(text.trim())
  let status: SaleSearch['status'] = null
  const take = (re: RegExp, s: SaleSearch['status']) => {
    if (re.test(t)) {
      status = s
      t = t.replace(re, ' ')
    }
  }
  take(/\batrasad[oa]s?\b|\bvencid[oa]s?\b/, 'overdue')
  take(/\bquitad[oa]s?\b|\bpag[oa]s\b|\bpagas\b/, 'paid')
  take(/\bparcia(l|is)\b/, 'partial')
  take(/\bpendentes?\b|\ba receber\b|\bem aberto\b|\bdevendo\b|\babertas?\b/, 'open')

  let from = ''
  let to = ''
  let dateLabel = ''
  const range = (f: string, tt: string, label: string, re: RegExp) => {
    from = f
    to = tt
    dateLabel = label
    t = t.replace(re, ' ')
  }
  const wd = weekdayOfDate(today)
  const monday = addDaysToDate(today, -((wd + 6) % 7))
  if (/\bhoje\b/.test(t)) range(today, today, 'hoje', /\bhoje\b/)
  else if (/\bontem\b/.test(t)) range(addDaysToDate(today, -1), addDaysToDate(today, -1), 'ontem', /\bontem\b/)
  else if (/\bsemana passada\b/.test(t)) range(addDaysToDate(monday, -7), addDaysToDate(monday, -1), 'semana passada', /\bsemana passada\b/)
  else if (/\b(esta|essa|nesta|nessa) semana\b/.test(t)) range(monday, today, 'esta semana', /\b(esta|essa|nesta|nessa) semana\b/)
  else if (/\bmes passado\b/.test(t)) {
    const first = `${shiftMonths(`${today.slice(0, 7)}-01`, -1, 1)}`
    range(first, addDaysToDate(`${today.slice(0, 7)}-01`, -1), 'mês passado', /\bmes passado\b/)
  } else if (/\b(este|esse|neste|nesse) mes\b/.test(t)) range(`${today.slice(0, 7)}-01`, today, 'este mês', /\b(este|esse|neste|nesse) mes\b/)
  else {
    const m = t.match(/\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\b/)
    if (m) {
      // The most recent one (today counts): "vendas de sexta" are sales already made.
      const back = (wd - WEEKDAYS.indexOf(m[1]) + 7) % 7
      const day = addDaysToDate(today, -back)
      range(day, day, `${m[1] === 'terca' ? 'terça' : m[1] === 'sabado' ? 'sábado' : m[1]}, ${fmt(day)}`, new RegExp(m[0]))
    } else {
      const d = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
      if (d) {
        const y = d[3] ? (d[3].length === 2 ? `20${d[3]}` : d[3]) : today.slice(0, 4)
        const day = `${y}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`
        range(day, day, fmt(day), new RegExp(d[0].replace('/', '\\/').replace('/', '\\/')))
      }
    }
  }
  const words = t
    .split(/[^a-z0-9,.$€]+/)
    .map((w) => w.trim())
    .filter((w) => w && !SEARCH_STOP.has(w))
  return { status, from, to, dateLabel, words }
}

/** Everything a sale can be found by: who, what (items too), notes, amounts, dates, status. */
export function saleHaystack(sale: Sale, buyerName: string): string {
  const money = (c: Cents) => {
    const v = c / 100
    return `${v} ${v.toFixed(2).replace('.', ',')} ${Math.round(v)}`
  }
  const status = saleStatus(sale) === 'paid' ? 'quitada paga' : saleStatus(sale) === 'partial' ? 'parcial pendente' : 'pendente'
  return foldKeep(
    [buyerName, sale.product, ...(sale.items ?? []).map((i) => i.name), sale.notes, money(sale.total), money(saleRemaining(sale)), sale.date, fmt(sale.date), sale.dueDate ? fmt(sale.dueDate) : '', status].join(' '),
  )
}

export function matchesSearch(sale: Sale, buyerName: string, q: SaleSearch, today: string): boolean {
  if (q.status === 'overdue' && !isLate(sale, today)) return false
  if (q.status === 'paid' && saleStatus(sale) !== 'paid') return false
  if (q.status === 'partial' && saleStatus(sale) !== 'partial') return false
  if (q.status === 'open' && saleStatus(sale) === 'paid') return false
  if (q.from && (sale.date < q.from || sale.date > q.to)) return false
  if (!q.words.length) return true
  const hay = saleHaystack(sale, buyerName)
  const tokens = hay.split(/\s+/)
  return q.words.every((w) => (/^\d/.test(w) ? tokens.some((x) => x === w || x.startsWith(w)) : hay.includes(w)))
}

// ---------- installments

/** Splits `amount` into `count` parts that add up exactly (the extra cents go to the first ones). */
export function buildInstallments(amount: Cents, count: number, first: string, every: 'week' | 'month', newId: () => string): Installment[] {
  const n = Math.max(1, Math.min(48, Math.floor(count)))
  const base = Math.floor(amount / n)
  const extra = amount - base * n
  const day = Number(first.slice(8, 10))
  return Array.from({ length: n }, (_, i) => ({
    id: newId(),
    due: every === 'week' ? addDaysToDate(first, 7 * i) : shiftMonths(first, i, day),
    amount: base + (i < extra ? 1 : 0),
  }))
}

// ---------- remembered clients and products

export interface KnownProduct {
  name: string
  /** Last unit price and its currency. */
  price: Cents
  currency: Currency
  times: number
}

export function knownProducts(sales: Sale[]): KnownProduct[] {
  const map = new Map<string, KnownProduct & { last: string }>()
  const add = (name: string, price: Cents, currency: Currency, date: string) => {
    const key = personName(name)
    if (!key) return
    const cur = map.get(key)
    if (!cur) map.set(key, { name: name.trim(), price, currency, times: 1, last: date })
    else {
      cur.times++
      if (date >= cur.last) Object.assign(cur, { price, currency, last: date, name: name.trim() })
    }
  }
  for (const s of sales) {
    if (s.recurOf) continue
    if (s.items?.length) for (const i of s.items) add(i.name, i.price, s.currency, s.date)
    else if (s.product) add(s.product, Math.round((s.total + (s.discount ?? 0)) / Math.max(1, s.quantity)), s.currency, s.date)
  }
  return [...map.values()].sort((a, b) => b.times - a.times || a.name.localeCompare(b.name)).map(({ last: _l, ...p }) => (void _l, p))
}

/** Items → product summary and total (after discount). */
export function itemsSummary(items: SaleItem[], discount = 0): { product: string; quantity: number; total: Cents } {
  const valid = items.filter((i) => i.name.trim())
  const product = valid.length === 1 ? valid[0].name.trim() : valid.map((i) => (i.quantity !== 1 ? `${i.quantity}× ${i.name.trim()}` : i.name.trim())).join(' + ')
  const sum = valid.reduce((s, i) => s + Math.round(i.price * i.quantity), 0)
  return { product, quantity: valid.length === 1 ? valid[0].quantity : 1, total: Math.max(0, sum - discount) }
}

// ---------- charging

export function chargeMessage(input: { name: string; product: string; saleDate: string; pending: string; due: string; late: boolean }): string {
  const first = input.name.trim().split(/\s+/)[0] || ''
  const when = input.due ? (input.late ? `que venceu em ${fmt(input.due)}` : `com vencimento em ${fmt(input.due)}`) : ''
  return [
    `Oi${first ? `, ${first}` : ''}! Tudo bem?`,
    `Passando para lembrar do pagamento de ${input.product} (compra de ${fmt(input.saleDate)}): ${input.pending} em aberto${when ? `, ${when}` : ''}.`,
    'Se já tiver pago, me avise que eu confiro. Obrigado!',
  ].join('\n')
}

/** wa.me needs the number with country code and digits only. Null when there aren't enough digits. */
export function whatsappLink(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 8) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

// ---------- repeating sales

export function nextRepeat(date: string, every: 'week' | 'month' | 'year', anchorDay = Number(date.slice(8, 10))): string {
  if (every === 'week') return addDaysToDate(date, 7)
  return shiftMonths(date, every === 'month' ? 1 : 12, anchorDay)
}

/** Same buyer key whether linked to Clients or typed (re-exported for the page). */
export { clientKey }
