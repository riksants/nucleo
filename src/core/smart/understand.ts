/**
 * Cadastro inteligente (Etapa 4): one sentence → what it probably is, with every field that was written and the
 * questions for what is missing. Local word rules only (no AI); the existing readers are reused (tasks/agenda/
 * habits/recurring: core/capture.ts · sales: core/salesSmart.ts · money values: core/smart/amount.ts).
 *
 * Money is never assumed: no value, no currency (when the person uses more than one), no date, or a payment that
 * could settle something already registered ("recebi 300 do João" while a sale of João is open) → a question.
 * Nothing is saved here: the screen shows the preview and saves only after the person confirms.
 */
import type { AutomationRun, Cents, Currency, DataState, Sale, Settings, ToolBilling } from '../../data/types'
import { saleRemaining } from '../../data/sales'
import { formatMoney } from '../../lib/money'
import type { Converter } from '../../lib/rates'
import { readDate } from '../assistant/intents'
import { parseCapture, type CaptureDraft } from '../capture'
import { makeCategorizer } from '../import/categorize'
import { addDaysToDate } from '../period'
import { readSaleText, type SaleDraft } from '../salesSmart'
import { foldSame, onlyCurrency, readAmount, readAmounts } from './amount'

export interface MoneyDraft {
  kind: 'money'
  type: 'in' | 'out'
  amount: Cents | null
  currency: Currency | null
  /** null = not said (asked). */
  date: string | null
  reason: string
  category: string | null
  /** Who paid / was paid, as written ("João"). */
  person: string
  /** The person's answer to "Isso é o pagamento de…?" (a link key, or 'none'). */
  link?: string
}

export interface GoalDraft {
  kind: 'goal'
  name: string
  target: Cents | null
  /** "500 por mês": the monthly amount ("Guardar todo mês"). */
  monthly: Cents | null
  currency: Currency | null
  deadline: string | null
  /** Reserve the monthly amount automatically (only when a monthly amount was said). */
  autoSave: boolean
}

export interface ToolDraft {
  kind: 'subscription'
  name: string
  price: Cents | null
  currency: Currency | null
  billing: Extract<ToolBilling, 'monthly' | 'yearly'> | null
  nextCharge: string | null
}

export interface ClientDraft {
  kind: 'client'
  name: string
}

export interface SaleSmart {
  kind: 'sale'
  sale: SaleDraft
}

export interface CaptureSmart {
  kind: 'capture'
  capture: CaptureDraft
}

export type SmartDraft = MoneyDraft | GoalDraft | ToolDraft | ClientDraft | SaleSmart | CaptureSmart

export type Missing = 'amount' | 'currency' | 'date' | 'name' | 'target' | 'deadline' | 'billing' | 'nextCharge' | 'link' | 'type'

export interface SmartCtx {
  today: string
  data: DataState
  settings: Settings
  convert: Converter
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

const OUT = /\b(gastei|paguei|comprei|gasto de|despesa de|torrei|saiu|debitaram|cobraram)\b/
const IN = /\b(recebi|ganhei|entrou|entraram|caiu|cairam|me pagou|me pagaram|me transferiu|recebimento)\b/
const SALE = /\b(vendi|vendemos|vendeu|fiz uma venda)\b/
const SUB = /\b(assinei|assinatura|assinar|plano mensal|plano anual)\b/
const GOAL = /\b(guardar|juntar|economizar|poupar)\b/
const CLIENT = /\b(novo cliente|cliente novo|cadastrar (?:o |a )?cliente|cadastra (?:o |a )?cliente)\b/

/** "ontem", "anteontem" (the Assistant's reader does the rest: hoje, amanhã, sexta, 15/10…). */
function readDay(t: string, today: string): { date: string; match: string } | null {
  let m = t.match(/\banteontem\b/)
  if (m) return { date: addDaysToDate(today, -2), match: m[0] }
  m = t.match(/\bontem\b/)
  if (m) return { date: addDaysToDate(today, -1), match: m[0] }
  return readDate(t, today)
}

/** Removes the folded `piece` from the original text (same positions). */
function cut(src: string, folded: string, piece: string): { src: string; folded: string } {
  const i = folded.indexOf(piece)
  if (i < 0 || !piece) return { src, folded }
  return { src: src.slice(0, i) + ' ' + src.slice(i + piece.length), folded: folded.slice(0, i) + ' ' + folded.slice(i + piece.length) }
}

const FILLER = /^(?:e|eu|o|a|os|as|um|uma|no|na|nos|nas|em|com|de|do|da|dos|das|pelo|pela|pra|para|por|hoje|reais|euros|ja|que)\b\s*/i

function tidy(s: string): string {
  let out = s.replace(/[,;.!?]+/g, ' ').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 6; i++) out = out.replace(FILLER, '').trim()
  out = out.replace(/\s+(?:e|no|na|em|com|de|do|da|pelo|pela|para|pra|por|hoje)$/i, '').trim()
  return cap(out)
}

