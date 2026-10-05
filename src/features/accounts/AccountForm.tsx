import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '../../data/store'
import type { Account } from '../../data/types'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, TextArea, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDelete, useDraft } from '../../ui/formHooks'
import { ClientSelect, ProjectSelect } from '../shared/RelationSelect'
import { useVault } from './vault'

export function AccountForm({ open, onClose, account, onVault }: { open: boolean; onClose(): void; account: Account | null; onVault(sheet: 'create' | 'unlock'): void }) {
  const { save } = useStore()
  const vault = useVault()
  const { toast } = useFeedback()
  const del = useDelete()
  const [reveal, setReveal] = useState(false)
  const [d, set] = useDraft(open, () => ({
    name: account?.name ?? '',
    clientId: account?.clientId ?? null,
    projectId: account?.projectId ?? null,
    link: account?.link ?? '',
    email: account?.email ?? '',
    username: account?.username ?? '',
    password: account?.password ?? '',
    notes: account?.notes ?? '',
  }))
  // Sealed password, decrypted only while the form is open and the vault is unlocked.
  const [loaded, setLoaded] = useState<string | null>(null)
  const legacy = Boolean(account?.password)
  const canEditPassword = legacy || vault.unlocked
  useEffect(() => {
    setReveal(false)
    setLoaded(null)
    if (!open || !account?.secret || !vault.unlocked) return
    vault.reveal(account.secret).then((plain) => {
      setLoaded(plain)
      set('password', plain)
    }, () => {})
  }, [open, account, vault.unlocked])

  const submit = async () => {
    if (!d.name.trim()) return 'Informe o nome ou serviço'
    const base = { ...account, ...d, name: d.name.trim(), link: d.link.trim(), email: d.email.trim(), username: d.username.trim() }
    let secret = account?.secret ?? null
    if (vault.unlocked) {
      // New or changed password goes into the vault; the plain field is cleared.
      if (d.password !== (loaded ?? account?.password ?? '')) secret = d.password ? await vault.sealText(d.password) : null
      else if (account?.password) secret = await vault.sealText(account.password)
      base.password = ''
    } else if (!legacy) {
      base.password = ''
    }
    await save('accounts', { ...base, secret })
    toast(account ? 'Acesso atualizado' : 'Acesso adicionado')
    onClose()
  }

  const noAuto = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={account ? 'Editar acesso' : 'Novo acesso'}
      submitLabel={account ? 'Salvar' : 'Adicionar'}
      onSubmit={submit}
      size="lg"
      onDelete={account ? () => del('accounts', account.id, 'acesso', { after: onClose }) : undefined}
    >
      <FormGrid>
        <div className="half">
          <Field label="Nome / serviço">
            <TextInput value={d.name} onChange={(e) => set('name', e.target.value)} autoFocus={!account} autoComplete="off" />
          </Field>
        </div>
        <div className="half">
          <Field label="Site / link" hint="opcional">
            <TextInput type="url" inputMode="url" value={d.link} onChange={(e) => set('link', e.target.value)} {...noAuto} placeholder="site.com" />
          </Field>
        </div>
        <div className="half">
          <Field label="E-mail">
            <TextInput type="email" inputMode="email" autoComplete="off" value={d.email} onChange={(e) => set('email', e.target.value)} {...noAuto} />
          </Field>
        </div>
        <div className="half">
          <Field label="Usuário">
            <TextInput autoComplete="off" value={d.username} onChange={(e) => set('username', e.target.value)} {...noAuto} />
          </Field>
        </div>
        <Field label="Senha" hint={!vault.exists ? 'requer o cofre' : !vault.unlocked && !legacy ? 'cofre fechado' : undefined}>
          {!canEditPassword ? (
            <button
              type="button"
              onClick={() => onVault(vault.exists ? 'unlock' : 'create')}
              className="flex h-12 w-full items-center rounded-[var(--radius-field)] border border-dashed border-line-strong px-4 text-left text-[15px] text-soft hover:text-ink"
            >
              {vault.exists ? (account?.secret ? 'Abrir o cofre para ver ou alterar' : 'Abrir o cofre para guardar a senha') : 'Criar o cofre para guardar senhas'}
            </button>
          ) : (
          <div className="relative">
            {/* Plain text field masked with CSS so browsers don't offer to save it as a login. */}
            <TextInput
              autoComplete="off"
              value={d.password}
              onChange={(e) => set('password', e.target.value)}
              className={`pr-12 ${reveal ? '' : '[-webkit-text-security:disc]'}`}
              {...noAuto}
            />
            <button type="button" onClick={() => setReveal(!reveal)} aria-label={reveal ? 'Esconder senha' : 'Mostrar senha'} className="absolute top-1/2 right-1.5 grid size-9 -translate-y-1/2 place-items-center rounded-xl text-faint hover:text-ink">
              {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          )}
        </Field>
        <div className="half">
          <Field label="Cliente" hint="opcional">
            <ClientSelect value={d.clientId} onChange={(v) => set('clientId', v)} />
          </Field>
        </div>
        <div className="half">
          <Field label="Projeto" hint="opcional">
            <ProjectSelect value={d.projectId} onChange={(v) => set('projectId', v)} />
          </Field>
        </div>
        <Field label="Observações" hint="opcional">
          <TextArea rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </FormGrid>
    </FormSheet>
  )
}
