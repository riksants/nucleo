import { Copy, ExternalLink, Eye, EyeOff, KeyRound, Pencil } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../../app/Shell'
import { matches } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Account, SealedValue } from '../../data/types'
import { copyText, displayUrl, normalizeUrl } from '../../lib/links'
import { IconButton } from '../../ui/Button'
import { EmptyState, SearchField } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { useSheet } from '../../ui/formHooks'
import { useOpenParam } from '../useOpenParam'
import { useNames } from '../shared/useNames'
import { AccountForm } from './AccountForm'
import { useVault } from './vault'
import { VaultBar, VaultCreateSheet, VaultUnlockSheet } from './VaultSheets'

function CopyRow({ label, value, secret, sealed, onLocked }: { label: string; value: string; secret?: boolean; sealed?: SealedValue; onLocked?(): void }) {
  const { toast } = useFeedback()
  const vault = useVault()
  const [shown, setShown] = useState(false)
  const [plain, setPlain] = useState<string | null>(null)

  // Hide again as soon as the vault locks.
  if (sealed && !vault.unlocked && (shown || plain !== null)) {
    setShown(false)
    setPlain(null)
  }

  const open = async (): Promise<string | null> => {
    if (!sealed) return value
    if (!vault.unlocked) {
      onLocked?.()
      return null
    }
    try {
      const text = plain ?? (await vault.reveal(sealed))
      setPlain(text)
      return text
    } catch {
      toast('Não foi possível abrir esta senha', 'error')
      return null
    }
  }

  const toggle = async () => {
    if (shown) return setShown(false)
    if ((await open()) !== null) setShown(true)
  }

  const copy = async () => {
    const text = await open()
    if (text === null) return
    const ok = await copyText(text)
    toast(ok ? 'Copiado' : 'Não foi possível copiar', ok ? 'success' : 'error')
  }
  const visible = sealed ? (plain ?? '') : value

  return (
    <div className="flex items-center gap-2 rounded-2xl bg-raised py-1.5 pr-1.5 pl-4">
      <div className="min-w-0 flex-1 py-1">
        <p className="text-xs text-faint">{label}</p>
        <p className={`truncate text-[15px] ${secret && !shown ? 'tracking-[0.2em]' : ''}`}>{secret && !shown ? '••••••••••' : visible}</p>
      </div>
      {secret && (
        <IconButton label={shown ? 'Esconder senha' : 'Mostrar senha'} size="sm" onClick={toggle}>
          {shown ? <EyeOff size={18} /> : <Eye size={18} />}
        </IconButton>
      )}
      <IconButton label={`Copiar ${label.toLowerCase()}`} size="sm" onClick={copy}>
        <Copy size={18} />
      </IconButton>
    </div>
  )
}

function AccountCard({ account, onEdit, onLocked }: { account: Account; onEdit(a: Account): void; onLocked(): void }) {
  const names = useNames()
  const related = [names.client(account.clientId), names.project(account.projectId)].filter(Boolean).join(' · ')
  return (
    <article className="card p-4">
      <div className="mb-3 flex items-start gap-3 pl-1">
        <div className="min-w-0 flex-1 pt-1">
          <h3 className="truncate text-[17px] font-semibold tracking-tight">{account.name}</h3>
          {(account.link || related) && <p className="mt-0.5 truncate text-[13px] text-faint">{[account.link && displayUrl(account.link), related].filter(Boolean).join(' · ')}</p>}
        </div>
        {account.link && (
          <a href={normalizeUrl(account.link)} target="_blank" rel="noreferrer" aria-label="Abrir site" title="Abrir site" className="press grid size-9 shrink-0 place-items-center rounded-xl text-soft hover:bg-tint/[0.05] hover:text-ink">
            <ExternalLink size={18} />
          </a>
        )}
        <IconButton label="Editar" size="sm" onClick={() => onEdit(account)}>
          <Pencil size={18} />
        </IconButton>
      </div>
      <div className="space-y-2">
        {account.email && <CopyRow label="E-mail" value={account.email} />}
        {account.username && <CopyRow label="Usuário" value={account.username} />}
        {account.secret && <CopyRow label="Senha" value="" secret sealed={account.secret} onLocked={onLocked} />}
        {!account.secret && account.password && <CopyRow label="Senha (sem cofre)" value={account.password} secret />}
      </div>
      {account.notes && <p className="mt-3 px-1 text-sm leading-relaxed whitespace-pre-wrap text-soft">{account.notes}</p>}
    </article>
  )
}

export function AccountsPage() {
  const { data } = useStore()
  const [query, setQuery] = useState('')
  const form = useSheet<Account>()
  const [vaultSheet, setVaultSheet] = useState<'create' | 'unlock' | null>(null)
  useOpenParam(data.accounts, form.show)
  const names = useNames()

  const list = [...data.accounts]
    .filter((a) => matches(query, a.name, a.link, a.email, a.username, a.notes, names.client(a.clientId), names.project(a.projectId)))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <PageHeader
        title="Senhas"
        subtitle="Acessos anotados para consulta rápida"
        primary={{ label: 'Nova', aria: 'Novo acesso', onPress: () => form.show() }}
      />
      <VaultBar onCreate={() => setVaultSheet('create')} onUnlock={() => setVaultSheet('unlock')} />
      {data.accounts.length === 0 ? (
        <EmptyState icon={<KeyRound size={20} />} title="Nenhum acesso guardado ainda" text="Anote e-mails, usuários e senhas dos serviços que você usa." action="Adicionar acesso" onAction={() => form.show()} />
      ) : (
        <>
          <div className="mb-5">
            <SearchField value={query} onChange={setQuery} placeholder="Buscar serviço, e-mail, cliente…" />
          </div>
          {list.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {list.map((a) => (
                <AccountCard key={a.id} account={a} onEdit={form.show} onLocked={() => setVaultSheet('unlock')} />
              ))}
            </div>
          ) : (
            <EmptyState compact icon={<KeyRound size={20} />} title="Nada encontrado" action={query ? 'Limpar busca' : undefined} onAction={() => setQuery('')} />
          )}
        </>
      )}
      <AccountForm open={form.open} onClose={form.close} account={form.item} onVault={setVaultSheet} />
      <VaultCreateSheet open={vaultSheet === 'create'} onClose={() => setVaultSheet(null)} />
      <VaultUnlockSheet open={vaultSheet === 'unlock'} onClose={() => setVaultSheet(null)} />
    </>
  )
}