function readMoney(src: string, ctx: SmartCtx): MoneyDraft {
  const folded = foldSame(src)
  const type: 'in' | 'out' = IN.test(folded) && !OUT.test(folded) ? 'in' : 'out'
  let s = { src, folded }
  const amt = readAmount(src, { strict: false })
  if (amt) s = cut(s.src, s.folded, amt.match)
  const day = readDay(s.folded, ctx.today)
  if (day) s = cut(s.src, s.folded, day.match)
  const verb = s.folded.match(type === 'in' ? IN : OUT)
  if (verb) s = cut(s.src, s.folded, verb[0])
  // Who: "do João", "da Maria Clara" (capitalised as written), "para o Pedro".
  let person = ''
  const pm = s.src.match(/\b(?:do|da|de|para o|para a|pro|pra)\s+((?:[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ]+)(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ÿ]+)?)/)
  if (pm) {
    person = pm[1]
    s = { src: s.src.replace(pm[0], ' '), folded: s.folded.replace(foldSame(pm[0]), ' ') }
  }
  const rest = tidy(s.src)
  const reason = type === 'in' ? [person, rest].filter(Boolean).join(' · ') || 'Entrada' : rest || person || 'Saída'
  const currency = amt?.currency ?? onlyCurrency(ctx.settings)
  let category: string | null = null
  try {
    const g = makeCategorizer(ctx.data, ctx).guess(type, reason, { key: 'smart', kind: type === 'in' ? 'moneyIn' : 'moneyOut', date: ctx.today, origin: { collection: 'transactions', id: 'smart', label: reason }, label: reason, amount: amt?.cents, currency: currency ?? undefined, moneyOrigin: 'manual', text: reason, names: {} })
    category = g.applied?.id ?? null
  } catch {
    category = null
  }
  return { kind: 'money', type, amount: amt?.cents ?? null, currency, date: day?.date ?? null, reason, category, person }
}

function readGoal(src: string, ctx: SmartCtx): GoalDraft {
  const t = foldSame(src)
  const amounts = readAmounts(src, { strict: false })
  const monthlyRe = /\b(por mes|ao mes|todo mes|todos os meses|mensais|mensal)\b/
  let monthly: Cents | null = null
  let target: Cents | null = null
  for (const a of amounts) {
    const after = t.slice(a.index + a.match.length, a.index + a.match.length + 16)
    if (monthlyRe.test(after) && monthly === null) monthly = a.cents
    else if (target === null) target = a.cents
  }
  if (monthly === null && target !== null && monthlyRe.test(t) && amounts.length === 1) {
    monthly = target
    target = null
  }
  const currency = amounts.find((a) => a.currency)?.currency ?? onlyCurrency(ctx.settings)
  const nm = src.match(/\b(?:para|pra)\s+(?:(?:comprar|fazer|pagar|trocar de)\s+)?(?:o |a |um |uma |meu |minha )?([^,.;]{3,40}?)(?:\s+(?:até|ate|em)\b|[,.;]|$)/i)
  const name = nm ? cap(nm[1].trim()) : ''
  const d = readDay(t.replace(monthlyRe, ' '), ctx.today)
  return { kind: 'goal', name, target, monthly, currency, deadline: d && d.date > ctx.today ? d.date : null, autoSave: monthly !== null }
}

