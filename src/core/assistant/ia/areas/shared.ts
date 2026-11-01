/**
 * NÚCLEO IA — what every lookup shares: context, output limits, facts for money/dates (one fact per
 * currency — never a sum across currencies), and the privacy areas.
 */
import { isEnabled } from '../../../../app/modules'
import type { Currency, DataState, ModuleId, Settings } from '../../../../data/types'
import { formatMoney } from '../../../../lib/money'
import { factForModel, type Fact, type FactBook } from '../../../../../supabase/functions/_shared/ia/facts.ts'
import { MAX_RESULT_CHARS, PRIVACY_AREAS, type Area } from '../../../../../supabase/functions/_shared/ia/tools.ts'

export interface LookupCtx {
  data: DataState
  settings: Settings
  now: Date
  book: FactBook
  /** Areas off for the AI (chosen by the person, or whose sections are off). */
  areasOff: Area[]
}

export interface LookupResult {
  /** JSON for the model. */
  content: string
  isError: boolean
  /** Names of what the lookup was about (kept in the conversation's focus, for "essa", "ele"…). */
  about?: string[]
}

export const PAGE_SIZE = 25

const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
export const dayLabel = (d: string) => `${WD[new Date(`${d}T12:00:00Z`).getUTCDay()]}, ${d.slice(8, 10)}/${d.slice(5, 7)}`
export const dayLabelYear = (d: string) => `${dayLabel(d)}/${d.slice(0, 4)}`
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const monthLong = (m: string) => `${MONTHS_LONG[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
export const has = (hay: string | null | undefined, needle: string) => Boolean(hay) && fold(hay!).includes(fold(needle))
export const textArg = (v: unknown, max = 120): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
export const pageArg = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 200 ? v : 1)

export function out(payload: Record<string, unknown>, about?: string[]): LookupResult {
  let content = JSON.stringify(payload)
  if (content.length > MAX_RESULT_CHARS) {
    // Too big: keep the totals and facts, cut the lists, and say so.
    const slim: Record<string, unknown> = { aviso: 'Resultado reduzido: muitos itens. Peça um período menor, um filtro ou a próxima página.' }
    for (const [k, v] of Object.entries(payload)) slim[k] = Array.isArray(v) ? v.slice(0, 8) : v
    content = JSON.stringify(slim)
    if (content.length > MAX_RESULT_CHARS) content = JSON.stringify({ aviso: slim.aviso, fatos: payload.fatos ?? null, totais: payload.totais ?? null })
  }
  return { content, isError: false, about: about?.filter(Boolean).slice(0, 5) }
}
export const err = (message: string): LookupResult => ({ content: JSON.stringify({ erro: message }), isError: true })

/** One money fact. */
export function moneyFact(book: FactBook, cents: number, currency: Currency, label: string, seal: Fact['seal'] = 'confirmado', base?: string, path = '/finance') {
  return factForModel(book.add({ kind: 'dinheiro', label, display: formatMoney(cents, currency), seal, base, open: { path } }))
}

/** Sums per currency — one fact each, never mixed. `[]` when there is nothing. */
export function byCurrency(book: FactBook, items: { cents: number; currency: Currency }[], label: string, seal: Fact['seal'] = 'confirmado', path = '/finance') {
  const sums = new Map<Currency, number>()
  for (const i of items) sums.set(i.currency, (sums.get(i.currency) ?? 0) + i.cents)
  return [...sums.entries()].filter(([, c]) => c !== 0).map(([cur, cents]) => moneyFact(book, cents, cur, `${label} (${cur})`, seal, undefined, path))
}

export function dateFact(book: FactBook, day: string, label: string, seal: Fact['seal'] = 'confirmado', withYear = false) {
  return factForModel(book.add({ kind: 'data', label, display: withYear ? dayLabelYear(day) : dayLabel(day), seal }))
}
export function countFact(book: FactBook, n: number, label: string, unit?: [string, string]) {
  return factForModel(book.add({ kind: 'contagem', label, display: unit ? `${n} ${n === 1 ? unit[0] : unit[1]}` : String(n), seal: n ? 'confirmado' : 'ausente' }))
}
export function absent(book: FactBook, label: string, display = 'nada encontrado') {
  return factForModel(book.add({ kind: 'texto', label, display, seal: 'ausente' }))
}

/* ------------------------------------------------------------------ privacy areas */

const AREA_MODULES: Record<Exclude<Area, 'busca'>, ModuleId[]> = {
  agenda: ['agenda', 'today', 'routine', 'recurring'],
  tarefas: ['tasks'],
  habitos: ['habits', 'recurring', 'routine'],
  financas: ['finance'],
  metas: ['finance', 'goals', 'week', 'life'],
  vendas: ['sales', 'subscribers'],
  clientes: ['clients', 'projects'],
  alimentacao: ['meals'],
  anotacoes: ['notes', 'inbox'],
}

/** The area has at least one visible section. */
export function areaAvailable(area: Area, settings: Settings): boolean {
  if (area === 'busca') return true
  return AREA_MODULES[area].some((m) => isEnabled(settings, m))
}

/** Areas the AI may NOT read: turned off by the person, or with every section off. */
export function areasOffFor(settings: Settings, chosenOff: readonly string[] = settings.assistantAi?.areasOff ?? []): Area[] {
  return PRIVACY_AREAS.filter((a) => chosenOff.includes(a) || !areaAvailable(a, settings))
}

export const moduleOn = (ctx: LookupCtx, id: ModuleId) => isEnabled(ctx.settings, id)
export const areaOn = (ctx: LookupCtx, area: Area) => !ctx.areasOff.includes(area)
