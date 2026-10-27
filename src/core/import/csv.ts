/**
 * CSV statements. Each bank writes its own: the separator (, ; tab |), the header (Data / Date / Fecha…,
 * sometimes after a few lines about the account), one signed value or separate debit/credit columns,
 * decimal comma or point, day/month order. The Núcleo guesses all of it and checks the guess against
 * the values; what it can't tell for sure is left for the person to choose (the column screen).
 */
import type { CsvColumns, CsvMapping, Currency } from '../../data/types'
import { plain } from './normalize'
import type { ParsedLine } from './types'
import { amountShare, dateOrderAmbiguous, dateShare, inferDateOrder, inferDecimal, parseAmount, parseDate } from './values'

export type Role = keyof CsvColumns

/** Header words per column, most specific first (pt / es / en). */
const HEADERS: Record<Role, string[]> = {
  date: ['data', 'date', 'fecha', 'fecha operacion', 'f. operativa', 'f.operativa', 'fecha operativa', 'f. operacion', 'fecha de operacion', 'data lancamento', 'data do lancamento', 'data movimento', 'data da transacao', 'data operacao', 'booking date', 'transaction date', 'posting date', 'posted date', 'completed date', 'started date', 'fecha transaccion', 'fecha movimiento', 'dia', 'fecha valor', 'f. valor', 'data valor', 'value date'],
  description: ['descricao', 'description', 'concepto', 'descripcion', 'historico', 'lancamento', 'detalhes', 'detalhe', 'details', 'movimiento', 'movimento', 'payee', 'merchant', 'beneficiario', 'texto', 'narrative', 'name', 'nome', 'estabelecimento', 'title', 'titulo'],
  memo: ['memo', 'mas datos', 'observaciones', 'observacoes', 'observacao', 'notes', 'nota', 'complemento', 'informacion adicional', 'payment reference', 'referencia del pago'],
  amount: ['valor', 'amount', 'importe', 'quantia', 'montante', 'monto', 'value', 'valor (r$)', 'valor (eur)', 'amount (eur)', 'cantidad', 'total'],
  debit: ['debito', 'debit', 'debitos', 'saida', 'saidas', 'cargo', 'cargos', 'withdrawal', 'withdrawals', 'paid out', 'money out', 'gasto', 'gastos', 'retiradas', 'valor debito'],
  credit: ['credito', 'credit', 'creditos', 'entrada', 'entradas', 'abono', 'abonos', 'deposit', 'deposits', 'paid in', 'money in', 'ingreso', 'ingresos', 'valor credito'],
  type: ['tipo', 'type', 'd/c', 'dc', 'c/d', 'debito/credito', 'debit/credit', 'cr/dr', 'dr/cr', 'sentido', 'natureza', 'tipo de movimiento', 'tipo de transacao'],
  currency: ['moeda', 'currency', 'divisa', 'moneda', 'ccy'],
  balance: ['saldo', 'balance', 'saldo disponible', 'saldo disponivel', 'running balance', 'saldo final', 'saldo apos'],
  id: ['id', 'identificador', 'transaction id', 'id transaccion', 'id da transacao', 'id transacao', 'fitid', 'transferwise id', 'reference number', 'numero de referencia', 'referencia', 'reference', 'ref', 'numero documento', 'n documento', 'documento'],
}

/** The order roles pick their column (specific before generic). */
const ROLE_ORDER: Role[] = ['date', 'debit', 'credit', 'amount', 'balance', 'currency', 'type', 'id', 'memo', 'description']

const DATE_WORDS = /\b(fecha|data|date|dia)\b/

