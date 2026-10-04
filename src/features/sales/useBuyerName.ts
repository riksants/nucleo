import type { Sale } from '../../data/types'
import { useNames } from '../shared/useNames'

/** Buyer's display name: the client's name, or the name typed in the sale. */
export function useBuyerName() {
  const names = useNames()
  return (s: Pick<Sale, 'clientId' | 'clientName'>) => (s.clientId ? (names.client(s.clientId) ?? 'Cliente removido') : s.clientName)
}
