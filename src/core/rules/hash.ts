/** FNV-1a 64-bit as 16 hex chars: short, stable on every device, for ids (records ids are ≤ 100 chars). */
export function hash16(s: string): string {
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i))
    h = (h * prime) & mask
  }
  return h.toString(16).padStart(16, '0')
}
