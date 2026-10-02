/**
 * Shopping list (Etapa 5). Automatic items are computed from the meals of the
 * week every time — never stored; only their state (bought, category, note)
 * is stored, under a fixed id. Manual items are separate records and are never
 * touched by the automatic part.
 *
 * Quantities are never invented: a line without a number stays without one;
 * amounts are added only with compatible units (g/kg, ml/l, un).
 */
import type { MealEntry, ShoppingEntry, WeekId } from '../data/types'

export const SHOPPING_CATEGORIES = ['Frutas', 'Verduras', 'Carnes', 'Laticínios', 'Grãos', 'Padaria', 'Bebidas', 'Congelados', 'Higiene', 'Outros']

/** Light normalisation: case, accents, spaces. "peito de frango" ≠ "frango inteiro". */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.;:!?()"“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

type Dim = 'mass' | 'volume' | 'count' | 'other'

const UNITS: { re: RegExp; unit: string; dim: Dim; factor: number }[] = [
  { re: /^(kg|kgs|quilo|quilos)$/, unit: 'g', dim: 'mass', factor: 1000 },
  { re: /^(g|gr|grs|grama|gramas)$/, unit: 'g', dim: 'mass', factor: 1 },
  { re: /^(l|lt|litro|litros)$/, unit: 'ml', dim: 'volume', factor: 1000 },
  { re: /^(ml|mililitro|mililitros)$/, unit: 'ml', dim: 'volume', factor: 1 },
  { re: /^(un|und|unid|unidade|unidades|x)$/, unit: 'un', dim: 'count', factor: 1 },
]
// Kitchen measures: only added to the very same measure.
const MEASURES = ['colher de sopa', 'colheres de sopa', 'colher de cha', 'colheres de cha', 'colher', 'colheres', 'xicara', 'xicaras', 'fatia', 'fatias', 'dente', 'dentes', 'pacote', 'pacotes', 'lata', 'latas', 'caixa', 'caixas', 'maco', 'macos', 'duzia', 'duzias', 'copo', 'copos', 'pote', 'potes', 'scoop', 'scoops']
const singular = (m: string) => m.replace(/^colheres/, 'colher').replace(/^xicaras/, 'xicara').replace(/s$/, '').replace(/^colher de cha$/, 'colher de cha')

export interface ParsedIngredient {
  raw: string
  /** Display name (as first typed, without the amount). */
  name: string
  key: string
  qty: number | null
  /** Base unit (g, ml, un) or the kitchen measure; null without amount. */
  unit: string | null
  dim: Dim | null
}

const NUM = String.raw`(\d+\/\d+|\d+(?:[.,]\d+)?|½|¼)`

function toNumber(s: string): number {
  if (s === '½') return 0.5
  if (s === '¼') return 0.25
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number)
    return b ? a / b : NaN
  }
  return Number(s.replace(',', '.'))
}

function readUnit(word: string): { unit: string; dim: Dim; factor: number } | null {
  const w = normalizeName(word)
  for (const u of UNITS) if (u.re.test(w)) return u
  return null
}

/** "200g de frango", "2 ovos", "1 kg arroz", "Frango 300 g", "Banana" → name + optional amount. */
export function parseIngredient(raw: string): ParsedIngredient {
  const text = raw.trim().replace(/^[-•*]\s*/, '')
  const plain = (name: string): ParsedIngredient => ({ raw, name: name.trim(), key: normalizeName(name), qty: null, unit: null, dim: null })
  // Amount first: "200 g de frango", "200g frango", "2 ovos", "1 colher de sopa de azeite"
  let m = text.match(new RegExp(`^${NUM}\\s*([a-zA-Zçãéíóú]+(?:\\s+de\\s+(?:sopa|cha|chá))?)?\\s*(?:de\\s+)?(.*)$`, 'i'))
  if (m) {
    const qty = toNumber(m[1])
    const word = m[2] ?? ''
    const rest = (m[3] ?? '').trim()
    const u = word ? readUnit(word) : null
    const measure = word && !u ? MEASURES.find((x) => normalizeName(word) === x) : undefined
    if (Number.isFinite(qty) && qty > 0) {
      if (u && rest) return { raw, name: rest, key: normalizeName(rest), qty: qty * u.factor, unit: u.unit, dim: u.dim }
      if (measure && rest) return { raw, name: rest, key: normalizeName(rest), qty, unit: singular(measure), dim: 'other' }
      // "2 ovos", "3 bananas maduras": the word is part of the name, counted in units.
      const name = `${u || measure ? '' : word} ${rest}`.trim()
      if (name) return { raw, name, key: normalizeName(name), qty, unit: 'un', dim: 'count' }
    }
  }
  // Amount last: "Frango 300 g", "Leite 1 l"
  m = text.match(new RegExp(`^(.*?)\\s+${NUM}\\s*([a-zA-Z]+)?$`, 'i'))
  if (m && m[1].trim()) {
    const qty = toNumber(m[2])
    const u = m[3] ? readUnit(m[3]) : { unit: 'un', dim: 'count' as Dim, factor: 1 }
    if (u && Number.isFinite(qty) && qty > 0) return { raw, name: m[1].trim(), key: normalizeName(m[1]), qty: qty * u.factor, unit: u.unit, dim: u.dim }
  }
  return plain(text)
}

