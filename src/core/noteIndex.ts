/**
 * Anotações with very large texts (a 260 000-character note froze the app once). Everything derived from a
 * note is computed once per version of it (the store replaces the object on every change) and kept in a
 * WeakMap, never on each render or keystroke:
 * - the card preview reads only the beginning;
 * - suggestions read the first ANALYSIS_LIMIT characters;
 * - checklist progress and search cover the whole text (a single linear pass / a substring check).
 * Nothing is cut from the note itself.
 */
import type { Note } from '../data/types'
import { actionsInNote, type Suggestion } from './intentSuggest'
import { linksIn, parseNote, type NoteLine } from './noteText'

/** Suggestions look only at the beginning of a note (enough for real notes; a book doesn't need them). */
export const ANALYSIS_LIMIT = 20_000
/** From here on the editor tells the size (still saved normally). */
export const LARGE_NOTE = 500_000
/** Above this the note is not saved (the server refuses records near 3 MB): told clearly, never cut. */
export const MAX_NOTE = 2_000_000

const PREVIEW_CHARS = 4_000

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export interface NoteSummary {
  title: string
  /** First lines to show (checklist items keep their line index for toggling). */
  lines: NoteLine[]
  progress: { done: number; total: number }
  links: string[]
}

const summaries = new WeakMap<Note, NoteSummary>()
const searchText = new WeakMap<Note, string>()

const CHECK_LINE = /^\s*[-*]\s*\[([ xX])\]/gm

/** Done / total checklist items over the whole text, in one pass (no array of 100 000 lines). */
export function checklistCount(body: string): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const m of body.matchAll(CHECK_LINE)) {
    total++
    if (m[1] !== ' ') done++
  }
  return { done, total }
}

export function summaryOf(note: Note): NoteSummary {
  const hit = summaries.get(note)
  if (hit) return hit
  const lines = parseNote(note.body.slice(0, PREVIEW_CHARS)).filter((l) => l.text.trim())
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
  const title = clip(note.title || lines[0]?.text || 'Sem título', 120)
  const summary: NoteSummary = {
    title,
    lines: (note.title ? lines : lines.slice(1)).slice(0, 3),
    progress: checklistCount(note.body),
    links: linksIn(note.body.slice(0, ANALYSIS_LIMIT)),
  }
  summaries.set(note, summary)
  return summary
}

/**
 * Whole-text search: every word of the query must appear (accents and case ignored). The folded text is built
 * once per version of the note, so typing in the search box is a plain substring check even on huge notes.
 */
export function noteMatches(note: Note, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  let text = searchText.get(note)
  if (text === undefined) {
    text = fold(`${note.title}\n${note.category ?? ''}\n${note.body}`)
    searchText.set(note, text)
  }
  return words.every((w) => text!.includes(w))
}

const actions = new WeakMap<Note, { today: string; list: { line: string; suggestion: Suggestion }[] }>()

/** Possible tasks / reminders / bills in the beginning of a note (not the lines already acted on). */
export function actionsOf(note: Note, today: string, enabled: (kind: string) => boolean): { line: string; suggestion: Suggestion }[] {
  let hit = actions.get(note)
  if (!hit || hit.today !== today) {
    hit = { today, list: actionsInNote(note.body.slice(0, ANALYSIS_LIMIT), today, enabled) }
    actions.set(note, hit)
  }
  return hit.list.filter((a) => !note.acted?.includes(a.line))
}

/** "212 mil caracteres" — for the editor's size line. */
export function sizeWords(chars: number): string {
  if (chars < 1000) return `${chars} caracteres`
  if (chars < 1_000_000) return `${Math.round(chars / 1000)} mil caracteres`
  return `${(chars / 1_000_000).toFixed(1).replace('.', ',')} milhões de caracteres`
}
