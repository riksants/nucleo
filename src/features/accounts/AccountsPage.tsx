import { ChevronRight, Copy, ExternalLink, Eye, EyeOff, KeyRound, Pencil, ShieldAlert } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../../app/Shell'
import { matches } from '../../data/selectors'
import { useStore } from '../../data/store'
import type { Account, SealedValue } from '../../data/types'
import { copyText, displayUrl, normalizeUrl } from '../../lib/links'
import { Button, IconButton } from '../../ui/Button'
import { EmptyState, SearchField } from '../../ui/Display'
import { useFeedback } from '../../ui/Feedback'
import { useSheet } from '../../ui/formHooks'
import { Sheet } from '../../ui/Sheet'
import { useNames } from '../shared/useNames'
import { useOpenParam } from '../useOpenParam'
import { AccountForm } from './AccountForm'
import { useVault } from './vault'
import { VaultBar, VaultCreateSheet, VaultUnlockSheet } from './VaultSheets'

/** A revealed password hides itself after this long (and at once when the vault locks). */
export const REVEAL_MS = 30_000
/** The copied password is wiped from the clipboard after this long, when the system lets the page do it. */
export const CLEAR_CLIPBOARD_MS = 60_000

/**
 * Wipes the clipboard a minute after a password was copied, only while this page kept the focus the whole
 * time (so nothing copied elsewhere in between is erased). Where the system refuses (iPhone), nothing is
 * claimed: the person is told only what actually happened.
 */
function scheduleClear(onCleared: () => void) {
  let focused = document.hasFocus()
  const lost = () => (focused = false)
  window.addEventListener('blur', lost)
  document.addEventListener('copy', lost)
  window.setTimeout(async () => {
    window.removeEventListener('blur', lost)
    document.removeEventListener('copy', lost)
    if (!focused || !document.hasFocus()) return
    try {
      await navigator.clipboard.writeText('')
      onCleared()
    } catch {
      // Not allowed without a tap here (Safari): leave it, without pretending.
    }
  }, CLEAR_CLIPBOARD_MS)
}

/**
 * One field of an access. A password (sealed) opens only with the vault unlocked, for reveal and copy alike;
 * revealed, it hides again after 30 s or when the vault locks. Non-secret fields copy freely.
 */
function CopyRow({ label, value, sealed, onLocked }: { label: string; value: string; sealed?: SealedValue; onLocked?(): void }) {
  const { toast } = useFeedback()
  const vault = useVault()
  const [plain, setPlain] = useState<string | null>(null)
  const timer = useRef(0)
  const secret = Boolean(sealed)

  // Hide again as soon as the vault locks.
  if (sealed && !vault.unlocked && plain !== null) setPlain(null)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const read = async (): Promise<string | null> => {
    if (!sealed) return value
    if (!vault.unlocked) {
      onLocked?.()
      return null
    }
    try {
      return await vault.reveal(sealed)
    } catch {
      toast('Não foi possível abrir esta senha', 'error')
      return null
    }
  }

  const toggle = async () => {
    if (plain !== null) return setPlain(null)
    const text = await read()
    if (text === null) return
    setPlain(text)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPlain(null), REVEAL_MS)
  }

  const copy = async () => {
    const text = await read()
    if (text === null) return
    const ok = await copyText(text)
    if (!ok) return toast('Não foi possível copiar', 'error')
    toast(secret ? 'Senha copiada' : 'Copiado')
    if (secret) scheduleClear(() => toast('Área de transferência limpa'))
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl bg-raised py-1.5 pr-1.5 pl-4">
      <div className="min-w-0 flex-1 py-1">
        <p className="text-xs text-faint">{label}</p>
        <p className={`truncate text-[15px] ${secret && plain === null ? 'tracking-[0.2em]' : ''}`}>{secret ? (plain ?? '••••••••••') : value}</p>
      </div>
      {secret && (
        <IconButton label={plain !== null ? 'Esconder senha' : 'Mostrar senha'} size="sm" onClick={toggle}>
          {plain !== null ? <EyeOff size={18} /> : <Eye size={18} />}
        </IconButton>
      )}
      <IconButton label={`Copiar ${label.toLowerCase()}`} size="sm" onClick={copy}>
        <Copy size={18} />
      </IconButton>
    </div>
  )
}

