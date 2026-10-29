/**
 * Quick capture of a task in one line: "ligar pro banco amanhã às 10h" → title "ligar pro banco", tomorrow, 10:00.
 * Uses the Assistente's date/time reader (local, no AI). Only what the person wrote is used; nothing is guessed.
 */
import type { TaskPriority } from '../data/types'
import { readDate, readTime } from './assistant/intents'

const strip = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export interface QuickTask {
  title: string
  dueDate: string
  dueTime: string
  priority: TaskPriority
}

/** Removes a phrase found in the folded text from the original words (keeps the person's accents and case). */
export function removePhrase(original: string, phrase: string): string {
  const words = original.split(/\s+/).filter(Boolean)
  const folded = words.map((w) => strip(w).replace(/[?!.,;:]+$/g, ''))
  const target = phrase.trim().split(' ')
  for (let i = 0; i + target.length <= words.length; i++) {
    if (target.every((t, k) => folded[i + k] === t)) {
      // Also drop a dangling "às"/"as"/"para"/"no"/"na" right before it.
      const from = i > 0 && ['as', 'para', 'pra', 'no', 'na', 'ate'].includes(folded[i - 1]) ? i - 1 : i
      return [...words.slice(0, from), ...words.slice(i + target.length)].join(' ')
    }
  }
  return original
}

export function parseQuickTask(text: string, today: string): QuickTask {
  let title = text.trim().replace(/\s+/g, ' ')
  let priority: TaskPriority = 'none'
  if (/(^|\s)(!{1,3}|urgente)(\s|$)/i.test(title)) {
    priority = 'high'
    title = title.replace(/(^|\s)(!{1,3}|urgente)(?=\s|$)/gi, ' ').trim()
  }
  const date = readDate(strip(title), today)
  if (date) title = removePhrase(title, date.match)
  const time = readTime(strip(title))
  if (time) title = removePhrase(title, time.match)
  title = title.replace(/\s+/g, ' ').replace(/^[,;:\s-]+|[,;:\s-]+$/g, '')
  // A time alone means today.
  return { title: title || text.trim(), dueDate: date?.date ?? (time ? today : ''), dueTime: time?.time ?? '', priority }
}