export interface AutoItem {
  key: string
  name: string
  /** Summed amounts per compatible unit. */
  amounts: { unit: string; qty: number }[]
  /** Times it appears without an amount. */
  unquantified: number
  /** Meals that use it. */
  meals: number
  category: string
}

const CATEGORY_WORDS: [string, string[]][] = [
  ['Frutas', ['banana', 'maca', 'laranja', 'mamao', 'manga', 'uva', 'morango', 'abacaxi', 'melancia', 'melao', 'pera', 'kiwi', 'limao', 'abacate', 'fruta', 'frutas']],
  ['Verduras', ['alface', 'tomate', 'cebola', 'alho', 'cenoura', 'batata', 'brocolis', 'couve', 'espinafre', 'pepino', 'abobrinha', 'abobora', 'pimentao', 'rucula', 'legumes', 'salada', 'beterraba', 'mandioca']],
  ['Carnes', ['frango', 'carne', 'peixe', 'atum', 'salmao', 'tilapia', 'porco', 'linguica', 'presunto', 'peito', 'file', 'patinho', 'bife', 'camarao']],
  ['Laticínios', ['leite', 'queijo', 'iogurte', 'manteiga', 'requeijao', 'creme de leite', 'ovo', 'ovos', 'mussarela']],
  ['Grãos', ['arroz', 'feijao', 'lentilha', 'grao de bico', 'aveia', 'macarrao', 'quinoa', 'milho', 'granola', 'farinha', 'tapioca']],
  ['Padaria', ['pao', 'paes', 'bolo', 'torrada', 'biscoito', 'bisnaguinha', 'wrap']],
  ['Bebidas', ['agua', 'suco', 'cafe', 'cha', 'refrigerante', 'cerveja', 'vinho']],
  ['Congelados', ['congelado', 'congelada', 'sorvete', 'pizza', 'hamburguer']],
  ['Higiene', ['sabonete', 'shampoo', 'pasta de dente', 'papel higienico', 'desodorante', 'detergente']],
]

/** Suggested category by a small word list; anything else is "Outros". */
export function guessCategory(key: string): string {
  // Plural-tolerant only for the guess ("bananas" → Frutas); items themselves are not merged by plural.
  const k = key
    .split(' ')
    .map((w) => w.replace(/s$/, ''))
    .join(' ')
  const has = (text: string, w: string) => text === w || text.startsWith(`${w} `) || text.endsWith(` ${w}`) || text.includes(` ${w} `)
  for (const [cat, words] of CATEGORY_WORDS) if (words.some((w) => has(key, w) || has(k, w))) return cat
  return 'Outros'
}

/** Ingredients of the given meals, merged by name; amounts summed only when compatible. */
export function consolidate(meals: MealEntry[]): AutoItem[] {
  const map = new Map<string, AutoItem & { units: Map<string, number> }>()
  for (const meal of meals) {
    const seen = new Set<string>()
    for (const line of meal.ingredients) {
      if (!line.trim()) continue
      const p = parseIngredient(line)
      if (!p.key) continue
      let it = map.get(p.key)
      if (!it) map.set(p.key, (it = { key: p.key, name: p.name.charAt(0).toUpperCase() + p.name.slice(1), amounts: [], unquantified: 0, meals: 0, category: guessCategory(p.key), units: new Map() }))
      if (p.qty !== null && p.unit) it.units.set(p.unit, (it.units.get(p.unit) ?? 0) + p.qty)
      else it.unquantified++
      if (!seen.has(p.key)) {
        it.meals++
        seen.add(p.key)
      }
    }
  }
  return [...map.values()].map(({ units, ...it }) => ({ ...it, amounts: [...units].map(([unit, qty]) => ({ unit, qty })) }))
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '').replace('.', ','))

