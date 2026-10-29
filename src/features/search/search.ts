/** Ranking for Buscar: places/actions of the app (catalog) and the person's own records. Pure, so it is tested directly. */
import type { RoutePath } from '../../app/router'
import type { ModuleId } from '../../data/types'
import { CATALOG, type Destination } from './catalog'
import { fold, Matcher, tokens, type ParsedQuery } from './engine'

// ---------- Places and actions

interface Indexed {
  dest: Destination
  title: string[]
  keywords: string[]
  subtitle: string[]
  foldedTitle: string
  foldedKeywords: string[]
}

const INDEXED: Indexed[] = CATALOG.map((dest) => ({
  dest,
  title: tokens(dest.title),
  keywords: [...new Set(dest.keywords.flatMap(tokens))],
  subtitle: tokens(dest.subtitle),
  foldedTitle: fold(dest.title),
  foldedKeywords: dest.keywords.map(fold),
}))

const catalogMatcher = new Matcher(new Set(INDEXED.flatMap((d) => [...d.title, ...d.keywords, ...d.subtitle])))

export interface PlaceHit {
  dest: Destination
  score: number
  /** The section is hidden: the result offers to show it again instead of opening it. */
  hidden: boolean
}

export interface PlaceContext {
  enabled: (id: ModuleId) => boolean
  hasSubPlans: boolean
}

function placeScore(d: Indexed, q: ParsedQuery): number {
  const words = q.content
  let sum = 0
  let matched = 0
  for (const w of words) {
    const s = Math.max(catalogMatcher.best(w, d.title), 0.92 * catalogMatcher.best(w, d.keywords), 0.6 * catalogMatcher.best(w, d.subtitle))
    if (s >= 0.5) matched++
    sum += s
  }
  // Every meaningful word must match for short queries; most of them for long sentences.
  const needed = words.length <= 2 ? words.length : Math.ceil(words.length * 0.6)
  if (matched < needed || matched === 0) return 0
  let score = sum / words.length
  const phrase = fold(q.content.join(' '))
  if (d.foldedTitle === q.folded || d.foldedTitle === phrase) score += 0.4
  else if (d.foldedTitle.startsWith(q.folded) || d.foldedKeywords.includes(phrase)) score += 0.2
  else if (phrase.length > 4 && d.foldedKeywords.some((k) => k.includes(phrase))) score += 0.1
  // Intent: "adicionar cliente" prefers the action, "quanto tenho para receber?" the answer, a plain word the section.
  const { kind } = d.dest
  if (kind === 'action') score += q.create ? 0.45 : -0.2
  else if (q.create) score -= 0.15
  if (kind === 'answer') score += q.question ? 0.35 : -0.15
  if (kind === 'section') score += 0.05
  return score
}

export function rankPlaces(q: ParsedQuery, ctx: PlaceContext): PlaceHit[] {
  if (!q.content.length) return []
  // One letter: just the names that start with it ("c" → Clientes, Configurações…).
  const letter = q.folded.length === 1 ? q.folded : null
  const hits: PlaceHit[] = []
  for (const d of INDEXED) {
    const mod = d.dest.module
    const on = !mod || ctx.enabled(mod)
    // A hidden section shows up only as itself (to turn it back on); its screens and actions wait until then.
    if (!on && d.dest.kind !== 'section') continue
    if (d.dest.requires === 'subPlans' && !ctx.hasSubPlans) continue
    const score = letter ? (d.foldedTitle.startsWith(letter) ? (d.dest.kind === 'section' ? 0.75 : 0.6) : 0) : placeScore(d, q)
    if (score >= 0.5) hits.push({ dest: d.dest, score: on ? score : score - 0.3, hidden: !on })
  }
  return hits.sort((a, b) => b.score - a.score)
}

// ---------- Records

export interface RecordEntry {
  /** Group label shown above the results ("Clientes"). */
  group: string
  path: RoutePath
  /** Opened with ?open=<id> (a step opens its plan). */
  openId: string
  key: string
  title: string
  subtitle?: string
  titleWords: string[]
  words: string[]
  folded: string
}

export function makeEntry(e: Omit<RecordEntry, 'titleWords' | 'words' | 'folded' | 'key'> & { key?: string }, fields: (string | null | undefined)[]): RecordEntry {
  const text = fields.filter(Boolean).join(' ')
  const titleWords = [...new Set(tokens(e.title))]
  return { ...e, key: e.key ?? e.openId, titleWords, words: [...new Set([...titleWords, ...tokens(text)])], folded: fold(`${e.title} ${text}`) }
}

export class RecordIndex {
  readonly matcher: Matcher
  readonly entries: RecordEntry[]
  constructor(entries: RecordEntry[]) {
    this.entries = entries
    this.matcher = new Matcher(new Set(entries.flatMap((e) => e.words)))
  }
}

export interface RecordGroup {
  label: string
  path: RoutePath
  hits: (RecordEntry & { score: number })[]
  best: number
}

function recordScore(index: RecordIndex, e: RecordEntry, q: ParsedQuery): number {
  // The whole text typed as is (an e-mail, "150,00", part of a word).
  const exact = q.folded.length >= 2 && e.folded.includes(q.folded) ? (fold(e.title).startsWith(q.folded) ? 1.1 : 0.85) : 0
  let sum = 0
  for (const w of q.content) {
    const s = Math.max(index.matcher.best(w, e.titleWords), 0.85 * index.matcher.best(w, e.words))
    // Every meaningful word has to be in the record.
    if (s < 0.5) return exact
    sum += s
  }
  return Math.max(exact, sum / q.content.length)
}

export function searchRecords(index: RecordIndex, q: ParsedQuery): RecordGroup[] {
  if (!q.content.length) return []
  const groups = new Map<string, RecordGroup>()
  for (const e of index.entries) {
    const score = recordScore(index, e, q)
    if (score < 0.55) continue
    let g = groups.get(e.group)
    if (!g) groups.set(e.group, (g = { label: e.group, path: e.path, hits: [], best: 0 }))
    g.hits.push({ ...e, score })
    if (score > g.best) g.best = score
  }
  const list = [...groups.values()]
  for (const g of list) g.hits.sort((a, b) => b.score - a.score)
  // Stable: groups keep their usual order when equally relevant.
  return list.map((g, i) => ({ g, i })).sort((a, b) => b.g.best - a.g.best || a.i - b.i).map((x) => x.g)
}
