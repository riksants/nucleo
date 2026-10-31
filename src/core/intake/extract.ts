/**
 * Importação inteligente (Etapa 4) — step 1: what is inside a file or a pasted text, on the device.
 * Accepted: text (.txt, .md), CSV/TSV, Excel (.xlsx), Word (.docx), PDF with text. Honest about the rest:
 * a scanned PDF or a photo has no text the Núcleo can read without OCR (not in this stage) — the screen says
 * so and points to the iPhone's Live Text. Nothing is executed, nothing is sent anywhere, nothing is stored.
 */
import { decodeBytes } from '../import/decode'
import { readSheet } from '../import/csv'
import { hash16 } from '../rules/hash'
import { PdfError, readPdf } from './pdf'
import { readXlsx } from './xlsx'
import { isZip, readZip, xmlText, zipEntries, ZipError } from './zip'

export const MAX_INTAKE_BYTES = 10 * 1024 * 1024
export const MAX_INTAKE_CHARS = 200_000

export type Extracted =
  | { kind: 'text'; lines: string[]; source: string; hash: string; notes: string[] }
  | { kind: 'table'; rows: string[][]; source: string; hash: string; notes: string[] }
  | { kind: 'error'; message: string }

const starts = (b: Uint8Array, sig: number[]) => sig.every((x, i) => b[i] === x)

const LIVE_TEXT = 'No iPhone, você pode abrir a foto ou o PDF, tocar e segurar o texto (Texto ao Vivo), copiar e colar aqui.'

function cap(lines: string[], notes: string[]): string[] {
  let total = 0
  const out: string[] = []
  for (const l of lines) {
    total += l.length + 1
    if (total > MAX_INTAKE_CHARS) {
      notes.push('O documento é longo: só o começo foi lido. Importe por partes para ver o resto.')
      break
    }
    out.push(l)
  }
  return out
}

/** Pasted text → lines (empty lines dropped, everything else kept as written). */
export function extractText(text: string): Extracted {
  const notes: string[] = []
  const lines = cap(
    text
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+$/, ''))
      .filter((l) => l.trim()),
    notes,
  )
  if (!lines.length) return { kind: 'error', message: 'Cole ou escreva algum conteúdo primeiro.' }
  return { kind: 'text', lines, source: 'Texto colado', hash: hash16(lines.join('\n')), notes }
}

/** Word (.docx): paragraphs, line breaks and tabs, and table rows (cells separated by tabs). */
export function docxText(xml: string): string[] {
  const TAB = '\uE001'
  const BREAK = '\uE002'
  const body = xml.replace(/<w:tab\/>/g, TAB).replace(/<w:br\/>|<w:cr\/>/g, BREAK).replace(/<\/w:tc>/g, TAB).replace(/<\/w:p>/g, BREAK)
  let out = ''
  for (const m of body.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|\uE001|\uE002/g)) {
    if (m[0] === TAB) out += '\t'
    else if (m[0] === BREAK) out += '\n'
    else out += xmlText(m[1])
  }
  return out
    .split('\n')
    .map((l) => l.replace(/\t+$/, '').replace(/\t{2,}/g, '\t').trim())
    .filter(Boolean)
}

export async function extractFile(bytes: Uint8Array, name: string): Promise<Extracted> {
  if (!bytes.length) return { kind: 'error', message: 'O arquivo está vazio.' }
  if (bytes.length > MAX_INTAKE_BYTES) return { kind: 'error', message: 'O arquivo é grande demais (mais de 10 MB). Importe uma parte menor.' }
  const lower = name.toLowerCase()
  const notes: string[] = []

  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47]) || starts(bytes, [0xff, 0xd8, 0xff]) || /\.(png|jpe?g|heic|heif|webp|gif|bmp|tiff?)$/.test(lower))
    return { kind: 'error', message: `É uma imagem. O Núcleo ainda não lê texto de fotos (isso exige reconhecimento de texto, que não faz parte desta etapa). ${LIVE_TEXT}` }
  if (starts(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return { kind: 'error', message: 'Este é um formato antigo do Office (.doc ou .xls). Salve como .docx, .xlsx, PDF ou texto e tente de novo.' }

  if (starts(bytes, [0x25, 0x50, 0x44, 0x46])) {
    try {
      const pdf = await readPdf(bytes)
      if (pdf.chars < 20) return { kind: 'error', message: `Este PDF não tem texto: parece digitalizado (uma imagem de cada página). O Núcleo não lê imagens nesta etapa. ${LIVE_TEXT}` }
      if (pdf.truncated) notes.push(`O PDF tem ${pdf.pageCount} páginas: só as primeiras 40 foram lidas.`)
      const lines = cap(pdf.pages.flat(), notes)
      notes.push('PDF lido pelo texto que ele contém. Colunas lado a lado podem vir misturadas: confira a prévia.')
      return { kind: 'text', lines, source: name, hash: hash16(lines.join('\n')), notes }
    } catch (err) {
      return { kind: 'error', message: err instanceof PdfError ? err.message : 'Não consegui ler este PDF.' }
    }
  }

  if (isZip(bytes)) {
    try {
      const names = zipEntries(bytes).map((e) => e.name)
      if (names.includes('xl/workbook.xml')) {
        const x = await readXlsx(bytes)
        if (x.sheets.length > 1) notes.push(`A planilha tem ${x.sheets.length} abas: só a primeira (“${x.name}”) foi lida.`)
        return { kind: 'table', rows: x.rows, source: name, hash: hash16(x.rows.map((r) => r.join('\t')).join('\n')), notes }
      }
      if (names.includes('word/document.xml')) {
        const files = await readZip(bytes, (n) => n === 'word/document.xml')
        const lines = cap(docxText(new TextDecoder().decode(files.get('word/document.xml'))), notes)
        if (!lines.length) return { kind: 'error', message: 'Este documento do Word não tem texto.' }
        return { kind: 'text', lines, source: name, hash: hash16(lines.join('\n')), notes }
      }
      return { kind: 'error', message: 'Este arquivo compactado não é um documento que o Núcleo lê (Word .docx ou Excel .xlsx).' }
    } catch (err) {
      return { kind: 'error', message: err instanceof ZipError ? err.message : 'Não consegui ler este arquivo.' }
    }
  }

  const text = decodeBytes(bytes)
  if (text.includes('\u0000')) return { kind: 'error', message: 'Este arquivo não é um documento de texto que o Núcleo consiga ler.' }
  if (/^\s*<(?:!doctype|html|\?xml)/i.test(text.slice(0, 200))) return { kind: 'error', message: 'Este arquivo é uma página ou XML. Copie o texto que interessa e cole aqui.' }
  if (/\.(csv|tsv)$/.test(lower)) {
    const sheet = readSheet(text)
    if (sheet && sheet.rows.length) return { kind: 'table', rows: sheet.rows.slice(0, 20_000), source: name, hash: hash16(text), notes }
  }
  const r = extractText(text)
  return r.kind === 'text' ? { ...r, source: name, notes: [...notes, ...r.notes] } : r
}