function readTool(src: string, ctx: SmartCtx): ToolDraft {
  const t = foldSame(src)
  const amt = readAmount(src, { strict: false })
  const billing = /\b(por ano|ao ano|anual|anuais|por anos)\b/.test(t) ? 'yearly' : /\b(por mes|ao mes|mensal|mensais|todo mes)\b/.test(t) ? 'monthly' : null
  // The name: "assinei o Figma", "assinatura do Notion", "assinei a Netflix" — a generic word is not a name.
  const generic = /^(uma?|o|a)?\s*(ferramenta|app|aplicativo|servico|plano|assinatura|programa|software|site)$/i
  let name = ''
  const m = src.match(/\b(?:assinei|assinar|assinatura (?:do|da|de))\s+(?:o |a |um |uma )?([^\d,.;€$]{2,40}?)(?:\s+(?:de|por|a|com|no|na)\b|\s*[\d,.;€$]|$)/i)
  if (m && !generic.test(foldSame(m[1].trim()))) name = cap(m[1].trim())
  const d = readDay(t, ctx.today)
  return { kind: 'subscription', name, price: amt?.cents ?? null, currency: amt?.currency ?? onlyCurrency(ctx.settings), billing, nextCharge: d?.date ?? null }
}

function readClient(src: string): ClientDraft {
  const m = src.match(/\b(?:novo cliente|cliente novo|cadastrar (?:o |a )?cliente|cadastra (?:o |a )?cliente)\s*:?\s*(.+)$/i)
  return { kind: 'client', name: m ? cap(m[1].trim().replace(/[.!]+$/, '')) : '' }
}

/** What the sentence is, or null when nothing useful was understood. */
export function understand(text: string, ctx: SmartCtx): SmartDraft | null {
  const src = text.trim().replace(/\s+/g, ' ')
  if (!src) return null
  const t = foldSame(src)
  const knownNames = [...ctx.data.clients.map((c) => c.name), ...ctx.data.sales.map((s) => s.clientName).filter(Boolean)]
  if (SALE.test(t)) {
    const r = readSaleText(src, ctx.today, knownNames)
    if (r.kind === 'create') return { kind: 'sale', sale: { ...r.draft, currency: r.draft.currency ?? onlyCurrency(ctx.settings) } }
  }
  if (CLIENT.test(t)) return readClient(src)
  if (SUB.test(t) && readAmount(src, { strict: false })) return readTool(src, ctx)
  if (GOAL.test(t) && !/\b(guardar|juntar)\s+(?:na|no|em)\s+(?:gaveta|armario|caixa)\b/.test(t) && readAmount(src, { strict: false })) return readGoal(src, ctx)
  if (OUT.test(t) || IN.test(t)) return readMoney(src, ctx)
  const capture = parseCapture(src, ctx.today)
  return capture.title ? { kind: 'capture', capture } : null
}

// ---------------------------------------------------------------- payment identification

export interface PaymentLink {
  key: string
  label: string
  kind: 'sale' | 'charge'
  saleId?: string
  run?: AutomationRun
  /** Still open on it (in its currency). */
  open?: Cents
}

const nameMatch = (hay: string, needle: string) => {
  const h = foldSame(hay)
  const n = foldSame(needle).trim()
  return Boolean(n) && n.split(' ').every((w) => w.length >= 2 && new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(h))
}

