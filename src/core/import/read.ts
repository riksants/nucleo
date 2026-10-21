/**
 * From the chosen file to statement lines, on the device. A CSV with the same header as a saved model
 * ("Meu Sabadell") is read with that model by itself; otherwise with the Núcleo's guess, which the
 * person can correct on the column screen (and save as a model).
 */
import type { CsvMapping, Currency, ImportTemplate } from '../../data/types'
import { guessMapping, mappingProblems, readLines, readSheet, type CsvGuess, type CsvSheet } from './csv'
import { sniff } from './decode'
import { readOfx } from './ofx'
import type { ParsedLine } from './types'

export type FileRead =
  | { kind: 'error'; message: string }
  | { kind: 'ofx'; lines: ParsedLine[]; account?: string; currency?: Currency }
  | { kind: 'csv'; sheet: CsvSheet; guess: CsvGuess; mapping: CsvMapping; template: ImportTemplate | null }

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
export function csvLines(sheet: CsvSheet, mapping: CsvMapping): { lines: ParsedLine[]; ignored: number; problems: string[] } {
  const problems = mappingProblems(mapping)
  if (problems.length) return { lines: [], ignored: 0, problems }
  const { lines, ignored } = readLines(sheet, mapping)
  if (!lines.length) return { lines, ignored, problems: ['Não encontrei movimentações neste arquivo.'] }
  const bad = lines.filter((l) => l.error).length
  if (bad === lines.length) return { lines, ignored, problems: [bad === 1 ? 'Não consegui ler a única linha do arquivo com estas colunas.' : `Não consegui ler nenhuma das ${bad} linhas com estas colunas.`] }
  return { lines, ignored, problems: [] }
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
