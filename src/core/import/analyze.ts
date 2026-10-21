/**
 * What each line of a statement is, compared with what the Núcleo already has — before anything is
 * written. In this order (strongest first):
 * 1. the same bank id (FITID / id column) or the same line id: already imported → Duplicada;
 * 2. same day + value + currency + description of a line imported before (each existing one counted
 *    once, so two equal coffees on the same day stay two) → Duplicada (other account → Possível);
 * 3. close to a line imported before (same value, a few days apart, similar text) → Possível duplicada;
 * 4. a movement the Núcleo already registered (payment of a project/sale, subscriber, tool, typed by
 *    hand…): same value, currency and direction, close date → Conciliada when the confidence is very
 *    high (similar text, ≤ 3 days, the only candidate both ways), otherwise Precisa revisar with the
 *    suggestion — a wrong reconciliation is worse than a line left to review;
 * 5. everything else → Nova (or Precisa revisar when dated before the person started the Núcleo:
 *    the initial balance already counts it).
 */
import type { Cents, Client, Currency, DataState, Project, Sale, Subscriber, Tool, Transaction } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { startDay } from '../finance'
import { dayOf } from '../indexes'
import { zoneOf } from '../period'
import { hash16 } from '../rules/hash'
import type { RuleCtx, RuleEvent } from '../rules/types'
import { makeCategorizer, type CategoryGuess } from './categorize'
import { merchantKey, normDescription, plain, prettyDescription, similarity, textsMatch } from './normalize'
import type { ParsedLine } from './types'

export type LineStatus = 'new' | 'duplicate' | 'possible' | 'reconciled' | 'review'
export type LineAction = 'import' | 'reconcile' | 'skip'

export const STATUS_LABEL: Record<LineStatus, string> = {
  new: 'Nova',
  duplicate: 'Duplicada',
  possible: 'Possível duplicada',
  reconciled: 'Conciliada',
  review: 'Precisa revisar',
}

export interface Match {
  txId: string
  /** "Pagamento de projeto — Perfect Clean" */
  label: string
  day: string
  /** Very high confidence (reconciled by itself). */
  high: boolean
}

export interface AnalyzedLine {
  i: number
  line: ParsedLine
  /** The id the movement gets if imported (fixed: the same line always gets the same id). */
  id: string
  type: 'in' | 'out'
  /** Absolute, in `currency`. */
  amount: Cents
  currency: Currency
  day: string
  /** Cleaned description for the movement. */
  reason: string
  status: LineStatus
  /** Why it has this status, in words. */
  note: string
  /** A movement already in the Núcleo this line seems to be. */
  match?: Match
  /** The existing movement it duplicates (Duplicada / Possível duplicada). */
  dupOf?: string
  category: CategoryGuess | null
  hint: CategoryGuess | null
  beforeStart?: boolean
  /** Lines that can never be imported (unreadable, or exactly the same line already in). */
  locked: boolean
}

export interface ImportSource {
  /** Account typed or recognized ("Sabadell"). Part of the line ids. */
  account: string
  /** For lines without a currency of their own. */
  currency: Currency | null
}

export interface Analysis {
  lines: AnalyzedLine[]
  counts: { read: number; new: number; duplicate: number; possible: number; reconciled: number; review: number; categorized: number; attention: number }
  from?: string
  to?: string
}

/** What a line does unless the person changes it. Anything uncertain is left out. */
export function defaultAction(l: AnalyzedLine): LineAction {
  if (l.status === 'new') return 'import'
  if (l.status === 'reconciled') return 'reconcile'
  return 'skip'
}

const daysBetween = (a: string, b: string) => Math.round(Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)

/** The stable id of a line: by bank id when there is one, else by its content and its position among equal lines. */
export function lineId(account: string, l: { fitid?: string; day: string; signed: Cents; currency: Currency; norm: string }, occurrence: number): string {
  const acct = plain(account)
  if (l.fitid) return `bank-${hash16(`f|${acct}|${l.fitid}`)}`
  return `bank-${hash16(`l|${acct}|${l.day}|${l.signed}|${l.currency}|${l.norm}|${occurrence}`)}`
}

