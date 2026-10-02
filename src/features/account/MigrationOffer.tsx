import { HardDriveUpload, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { declineMigration, localSummary, migrateLocalToAccount, migrationDeclined, planMigration, type LocalSummary } from '../../data/migration'
import { useStore } from '../../data/store'
import { createSupabaseRemote } from '../../data/sync'
import type { Account, CollectionName } from '../../data/types'
import { requireSupabase } from '../../lib/supabase'
import { open, unlockWithPassword } from '../../lib/vault'
import { Button } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { Field, TextInput } from '../../ui/Field'
import { useVault } from '../accounts/vault'
import { VaultCreateSheet, VaultUnlockSheet } from '../accounts/VaultSheets'
import { useSession } from './session'

export const COLLECTION_LABELS: Record<CollectionName, string> = {
  transactions: 'Movimentações',
  goals: 'Metas de compra',
  clients: 'Clientes',
  projects: 'Projetos de trabalho',
  tasks: 'Tarefas',
  tools: 'Ferramentas',
  accounts: 'Contas',
  notes: 'Anotações',
  portfolio: 'Portfólio',
  sales: 'Vendas',
  offerings: 'Produtos de assinatura',
  subPlans: 'Planos',
  subscribers: 'Assinantes',
  plannerProfiles: 'Questionários',
  routinePlans: 'Rotinas',
  mealPlans: 'Planos alimentares',
  inbox: 'Caixa de entrada',
  habits: 'Hábitos',
  recurring: 'Recorrentes',
  completions: 'Marcações do dia',
  events: 'Compromissos',
  focusSessions: 'Sessões de foco',
  weeklyGoals: 'Metas semanais',
  challenges: 'Desafios',
  weekCheckins: 'Check-ins semanais',
  weekSnapshots: 'Resumos de semanas fechadas',
  financeGoals: 'Metas financeiras',
  lifePlans: 'Projetos pessoais e objetivos',
  planSteps: 'Etapas de projetos e objetivos',
  meals: 'Refeições planejadas',
  shoppingItems: 'Lista de compras',
}

/** Local data that was never sent (nor refused) for this account. */
export function useMigrationCandidate(uid: string | null) {
  const [summary, setSummary] = useState<LocalSummary | null>(null)
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    if (!uid) return
    let alive = true
    Promise.all([localSummary(), migrationDeclined(uid)])
      .then(([s, declined]) => {
        if (!alive) return
        const hasData = s.total > 0 || Boolean(s.settings)
        setSummary(hasData && !declined && !s.migratedTo.includes(uid) ? s : null)
      })
      .catch(() => setSummary(null))
      .finally(() => alive && setChecked(true))
    return () => {
      alive = false
    }
  }, [uid])
  return { summary, checked, dismiss: () => setSummary(null) }
}

