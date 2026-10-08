import { Copy, Lock, LockOpen, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { copyText } from '../../lib/links'
import { vaultPasswordProblem } from '../../lib/vault'
import { Button } from '../../ui/Button'
import { useFeedback } from '../../ui/Feedback'
import { Field, FormGrid, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useDraft } from '../../ui/formHooks'
import { Sheet } from '../../ui/Sheet'
import { useVault } from './vault'

const noAuto = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const

export function VaultCreateSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const vault = useVault()
  const { toast } = useFeedback()
  const [d, set] = useDraft(open, () => ({ password: '', confirm: '', recovery: true, understood: false }))
  const [code, setCode] = useState<string | null>(null)

  const submit = async () => {
    const problem = vaultPasswordProblem(d.password)
    if (problem) return problem
    if (d.password !== d.confirm) return 'As senhas não são iguais'
    if (!d.understood) return 'Confirme que entendeu como recuperar o cofre'
    const { recoveryCode, migrated } = await vault.create(d.password, d.recovery)
    if (migrated) toast(`${migrated} ${migrated === 1 ? 'senha protegida' : 'senhas protegidas'}`)
    else toast('Cofre criado')
    if (recoveryCode) setCode(recoveryCode)
    else onClose()
  }

  return (
    <>
      <FormSheet open={open && !code} onClose={onClose} title="Criar cofre de senhas" submitLabel="Criar cofre" onSubmit={submit}>
        <div className="space-y-3 pb-5 text-[15px] leading-relaxed text-soft">
          <p>As senhas guardadas em Senhas serão criptografadas no aparelho antes de serem salvas ou sincronizadas. Nem o servidor consegue lê-las.</p>
          <p>
            Use uma <span className="text-ink">senha do cofre diferente da senha de login</span>. Recuperar a senha de login <span className="text-ink">não</span> abre o cofre.
          </p>
        </div>
        <FormGrid>
          <Field label="Senha do cofre" hint="mín. 10 caracteres">
            <TextInput type="password" autoComplete="new-password" value={d.password} onChange={(e) => set('password', e.target.value)} {...noAuto} autoFocus />
          </Field>
          <Field label="Repita a senha do cofre">
            <TextInput type="password" autoComplete="new-password" value={d.confirm} onChange={(e) => set('confirm', e.target.value)} {...noAuto} />
          </Field>
          <label className="flex items-start gap-3 rounded-2xl bg-raised p-4">
            <input type="checkbox" className="mt-1 size-5 accent-[var(--color-accent)]" checked={d.recovery} onChange={(e) => set('recovery', e.target.checked)} />
            <span className="text-[15px] leading-relaxed">
              Gerar código de recuperação
              <span className="block text-[13px] text-faint">Mostrado uma única vez. Guarde fora do app (papel ou gerenciador de senhas).</span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-2xl border border-warn/30 bg-warn/8 p-4">
            <input type="checkbox" className="mt-1 size-5 accent-[var(--color-accent)]" checked={d.understood} onChange={(e) => set('understood', e.target.checked)} />
            <span className="text-[15px] leading-relaxed">
              Entendi: se eu perder a senha do cofre{d.recovery ? ' e o código de recuperação' : ''}, as senhas guardadas ficam <span className="text-ink">impossíveis de recuperar</span>, inclusive pelo suporte.
            </span>
          </label>
        </FormGrid>
      </FormSheet>
      <RecoveryCodeSheet
        code={code}
        onClose={() => {
          setCode(null)
          onClose()
        }}
      />
    </>
  )
}

function RecoveryCodeSheet({ code, onClose }: { code: string | null; onClose(): void }) {
  const { toast, confirm } = useFeedback()
  const finish = async () => {
    const ok = await confirm({ title: 'Guardou o código?', message: 'Ele não será mostrado de novo.', confirmLabel: 'Sim, guardei' })
    if (ok) onClose()
  }
  return (
    <Sheet
      open={code !== null}
      onClose={finish}
      title="Código de recuperação"
      footer={
        <Button size="lg" block onClick={finish}>
          Já guardei
        </Button>
      }
    >
      <p className="pb-4 text-[15px] leading-relaxed text-soft">Com este código você cria uma nova senha do cofre se esquecer a atual. Quem tiver o código e acesso à sua conta consegue abrir o cofre — guarde com cuidado.</p>
      <div className="card flex items-center gap-3 p-4">
        <code className="num min-w-0 flex-1 text-[17px] font-semibold tracking-wider break-all">{code}</code>
        <Button
          variant="secondary"
          icon={<Copy size={18} />}
          onClick={async () => {
            const ok = await copyText(code ?? '')
            toast(ok ? 'Copiado' : 'Não foi possível copiar', ok ? 'success' : 'error')
          }}
        >
          Copiar
        </Button>
      </div>
    </Sheet>
  )
}