interface Described {
  label: string
  text: string
  days: string[]
}

/** How an existing movement is named in a suggestion, and the texts/dates it can be matched on. */
function describe(t: Transaction, data: DataState, tz: string, cache: Map<string, unknown>): Described {
  const days = [dayOf(t.createdAt, tz)]
  const find = <T extends { id: string }>(collection: 'projects' | 'sales' | 'subscribers' | 'tools' | 'clients', id: string | null | undefined): T | undefined => {
    if (!id) return undefined
    const key = `${collection}`
    let m = cache.get(key) as Map<string, T> | undefined
    if (!m) cache.set(key, (m = new Map((data[collection] as unknown as T[]).map((x) => [x.id, x]))))
    return m.get(id)
  }
  const s = t.source
  let label = t.reason || (t.type === 'in' ? 'Entrada' : 'Saída')
  const texts = [t.reason]
  if (s?.kind === 'project') {
    const p = find<Project>('projects', s.parentId)
    const c = find<Client>('clients', p?.clientId)
    label = `Pagamento de projeto — ${p?.name ?? t.reason}`
    texts.push(p?.name ?? '', c?.name ?? '', c?.company ?? '')
    const pay = p?.payments?.find((x) => x.id === s.paymentId)
    if (pay?.date) days.push(pay.date)
  } else if (s?.kind === 'sale' || s?.kind === 'saleGeneral') {
    const sale = find<Sale>('sales', s.parentId)
    const c = find<Client>('clients', sale?.clientId)
    const buyer = (sale?.clientId ? c?.name : sale?.clientName) ?? ''
    label = `Pagamento de venda — ${[sale?.product, buyer].filter(Boolean).join(' · ') || t.reason}`
    texts.push(sale?.product ?? '', buyer, c?.company ?? '')
    const pay = sale?.payments.find((x) => x.id === s.paymentId || x.generalId === s.paymentId)
    if (pay?.date) days.push(pay.date)
  } else if (s?.kind === 'subscriber') {
    const sub = find<Subscriber>('subscribers', s.parentId)
    label = `Assinante — ${sub?.name ?? t.reason}`
    texts.push(sub?.name ?? '')
    const pay = sub?.payments.find((x) => x.id === s.paymentId)
    if (pay?.date) days.push(pay.date)
  } else if (s?.kind === 'tool') {
    const tool = find<Tool>('tools', s.parentId)
    label = `Ferramenta — ${tool?.name ?? t.reason}`
    texts.push(tool?.name ?? '')
  }
  return { label, text: texts.filter(Boolean).join(' '), days }
}

const moneyKey = (type: string, currency: string, amount: number) => `${type}|${currency}|${amount}`

