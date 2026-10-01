import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Eye, EyeOff, MailCheck } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Logo } from '../../app/Shell'
import { Button, IconButton } from '../../ui/Button'
import { Field, TextInput } from '../../ui/Field'
import { useSession } from './session'

type Step = 'signin' | 'signup' | 'confirm' | 'forgot' | 'resetCode' | 'newPassword'

export const MIN_LOGIN_PASSWORD = 8

export function loginPasswordProblem(password: string): string | null {
  if (password.length < MIN_LOGIN_PASSWORD) return `Use pelo menos ${MIN_LOGIN_PASSWORD} caracteres.`
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return 'Misture letras e números.'
  return null
}

function PasswordInput({ value, onChange, autoComplete, autoFocus }: { value: string; onChange(v: string): void; autoComplete: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <TextInput type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoFocus={autoFocus} className="pr-12" />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Esconder senha' : 'Mostrar senha'} className="absolute top-1/2 right-1.5 grid size-9 -translate-y-1/2 place-items-center rounded-xl text-faint hover:text-ink">
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}

function Frame({ title, text, onBack, children, footer }: { title: string; text?: ReactNode; onBack?(): void; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col px-6 pt-[calc(env(safe-area-inset-top)+20px)] pb-[calc(env(safe-area-inset-bottom)+24px)]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex h-11 items-center">
          {onBack ? (
            <IconButton label="Voltar" onClick={onBack} className="-ml-2">
              <ArrowLeft size={22} />
            </IconButton>
          ) : (
            <Logo />
          )}
        </div>
        <div className="flex-1 pt-8">
          <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.03em]">{title}</h1>
          {text && <p className="mt-2 text-[16px] leading-relaxed text-soft">{text}</p>}
          <div className="mt-8 space-y-5">{children}</div>
        </div>
        <div className="space-y-2.5 pt-6">{footer}</div>
      </div>
    </div>
  )
}

