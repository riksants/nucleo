/**
 * Values and dates as banks write them: "1.234,56", "1,234.56", "-12,50", "12,50-", "(12.50)",
 * "€ 12,50"; "31/12/2026", "12/31/2026", "2026-12-31", "20261231", "31-dic-2026", "Dec 31, 2026".
 * The decimal separator and the day/month order are decided per column (from all its values), so
 * "03/04" is read the same way in every line of a file.
 */
import type { Cents } from '../../data/types'

export type Decimal = ',' | '.'
export type DateOrder = 'dmy' | 'mdy' | 'ymd'

const SPACES = /[\s  '’]/g

/** Which separator is the decimal one in these values ("." when nothing says otherwise). */
export function inferDecimal(values: string[]): Decimal {
  let comma = 0
  let dot = 0
  for (const raw of values) {
    const v = raw.replace(SPACES, '').replace(/[^\d.,]/g, '')
    if (!v) continue
    const lc = v.lastIndexOf(',')
    const ld = v.lastIndexOf('.')
    if (lc >= 0 && ld >= 0) {
      if (lc > ld) comma++
      else dot++
      continue
    }
    const sep = lc >= 0 ? ',' : ld >= 0 ? '.' : null
    if (!sep) continue
    const parts = v.split(sep)
    const after = parts[parts.length - 1].length
    if (parts.length > 2) {
      // 1.234.567 → that one groups thousands
      if (sep === ',') dot++
      else comma++
    } else if (after !== 3) {
      if (sep === ',') comma++
      else dot++
    }
  }
  return comma > dot ? ',' : '.'
}

/** Signed cents, or null when it is not a value. */
export function parseAmount(raw: string, decimal: Decimal): Cents | null {
  let s = (raw ?? '').trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  s = s.replace(/−/g, '-')
  if (/-\s*$/.test(s) && !/^\s*-/.test(s)) {
    negative = true
    s = s.replace(/-\s*$/, '')
  }
  if (/^[^\d]*-/.test(s)) negative = !negative
  s = s.replace(SPACES, '').replace(/[^\d.,]/g, '')
  if (!s || !/\d/.test(s)) return null
  s = decimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  if (!/^\d*\.?\d*$/.test(s)) return null
  const v = Number(s)
  if (!Number.isFinite(v)) return null
  const cents = Math.round(v * 100)
  return negative ? -cents : cents
}

const MONTHS: Record<string, number> = {
  jan: 1, ene: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dic: 12, dec: 12,
}

const monthOf = (word: string): number | null => {
  const w = word
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .slice(0, 3)
  return MONTHS[w] ?? null
}

const pad = (n: number) => String(n).padStart(2, '0')

function make(y: number, m: number, d: number): string | null {
  if (y < 100) y += y > (new Date().getFullYear() % 100) + 1 ? 1900 : 2000
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** The date part, without a time ("31/12/2026 10:22" → "31/12/2026"). */
const datePart = (raw: string) =>
  raw
    .trim()
    .replace(/[T\s]+\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2}|[ap]\.?m\.?)?$/i, '')
    .trim()

/** "YYYY-MM-DD", or null. */
export function parseDate(raw: string, order: DateOrder): string | null {
  const s = datePart(raw ?? '')
  if (!s) return null
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (m) return make(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return make(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/)
  if (m) return order === 'mdy' ? make(+m[3], +m[1], +m[2]) : make(+m[3], +m[2], +m[1])
  m = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-zÀ-ÿ]+)\.?[\s\-/.,]+(\d{2}|\d{4})$/)
  if (m && monthOf(m[2])) return make(+m[3], monthOf(m[2])!, +m[1])
  m = s.match(/^([A-Za-zÀ-ÿ]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/)
  if (m && monthOf(m[1])) return make(+m[3], monthOf(m[1])!, +m[2])
  return null
}

/** Day/month order of a column of dates: a first part above 12 means day first, a second one means month first. */
export function inferDateOrder(values: string[]): DateOrder {
  let dmy = 0
  let mdy = 0
  let ymd = 0
  for (const raw of values) {
    const s = datePart(raw ?? '')
    if (/^\d{4}[-/.]?\d{1,2}[-/.]?\d{1,2}$/.test(s)) {
      ymd++
      continue
    }
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/)
    if (!m) continue
    if (+m[1] > 12) dmy++
    else if (+m[2] > 12) mdy++
  }
  if (ymd && !dmy && !mdy) return 'ymd'
  return mdy > dmy ? 'mdy' : 'dmy'
}

/** True when the order of these dates can't be told from them (every one could be either). */
export function dateOrderAmbiguous(values: string[]): boolean {
  let numeric = 0
  for (const raw of values) {
    const s = datePart(raw ?? '')
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/)
    if (!m) continue
    numeric++
    if (+m[1] > 12 || +m[2] > 12) return false
  }
  return numeric > 0
}

/** Share of the values that read as dates / as amounts. */
export const dateShare = (values: string[]) => share(values, (v) => parseDate(v, 'dmy') !== null || parseDate(v, 'mdy') !== null)
export const amountShare = (values: string[]) =>
  share(values, (v) => /\d/.test(v) && parseDate(v, 'dmy') === null && parseAmount(v, inferDecimal([v])) !== null && !/[a-z]{4,}/i.test(v.replace(/[A-Z]{3}/g, '')))

function share(values: string[], ok: (v: string) => boolean): number {
  const filled = values.filter((v) => v && v.trim())
  if (!filled.length) return 0
  return filled.filter(ok).length / filled.length
}