export function analyze(lines: ParsedLine[], source: ImportSource, data: DataState, ctx: Pick<RuleCtx, 'settings' | 'convert'>): Analysis {
  const tz = zoneOf(ctx.settings)
  const start = startDay(ctx.settings)
  const acct = plain(source.account)
  const categorizer = makeCategorizer(data, ctx)
  const cache = new Map<string, unknown>()

  // What already exists, indexed once.
  const byId = new Map<string, Transaction>()
  const byLine = new Map<string, Transaction>()
  const sameLine = new Map<string, Transaction[]>()
  const banked = new Map<string, Transaction[]>()
  const plainTx = new Map<string, Transaction[]>()
  for (const t of data.transactions) {
    byId.set(t.id, t)
    if (t.type === 'adjust') continue
    const mk = moneyKey(t.type, t.currency, t.amount)
    if (t.bank) {
      if (t.bank.line) byLine.set(t.bank.line, t)
      const k3 = `${t.bank.day}|${mk}|${normDescription(t.bank.raw)}`
      ;(sameLine.get(k3) ?? sameLine.set(k3, []).get(k3)!).push(t)
      ;(banked.get(mk) ?? banked.set(mk, []).get(mk)!).push(t)
    } else (plainTx.get(mk) ?? plainTx.set(mk, []).get(mk)!).push(t)
  }

  const consumed = new Set<string>()
  const seenInFile = new Set<string>()
  const occurrences = new Map<string, number>()
  const out: AnalyzedLine[] = []
  let from: string | undefined
  let to: string | undefined

  lines.forEach((line, i) => {
    const currency = line.currency ?? source.currency
    const signed = line.amount ?? 0
    const type: 'in' | 'out' = signed >= 0 ? 'in' : 'out'
    const amount = Math.abs(signed)
    const day = line.day ?? ''
    const reason = prettyDescription(line.description) || (type === 'in' ? 'Entrada' : 'Saída')
    const norm = normDescription(line.description) || plain(line.description)
    const base = { i, line, type, amount, currency: currency ?? '', day, reason, category: null, hint: null }
    if (line.error || !currency) {
      out.push({ ...base, id: `bank-error-${i}`, status: 'review', note: line.error ? `Não dá para importar: ${line.error}.` : 'Escolha a moeda deste arquivo.', locked: true })
      return
    }
    if (!from || day < from) from = day
    if (!to || day > to) to = day
    const occKey = `${day}|${signed}|${currency}|${norm}`
    const occ = occurrences.get(occKey) ?? 0
    occurrences.set(occKey, occ + 1)
    const id = lineId(source.account, { fitid: line.fitid, day, signed, currency, norm }, occ)
    const a: AnalyzedLine = { ...base, currency, id, status: 'new', note: '', locked: false }
    out.push(a)

    if (seenInFile.has(id)) {
      Object.assign(a, { status: 'duplicate', note: 'Esta linha aparece repetida no arquivo.', locked: true })
      return
    }
    seenInFile.add(id)
    const exact = byId.get(id) ?? byLine.get(id)
    if (exact) {
      consumed.add(exact.id)
      Object.assign(a, { status: 'duplicate', dupOf: exact.id, note: exact.bank?.reconciled ? 'Esta linha já foi conciliada antes.' : 'Esta linha já foi importada antes.', locked: true })
      return
    }
    const mk = moneyKey(type, currency, amount)
    const fitidClash = (t: Transaction) => Boolean(line.fitid && t.bank?.fitid && t.bank.fitid !== line.fitid)
    const same = (sameLine.get(`${day}|${mk}|${normDescription(line.description)}`) ?? []).find((t) => !consumed.has(t.id) && !fitidClash(t))
    if (same) {
      consumed.add(same.id)
      const sameAccount = plain(same.bank?.account ?? '') === acct
      Object.assign(a, sameAccount ? { status: 'duplicate', dupOf: same.id, note: 'Já existe uma linha igual (mesmo dia, valor e descrição) importada antes.', locked: false } : { status: 'possible', dupOf: same.id, note: `Igual a uma linha importada de outra conta (${same.bank?.account || 'sem conta'}).` })
      return
    }
    const merchant = merchantKey(line.description)
    const close = (banked.get(mk) ?? []).find((t) => {
      if (consumed.has(t.id) || fitidClash(t) || !t.bank) return false
      const d = daysBetween(t.bank.day, day)
      const m = merchant && merchantKey(t.bank.raw) === merchant
      return (d <= 1 && (m || similarity(t.bank.raw, line.description) >= 0.34)) || (d <= 3 && m)
    })
    if (close) {
      consumed.add(close.id)
      Object.assign(a, { status: 'possible', dupOf: close.id, note: `Parecida com “${close.reason}” de ${close.bank!.day.split('-').reverse().join('/')}, importada antes.` })
    }
  })

  // Reconciliation: candidates among the movements the Núcleo registered (not from a statement).
  type Cand = { line: AnalyzedLine; tx: Transaction; d: number; high: boolean; desc: Described }
  const cands = new Map<number, Cand[]>()
  const highFor = new Map<string, number>()
  for (const a of out) {
    if (a.status !== 'new') continue
    const list: Cand[] = []
    for (const t of plainTx.get(moneyKey(a.type, a.currency, a.amount)) ?? []) {
      if (consumed.has(t.id)) continue
      const desc = describe(t, data, tz, cache)
      const d = Math.min(...desc.days.map((x) => daysBetween(x, a.day)))
      if (d > 7) continue
      const text = textsMatch(a.line.description, desc.text)
      if (!text && d > 2) continue
      const high = text && d <= 3
      list.push({ line: a, tx: t, d, high, desc })
      if (high) highFor.set(t.id, (highFor.get(t.id) ?? 0) + 1)
    }
    if (list.length) cands.set(a.i, list.sort((x, y) => Number(y.high) - Number(x.high) || x.d - y.d))
  }
  for (const [i, list] of cands) {
    const a = out[i]
    const highs = list.filter((c) => c.high)
    if (highs.length === 1 && highFor.get(highs[0].tx.id) === 1) {
      const c = highs[0]
      consumed.add(c.tx.id)
      a.status = 'reconciled'
      a.match = { txId: c.tx.id, label: c.desc.label, day: c.desc.days[0], high: true }
      a.note = `Corresponde a ${c.desc.label} (${formatMoney(c.tx.amount, c.tx.currency)}), já registrado no Núcleo.`
    }
  }
  for (const [i, list] of cands) {
    const a = out[i]
    if (a.status !== 'new') continue
    const c = list.find((x) => !consumed.has(x.tx.id))
    if (!c) continue
    a.status = 'review'
    a.match = { txId: c.tx.id, label: c.desc.label, day: c.desc.days[0], high: false }
    a.note = `Parece corresponder a ${c.desc.label} (${c.desc.days[0].split('-').reverse().join('/')}). Concilie se for a mesma movimentação.`
  }

  // Before the person started the Núcleo: the initial balance already has it.
  for (const a of out) {
    if (a.status === 'new' && a.day < start) {
      a.status = 'review'
      a.beforeStart = true
      a.note = `É de antes de você começar a usar o Núcleo (${start.split('-').reverse().join('/')}): o saldo inicial já conta com ela. Importar muda o saldo.`
    }
  }

  // Categories, for the lines that may become movements.
  for (const a of out) {
    if (a.locked || a.status === 'reconciled' || a.status === 'duplicate') continue
    const ev: RuleEvent = {
      key: `tx:${a.id}`,
      kind: a.type === 'in' ? 'moneyIn' : 'moneyOut',
      date: a.day,
      origin: { collection: 'transactions', id: a.id, label: a.reason },
      label: a.reason,
      amount: a.amount,
      currency: a.currency,
      moneyOrigin: 'import',
      txId: a.id,
      clientId: null,
      projectId: null,
      text: a.reason,
      names: { valor: formatMoney(a.amount, a.currency), descricao: a.reason },
    }
    const g = categorizer.guess(a.type, a.line.description, ev)
    a.category = g.applied
    a.hint = g.hint
  }

  const counts = { read: lines.length, new: 0, duplicate: 0, possible: 0, reconciled: 0, review: 0, categorized: 0, attention: 0 }
  for (const a of out) {
    counts[a.status]++
    if (a.status === 'new' && a.category) counts.categorized++
  }
  counts.attention = counts.possible + counts.review
  return { lines: out, counts, from, to }
}

/** The date window of a statement, for the "dates" line ("01/09 a 30/09"). */
export const windowLabel = (from?: string, to?: string) => (from && to ? `${from.split('-').reverse().join('/')} a ${to.split('-').reverse().join('/')}` : '')