/** "400 g", "1,2 kg", "2 un + 1 sem quantidade" — or "" when nothing is known. */
export function formatAmounts(item: Pick<AutoItem, 'amounts' | 'unquantified'>): string {
  const parts = item.amounts.map(({ unit, qty }) => {
    if (unit === 'g') return qty >= 1000 ? `${fmt(qty / 1000)} kg` : `${fmt(qty)} g`
    if (unit === 'ml') return qty >= 1000 ? `${fmt(qty / 1000)} l` : `${fmt(qty)} ml`
    return `${fmt(qty)} ${unit}`
  })
  if (parts.length && item.unquantified) parts.push(`${item.unquantified} sem quantidade`)
  return parts.join(' + ')
}

export const autoId = (week: WeekId, key: string) => `auto:${week}:${key}`

export interface ListRow {
  id: string
  kind: 'auto' | 'manual'
  name: string
  amount: string
  category: string
  checked: boolean
  note: string
  /** auto: bought earlier but no longer in the meals. */
  orphan: boolean
  /** auto: how many meals use it. */
  meals: number
  /** The stored record (manual item, or the state of an auto item). */
  record: ShoppingEntry | null
}

/** Automatic rows (with their stored state) + manual rows of one week. */
export function buildList(meals: MealEntry[], entries: ShoppingEntry[], week: WeekId): ListRow[] {
  const mine = entries.filter((e) => e.week === week)
  const states = new Map(mine.filter((e) => e.kind === 'auto').map((e) => [e.id, e]))
  const rows: ListRow[] = []
  const used = new Set<string>()
  for (const it of consolidate(meals)) {
    const id = autoId(week, it.key)
    const st = states.get(id)
    used.add(id)
    if (st?.cleared) continue
    rows.push({ id, kind: 'auto', name: it.name, amount: formatAmounts(it), category: st?.category || it.category, checked: Boolean(st?.checked), note: st?.note ?? '', orphan: false, meals: it.meals, record: st ?? null })
  }
  // Bought items that left the meals stay until "Limpar comprados".
  for (const st of states.values()) {
    if (used.has(st.id) || st.cleared || !st.checked) continue
    rows.push({ id: st.id, kind: 'auto', name: st.name || st.key || '', amount: '', category: st.category || 'Outros', checked: true, note: st.note, orphan: true, meals: 0, record: st })
  }
  for (const e of mine) {
    if (e.kind !== 'manual') continue
    rows.push({ id: e.id, kind: 'manual', name: e.name, amount: [e.qty, e.unit].filter(Boolean).join(' '), category: e.category || 'Outros', checked: e.checked, note: e.note, orphan: false, meals: 0, record: e })
  }
  return rows
}

/** Rows grouped by category in the usual order, unchecked first inside each group. */
export function groupRows(rows: ListRow[]): { category: string; rows: ListRow[] }[] {
  const order = (c: string) => {
    const i = SHOPPING_CATEGORIES.indexOf(c)
    return i < 0 ? SHOPPING_CATEGORIES.length - 1 : i // custom categories before "Outros"? keep stable: after defaults
  }
  const groups = new Map<string, ListRow[]>()
  for (const r of rows) groups.set(r.category, [...(groups.get(r.category) ?? []), r])
  return [...groups]
    .sort(([a], [b]) => (a === 'Outros' ? 1 : b === 'Outros' ? -1 : order(a) - order(b) || a.localeCompare(b)))
    .map(([category, list]) => ({ category, rows: list.sort((a, b) => Number(a.checked) - Number(b.checked) || a.name.localeCompare(b.name)) }))
}

/** Names already on the week's list (to avoid obvious duplicates when copying). */
export function keysOnList(rows: ListRow[]): Set<string> {
  return new Set(rows.map((r) => normalizeName(r.name)))
}
