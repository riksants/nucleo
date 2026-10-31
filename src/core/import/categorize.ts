/**
 * Categories for imported lines, in this order:
 * 1. the person's own rules ("Quando sair dinheiro… se o texto contém Mercadona → Mercado");
 * 2. what the person did before with the same merchant (learned from the movements, nothing stored):
 *    only choices made by the person count — a category the Núcleo applied by itself and the person
 *    kept is not evidence, so a guess never reinforces itself;
 * 3. well-known names (Mercadona, Uber, Netflix…).
 *
 * Confidence: one choice is a hint (shown, not applied); two or more consistent choices (≥ 75 % of
 * the person's choices for that merchant) are applied as a suggestion; conflicting choices lower it.
 */
import type { DataState, Rule, Settings, Transaction } from '../../data/types'
import { findCategory, isCategoryHidden } from '../financeCategories'
import { checkConditions, triggerMatches } from '../rules/conditions'
import { activeRules } from '../rules/engine'
import { triggerInfo } from '../rules/catalog'
import type { RuleCtx, RuleEvent } from '../rules/types'
import { merchantKey, plain } from './normalize'

export type CategorySource = 'rule' | 'learned' | 'known'

export interface CategoryGuess {
  id: string
  source: CategorySource
  /** Why, in words ("pela regra “Mercado”", "você escolheu Mercado 3 vezes"). */
  why: string
  /** Applied in the preview (high confidence). False = only a hint the person may tap. */
  apply: boolean
  /** For a rule: which one. */
  ruleId?: string
}

/** Learned choices: merchant → category → how many times the person chose it. */
export type Learned = Map<string, Map<string, number>>

/** Was this category chosen by the person (not left as the Núcleo set it, not set by a payment)? */
function personChoice(t: Transaction): boolean {
  if (!t.category || t.type === 'adjust' || t.source || t.transfer) return false
  if (t.bank) return !t.bank.reconciled && t.category !== t.bank.autoCategory
  return true
}

export function learnFrom(transactions: Transaction[]): Learned {
  const out: Learned = new Map()
  for (const t of transactions) {
    if (!personChoice(t)) continue
    const key = `${t.type}:${merchantKey(t.bank?.raw || t.reason)}`
    if (key.endsWith(':')) continue
    let m = out.get(key)
    if (!m) out.set(key, (m = new Map()))
    m.set(t.category!, (m.get(t.category!) ?? 0) + 1)
  }
  return out
}

export const MIN_LEARNED = 2
export const MIN_SHARE = 0.75

export function learnedGuess(learned: Learned, type: 'in' | 'out', description: string, settings: Settings): CategoryGuess | null {
  const m = learned.get(`${type}:${merchantKey(description)}`)
  if (!m) return null
  let total = 0
  let top: [string, number] | null = null
  for (const [cat, n] of m) {
    total += n
    if (!top || n > top[1]) top = [cat, n]
  }
  if (!top) return null
  const cat = findCategory(settings, top[0])
  if (!cat || cat.type !== type) return null
  const share = top[1] / total
  if (share < 0.5) return null
  const times = top[1] === 1 ? '1 vez' : `${top[1]} vezes`
  const apply = top[1] >= MIN_LEARNED && share >= MIN_SHARE
  const why = total > top[1] ? `você escolheu ${cat.label} ${times} de ${total} para isto` : `você escolheu ${cat.label} ${times} para isto`
  return { id: cat.id, source: 'learned', why, apply }
}

