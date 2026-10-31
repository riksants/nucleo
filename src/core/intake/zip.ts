/**
 * A small ZIP reader for the files people actually have (.xlsx and .docx are ZIP files of XML), on the device,
 * with the browser's own decompressor (DecompressionStream, iOS 16.4+). No library, nothing sent anywhere.
 *
 * Safe by limits: at most MAX_ENTRIES entries, each file at most MAX_FILE bytes once unpacked, MAX_TOTAL for the
 * whole read, and a compression ratio cap — a "zip bomb" stops with a clear message instead of filling memory.
 * Only what is asked for is unpacked; nothing in the archive is ever executed.
 */

export const MAX_ENTRIES = 2_000
export const MAX_FILE = 25 * 1024 * 1024
export const MAX_TOTAL = 40 * 1024 * 1024
const MAX_RATIO = 200

export class ZipError extends Error {}

export interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  size: number
  offset: number
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

export const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04

/** The entries of the central directory. */
export function zipEntries(b: Uint8Array): ZipEntry[] {
  // End of central directory: the last 22..65557 bytes.
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('O arquivo está incompleto ou corrompido.')
  const count = u16(b, eocd + 10)
  if (count > MAX_ENTRIES) throw new ZipError('O arquivo tem partes demais para ser lido com segurança.')
  let p = u32(b, eocd + 16)
  const out: ZipEntry[] = []
  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new ZipError('O arquivo está incompleto ou corrompido.')
    const method = u16(b, p + 10)
    const compressedSize = u32(b, p + 20)
    const size = u32(b, p + 24)
    const nameLen = u16(b, p + 28)
    const extraLen = u16(b, p + 30)
    const commentLen = u16(b, p + 32)
    const offset = u32(b, p + 42)
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen))
    out.push({ name, method, compressedSize, size, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) {
      await reader.cancel()
      throw new ZipError('Uma parte do arquivo é grande demais depois de descompactada.')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

/** Reads entries by name (only those asked), within the limits. Missing names are simply absent. */
export async function readZip(b: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>()
  let total = 0
  for (const e of zipEntries(b)) {
    if (!wanted(e.name)) continue
    if (e.size > MAX_FILE) throw new ZipError('Uma parte do arquivo é grande demais.')
    if (e.compressedSize > 0 && e.size / e.compressedSize > MAX_RATIO) throw new ZipError('O arquivo parece compactado de forma suspeita e não foi lido.')
    if (u32(b, e.offset) !== 0x04034b50) throw new ZipError('O arquivo está incompleto ou corrompido.')
    const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28)
    const raw = b.subarray(start, start + e.compressedSize)
    let data: Uint8Array
    if (e.method === 0) data = raw.slice()
    else if (e.method === 8) data = await inflate(raw, Math.min(MAX_FILE, MAX_TOTAL - total))
    else throw new ZipError('O arquivo usa uma compactação que o Núcleo não lê.')
    total += data.length
    if (total > MAX_TOTAL) throw new ZipError('O arquivo é grande demais depois de descompactado.')
    out.set(e.name, data)
  }
  return out
}

/** The few XML entities a document uses (and numeric ones). */
export function xmlText(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
