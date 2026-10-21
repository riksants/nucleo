/**
 * OFX statements, 1.x (SGML: tags often not closed) and 2.x (XML). Each <STMTTRN> is one line: TRNTYPE,
 * DTPOSTED, TRNAMT (signed), FITID, NAME, MEMO. The currency comes from CURDEF; the account from
 * BANKACCTFROM / CCACCTFROM (only its last digits are kept).
 */
import type { Currency } from '../../data/types'
import type { ParsedLine, ReadResult } from './types'
import { parseAmount } from './values'

/** The value of each tag inside a block (first occurrence), closed or not. */
function tags(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /<([A-Z0-9.]+)>([^<\r\n]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) {
    const name = m[1].toUpperCase()
    const value = m[2].trim()
    if (value && !(name in out)) out[name] = decodeEntities(value)
  }
  return out
}

const decodeEntities = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')

/** "20261231", "20261231120000", "20261231120000.000[-3:BRT]" → "2026-12-31". */
export function ofxDay(raw: string): string | null {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/)
  if (!m) return null
  const [y, mo, d] = [+m[1], +m[2], +m[3]]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (y < 1990 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** Blocks between <NAME> and </NAME> (or the next <NAME>, for unclosed SGML). */
function blocks(text: string, name: string): string[] {
  const out: string[] = []
  const open = new RegExp(`<${name}>`, 'gi')
  const close = new RegExp(`</${name}>`, 'i')
  const starts: number[] = []
  let m: RegExpExecArray | null
  while ((m = open.exec(text))) starts.push(m.index + m[0].length)
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : text.length
    const chunk = text.slice(starts[i], end)
    const c = chunk.search(close)
    out.push(c >= 0 ? chunk.slice(0, c) : chunk)
  }
  return out
}

const maskAccount = (id: string) => {
  const digits = id.replace(/\s/g, '')
  return digits.length > 4 ? `•••${digits.slice(-4)}` : digits
}

export function readOfx(text: string): ReadResult | null {
  const statements = [...blocks(text, 'STMTRS'), ...blocks(text, 'CCSTMTRS')]
  const parts = statements.length ? statements : [text]
  const lines: ParsedLine[] = []
  let account: string | undefined
  let currency: Currency | undefined
  for (const st of parts) {
    const head = tags(st.split(/<BANKTRANLIST>/i)[0])
    const cur = head.CURDEF?.toUpperCase()
    if (cur && /^[A-Z]{3}$/.test(cur)) currency ??= cur
    const acct = head.ACCTID
    if (acct) account ??= maskAccount(acct)
    for (const b of blocks(st, 'STMTTRN')) {
      const t = tags(b)
      const rawDate = t.DTPOSTED ?? t.DTUSER ?? ''
      const day = ofxDay(rawDate)
      // OFX uses a point, some Brazilian banks a comma.
      const amtText = t.TRNAMT ?? ''
      const amount = parseAmount(amtText, /,\d{1,2}$/.test(amtText) ? ',' : '.')
      const name = t.NAME ?? t.PAYEE ?? ''
      const memo = t.MEMO ?? ''
      const description = [name, memo].filter((x, i, all) => x && all.indexOf(x) === i).join(' · ') || t.TRNTYPE || ''
      const fitid = t.FITID ?? t.REFNUM ?? ''
      const curLine = (t.CURSYM ?? '').toUpperCase()
      const line: ParsedLine = { row: lines.length + 1, day, date: rawDate, amount, currency: /^[A-Z]{3}$/.test(curLine) ? curLine : cur && /^[A-Z]{3}$/.test(cur) ? cur : null, description }
      if (memo && name && memo !== name) line.memo = memo
      if (fitid) line.fitid = fitid
      if (!day) line.error = rawDate ? `não consegui ler a data “${rawDate}”` : 'linha sem data'
      else if (amount === null) line.error = 'não consegui ler o valor'
      else if (amount === 0) line.error = 'valor zerado'
      lines.push(line)
    }
  }
  if (!lines.length) return null
  return { format: 'ofx', lines, account, currency }
}
