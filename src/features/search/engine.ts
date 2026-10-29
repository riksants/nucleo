/**
 * Search matching used by Buscar: accents and case don't matter, plurals match singulars, small typos are
 * forgiven and filler words ("quero", "minhas", "para"…) are ignored. Runs entirely on the device, over the
 * data this person already has loaded (no server query, no paid API).
 */

/** Lowercase, no accents, only letters/digits separated by single spaces. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Light Portuguese plural → singular, so "contas" finds "conta" and "anotações" finds "anotação". */
export function stem(w: string): string {
  if (w.length <= 3 || /^\d+$/.test(w)) return w
  if (w.endsWith('oes') || w.endsWith('aes')) return w.slice(0, -3) + 'ao'
  if (w.endsWith('ais')) return w.slice(0, -3) + 'al'
  if (w.endsWith('eis')) return w.slice(0, -3) + 'el'
  if (w.endsWith('ns')) return w.slice(0, -2) + 'm'
  if (/(r|z|s)es$/.test(w) && w.length > 5) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

export function tokens(s: string): string[] {
  const f = fold(s)
  return f ? f.split(' ').map(stem) : []
}

/** Words that carry no meaning for the search ("quero ver minhas tarefas" → "tarefas"). */
const STOP = new Set(
  [
    'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'para', 'pra', 'pro', 'por', 'com', 'e', 'ou',
    'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'eu', 'me', 'mim', 'que', 'quero', 'queria', 'gostaria', 'preciso', 'precisa', 'como', 'onde', 'fica', 'esta',
    'ver', 'mostrar', 'mostra', 'abrir', 'abre', 'ir', 'tela', 'pagina', 'secao', 'area', 'todos', 'todas', 'tudo', 'tenho', 'tem', 'ja', 'mais',
    'favor', 'quais', 'qual', 'quanto', 'quantos', 'quanta', 'quantas', 'sao', 'ai', 'aqui', 'algum', 'alguma', 'novamente', 'agora', 'este', 'esta', 'esse', 'essa', 'neste', 'nesta', 'nesse', 'nessa', 'isso', 'isto',
  ].map(stem),
)

/** Question words: the person asks something ("quanto tenho para receber?") rather than looking for a name. */
const QUESTION = new Set(['quanto', 'quantos', 'quanta', 'quantas', 'qual', 'quais', 'onde', 'quando', 'como'].map(stem))

/** "Create something" verbs in their usual forms ("quero adicionar um cliente", "nova tarefa", "registrar pagamento"). */
const CREATE = new Set(
  [
    'adicionar', 'adiciona', 'adicione', 'add', 'incluir', 'inclui', 'inserir', 'cadastrar', 'cadastra', 'cadastre', 'cadastro', 'criar', 'cria', 'crie',
    'novo', 'nova', 'registrar', 'registra', 'registre', 'lancar', 'lanca', 'lance', 'anotar', 'anota', 'anote', 'agendar', 'marcar',
    'colocar', 'coloca', 'botar', 'salvar', 'guardar', 'montar', 'capturar',
  ].map(stem),
)

export interface ParsedQuery {
  /** Every word, folded and singular. */
  all: string[]
  /** Words that say what is being looked for (filler and verbs removed). */
  content: string[]
  /** The person wants to create something. */
  create: boolean
  question: boolean
  /** The whole query folded, for substring matches ("joao@", "150,00"). */
  folded: string
}

export function parseQuery(q: string): ParsedQuery {
  const all = tokens(q)
  const create = all.some((t) => CREATE.has(t))
  const question = /\?\s*$/.test(q) || all.some((t) => QUESTION.has(t))
  let content = all.filter((t) => !STOP.has(t) && !CREATE.has(t))
  // "agenda" is both a verb and a section: keep it when it is the only word.
  if (!content.length) content = all.filter((t) => !STOP.has(t))
  if (!content.length) content = all
  return { all, content, create, question, folded: fold(q) }
}

/** Edit distance with an early exit once it exceeds `max` (adjacent swaps count as one). */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
      if (v < best) best = v
    }
    if (best > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

/**
 * How well one typed word matches one word of the content, 0–1:
 * same word 1 · the content word starts with it (still typing) 0.9 · contains it 0.6 · one or two typos 0.75/0.6.
 */
export function wordScore(q: string, w: string): number {
  if (q === w) return 1
  if (w.startsWith(q)) return q.length >= 2 ? 0.9 : 0.5
  // Numbers (amounts, phone digits, codes) match only exactly or from the start: 4321 is not 1321.
  if (/^\d+$/.test(q)) return 0
  if (q.length >= 5 && q.startsWith(w) && w.length >= 4) return 0.8
  if (q.length >= 3 && w.includes(q)) return 0.6
  if (q.length >= 4 && w.length >= 3) {
    const max = q.length >= 7 ? 2 : 1
    const d = distance(q, w.length > q.length + max ? w.slice(0, q.length + max) : w, max)
    // A typo early in a word that is a prefix ("clinte" → "clientes") still counts.
    if (d <= max) return d === 1 ? 0.75 : 0.6
  }
  return 0
}

/**
 * Scores many words against a vocabulary once per query (cached), so matching thousands of records while
 * typing stays fast on a phone.
 */
export class Matcher {
  private cache = new Map<string, Map<string, number>>()
  private readonly vocabulary: Iterable<string>
  constructor(vocabulary: Iterable<string>) {
    this.vocabulary = vocabulary
  }

  /** For a typed word: every vocabulary word it matches, with its score. */
  matchesFor(q: string): Map<string, number> {
    let hit = this.cache.get(q)
    if (hit) return hit
    hit = new Map()
    for (const w of this.vocabulary) {
      const s = wordScore(q, w)
      if (s > 0) hit.set(w, s)
    }
    this.cache.set(q, hit)
    return hit
  }

  /** Best score of `q` among `words` (0 when none matches). */
  best(q: string, words: Iterable<string>): number {
    const m = this.matchesFor(q)
    let top = 0
    for (const w of words) {
      const s = m.get(w)
      if (s && s > top) top = s
      if (top === 1) break
    }
    return top
  }
}
