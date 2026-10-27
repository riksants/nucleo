import { useState } from 'react'
import { useStore } from '../../data/store'
import { buildBackup, backupFileName, saveFile } from '../../lib/backup'
import { Button } from '../../ui/Button'
import { Field, TextInput } from '../../ui/Field'
import { FormSheet } from '../../ui/FormSheet'
import { useVault } from '../accounts/vault'
import { forgetPushOnThisDevice } from '../reminders/push'
import { PasswordInput } from './AuthScreen'
import { Captcha } from './Captcha'
import { captchaOn } from './captchaKey'
import { useSession } from './session'

const WORD = 'EXCLUIR'

/**
 * "Excluir conta" (Etapa 9): everything of the account goes, on the server and on this device. The
 * password is asked again and checked by the server, which deletes only right after a sign-in.
 */
export function DeleteAccountSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const auth = useSession()
  const { data, settings } = useStore()
  const vault = useVault()
  const [password, setPassword] = useState('')
  const [word, setWord] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [round, setRound] = useState(0)

  const exportFirst = async () => {
    const { blob } = buildBackup(data, settings)
    await saveFile(blob, backupFileName())
  }

  const submit = async () => {
    if (word.trim().toUpperCase() !== WORD) return `Digite ${WORD} para confirmar.`
    if (!password) return 'Digite a senha da conta.'
    if (captchaOn && !token) return 'Aguarde a verificação de segurança terminar.'
    try {
      vault.lock()
      await forgetPushOnThisDevice().catch(() => {})
      await auth.deleteAccount(password, token ?? undefined)
    } finally {
      // A token works once: a new check for the next try.
      setToken(null)
      setRound((n) => n + 1)
    }
  }

  return (
    <FormSheet open={open} onClose={onClose} title="Excluir conta" submitLabel="Excluir conta e dados" onSubmit={submit}>
      <div className="grid gap-4">
        <p className="text-[15px] leading-relaxed text-soft">
          Apaga a conta <strong className="text-ink">{auth.email}</strong> e tudo o que está nela, no servidor e neste aparelho: finanças, tarefas, notas, senhas do cofre, configurações. Não dá para desfazer. Os outros aparelhos saem da conta na próxima vez que abrirem o app.
        </p>
        <p className="text-[13px] leading-relaxed text-faint">
          Cópias de segurança do servidor guardam os dados por até 30 dias e depois são apagadas. Se quiser ficar com os seus dados, exporte antes.
        </p>
        <Button variant="secondary" onClick={exportFirst}>
          Exportar meus dados antes
        </Button>
        <Field label="Senha da conta">
          <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        <Field label={`Digite ${WORD} para confirmar`}>
          <TextInput value={word} onChange={(e) => setWord(e.target.value)} autoCapitalize="characters" autoComplete="off" />
        </Field>
        {captchaOn && <Captcha key={round} onToken={setToken} />}
      </div>
    </FormSheet>
  )
}
