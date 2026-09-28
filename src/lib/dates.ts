const DAY = 24 * 60 * 60 * 1000

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** "YYYY-MM-DD" in local time, the value format of <input type="date">. */
export function toDateInput(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fromDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY)
}

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })
const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
const dayMonthYear = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' })

function cleanMonth(s: string) {
  return s.replace(/\./g, '').replace(/ de /g, ' ')
}

/** "Hoje", "Ontem", "12 set" or "12 set 2025" when not this year. */
export function formatDay(d: Date, now = new Date()): string {
  const diff = daysBetween(d, now)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  if (diff === -1) return 'Amanhã'
  const f = d.getFullYear() === now.getFullYear() ? dayMonth : dayMonthYear
  return cleanMonth(f.format(d))
}

/** "Hoje • 15:42" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${formatDay(d)} • ${time.format(d)}`
}

/** For date-only values ("2026-09-28"). */
export function formatDateValue(value: string): string {
  const d = fromDateInput(value)
  return d ? formatDay(d) : ''
}

/** "em 3 dias", "hoje", "há 2 dias" — for deadlines and charges. */
export function relativeDays(value: string, now = new Date()): { label: string; days: number } | null {
  const d = fromDateInput(value)
  if (!d) return null
  const days = daysBetween(now, d)
  if (days === 0) return { label: 'hoje', days }
  if (days === 1) return { label: 'amanhã', days }
  if (days === -1) return { label: 'ontem', days }
  if (days > 0) return { label: `em ${days} dias`, days }
  return { label: `há ${-days} dias`, days }
}

export function formatWeekday(d: Date): string {
  return weekday.format(d)
}

export type Period = 'today' | '7d' | 'month' | 'year' | 'all'

export const PERIOD_LABELS: Record<Period, string> = {
  today: 'Hoje',
  '7d': '7 dias',
  month: 'Mês',
  year: 'Ano',
  all: 'Tudo',
}

export function periodStart(period: Period, now = new Date()): Date | null {
  switch (period) {
    case 'today':
      return startOfDay(now)
    case '7d':
      return new Date(startOfDay(now).getTime() - 6 * DAY)
    case 'month':
      return new Date(now.getFullYear(), now.getMonth(), 1)
    case 'year':
      return new Date(now.getFullYear(), 0, 1)
    case 'all':
      return null
  }
}

export function monthName(d = new Date()): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(d)
}