export function MigrationOffer({ summary, onDone }: { summary: LocalSummary; onDone(): void }) {
  const { userId, email } = useSession()
  const { settings, updateSettings, repository } = useStore()
  const vault = useVault()
  const { toast, confirm } = useFeedback()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [vaultSheet, setVaultSheet] = useState<'create' | 'unlock' | null>(null)
  const [localVaultPassword, setLocalVaultPassword] = useState('')

  const plan = planMigration(summary.settings, settings.onboarded ? settings : null, Boolean(userId && summary.migratedTo.includes(userId)))
  const localVault = summary.settings?.vault ?? null
  const sealedLocal = (summary.counts.accounts ?? 0) > 0 && Boolean(localVault)
  // Device passwords sealed with another vault must be re-encrypted with this account's vault.
  const needsReseal = sealedLocal && vault.exists && JSON.stringify(localVault?.byPassword) !== JSON.stringify(settings.vault?.byPassword)
  const carriesVault = sealedLocal && !vault.exists && plan.settings === 'keep'
  const needsVault = summary.plainPasswords > 0 || needsReseal
  const ready = !needsVault || vault.unlocked || (summary.plainPasswords === 0 && !needsReseal)

  const send = async () => {
    if (!userId) return
    setBusy(true)
    setError(null)
    try {
      let localKey: CryptoKey | null = null
      if (needsReseal) {
        if (!localVaultPassword) throw new Error('Digite a senha do cofre deste aparelho.')
        localKey = await unlockWithPassword(localVault!, localVaultPassword)
      }
      if (carriesVault) await updateSettings({ vault: localVault })
      const sealAccount = async (account: Account): Promise<Account> => {
        if (localKey && account.secret) {
          const plain = await open(localKey, account.secret)
          return { ...account, secret: await vault.sealText(plain) }
        }
        return vault.sealAccount(account)
      }
      const remote = createSupabaseRemote(requireSupabase(), userId)
      const result = await migrateLocalToAccount({ uid: userId, remote, plan, accountSettings: settings, sealAccount })
      await repository.syncNow?.()
      const skipped = result.skipped.transactions ? ` ${result.skipped.transactions} movimentações ficaram só no aparelho (moeda do saldo diferente).` : ''
      toast(`${result.verified} registros enviados e conferidos`)
      if (skipped) await confirm({ title: 'Migração concluída', message: `Tudo foi conferido no servidor. A cópia deste aparelho foi mantida.${skipped}`, confirmLabel: 'Ok' })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const later = () => onDone()
  const never = async () => {
    const ok = await confirm({
      title: 'Não enviar para esta conta?',
      message: 'Os dados continuam neste aparelho, disponíveis quando você sair da conta. Dá para enviar depois em Conta.',
      confirmLabel: 'Não enviar',
    })
    if (!ok || !userId) return
    await declineMigration(userId)
    onDone()
  }

  return (
    <div className="flex min-h-dvh flex-col px-6 pt-[calc(env(safe-area-inset-top)+28px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex-1">
          <div className="grid size-12 place-items-center rounded-2xl bg-accent/12 text-accent-hi">
            <HardDriveUpload size={22} />
          </div>
          <h1 className="mt-6 text-[28px] leading-tight font-semibold tracking-[-0.03em]">Dados neste aparelho</h1>
          <p className="mt-2 text-[16px] leading-relaxed text-soft">
            Este aparelho tem dados salvos sem conta. Quer enviá-los para <span className="text-ink">{email}</span>? Se o aparelho é de outra pessoa, escolha “Não enviar”.
          </p>

          <div className="card mt-6 divide-y divide-line">
            {Object.entries(summary.counts).map(([k, n]) => (
              <div key={k} className="flex items-center justify-between px-4 py-3 text-[15px]">
                <span className="text-soft">{COLLECTION_LABELS[k as CollectionName]}</span>
                <span className="num">{n}</span>
              </div>
            ))}
            {summary.total === 0 && <div className="px-4 py-3 text-[15px] text-soft">Só configurações (moeda e saldo inicial)</div>}
          </div>

          <ul className="mt-5 space-y-2 text-[14px] leading-relaxed text-faint">
            <li>• Nada é apagado deste aparelho. A cópia local fica até você decidir.</li>
            <li>• Enviar de novo não duplica: cada registro tem o mesmo identificador.</li>
            {plan.settings === 'keep' && <li>• Sua conta mantém a moeda e o saldo inicial dela.</li>}
            {plan.initialAsAdjustment && <li>• O saldo inicial do aparelho entra como um ajuste visível no histórico.</li>}
            {!plan.moveTransactions && <li className="text-warn">• Movimentações não serão enviadas: a moeda do saldo da conta é diferente da do aparelho.</li>}
          </ul>

          {needsVault && (
            <div className="card mt-5 space-y-3 border-warn/25 p-4">
              <p className="flex items-start gap-2 text-[15px] leading-relaxed">
                <ShieldAlert size={18} className="mt-0.5 shrink-0 text-warn" />
                {summary.plainPasswords > 0
                  ? `${summary.plainPasswords} senha(s) de Contas estão sem criptografia. Elas serão criptografadas pelo cofre antes de sair do aparelho.`
                  : 'As senhas deste aparelho estão num cofre diferente do da conta. Elas serão abertas e criptografadas de novo com o cofre da conta.'}
              </p>
              {needsReseal && (
                <Field label="Senha do cofre deste aparelho">
                  <TextInput type="password" autoComplete="off" value={localVaultPassword} onChange={(e) => setLocalVaultPassword(e.target.value)} />
                </Field>
              )}
              {!vault.unlocked && (
                <Button variant="secondary" block onClick={() => setVaultSheet(vault.exists ? 'unlock' : 'create')}>
                  {vault.exists ? 'Abrir o cofre da conta' : 'Criar o cofre da conta'}
                </Button>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="mt-5 rounded-2xl bg-expense/10 px-4 py-3 text-[15px] leading-relaxed text-expense">
              {error}
            </p>
          )}
        </div>

        <div className="space-y-2.5 pt-6">
          <Button size="lg" block onClick={send} disabled={busy || !ready}>
            {busy ? 'Enviando e conferindo…' : 'Enviar para a conta'}
          </Button>
          <div className="grid grid-cols-2 gap-2.5">
            <Button size="lg" variant="secondary" onClick={later} disabled={busy}>
              Agora não
            </Button>
            <Button size="lg" variant="ghost" onClick={never} disabled={busy}>
              Não enviar
            </Button>
          </div>
        </div>
      </div>
      <VaultCreateSheet open={vaultSheet === 'create'} onClose={() => setVaultSheet(null)} />
      <VaultUnlockSheet open={vaultSheet === 'unlock'} onClose={() => setVaultSheet(null)} />
    </div>
  )
}
