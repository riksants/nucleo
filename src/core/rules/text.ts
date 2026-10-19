/** Texts of rules: comparison without accents/case and the {marcadores} of actions. */
import type { EventNames } from './types'

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** Markers offered in action texts, with what they become when the event has no such thing. */
export const TOKENS: { key: keyof EventNames; label: string; fallback: string }[] = [
  { key: 'cliente', label: 'nome do cliente', fallback: 'cliente' },
  { key: 'projeto', label: 'nome do projeto', fallback: 'projeto' },
  { key: 'tarefa', label: 'título da tarefa', fallback: 'tarefa' },
  { key: 'venda', label: 'produto da venda', fallback: 'venda' },
  { key: 'descricao', label: 'descrição da movimentação', fallback: 'movimentação' },
  { key: 'valor', label: 'valor', fallback: 'valor' },
]

/** "{cliente}" → the event's client, or a neutral word (never an empty text). */
export function fillTokens(text: string, names: EventNames): string {
  let out = text
  for (const t of TOKENS) out = out.split(`{${t.key}}`).join(names[t.key]?.trim() || t.fallback)
  return out.replace(/\s+/g, ' ').trim()
}