/**
 * Things already registered that this money may settle — so the same payment is never counted twice:
 * - income: open sales of that person (same currency), subscriber charges waiting ("A receber");
 * - expense: subscription charges waiting ("A pagar") whose name is in the sentence.
 */
export function paymentLinks(d: MoneyDraft, data: Pick<DataState, 'sales' | 'clients' | 'automationRuns'>, text: string): PaymentLink[] {
  const out: PaymentLink[] = []
  const clients = new Map(data.clients.map((c) => [c.id, c.name]))
  if (d.type === 'in') {
    const who = d.person
    for (const s of data.sales as Sale[]) {
      const buyer = s.clientId ? (clients.get(s.clientId) ?? '') : s.clientName
      const open = saleRemaining(s)
      if (open <= 0 || !who || !nameMatch(buyer, who)) continue
      if (d.currency && s.currency !== d.currency) continue
      out.push({ key: `sale:${s.id}`, kind: 'sale', saleId: s.id, open, label: `Pagamento da venda “${s.product || 'venda'}” de ${buyer} (falta ${formatMoney(open, s.currency)})` })
    }
    for (const r of data.automationRuns) {
      if (r.automation !== 'subscriberCharge' || r.status !== 'pending' || r.dismissedAt) continue
      if (!who || !nameMatch(r.origin.label, who)) continue
      if (d.currency && r.currency && r.currency !== d.currency) continue
      out.push({ key: `run:${r.id}`, kind: 'charge', run: r, label: `Cobrança de ${r.origin.label} de ${r.date.split('-').reverse().join('/')} (a receber)` })
    }
  } else {
    for (const r of data.automationRuns) {
      if (r.automation !== 'toolCharge' || r.status !== 'pending' || r.dismissedAt) continue
      if (!nameMatch(text, r.origin.label)) continue
      if (d.currency && r.currency && r.currency !== d.currency) continue
      out.push({ key: `run:${r.id}`, kind: 'charge', run: r, label: `Cobrança de ${r.origin.label} de ${r.date.split('-').reverse().join('/')} (a pagar)` })
    }
  }
  return out
}

/** What still has to be answered before saving (in the order it is asked). */
export function missingOf(d: SmartDraft, links: PaymentLink[] = []): Missing[] {
  const out: Missing[] = []
  switch (d.kind) {
    case 'money':
      if (!d.amount) out.push('amount')
      if (!d.currency) out.push('currency')
      if (!d.date) out.push('date')
      if (links.length && !d.link) out.push('link')
      if (!d.reason.trim()) out.push('name')
      break
    case 'goal':
      if (!d.name.trim()) out.push('name')
      if (!d.target) out.push('target')
      if (!d.currency) out.push('currency')
      if (!d.deadline) out.push('deadline')
      break
    case 'subscription':
      if (!d.name.trim()) out.push('name')
      if (!d.price) out.push('amount')
      if (!d.currency) out.push('currency')
      if (!d.billing) out.push('billing')
      if (!d.nextCharge) out.push('nextCharge')
      break
    case 'client':
      if (!d.name.trim()) out.push('name')
      break
    case 'sale':
      if (!d.sale.currency) out.push('currency')
      break
    case 'capture':
      break
  }
  return out
}

/** A movement typed the same way today already exists (same direction, value, currency, day and text). */
export function sameMovement(d: MoneyDraft, data: Pick<DataState, 'transactions'>, dayOf: (iso: string) => string): boolean {
  return data.transactions.some((t) => t.type === d.type && t.amount === d.amount && t.currency === d.currency && dayOf(t.createdAt) === d.date && foldSame(t.reason).trim() === foldSame(d.reason).trim())
}

export const KIND_TITLE: Record<SmartDraft['kind'], string> = {
  money: 'Movimentação',
  goal: 'Meta financeira',
  subscription: 'Assinatura',
  client: 'Cliente',
  sale: 'Venda',
  capture: 'Tarefa ou compromisso',
}