/** The details of an access: what can be copied, the password protected by the vault, related client/project. */
function AccountSheet({ open, account, onClose, onEdit, onVault }: { open: boolean; account: Account | null; onClose(): void; onEdit(a: Account): void; onVault(kind: 'create' | 'unlock'): void }) {
  const names = useNames()
  const vault = useVault()
  const related = account ? [names.client(account.clientId), names.project(account.projectId)].filter(Boolean).join(' · ') : ''
  return (
    <Sheet open={open && !!account} onClose={onClose} title={account?.name ?? ''}>
      {account && (
        <div className="space-y-2">
          {(account.link || related) && (
            <p className="flex items-center gap-2 px-1 pb-1 text-[13px] text-faint">
              <span className="min-w-0 flex-1 truncate">{[account.link && displayUrl(account.link), related].filter(Boolean).join(' · ')}</span>
              {account.link && (
                <a href={normalizeUrl(account.link)} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 font-medium text-accent-hi">
                  Abrir <ExternalLink size={14} />
                </a>
              )}
            </p>
          )}
          {account.email && <CopyRow label="E-mail" value={account.email} />}
          {account.username && <CopyRow label="Usuário" value={account.username} />}
          {account.secret && <CopyRow label="Senha" value="" sealed={account.secret} onLocked={() => onVault('unlock')} />}
          {/* A password from before the vault: never shown or copied as plain text; the vault protects it first. */}
          {!account.secret && account.password && (
            <div className="flex items-center gap-3 rounded-2xl bg-warn/[0.08] px-4 py-3">
              <ShieldAlert size={18} className="shrink-0 text-warn" />
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-soft">Senha antiga, ainda sem criptografia. {vault.exists ? 'Abra o cofre para protegê-la.' : 'Crie o cofre para protegê-la.'}</span>
              <Button size="md" variant="secondary" className="h-9! shrink-0 px-3.5! text-[13px]!" onClick={() => onVault(vault.exists ? 'unlock' : 'create')}>
                Proteger
              </Button>
            </div>
          )}
          {account.notes && <p className="px-1 pt-2 text-sm leading-relaxed whitespace-pre-wrap text-soft">{account.notes}</p>}
          <div className="flex justify-end pt-2">
            <Button variant="ghost" icon={<Pencil size={16} />} onClick={() => onEdit(account)}>
              Editar
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

export function AccountsPage() {
  const { data } = useStore()
  const vault = useVault()
  const [query, setQuery] = useState('')
  const form = useSheet<Account>()
  const detail = useSheet<Account>()
  const [vaultSheet, setVaultSheet] = useState<'create' | 'unlock' | null>(null)
  useOpenParam(data.accounts, detail.show)
  const names = useNames()

  // Searches only what is not secret: service, link, e-mail, user, related client/project (never passwords or notes).
  const list = useMemo(
    () =>
      [...data.accounts]
        .filter((a) => matches(query, a.name, a.link, a.email, a.username, names.client(a.clientId), names.project(a.projectId)))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.accounts, query, names],
  )
  const current = detail.item ? (data.accounts.find((a) => a.id === detail.item!.id) ?? null) : null

  return (
    <>
      <PageHeader
        rich
        icon={KeyRound}
        eyebrow={vault.exists ? (vault.unlocked ? 'Cofre aberto' : 'Cofre fechado') : 'Sem cofre'}
        title="Senhas"
        primary={{ label: 'Nova', aria: 'Novo acesso', onPress: () => form.show() }}
        stats={data.accounts.length ? [{ label: data.accounts.length === 1 ? 'Acesso' : 'Acessos', value: data.accounts.length }, { label: 'No cofre', value: data.accounts.filter((a) => a.secret).length }, { label: 'A proteger', value: vault.plainCount }] : undefined}
      />
      <VaultBar onCreate={() => setVaultSheet('create')} onUnlock={() => setVaultSheet('unlock')} />
      {data.accounts.length === 0 ? (
        <EmptyState icon={<KeyRound size={20} />} title="Nenhum acesso guardado ainda" text="Serviço, e-mail, usuário e senha. A senha fica criptografada no cofre e só abre com a senha do cofre." action="Adicionar acesso" onAction={() => form.show()} />
      ) : (
        <>
          {data.accounts.length > 4 && (
            <div className="mb-4">
              <SearchField value={query} onChange={setQuery} placeholder="Buscar serviço, e-mail ou usuário" />
            </div>
          )}
          {list.length ? (
            <ul className="card divide-y divide-line">
              {list.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => detail.show(a)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-tint/[0.03] tap">
                    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-tint/[0.06] text-[15px] font-semibold text-soft">
                      {a.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{a.name}</span>
                      <span className="block truncate text-[13px] text-faint">{a.email || a.username || (a.link ? displayUrl(a.link) : 'Sem usuário')}</span>
                    </span>
                    {!a.secret && a.password && <ShieldAlert size={16} className="shrink-0 text-warn" aria-label="Senha antiga sem cofre" />}
                    <ChevronRight size={16} className="shrink-0 text-faint" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={<KeyRound size={20} />} title="Nada encontrado" action={query ? 'Limpar busca' : undefined} onAction={() => setQuery('')} />
          )}
        </>
      )}
      <AccountSheet
        open={detail.open}
        account={current}
        onClose={detail.close}
        onVault={setVaultSheet}
        onEdit={(a) => {
          detail.close()
          form.show(a)
        }}
      />
      <AccountForm open={form.open} onClose={form.close} account={form.item} onVault={setVaultSheet} />
      <VaultCreateSheet open={vaultSheet === 'create'} onClose={() => setVaultSheet(null)} />
      <VaultUnlockSheet open={vaultSheet === 'unlock'} onClose={() => setVaultSheet(null)} />
    </>
  )
}