const headerKey = (cell: string) =>
  plain(cell)
    .replace(/[_*:#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** How well a header names a role (0 = not at all). */
function headerScore(role: Role, cell: string): number {
  const h = headerKey(cell)
  if (!h) return 0
  const list = HEADERS[role]
  const exact = list.indexOf(h)
  if (exact >= 0) return 200 - exact
  if (role === 'amount' && DATE_WORDS.test(h)) return 0
  if (role === 'balance' && /\b(anterior|inicial)\b/.test(h)) return 0
  for (let i = 0; i < list.length; i++) {
    const w = list[i]
    if (w.length < 3) continue
    if (new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}([^a-z]|$)`).test(h)) return 100 - i
  }
  return 0
}

/* ----------------------------- splitting ----------------------------- */

/** Rows of the file (quotes, "" escapes and line breaks inside quotes), with the line each starts on. */
export function splitRows(text: string, delimiter: string, limit = Infinity): { rows: string[][]; lineNos: number[] } {
  const rows: string[][] = []
  const lineNos: number[] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let rowLine = 1
  const n = text.length
  for (let i = 0; i < n; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else {
        if (c === '\n') line++
        cell += c
      }
      continue
    }
    if (c === '"' && cell.trim() === '') {
      quoted = true
      cell = ''
    } else if (c === delimiter) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((x) => x.trim() !== '')) {
        rows.push(row.map((x) => x.trim()))
        lineNos.push(rowLine)
        if (rows.length >= limit) return { rows, lineNos }
      }
      row = []
      cell = ''
      line++
      rowLine = line
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) {
    rows.push(row.map((x) => x.trim()))
    lineNos.push(rowLine)
  }
  return { rows, lineNos }
}

/** The separator that splits the first lines into the same number of columns most consistently. */
export function detectDelimiter(text: string): string | null {
  let best: { d: string; score: number; cols: number } | null = null
  for (const d of [';', ',', '\t', '|']) {
    const { rows } = splitRows(text.slice(0, 20000), d, 40)
    if (!rows.length) continue
    const counts = new Map<number, number>()
    for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1)
    let mode = 0
    let freq = 0
    for (const [cols, f] of counts) if (f > freq || (f === freq && cols > mode)) [mode, freq] = [cols, f]
    if (mode < 2) continue
    // The lines at the end of the sample (past any preamble) matter most.
    const tail = rows.slice(Math.floor(rows.length / 3))
    const score = tail.filter((r) => r.length === mode).length / tail.length + Math.min(mode, 8) / 100
    if (!best || score > best.score) best = { d, score, cols: mode }
  }
  return best && best.score >= 0.6 ? best.d : null
}

/* ----------------------------- recognition ----------------------------- */

export interface CsvSheet {
  delimiter: string
  rows: string[][]
  lineNos: number[]
}

export interface CsvGuess {
  mapping: CsvMapping
  /** Names of the columns ("Coluna 3" when the file has no header). */
  headers: string[]
  /** What the person still has to choose before importing ("a coluna de valor"…). */
  missing: string[]
  /** Day/month order could be either (every date ≤ 12/12). */
  dateAmbiguous: boolean
  signature: string
}

export function readSheet(text: string): CsvSheet | null {
  const delimiter = detectDelimiter(text)
  if (!delimiter) return null
  const { rows, lineNos } = splitRows(text, delimiter)
  if (!rows.length) return null
  return { delimiter, rows, lineNos }
}

/** The first row (among the first 30) whose cells name at least two kinds of column. */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const roles = new Set<Role>()
    for (const cell of rows[i]) for (const role of ROLE_ORDER) if (headerScore(role, cell) > 0) roles.add(role)
    const filled = rows[i].filter((c) => c).length
    if (roles.size >= 2 && filled >= 2 && (roles.has('date') || roles.has('amount') || roles.has('debit') || roles.has('credit') || roles.has('description'))) return i
  }
  // Names the Núcleo doesn't know: a first row of words above rows with dates or values is still a header.
  const first = rows[0]
  const second = rows[1]
  const isValue = (c: string) => parseDate(c, 'dmy') !== null || parseDate(c, 'mdy') !== null || (/\d/.test(c) && parseAmount(c, inferDecimal([c])) !== null && !/[a-z]{3,}/i.test(c))
  if (first && second && first.length >= 2 && first.every((c) => c && !isValue(c)) && second.some(isValue)) return 0
  return -1
}

export const signatureOf = (sheet: CsvSheet, headerRow: number) =>
  headerRow >= 0 ? `h:${sheet.rows[headerRow].map(headerKey).join('|')}` : `n:${sheet.delimiter}:${modeWidth(sheet.rows)}`

function modeWidth(rows: string[][]): number {
  const counts = new Map<number, number>()
  for (const r of rows.slice(0, 200)) counts.set(r.length, (counts.get(r.length) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
}

export const columnValues = (sheet: CsvSheet, headerRow: number, col: number, max = 400) =>
  sheet.rows
    .slice(headerRow + 1, headerRow + 1 + max)
    .map((r) => r[col] ?? '')
    .filter((v) => v !== '')

const TYPE_VALUE = /^(d|c|dr|cr|db|debit|credit|debito|credito|débito|crédito|entrada|saida|saída|in|out|cargo|abono|\+|-)$/i

/** The column guess: header words first, then what the values look like; each guess is checked on the values. */
export function guessMapping(sheet: CsvSheet): CsvGuess {
  const headerRow = findHeaderRow(sheet.rows)
  const width = Math.max(modeWidth(sheet.rows.slice(Math.max(headerRow, 0))), headerRow >= 0 ? sheet.rows[headerRow].length : 0)
  const headers = Array.from({ length: width }, (_, i) => (headerRow >= 0 ? sheet.rows[headerRow][i] : '') || `Coluna ${i + 1}`)
  const values = (col: number) => columnValues(sheet, headerRow, col)
  const columns: CsvColumns = {}
  const used = new Set<number>()
  const valid = (role: Role, col: number) => {
    const v = values(col)
    if (!v.length) return role !== 'date' && role !== 'description'
    if (role === 'date') return dateShare(v) >= 0.8
    if (role === 'amount' || role === 'balance') return amountShare(v) >= 0.8
    if (role === 'debit' || role === 'credit') return amountShare(v) >= 0.6
    if (role === 'type') return v.filter((x) => TYPE_VALUE.test(x.trim())).length / v.length >= 0.8
    if (role === 'currency') return v.filter((x) => /^[A-Za-z]{3}$/.test(x.trim())).length / v.length >= 0.8
    return true
  }

  if (headerRow >= 0) {
    // Best names first: an exact "Payment Reference" (memo) wins over "reference" inside it (id).
    const pairs: { role: Role; col: number; score: number }[] = []
    for (const role of ROLE_ORDER) for (let c = 0; c < width; c++) {
      const score = headerScore(role, headers[c])
      if (score > 0) pairs.push({ role, col: c, score })
    }
    pairs.sort((a, b) => b.score - a.score || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.col - b.col)
    for (const p of pairs) {
      if (columns[p.role] !== undefined || used.has(p.col) || !valid(p.role, p.col)) continue
      columns[p.role] = p.col
      used.add(p.col)
    }
  }
  // Without a header (or with names the Núcleo doesn't know): what the values look like.
  if (columns.date === undefined) {
    for (let c = 0; c < width; c++) if (!used.has(c) && dateShare(values(c)) >= 0.9) {
      columns.date = c
      used.add(c)
      break
    }
  }
  if (columns.amount === undefined && columns.debit === undefined && columns.credit === undefined) {
    const numeric = [...Array(width).keys()].filter((c) => !used.has(c) && values(c).length > 0 && amountShare(values(c)) >= 0.9)
    if (numeric.length === 1) {
      columns.amount = numeric[0]
      used.add(numeric[0])
    }
  }
  if (columns.description === undefined) {
    let best = -1
    let len = 0
    for (let c = 0; c < width; c++) {
      if (used.has(c)) continue
      const v = values(c)
      if (!v.length || amountShare(v) > 0.5 || dateShare(v) > 0.5) continue
      const avg = v.reduce((s, x) => s + x.length, 0) / v.length
      if (avg > len) [best, len] = [c, avg]
    }
    if (best >= 0 && len >= 3) {
      columns.description = best
      used.add(best)
    }
  }
  // A debit or credit column alone is not enough to know the sign of every line.
  if (columns.amount === undefined && (columns.debit === undefined) !== (columns.credit === undefined)) {
    delete columns.debit
    delete columns.credit
  }

  const dateValues = columns.date !== undefined ? values(columns.date) : []
  const guessed = [columns.amount, columns.debit, columns.credit].filter((c) => c !== undefined)
  // No value column yet: the decimal separator comes from every column that holds numbers.
  const moneyCols = guessed.length ? guessed : [...Array(width).keys()].filter((c) => c !== columns.date && amountShare(values(c)) >= 0.8)
  const moneyValues = moneyCols.flatMap((c) => values(c))
  const missing: string[] = []
  if (columns.date === undefined) missing.push('data')
  if (columns.amount === undefined && columns.debit === undefined) missing.push('valor')
  if (columns.description === undefined) missing.push('descrição')
  return {
    mapping: { delimiter: sheet.delimiter, headerRow, columns, decimal: inferDecimal(moneyValues), dateOrder: inferDateOrder(dateValues) },
    headers,
    missing,
    dateAmbiguous: dateOrderAmbiguous(dateValues),
    signature: signatureOf(sheet, headerRow),
  }
}

/** What the person must still choose for this mapping (empty = ready). */
export function mappingProblems(m: CsvMapping): string[] {
  const out: string[] = []
  if (m.columns.date === undefined) out.push('Não consegui identificar a coluna de data.')
  if (m.columns.amount === undefined && (m.columns.debit === undefined || m.columns.credit === undefined)) out.push('Não consegui identificar a coluna de valor.')
  if (m.columns.description === undefined && m.columns.memo === undefined) out.push('Não consegui identificar a coluna de descrição.')
  return out
}

/* ----------------------------- lines ----------------------------- */

const SYMBOLS: [RegExp, Currency][] = [
  [/R\$/, 'BRL'],
  [/€/, 'EUR'],
  [/£/, 'GBP'],
  [/US\$|U\$S/, 'USD'],
  [/AED|د\.إ/, 'AED'],
]

/** A currency written next to a value ("12,50 EUR", "R$ 1.234,56"). */
export function currencyIn(text: string): Currency | null {
  const code = text.match(/\b([A-Z]{3})\b/)
  if (code && !/^(CR|DR)$/.test(code[1])) return code[1]
  for (const [re, c] of SYMBOLS) if (re.test(text)) return c
  return null
}

const DEBIT_VALUE = /^(d|dr|db|debit|debito|débito|saida|saída|out|cargo|-)$/i
const BALANCE_LINE = /^(saldo|balance|total|saldo anterior|saldo inicial|saldo final|saldo do dia|saldo disponivel|opening balance|closing balance)\b/

export interface CsvLines {
  lines: ParsedLine[]
  /** Balance/total lines left out ("SALDO ANTERIOR"). */
  ignored: number
  /** Lines past MAX_IMPORT_LINES, not read (B6). */
  tooMany?: number
}

/** A statement is a few hundred lines; past this the file is something else, or a whole history. */
export const MAX_IMPORT_LINES = 20_000

/** The statement lines, read with `mapping`. A line that can't be read comes with why. */
export function readLines(sheet: CsvSheet, mapping: CsvMapping): CsvLines {
  const { columns: c, decimal, dateOrder } = mapping
  const lines: ParsedLine[] = []
  let ignored = 0
  const cell = (r: string[], i: number | undefined) => (i === undefined ? '' : (r[i] ?? '').trim())
  const end = Math.min(sheet.rows.length, mapping.headerRow + 1 + MAX_IMPORT_LINES)
  for (let k = mapping.headerRow + 1; k < end; k++) {
    const r = sheet.rows[k]
    const rawDate = cell(r, c.date)
    const description = cell(r, c.description) || cell(r, c.memo)
    const memo = c.memo !== undefined && c.description !== undefined ? cell(r, c.memo) : ''
    const amountText = cell(r, c.amount)
    const debitText = cell(r, c.debit)
    const creditText = cell(r, c.credit)
    if (!rawDate && !amountText && !debitText && !creditText) {
      ignored++
      continue
    }
    if (BALANCE_LINE.test(plain(description)) && (!rawDate || plain(description).split(' ').length <= 3)) {
      ignored++
      continue
    }
    let amount: number | null
    if (c.amount !== undefined) {
      amount = parseAmount(amountText, decimal)
      const t = cell(r, c.type)
      if (amount !== null && t) amount = DEBIT_VALUE.test(t) ? -Math.abs(amount) : Math.abs(amount)
    } else {
      const debit = debitText ? parseAmount(debitText, decimal) : 0
      const credit = creditText ? parseAmount(creditText, decimal) : 0
      amount = debit === null || credit === null ? null : Math.abs(credit) - Math.abs(debit)
      if (!debitText && !creditText) amount = null
    }
    if (amount !== null && mapping.invert) amount = -amount
    const day = parseDate(rawDate, dateOrder)
    const code = cell(r, c.currency).toUpperCase()
    const currency = /^[A-Z]{3}$/.test(code) ? code : currencyIn(amountText || debitText || creditText)
    const balanceText = cell(r, c.balance)
    const balance = balanceText ? parseAmount(balanceText, decimal) : null
    const fitid = cell(r, c.id)
    const line: ParsedLine = { row: sheet.lineNos[k], day, date: rawDate, amount, currency, description }
    if (memo && memo !== description) line.memo = memo
    if (fitid) line.fitid = fitid
    if (balance !== null) line.balance = balance
    if (!day) line.error = rawDate ? `não consegui ler a data “${rawDate}”` : 'linha sem data'
    else if (amount === null) line.error = 'não consegui ler o valor'
    else if (amount === 0) line.error = 'valor zerado'
    lines.push(line)
  }
  const tooMany = sheet.rows.length - end
  return tooMany > 0 ? { lines, ignored, tooMany } : { lines, ignored }
}