export function AuthScreen() {
  const auth = useSession()
  const [step, setStep] = useState<Step>(auth.screen === 'newPassword' ? 'newPassword' : auth.screen === 'signup' ? 'signup' : auth.screen === 'forgot' ? 'forgot' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(auth.notice)
  const [busy, setBusy] = useState(false)

  const go = (next: Step) => {
    setError(null)
    setInfo(null)
    setStep(next)
  }

  const run = (fn: () => Promise<void>) => async (e?: FormEvent) => {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim())

  const signIn = run(async () => {
    if (!validEmail) throw new Error('Digite um e-mail válido.')
    await auth.signIn(email.trim(), password)
    auth.clearNotice()
  })

  const signUp = run(async () => {
    if (!validEmail) throw new Error('Digite um e-mail válido.')
    const problem = loginPasswordProblem(password)
    if (problem) throw new Error(problem)
    if (password !== password2) throw new Error('As senhas não são iguais.')
    const { needsConfirmation } = await auth.signUp(email.trim(), password)
    if (needsConfirmation) go('confirm')
    else auth.closeAuth()
  })

  const confirm = run(async () => {
    await auth.verifyCode(email.trim(), code, 'signup')
  })

  const forgot = run(async () => {
    if (!validEmail) throw new Error('Digite um e-mail válido.')
    await auth.sendReset(email.trim())
    go('resetCode')
  })

  const resetCode = run(async () => {
    await auth.verifyCode(email.trim(), code, 'recovery')
    go('newPassword')
  })

  const newPassword = run(async () => {
    const problem = loginPasswordProblem(password)
    if (problem) throw new Error(problem)
    if (password !== password2) throw new Error('As senhas não são iguais.')
    await auth.setNewPassword(password)
  })

  const messages = (
    <>
      {info && <p className="rounded-2xl bg-accent/10 px-4 py-3 text-[15px] leading-relaxed text-accent-hi">{info}</p>}
      {error && (
        <p role="alert" className="rounded-2xl bg-expense/10 px-4 py-3 text-[15px] leading-relaxed text-expense">
          {error}
        </p>
      )}
    </>
  )

  const emailField = (
    <Field label="E-mail">
      <TextInput type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
    </Field>
  )

  const codeField = (
    <Field label="Código do e-mail" hint="6 dígitos">
      <TextInput inputMode="numeric" autoComplete="one-time-code" className="num text-[22px]! tracking-[0.3em]" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
    </Field>
  )

  const content = (() => {
    switch (step) {
      case 'signin':
        return (
          <form onSubmit={signIn} noValidate>
            <Frame
              title="Entrar"
              text="Seus dados ficam na sua conta e sincronizam entre celular e computador."
              onBack={auth.closeAuth}
              footer={
                <>
                  <Button type="submit" size="lg" block disabled={busy}>
                    {busy ? 'Entrando…' : 'Entrar'}
                  </Button>
                  <Button size="lg" variant="ghost" block onClick={() => go('signup')}>
                    Criar conta
                  </Button>
                </>
              }
            >
              {messages}
              {emailField}
              <Field label="Senha">
                <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
              </Field>
              <button type="button" onClick={() => go('forgot')} className="text-[15px] font-medium text-accent-hi hover:text-ink">
                Esqueci minha senha
              </button>
            </Frame>
          </form>
        )
      case 'signup':
        return (
          <form onSubmit={signUp} noValidate>
            <Frame
              title="Criar conta"
              text="Você vai receber um e-mail para confirmar o endereço."
              onBack={() => go('signin')}
              footer={
                <Button type="submit" size="lg" block disabled={busy}>
                  {busy ? 'Criando…' : 'Criar conta'}
                </Button>
              }
            >
              {messages}
              {emailField}
              <Field label="Senha" hint="mín. 8, letras e números">
                <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" />
              </Field>
              <Field label="Repita a senha">
                <PasswordInput value={password2} onChange={setPassword2} autoComplete="new-password" />
              </Field>
              <p className="text-[13px] leading-relaxed text-faint">
                Esta é a senha de login. As senhas guardadas em “Contas” ficam num cofre separado, com outra senha.
              </p>
            </Frame>
          </form>
        )
      case 'confirm':
        return (
          <form onSubmit={confirm} noValidate>
            <Frame
              title="Confirme seu e-mail"
              text={
                <>
                  Enviamos um e-mail para <span className="text-ink">{email}</span>. Digite o código aqui, ou toque no link do e-mail e depois entre com sua senha.
                </>
              }
              onBack={() => go('signin')}
              footer={
                <>
                  <Button type="submit" size="lg" block disabled={busy || code.replace(/\D/g, '').length < 6}>
                    Confirmar
                  </Button>
                  <Button size="lg" variant="ghost" block onClick={run(async () => { await auth.resendConfirmation(email.trim()); setInfo('E-mail reenviado.') })}>
                    Reenviar e-mail
                  </Button>
                </>
              }
            >
              <div className="grid size-12 place-items-center rounded-2xl bg-accent/12 text-accent-hi">
                <MailCheck size={22} />
              </div>
              {messages}
              {codeField}
            </Frame>
          </form>
        )
      case 'forgot':
        return (
          <form onSubmit={forgot} noValidate>
            <Frame
              title="Recuperar senha de login"
              text="Enviaremos um código para criar uma nova senha de login. Isso não abre o cofre de senhas: ele tem senha própria."
              onBack={() => go('signin')}
              footer={
                <Button type="submit" size="lg" block disabled={busy}>
                  Enviar código
                </Button>
              }
            >
              {messages}
              {emailField}
            </Frame>
          </form>
        )
      case 'resetCode':
        return (
          <form onSubmit={resetCode} noValidate>
            <Frame
              title="Digite o código"
              text={
                <>
                  Se existir uma conta com <span className="text-ink">{email}</span>, o código chega em instantes.
                </>
              }
              onBack={() => go('forgot')}
              footer={
                <Button type="submit" size="lg" block disabled={busy || code.replace(/\D/g, '').length < 6}>
                  Continuar
                </Button>
              }
            >
              {messages}
              {codeField}
            </Frame>
          </form>
        )
      case 'newPassword':
        return (
          <form onSubmit={newPassword} noValidate>
            <Frame
              title="Nova senha de login"
              footer={
                <Button type="submit" size="lg" block disabled={busy}>
                  Salvar senha
                </Button>
              }
            >
              {messages}
              <Field label="Nova senha" hint="mín. 8, letras e números">
                <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
              </Field>
              <Field label="Repita a senha">
                <PasswordInput value={password2} onChange={setPassword2} autoComplete="new-password" />
              </Field>
            </Frame>
          </form>
        )
    }
  })()

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
        {content}
      </motion.div>
    </AnimatePresence>
  )
}
