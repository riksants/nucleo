import { Cloud, HardDrive, HardDriveUpload, LogOut, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PageHeader } from '../../app/Shell'
import { clearLocalData, localSummary, type LocalSummary } from '../../data/migration'
import { useStore } from '../../data/store'
import { formatDateTime } from '../../lib/dates'
import { Button } from '../../ui/Button'
import { SectionTitle } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { MigrationOffer } from './MigrationOffer'
import { useSession } from './session'
import { useSignOut } from './useSignOut'
import { syncLabel } from './SyncBadge'

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <span className="text-[15px] text-soft">{label}</span>
      <span className="min-w-0 truncate text-right text-[15px]">{value}</span>
    </div>
  )
}

export function AccountPage() {
  const auth = useSession()
  const { syncStatus, repository } = useStore()
  // Same sign-out everywhere (also in Configurações → Conta).
  const { signOut, busy: signingOut } = useSignOut()
  const { toast, confirm } = useFeedback()
  const [local, setLocal] = useState<LocalSummary | null>(null)
  const [offer, setOffer] = useState(false)

  useEffect(() => {
    localSummary().then(setLocal, () => setLocal(null))
  }, [offer])

  if (offer && local) return <MigrationOffer summary={local} onDone={() => setOffer(false)} />

  if (!auth.configured) {
    return (
      <>
        <PageHeader title="Conta" />
        <div className="card p-5 text-[15px] leading-relaxed text-soft">
          A sincronização ainda não foi configurada nesta versão do app. Seus dados continuam salvos neste aparelho — use Configurações → Exportar para ter um backup.
        </div>
      </>
    )
  }

  if (!auth.userId) {
    return (
      <>
        <PageHeader title="Conta" />
        <div className="card p-5">
          <div className="mb-4 grid size-11 place-items-center rounded-2xl bg-white/[0.06] text-soft">
            <HardDrive size={20} />
          </div>
          <p className="text-[17px] font-semibold tracking-tight">Seus dados estão só neste aparelho</p>
          <p className="mt-1.5 text-[15px] leading-relaxed text-soft">Entre ou crie uma conta para sincronizar entre celular e computador. Ao entrar, você decide se envia os dados daqui.</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Button size="lg" onClick={() => auth.openAuth('signin')}>
              Entrar
            </Button>
            <Button size="lg" variant="secondary" onClick={() => auth.openAuth('signup')}>
              Criar conta
            </Button>
          </div>
        </div>
      </>
    )
  }

  const syncNow = async () => {
    await repository.syncNow?.()
    const s = repository.status?.()
    toast(s?.state === 'idle' ? 'Sincronizado' : 'Não foi possível sincronizar agora', s?.state === 'idle' ? 'success' : 'error')
  }


  const migrated = Boolean(local && auth.userId && local.migratedTo.includes(auth.userId))
  const hasLocal = Boolean(local && (local.total > 0 || local.settings))

  const removeLocal = async () => {
    const ok = await confirm({
      title: 'Apagar a cópia sem conta?',
      message: 'Os dados deste aparelho já foram enviados e conferidos na sua conta. Isto apaga apenas a cópia que fica disponível quando você usa o app sem entrar.',
      confirmLabel: 'Apagar cópia local',
      danger: true,
    })
    if (!ok) return
    await clearLocalData()
    setLocal(await localSummary())
    toast('Cópia local apagada')
  }

  return (
    <>
      <PageHeader title="Conta" subtitle={auth.email ?? undefined} />
      <div className="grid gap-7 lg:grid-cols-2 lg:items-start">
        <section>
          <SectionTitle>Sincronização</SectionTitle>
          <div className="card divide-y divide-line overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="grid size-9 place-items-center rounded-xl bg-accent/12 text-accent-hi">
                <Cloud size={18} />
              </span>
              <span className="flex-1 text-[15px]">{syncLabel(syncStatus)}</span>
              <Button variant="secondary" icon={<RefreshCw size={16} className={syncStatus?.state === 'syncing' ? 'animate-spin' : ''} />} onClick={syncNow}>
                Agora
              </Button>
            </div>
            {syncStatus?.lastSyncAt && <Line label="Última sincronização" value={formatDateTime(syncStatus.lastSyncAt).toLowerCase()} />}
            {syncStatus?.error && <p className="px-4 py-3 text-[13px] text-warn">{syncStatus.error}</p>}
          </div>
          <p className="mt-2 px-1 text-[13px] leading-relaxed text-faint">Funciona offline: as alterações ficam na fila e são enviadas quando houver internet.</p>
        </section>

        {hasLocal && (
          <section>
            <SectionTitle>Dados deste aparelho (sem conta)</SectionTitle>
            <div className="card divide-y divide-line overflow-hidden">
              <Line label="Registros" value={String(local!.total)} />
              <Line label="Enviados para esta conta" value={migrated ? 'Sim, conferidos' : 'Não'} />
              <button type="button" onClick={() => setOffer(true)} className="flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-white/[0.03] tap">
                <HardDriveUpload size={18} className="text-accent-hi" />
                <span className="text-[15px]">{migrated ? 'Enviar de novo (não duplica)' : 'Enviar para a conta'}</span>
              </button>
              {migrated && (
                <button type="button" onClick={removeLocal} className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-expense hover:bg-white/[0.03] tap">
                  <Trash2 size={18} />
                  <span className="text-[15px]">Apagar cópia local</span>
                </button>
              )}
            </div>
          </section>
        )}

        <section>
          <SectionTitle>Sessão</SectionTitle>
          <div className="card overflow-hidden">
            <button type="button" disabled={signingOut} onClick={signOut} className="flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-white/[0.03] tap">
              <LogOut size={18} className="text-soft" />
              <span className="text-[15px]">Sair desta conta</span>
            </button>
          </div>
          <p className="mt-2 px-1 text-[13px] leading-relaxed text-faint">A sessão fica salva neste aparelho até você sair. Para trocar a senha de login, saia e use “Esqueci minha senha”.</p>
        </section>
      </div>
    </>
  )
}
