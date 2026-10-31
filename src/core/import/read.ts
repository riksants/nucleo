/**
 * From the chosen file to statement lines, on the device. A CSV with the same header as a saved model
 * ("Meu Sabadell") is read with that model by itself; otherwise with the Núcleo's guess, which the
 * person can correct on the column screen (and save as a model).
 */
import type { CsvMapping, Currency, ImportTemplate } from '../../data/types'
import { guessMapping, MAX_IMPORT_LINES, mappingProblems, readLines, readSheet, type CsvGuess, type CsvSheet } from './csv'
import { decodeBytes } from './decode'
import { MAX_PASTE_CHARS, readPastedLines } from './pasted'
import { hash16 } from '../rules/hash'
import { isZip, zipEntries, ZipError } from '../intake/zip'
import { readXlsx } from '../intake/xlsx'
import { sniff } from './decode'
import { readOfx } from './ofx'
import type { ParsedLine } from './types'

export type FileRead =
  | { kind: 'error'; message: string }
  | { kind: 'ofx'; lines: ParsedLine[]; account?: string; currency?: Currency; hash?: string }
  | { kind: 'csv'; sheet: CsvSheet; guess: CsvGuess; mapping: CsvMapping; template: ImportTemplate | null; source?: 'xlsx' | 'text'; hash?: string }
  /** Etapa 4: text pasted as one movement per line. */
  | { kind: 'lines'; lines: ParsedLine[]; ignored: number; hash?: string }

/** The format recorded in the import's history. */
export const formatOf = (r: Exclude<FileRead, { kind: 'error' }>): 'csv' | 'ofx' | 'xlsx' | 'text' => (r.kind === 'ofx' ? 'ofx' : r.kind === 'lines' ? 'text' : (r.source ?? 'csv'))

/** A sheet of rows (from Excel or pasted text) read like a CSV. */
function sheetRead(rows: string[][], templates: ImportTemplate[] | undefined, source: 'xlsx' | 'text', hash: string): FileRead {
  const sheet: CsvSheet = { delimiter: ';', rows: rows.slice(0, MAX_IMPORT_LINES + 50), lineNos: rows.map((_, i) => i + 1) }
  if (!sheet.rows.some((r) => r.some(Boolean))) return { kind: 'error', message: 'A planilha está vazia.' }
  const guess = guessMapping(sheet)
  const template = matchTemplate(templates, guess.signature)
  const mapping: CsvMapping = template
    ? { delimiter: ';', headerRow: guess.mapping.headerRow, columns: template.columns, decimal: template.decimal, dateOrder: template.dateOrder, ...(template.invert ? { invert: true } : {}) }
    : guess.mapping
  return { kind: 'csv', sheet, guess, mapping, template, source, hash }
}

/**
 * Etapa 4: every file the import accepts, including Excel (.xlsx, read on the device). Same result as
 * readFile for CSV/OFX; each read carries a fingerprint of its content (the same file again is recognised).
 */
export async function readFileAsync(bytes: Uint8Array, name: string, templates?: ImportTemplate[]): Promise<FileRead> {
  if (isZip(bytes)) {
    if (!/\.xlsx$/i.test(name) && !(await looksLikeXlsx(bytes))) return { kind: 'error', message: 'Este arquivo compactado não é uma planilha do Excel (.xlsx). O Núcleo lê extratos em CSV, OFX, Excel (.xlsx) ou texto colado.' }
    try {
      const x = await readXlsx(bytes)
      return sheetRead(x.rows, templates, 'xlsx', hash16(x.rows.map((r) => r.join('\t')).join('\n')))
    } catch (err) {
      return { kind: 'error', message: err instanceof ZipError ? err.message : 'Não consegui ler esta planilha. Salve como CSV e tente de novo.' }
    }
  }
  const r = readFile(bytes, name, templates)
  if (r.kind === 'error') return r
  return { ...r, hash: hash16(decodeBytes(bytes)) }
}

async function looksLikeXlsx(bytes: Uint8Array): Promise<boolean> {
  try {
    return zipEntries(bytes).some((e) => e.name === 'xl/workbook.xml')
  } catch {
    return false
  }
}