export function VaultUnlockSheet({ open, onClose, onUnlocked }: { open: boolean; onClose(): void; onUnlocked?(): void }) {
  const vault = useVault()
  const { toast } = useFeedback()
  const [mode, setMode] = useState<'unlock' | 'recover'>('unlock')
  const [d, set] = useDraft(open, () => ({ password: '', code: '', next: '', confirm: '' }))

  const submit = async () => {
    if (mode === 'unlock') {
      if (!d.password) return 'Digite a senha do cofre'
      await vault.unlock(d.password)
      toast('Cofre aberto')
    } else {
      const problem = vaultPasswordProblem(d.next)
      if (problem) return problem
      if (d.next !== d.confirm) return 'As senhas não são iguais'
      try {
        await vault.recover(d.code, d.next)
      } catch {
        return 'Código de recuperação incorreto'
      }
      toast('Nova senha do cofre definida')
    }
    setMode('unlock')
    onClose()
    onUnlocked?.()
  }

  return (
    <FormSheet open={open} onClose={onClose} title={mode === 'unlock' ? 'Desbloquear cofre' : 'Recuperar cofre'} submitLabel={mode === 'unlock' ? 'Desbloquear' : 'Definir nova senha'} onSubmit={submit}>
      {mode === 'unlock' ? (
        <FormGrid>
          <Field label="Senha do cofre">
            <TextInput type="password" autoComplete="current-password" value={d.password} onChange={(e) => set('password', e.target.value)} {...noAuto} autoFocus />
          </Field>
          <button type="button" onClick={() => setMode('recover')} className="hit relative justify-self-start text-[15px] font-medium text-accent-hi hover:text-ink">
            Esqueci a senha do cofre
          </button>
        </FormGrid>
      ) : vault.meta?.byRecovery ? (
        <FormGrid>
          <Field label="Código de recuperação">
            <TextInput value={d.code} onChange={(e) => set('code', e.target.value)} {...noAuto} placeholder="XXXX-XXXX-…" autoFocus />
          </Field>
          <Field label="Nova senha do cofre" hint="mín. 10 caracteres">
            <TextInput type="password" autoComplete="new-password" value={d.next} onChange={(e) => set('next', e.target.value)} {...noAuto} />
          </Field>
          <Field label="Repita a nova senha">
            <TextInput type="password" autoComplete="new-password" value={d.confirm} onChange={(e) => set('confirm', e.target.value)} {...noAuto} />
          </Field>
        </FormGrid>
      ) : (
        <div className="space-y-3 text-[15px] leading-relaxed text-soft">
          <p className="flex items-center gap-2 text-ink">
            <ShieldAlert size={18} className="text-warn" /> Este cofre não tem código de recuperação.
          </p>
          <p>Sem a senha do cofre não há como descriptografar as senhas guardadas — nem pela recuperação da senha de login, nem pelo servidor. Os outros dados da conta não são afetados.</p>
          <button type="button" onClick={() => setMode('unlock')} className="hit relative font-medium text-accent-hi hover:text-ink">
            Tentar a senha de novo
          </button>
        </div>
      )}
    </FormSheet>
  )
}

/** Status line at the top of "Senhas". */
export function VaultBar({ onCreate, onUnlock }: { onCreate(): void; onUnlock(): void }) {
  const vault = useVault()
  if (!vault.exists) {
    return (
      <div className="card mb-5 flex items-start gap-3 border-warn/25 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-warn/12 text-warn">
          <ShieldAlert size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium">Senhas sem cofre</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-faint">
            {vault.plainCount ? `${vault.plainCount} ${vault.plainCount === 1 ? 'senha está salva' : 'senhas estão salvas'} sem criptografia. ` : ''}
            Crie o cofre para guardar senhas com criptografia.
          </p>
          <Button className="mt-3" onClick={onCreate}>
            Criar cofre
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className="card mb-5 flex items-center gap-3 p-3 pl-4">
      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${vault.unlocked ? 'bg-accent/12 text-accent-hi' : 'bg-tint/[0.06] text-soft'}`}>
        {vault.unlocked ? <LockOpen size={18} /> : <ShieldCheck size={18} />}
      </span>
      <p className="min-w-0 flex-1 text-[14px] leading-snug text-soft">
        {vault.unlocked ? `Cofre aberto · fecha após ${vault.meta?.autoLockMin} min sem uso` : 'Cofre fechado · senhas criptografadas'}
      </p>
      {vault.unlocked ? (
        <Button variant="secondary" icon={<Lock size={16} />} onClick={vault.lock}>
          Fechar
        </Button>
      ) : (
        <Button onClick={onUnlock}>Abrir</Button>
      )}
    </div>
  )
}
