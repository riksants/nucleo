import { COLLECTION_LABELS } from './labels'
import type { CollectionName } from './types'

/** A limit the server refused a write for (migration 20261024000000_cotas.sql). */
export interface QuotaHit {
  key: string
  limit: number
}

/** The server says "quota_exceeded:<key>:<limit>" (code 23514). */
export function parseQuota(message: string | null | undefined): QuotaHit | null {
  const m = /quota_exceeded:([\w.]+):(\d+)/.exec(message ?? '')
  return m ? { key: m[1], limit: Number(m[2]) } : null
}

const n = (v: number) => v.toLocaleString('pt-BR')

/** Which limit was reached, in the user's words. */
export function quotaMessage(hit: QuotaHit): string {
  if (hit.key.startsWith('records.')) {
    const label = COLLECTION_LABELS[hit.key.slice('records.'.length) as CollectionName]
    return `Limite de ${n(hit.limit)} itens${label ? ` em “${label}”` : ''} atingido nesta conta.`
  }
  if (hit.key === 'account.bytes') return `Limite de espaço da conta (${Math.round(hit.limit / 1048576)} MB) atingido.`
  if (hit.key === 'account.rows') return `Limite de ${n(hit.limit)} registros da conta atingido.`
  if (hit.key === 'push.devices') return `Esta conta já recebe notificações em ${n(hit.limit)} aparelhos, o limite. Desative as notificações num aparelho que você não usa mais.`
  if (hit.key === 'notifications.active') return `Limite de ${n(hit.limit)} lembretes agendados atingido.`
  return 'Limite da conta atingido.'
}

/** Sync status when some items were refused because of a limit. */
export function quotaSyncMessage(hit: QuotaHit, count: number): string {
  const items = count === 1 ? '1 item continua salvo' : `${count} itens continuam salvos`
  // Deleted items still count as rows (the app keeps them so other devices learn about the deletion).
  if (hit.key === 'account.rows') return `${quotaMessage(hit)} ${items} só neste aparelho.`
  return `${quotaMessage(hit)} ${items} só neste aparelho. Apague itens antigos para liberar espaço: o envio é retomado sozinho.`
}
