/**
 * Parte 3 — import of bank statements (CSV / OFX), read on the device. Nothing is written before the
 * person confirms the preview; the file itself is never stored or sent anywhere.
 */
import type { Cents, Currency } from '../../data/types'

/** One line as read from the file, before anything is compared. */
export interface ParsedLine {
  /** Position in the file (1-based, as a person would count the lines). */
  row: number
  /** "YYYY-MM-DD", or null when the date could not be read. */
  day: string | null
  /** The date as written in the file. */
  date: string
  /** Signed: money in > 0, money out < 0. Null when the value could not be read. */
  amount: Cents | null
  /** From the line, the file or (later) the person. */
  currency: Currency | null
  description: string
  memo?: string
  /** Bank id of the line (OFX FITID / id column). */
  fitid?: string
  balance?: Cents
  /** Why the line can't be imported as it is ("data ilegível"). */
  error?: string
}

export interface ReadResult {
  format: 'csv' | 'ofx'
  lines: ParsedLine[]
  /** OFX: the account read from the file ("•••1234"). */
  account?: string
  /** A currency for the whole file (OFX CURDEF). */
  currency?: Currency
}

/** What a file is, before reading it. */
export type Sniff = { kind: 'csv' | 'ofx'; text: string } | { kind: 'unsupported'; message: string }
