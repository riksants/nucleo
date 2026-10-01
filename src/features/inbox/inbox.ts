import type { CollectionName, InboxItem } from '../../data/types'
import { addDaysToDate } from '../../lib/zoned'

/** First line becomes the title; the rest goes to notes. */
export function splitCapture(text: string): { title: string; notes: string } {
  const [first, ...rest] = text.trim().split('\n')
  const title = first.trim()
  if (title.length <= 120) return { title, notes: rest.join('\n').trim() }
  return { title: `${title.slice(0, 117).trimEnd()}…`, notes: text.trim() }
}

/** "hoje" / "amanhã" in the text suggest a date (only a suggestion in the form). */
export function suggestedDate(text: string, today: string): string {
  const t = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  if (/\bamanha\b/.test(t)) return addDaysToDate(today, 1)
  if (/\bhoje\b/.test(t)) return today
  return ''
}

export function markOrganized(item: InboxItem, convertedTo: { collection: CollectionName; id: string } | null): InboxItem {
  return { ...item, status: 'done', convertedTo, processedAt: new Date().toISOString() }
}
