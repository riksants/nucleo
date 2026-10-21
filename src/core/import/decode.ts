/**
 * Turns the bytes of a file into text and says what it is. Banks still export in Windows-1252 (Spain,
 * Brazil): a file that is not valid UTF-8 is read as Windows-1252, so "Débito" never becomes "D�bito".
 */
import type { Sniff } from './types'

export function decodeBytes(bytes: Uint8Array): string {
  let start = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  const body = bytes.subarray(start)
  // OFX 1.x says its charset in the header.
  const head = new TextDecoder('latin1').decode(body.subarray(0, 400))
  if (/CHARSET:\s*(1252|ISO-8859-1|8859-1)/i.test(head) && !/ENCODING:\s*UTF-?8/i.test(head)) return new TextDecoder('windows-1252').decode(body)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch {
    return new TextDecoder('windows-1252').decode(body)
  }
}

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((x, i) => b[i] === x)

/** CSV, OFX, or a human reason why the file can't be read. */
export function sniff(bytes: Uint8Array, name = ''): Sniff {
  if (!bytes.length) return { kind: 'unsupported', message: 'O arquivo está vazio.' }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return { kind: 'unsupported', message: 'Este arquivo é um PDF. Por enquanto o Núcleo lê extratos em CSV ou OFX — no site ou app do banco, procure “exportar” ou “baixar extrato” nesses formatos.' }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return { kind: 'unsupported', message: 'Este arquivo parece ser uma planilha do Excel. Abra-o e salve como CSV, ou baixe o extrato em CSV ou OFX.' }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) return { kind: 'unsupported', message: 'Este arquivo parece ser uma planilha antiga do Excel (.xls). Salve como CSV, ou baixe o extrato em CSV ou OFX.' }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'unsupported', message: 'Este arquivo é uma imagem. O Núcleo lê extratos em CSV ou OFX.' }
  const text = decodeBytes(bytes)
  if (text.includes('\u0000')) return { kind: 'unsupported', message: 'Este arquivo parece usar um formato diferente. O Núcleo lê extratos em CSV ou OFX.' }
  const head = text.slice(0, 2000)
  if (/OFXHEADER|<OFX>|<OFX\s/i.test(head) || /\.(ofx|qfx)$/i.test(name)) {
    if (!/<STMTTRN>|<BANKTRANLIST>|<OFX/i.test(text)) return { kind: 'unsupported', message: 'Este arquivo OFX não tem movimentações que o Núcleo consiga ler.' }
    return { kind: 'ofx', text }
  }
  if (/^\s*!Type:/i.test(head)) return { kind: 'unsupported', message: 'Este arquivo é QIF. Por enquanto o Núcleo lê extratos em CSV ou OFX.' }
  if (/^\s*<(\?xml|html|!doctype)/i.test(head)) return { kind: 'unsupported', message: 'Este arquivo parece usar um formato diferente. O Núcleo lê extratos em CSV ou OFX.' }
  return { kind: 'csv', text }
}
