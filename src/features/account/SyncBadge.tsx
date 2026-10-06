import { Cloud, CloudOff, HardDrive, RefreshCw } from 'lucide-react'
import { useStore } from '../../data/store'
import type { SyncStatus } from '../../data/repository'
import { useSession } from './session'

export function syncLabel(status: SyncStatus | null): string {
  if (!status) return 'Sincronizado'
  if (status.state === 'syncing') return 'Sincronizando…'
  if (status.state === 'offline') return status.pending ? `Offline · ${status.pending} pendente${status.pending > 1 ? 's' : ''}` : 'Offline'
  if (status.state === 'error') return status.rejected ? `${status.rejected} ${status.rejected === 1 ? 'item não enviado' : 'itens não enviados'}` : 'Falha ao sincronizar'
  return status.pending ? `${status.pending} alteração${status.pending > 1 ? 'ões' : ''} a enviar` : 'Sincronizado'
}

/** Small "where is my data" line in the sidebar. */
export function SyncBadge() {
  const { configured, userId, email } = useSession()
  const { syncStatus } = useStore()
  if (!configured) return null
  const Icon = !userId ? HardDrive : syncStatus?.state === 'syncing' ? RefreshCw : syncStatus?.state === 'offline' || syncStatus?.state === 'error' ? CloudOff : Cloud
  return (
    <a href="#/account" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-faint transition-colors hover:bg-tint/[0.03] tap hover:text-soft">
      <Icon size={16} className={`shrink-0 ${syncStatus?.state === 'syncing' ? 'animate-spin' : ''} ${syncStatus?.state === 'error' ? 'text-warn' : ''}`} />
      <span className="min-w-0 truncate">{userId ? `${syncLabel(syncStatus)} · ${email}` : 'Só neste aparelho · Entrar'}</span>
    </a>
  )
}
