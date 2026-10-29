/**
 * Light structure inside a note's plain text: "- [ ] item" / "- [x] item" is a checklist, "- item" a list,
 * links are recognized. The text itself stays the source (older notes are plain text and keep working).
 */
export type NoteLine =
  | { kind: 'check'; done: boolean; text: string; index: number }
  | { kind: 'bullet'; text: string; index: number }
  | { kind: 'text'; text: string; index: number }

const CHECK = /^\s*[-*]\s*\[([ xX])\]\s?(.*)$/
const BULLET = /^\s*[-*•]\s+(.*)$/

export function parseNote(body: string): NoteLine[] {
  return body.split('\n').map((line, index) => {
    const c = line.match(CHECK)
    if (c) return { kind: 'check', done: c[1] !== ' ', text: c[2], index }
    const b = line.match(BULLET)
    if (b) return { kind: 'bullet', text: b[1], index }
    return { kind: 'text', text: line, index }
  })
}

/** Checks or unchecks the checklist item on line `index`. */
export function toggleLine(body: string, index: number): string {
  const lines = body.split('\n')
  const m = lines[index]?.match(CHECK)
  if (!m) return body
  lines[index] = lines[index].replace(/\[([ xX])\]/, m[1] === ' ' ? '[x]' : '[ ]')
  return lines.join('\n')
}

export function checklistProgress(body: string): { done: number; total: number } {
  const items = parseNote(body).filter((l) => l.kind === 'check')
  return { done: items.filter((l) => l.kind === 'check' && l.done).length, total: items.length }
}

const URL_RE = /\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+/gi

export function linksIn(body: string): string[] {
  return [...new Set(body.match(URL_RE) ?? [])].slice(0, 5)
}
