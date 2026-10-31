/**
 * Text of a PDF, on the device, with PDF.js (Mozilla, Apache-2.0) — loaded only when a PDF is opened.
 * Hardened: PDF.js 6 never evaluates code from fonts (the CVE-2024-4367 class was removed; 6.2.108+ also fixes
 * GHSA-hq66-cqwq-w95j), no scripting, no XFA forms, no font loading, nothing rendered. Lines are rebuilt from the text positions (same height = same line, left to right).
 * A PDF with no text (a scanned image) is reported as such — it is never "read" by guessing.
 */

export const MAX_PDF_PAGES = 40

export class PdfError extends Error {}

export interface PdfText {
  /** Lines of each page read. */
  pages: string[][]
  pageCount: number
  /** More pages than MAX_PDF_PAGES: the rest was not read (said on screen). */
  truncated: boolean
  /** Characters of text found (0 = an image-only/scanned PDF). */
  chars: number
}

interface Item {
  str: string
  transform: number[]
  width?: number
}

/** Items of one page → lines (by height, then left to right; a wide gap becomes a tab). */
export function linesOf(items: Item[]): string[] {
  const rows: { y: number; parts: { x: number; w: number; s: string }[] }[] = []
  for (const it of items) {
    if (!it.str) continue
    const x = it.transform[4]
    const y = it.transform[5]
    let row = rows.find((r) => Math.abs(r.y - y) <= 2.5)
    if (!row) rows.push((row = { y, parts: [] }))
    row.parts.push({ x, w: it.width ?? it.str.length * 4, s: it.str })
  }
  rows.sort((a, b) => b.y - a.y)
  return rows
    .map((r) => {
      const parts = r.parts.sort((a, b) => a.x - b.x)
      let out = ''
      let end = -Infinity
      for (const p of parts) {
        const gap = p.x - end
        out += out ? (gap > 24 ? '\t' : gap > 1.5 && !out.endsWith(' ') && !p.s.startsWith(' ') ? ' ' : '') : ''
        out += p.s
        end = p.x + p.w
      }
      return out.replace(/[  ]+/g, ' ').trim()
    })
    .filter(Boolean)
}

export async function readPdf(bytes: Uint8Array): Promise<PdfText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  }
  const task = pdfjs.getDocument({ data: bytes.slice(), enableXfa: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false, verbosity: 0 })
  let doc
  try {
    doc = await task.promise
  } catch (err) {
    const name = (err as { name?: string })?.name ?? ''
    if (/Password/i.test(name)) throw new PdfError('Este PDF está protegido por senha. Abra-o, remova a senha (ou exporte uma cópia) e tente de novo.')
    throw new PdfError('Não consegui abrir este PDF. Ele pode estar corrompido.')
  }
  try {
    const pageCount = doc.numPages
    const pages: string[][] = []
    let chars = 0
    for (let n = 1; n <= Math.min(pageCount, MAX_PDF_PAGES); n++) {
      const page = await doc.getPage(n)
      const content = await page.getTextContent()
      const lines = linesOf(content.items as Item[])
      chars += lines.join('').length
      pages.push(lines)
      page.cleanup()
    }
    return { pages, pageCount, truncated: pageCount > MAX_PDF_PAGES, chars }
  } finally {
    await task.destroy()
  }
}
