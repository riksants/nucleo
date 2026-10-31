/**
 * Excel (.xlsx) → rows of text, on the device. Reads the FIRST sheet (or the one named), shared strings,
 * inline strings, numbers and booleans; a number formatted as a date becomes "dd/mm/aaaa" (1900 and 1904
 * systems). Formulas count by their saved result; nothing is calculated or executed. The old .xls format is
 * a different (binary) format and is not read — the screen says so.
 */
import { readZip, xmlText, ZipError } from './zip'

export const MAX_ROWS = 20_000
export const MAX_COLS = 60

export interface SheetRead {
  name: string
  rows: string[][]
  /** Sheets in the file (the first one is read). */
  sheets: string[]
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Excel serial day → "dd/mm/aaaa" (time of day dropped). */
export function serialToDate(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null
  // 1900 system: day 1 = 1900-01-01, with Excel's fake 29/02/1900 (serial 60).
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const d = new Date(base + Math.floor(serial) * 86_400_000)
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

const text = (b: Uint8Array | undefined) => (b ? new TextDecoder('utf-8').decode(b) : '')

export async function readXlsx(bytes: Uint8Array): Promise<SheetRead> {
  const files = await readZip(bytes, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || n === 'xl/styles.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  const workbook = text(files.get('xl/workbook.xml'))
  if (!workbook) throw new ZipError('Este arquivo não parece uma planilha do Excel (.xlsx).')
  const date1904 = /date1904="(1|true)"/.test(workbook)
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"[^>]*\br:id="([^"]*)"/g)].map((m) => ({ name: xmlText(m[1]), rid: m[2] }))
  const rels = new Map([...text(files.get('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b[^>]*\bId="([^"]*)"[^>]*\bTarget="([^"]*)"/g)].map((m) => [m[1], m[2]]))
  const first = sheets[0]
  const target = first ? rels.get(first.rid) : undefined
  const path = target ? `xl/${target.replace(/^\/?xl\//, '').replace(/^\.\//, '')}` : 'xl/worksheets/sheet1.xml'
  const sheetXml = text(files.get(path) ?? files.get('xl/worksheets/sheet1.xml'))
  if (!sheetXml) throw new ZipError('Não encontrei nenhuma planilha neste arquivo.')

  const shared = [...text(files.get('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))

  // Styles: which cell formats are dates.
  const styles = text(files.get('xl/styles.xml'))
  const custom = new Map([...styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), xmlText(m[2])]))
  const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? ''
  const dateStyle = [...xfs.matchAll(/<xf\b([^>]*)\/?>/g)].map((m) => {
    const id = Number(m[1].match(/numFmtId="(\d+)"/)?.[1] ?? 0)
    if (BUILTIN_DATE.has(id)) return true
    const code = custom.get(id)
    return Boolean(code && /[dy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && !/^[#0.,%\s]+$/.test(code))
  })

  const rows: string[][] = []
  for (const r of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    if (rows.length >= MAX_ROWS) break
    const rowNo = Number((r[1] ?? r[3] ?? '').match(/\br="(\d+)"/)?.[1] ?? rows.length + 1)
    while (rows.length < rowNo - 1 && rows.length < MAX_ROWS) rows.push([])
    const cells: string[] = []
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1]
      const col = ref ? colIndex(ref) : cells.length
      if (col >= MAX_COLS) continue
      const type = attrs.match(/\bt="(\w+)"/)?.[1]
      const style = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? 0)
      const body = c[2] ?? ''
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      let value = ''
      if (type === 's') value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = xmlText([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))
      else if (type === 'b') value = v === '1' ? 'VERDADEIRO' : 'FALSO'
      else if (type === 'str' || type === 'e') value = xmlText(v ?? '')
      else if (v !== undefined) {
        const n = Number(v)
        value = dateStyle[style] ? (serialToDate(n, date1904) ?? v) : v
      }
      while (cells.length < col) cells.push('')
      cells[col] = value.replace(/\r?\n/g, ' ').trim()
    }
    rows.push(cells)
  }
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop()
  return { name: first?.name ?? 'Planilha', rows, sheets: sheets.map((s) => s.name) }
}
