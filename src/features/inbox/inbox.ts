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

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Same text already waiting in the inbox (case, accents and punctuation ignored). */
export function duplicateOf(items: InboxItem[], text: string): InboxItem | null {
  const key = fold(text)
  return (key && items.find((i) => i.status === 'open' && fold(i.text) === key)) || null
}

/**
 * "Comprar arroz, ovos e leite" → ["Arroz", "Ovos", "Leite"]. Only splits what was written; the person
 * confirms (and can untick) before anything goes to the list.
 */
export function shoppingItems(text: string): string[] {
  const body = text
    .split('\n')[0]
    .replace(/^\s*(?:preciso\s+)?(?:comprar|compra|compras|mercado|supermercado|feira|lista de compras)\s*(?:de|:|-)?\s*/i, '')
    .replace(/\s+(?:no|na|do|da)\s+(?:mercado|supermercado|feira)\b.*$/i, '')
    .replace(/[.!]+$/, '')
  return [...new Set(body.split(/\s*(?:,|;|\+|\s+e\s+)\s*/i).map((x) => x.trim()).filter((x) => x.length > 0 && x.length <= 80))].map((x) => x[0].toUpperCase() + x.slice(1))
}

export function markOrganized(item: InboxItem, convertedTo: { collection: CollectionName; id: string } | null): InboxItem {
  return { ...item, status: 'done', convertedTo, processedAt: new Date().toISOString() }
}
