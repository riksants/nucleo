/** Test helpers: a tiny ZIP writer (stored + deflate) and a minimal PDF writer. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(s).arrayBuffer())
}
export async function makeZip(files: Record<string, string>, compress = true): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const raw = enc.encode(content)
    const data = compress ? await deflate(raw) : raw
    const n = enc.encode(name)
    const local = new Uint8Array(30 + n.length)
    const dv = new DataView(local.buffer)
    dv.setUint32(0, 0x04034b50, true)
    dv.setUint16(8, compress ? 8 : 0, true)
    dv.setUint32(18, data.length, true)
    dv.setUint32(22, raw.length, true)
    dv.setUint16(26, n.length, true)
    local.set(n, 30)
    const c = new Uint8Array(46 + n.length)
    const cv = new DataView(c.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, compress ? 8 : 0, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, n.length, true)
    cv.setUint32(42, offset, true)
    c.set(n, 46)
    parts.push(local, data)
    central.push(c)
    offset += local.length + data.length
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, central.length, true)
  ev.setUint16(10, central.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  const all = [...parts, ...central, end]
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0))
  let o = 0
  for (const p of all) {
    out.set(p, o)
    o += p.length
  }
  return out
}


/** A minimal one-page PDF; `lines` are drawn top to bottom (empty = a PDF with no text, like a scan). */
export function makePdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  const stream = lines.length ? `BT /F1 12 Tf 50 750 Td 16 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET` : '0 0 m 100 100 l S'
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array([...out].map((c) => c.charCodeAt(0) & 0xff))
}
