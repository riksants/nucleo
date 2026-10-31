/**
 * Content passed from the Importação inteligente to "Importar extrato" (movements go through the statement
 * preview — duplicates, transfers, categories — never a shortcut). Kept in memory only, taken once.
 */
export type Handoff = { kind: 'text'; text: string; source: string } | { kind: 'file'; bytes: Uint8Array; name: string }

let pending: Handoff | null = null

export function handOff(h: Handoff): void {
  pending = h
}

export function takeHandoff(): Handoff | null {
  const h = pending
  pending = null
  return h
}