/** Well-known names (pt / es / en / UAE) → default categories. Longer names first ("uber eats" before "uber"). */
const KNOWN: [string, string][] = [
  ['uber eats', 'food'], ['just eat', 'food'], ['deliveroo', 'food'], ['glovo', 'food'], ['ifood', 'food'], ['rappi', 'food'], ['talabat', 'food'], ['careem food', 'food'], ['noon food', 'food'],
  ['mercadona', 'food'], ['carrefour', 'food'], ['lidl', 'food'], ['aldi', 'food'], ['alcampo', 'food'], ['eroski', 'food'], ['consum', 'food'], ['caprabo', 'food'], ['bonpreu', 'food'], ['condis', 'food'], ['hipercor', 'food'], ['supercor', 'food'], ['ahorramas', 'food'], ['spar', 'food'], ['continente', 'food'], ['pingo doce', 'food'], ['pao de acucar', 'food'], ['assai', 'food'], ['atacadao', 'food'], ['spinneys', 'food'], ['lulu', 'food'], ['waitrose', 'food'], ['tesco', 'food'], ['sainsbury', 'food'], ['union coop', 'food'], ['choithrams', 'food'],
  ['mcdonald', 'food'], ['burger king', 'food'], ['starbucks', 'food'], ['telepizza', 'food'], ['dominos', 'food'], ['kfc', 'food'], ['subway', 'food'], ['restaurante', 'food'], ['restaurant', 'food'], ['cafeteria', 'food'], ['padaria', 'food'], ['panaderia', 'food'],
  ['uber', 'transport'], ['cabify', 'transport'], ['bolt', 'transport'], ['careem', 'transport'], ['lyft', 'transport'], ['freenow', 'transport'], ['free now', 'transport'], ['renfe', 'transport'], ['rodalies', 'transport'], ['tmb', 'transport'], ['metro', 'transport'], ['salik', 'transport'], ['rta', 'transport'], ['nol', 'transport'], ['repsol', 'transport'], ['cepsa', 'transport'], ['galp', 'transport'], ['petrobras', 'transport'], ['ipiranga', 'transport'], ['shell', 'transport'], ['enoc', 'transport'], ['adnoc', 'transport'], ['gasolinera', 'transport'], ['parking', 'transport'], ['estacionamento', 'transport'],
  ['netflix', 'subscriptions'], ['spotify', 'subscriptions'], ['hbo', 'subscriptions'], ['disney', 'subscriptions'], ['prime video', 'subscriptions'], ['amazon prime', 'subscriptions'], ['youtube premium', 'subscriptions'], ['icloud', 'subscriptions'], ['apple.com', 'subscriptions'], ['google one', 'subscriptions'], ['google storage', 'subscriptions'], ['dropbox', 'subscriptions'], ['openai', 'subscriptions'], ['chatgpt', 'subscriptions'], ['anthropic', 'subscriptions'], ['claude.ai', 'subscriptions'], ['adobe', 'subscriptions'], ['canva', 'subscriptions'], ['github', 'subscriptions'], ['notion', 'subscriptions'], ['figma', 'subscriptions'], ['shahid', 'subscriptions'], ['osn', 'subscriptions'],
  ['airbnb', 'travel'], ['booking.com', 'travel'], ['ryanair', 'travel'], ['vueling', 'travel'], ['iberia', 'travel'], ['easyjet', 'travel'], ['emirates', 'travel'], ['flydubai', 'travel'], ['etihad', 'travel'], ['latam', 'travel'], ['tap air', 'travel'], ['azul linhas', 'travel'], ['hotel', 'travel'],
  ['farmacia', 'health'], ['pharmacy', 'health'], ['drogaria', 'health'], ['drogasil', 'health'], ['clinica', 'health'], ['hospital', 'health'], ['aster', 'health'], ['life pharmacy', 'health'],
  ['amazon', 'shopping'], ['aliexpress', 'shopping'], ['zara', 'shopping'], ['primark', 'shopping'], ['ikea', 'shopping'], ['decathlon', 'shopping'], ['el corte ingles', 'shopping'], ['mercado livre', 'shopping'], ['mercadolivre', 'shopping'], ['shein', 'shopping'], ['noon', 'shopping'], ['temu', 'shopping'],
  ['endesa', 'bills'], ['iberdrola', 'bills'], ['naturgy', 'bills'], ['holaluz', 'bills'], ['vodafone', 'bills'], ['movistar', 'bills'], ['orange', 'bills'], ['digi', 'bills'], ['yoigo', 'bills'], ['vivo', 'bills'], ['claro', 'bills'], ['tim', 'bills'], ['edp', 'bills'], ['dewa', 'bills'], ['etisalat', 'bills'], ['du telecom', 'bills'], ['enel', 'bills'], ['sabesp', 'bills'],
  ['cinema', 'leisure'], ['cine', 'leisure'], ['ticketmaster', 'leisure'], ['steam', 'leisure'], ['playstation', 'leisure'], ['xbox', 'leisure'], ['nintendo', 'leisure'],
  ['udemy', 'education'], ['coursera', 'education'], ['duolingo', 'education'],
  ['nomina', 'salary'], ['salario', 'salary'], ['salary', 'salary'], ['payroll', 'salary'], ['ordenado', 'salary'],
  ['reembolso', 'refund'], ['refund', 'refund'], ['devolucion', 'refund'], ['estorno', 'refund'],
]

export function knownGuess(type: 'in' | 'out', description: string, settings: Settings): CategoryGuess | null {
  const p = plain(description)
  // "NETFLIX.COM" is Netflix; "booking.com" is only matched with its dot.
  const words = ` ${p.replace(/[^a-z0-9]+/g, ' ')} `
  const dotted = ` ${p.replace(/[^a-z0-9.]+/g, ' ')} `
  for (const [name, id] of KNOWN) {
    if (name.includes('.') ? !dotted.includes(name) : !words.includes(` ${name} `)) continue
    const cat = findCategory(settings, id)
    if (!cat || cat.type !== type || isCategoryHidden(settings, id)) continue
    return { id, source: 'known', why: `“${name}” costuma ser ${cat.label}`, apply: true }
  }
  return null
}

/** Rules that only give a category to money (the import applies it itself, so they don't run again). */
export const categoryOnly = (r: Rule) => r.actions.length > 0 && r.actions.every((a) => a.kind === 'setCategory')

/** The first of the person's rules that would give this line a category. */
export function ruleGuess(rules: Rule[], ev: RuleEvent, ctx: Pick<RuleCtx, 'settings' | 'convert'>): CategoryGuess | null {
  for (const r of rules) {
    if (triggerInfo(r.trigger.kind).scheduled || !triggerMatches(r, ev)) continue
    const action = r.actions.find((a) => a.kind === 'setCategory')
    if (!action || action.kind !== 'setCategory') continue
    if (checkConditions(r.conditions, ev, ctx).ok !== true) continue
    const cat = findCategory(ctx.settings, action.category)
    if (!cat || (ev.kind === 'moneyIn' ? 'in' : 'out') !== cat.type) continue
    return { id: cat.id, source: 'rule', why: `pela regra “${r.name}”`, apply: true, ruleId: r.id }
  }
  return null
}

export interface Categorizer {
  guess(type: 'in' | 'out', description: string, ev: RuleEvent): { applied: CategoryGuess | null; hint: CategoryGuess | null }
}

export function makeCategorizer(data: DataState, ctx: Pick<RuleCtx, 'settings' | 'convert'>): Categorizer {
  const learned = learnFrom(data.transactions)
  const rules = activeRules(data.rules ?? [])
  return {
    guess(type, description, ev) {
      const rule = ruleGuess(rules, ev, ctx)
      if (rule) return { applied: rule, hint: null }
      const l = learnedGuess(learned, type, description, ctx.settings)
      if (l?.apply) return { applied: l, hint: null }
      // The person's own (still uncertain) choice beats a well-known name.
      if (l) return { applied: null, hint: l }
      return { applied: knownGuess(type, description, ctx.settings), hint: null }
    },
  }
}