/** Etapa 4: text copied from the bank — a table (tab or ";") read like a CSV, else one movement per line. */
export function readPasted(text: string, today: string, templates?: ImportTemplate[]): FileRead {
  const t = text.slice(0, MAX_PASTE_CHARS).trim()
  if (!t) return { kind: 'error', message: 'Cole o texto do extrato primeiro.' }
  const hash = hash16(t)
  const sheet = /\t|;/.test(t) ? readSheet(t) : null
  if (sheet && sheet.rows.length > 1) {
    const guess = guessMapping(sheet)
    if (!guess.missing.length) {
      const template = matchTemplate(templates, guess.signature)
      const mapping: CsvMapping = template ? { delimiter: sheet.delimiter, headerRow: guess.mapping.headerRow, columns: template.columns, decimal: template.decimal, dateOrder: template.dateOrder, ...(template.invert ? { invert: true } : {}) } : guess.mapping
      return { kind: 'csv', sheet, guess, mapping, template, source: 'text', hash }
    }
  }
  const lines = readPastedLines(t, today)
  if (lines) return { kind: 'lines', lines: lines.lines, ignored: lines.ignored, hash }
  if (sheet && sheet.rows.length > 1) {
    const guess = guessMapping(sheet)
    return { kind: 'csv', sheet, guess, mapping: guess.mapping, template: null, source: 'text', hash }
  }
  return { kind: 'error', message: 'Não reconheci movimentações neste texto. Cada linha precisa de uma data, uma descrição e um valor com sinal (ex.: “05/10 Mercado -45,20”). Você também pode exportar o extrato em CSV, OFX ou Excel.' }
}

export function matchTemplate(templates: ImportTemplate[] | undefined, signature: string): ImportTemplate | null {
  return (templates ?? []).find((t) => t.signature === signature) ?? null
}

export function readFile(bytes: Uint8Array, name: string, templates?: ImportTemplate[]): FileRead {
  const s = sniff(bytes, name)
  if (s.kind === 'unsupported') return { kind: 'error', message: s.message }
  if (s.kind === 'ofx') {
    const r = readOfx(s.text)
    if (!r) return { kind: 'error', message: 'Não encontrei movimentações neste arquivo OFX.' }
    return { kind: 'ofx', lines: r.lines, account: r.account, currency: r.currency }
  }
  const sheet = readSheet(s.text)
  if (!sheet || sheet.rows.length < 1) return { kind: 'error', message: 'Este arquivo parece usar um formato diferente. O Núcleo lê extratos em CSV (colunas separadas por vírgula, ponto e vírgula ou tab) ou OFX.' }
  const guess = guessMapping(sheet)
  const template = matchTemplate(templates, guess.signature)
  const mapping: CsvMapping = template
    ? { delimiter: sheet.delimiter, headerRow: guess.mapping.headerRow, columns: template.columns, decimal: template.decimal, dateOrder: template.dateOrder, ...(template.invert ? { invert: true } : {}) }
    : guess.mapping
  return { kind: 'csv', sheet, guess, mapping, template }
}

/** Lines of a CSV with a mapping, or what is still missing to read it. */
export function csvLines(sheet: CsvSheet, mapping: CsvMapping): { lines: ParsedLine[]; ignored: number; tooMany?: number; problems: string[] } {
  const problems = mappingProblems(mapping)
  if (problems.length) return { lines: [], ignored: 0, problems }
  const { lines, ignored, tooMany } = readLines(sheet, mapping)
  if (!lines.length) return { lines, ignored, problems: ['Não encontrei movimentações neste arquivo.'] }
  const bad = lines.filter((l) => l.error).length
  if (bad === lines.length) return { lines, ignored, problems: [bad === 1 ? 'Não consegui ler a única linha do arquivo com estas colunas.' : `Não consegui ler nenhuma das ${bad} linhas com estas colunas.`] }
  return tooMany ? { lines, ignored, tooMany, problems: [] } : { lines, ignored, problems: [] }
}

export function templateOf(name: string, guess: Pick<CsvGuess, 'signature'>, mapping: CsvMapping, extra: { currency?: Currency | null; account?: string }, id: string, now: Date): ImportTemplate {
  return {
    id,
    name: name.trim(),
    signature: guess.signature,
    delimiter: mapping.delimiter,
    headerRow: mapping.headerRow,
    columns: mapping.columns,
    decimal: mapping.decimal,
    dateOrder: mapping.dateOrder,
    ...(mapping.invert ? { invert: true } : {}),
    ...(extra.currency ? { currency: extra.currency } : {}),
    ...(extra.account?.trim() ? { account: extra.account.trim() } : {}),
    createdAt: now.toISOString(),
  }
}
