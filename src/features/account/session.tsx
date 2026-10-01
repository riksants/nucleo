import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { appUrl, cloudConfigured, supabase } from '../../lib/supabase'

export type AuthScreen = null | 'signin' | 'signup' | 'forgot' | 'newPassword'

interface SessionApi {
  configured: boolean
  /** False until the stored session (and any ?code= from an e-mail link) was checked. */
  checked: boolean
  session: Session | null
  userId: string | null
  email: string | null
  screen: AuthScreen
  /** Message about an e-mail link (confirmation, expired link…). */
  notice: string | null
  openAuth(screen: Exclude<AuthScreen, null>): void
  closeAuth(): void
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  sendReset(email: string): Promise<void>
  /** 6-digit code from the e-mail. Works inside the installed iPhone app, where links open in Safari. */
  verifyCode(email: string, code: string, kind: 'signup' | 'recovery'): Promise<void>
  resendConfirmation(email: string): Promise<void>
  setNewPassword(password: string): Promise<void>
  clearNotice(): void
}

const SessionContext = createContext<SessionApi | null>(null)

/** Turns Supabase auth errors into short Portuguese messages. */
export function authMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const m = raw.toLowerCase()
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.'
  if (m.includes('user already registered')) return 'Já existe uma conta com este e-mail.'
  if (m.includes('password should be at least') || m.includes('weak password')) return 'Senha fraca: use pelo menos 8 caracteres, com letras e números.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Muitas tentativas. Espere alguns minutos e tente de novo.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sem conexão com o servidor.'
  if (m.includes('same as the old') || m.includes('different from the old')) return 'A nova senha precisa ser diferente da atual.'
  return raw
}

function cleanAuthParams() {
  const url = new URL(location.href)
  let dirty = false
  for (const key of ['code', 'error', 'error_code', 'error_description', 'type']) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      dirty = true
    }
  }
  if (dirty) history.replaceState(null, '', url.pathname + url.search + url.hash)
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [checked, setChecked] = useState(!cloudConfigured)
  const [screen, setScreen] = useState<AuthScreen>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    const params = new URLSearchParams(location.search)
    const linkError = params.get('error_description')
    const hadCode = params.has('code')

    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setScreen('newPassword')
      if (event === 'SIGNED_IN' && hadCode && params.get('type') !== 'recovery') setNotice(null)
    })

    supabase.auth.getSession().then(({ data: { session: current }, error }) => {
      setSession(current)
      if (linkError) setNotice(`Link inválido ou expirado: ${linkError}`)
      else if (hadCode && !current) {
        // PKCE links only complete in the browser that asked for them. The e-mail is
        // still confirmed on the server, so signing in works from here.
        setNotice('E-mail confirmado. Entre com seu e-mail e senha.')
        setScreen('signin')
      } else if (error) setNotice(authMessage(error))
      cleanAuthParams()
      setChecked(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase!.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } })
    if (error) throw new Error(authMessage(error))
    return { needsConfirmation: !data.session }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase!.auth.signInWithPassword({ email, password })
    if (error) throw new Error(authMessage(error))
    setScreen(null)
  }, [])

  const signOut = useCallback(async () => {
    // "local" ends the session on this device only.
    await supabase?.auth.signOut({ scope: 'local' })
    setSession(null)
  }, [])

  const sendReset = useCallback(async (email: string) => {
    const { error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })
    if (error) throw new Error(authMessage(error))
  }, [])

  const verifyCode = useCallback(async (email: string, code: string, kind: 'signup' | 'recovery') => {
    const token = code.replace(/\D/g, '')
    const { error } = await supabase!.auth.verifyOtp({ email, token, type: kind === 'signup' ? 'email' : 'recovery' })
    if (error) throw new Error(error.message.toLowerCase().includes('expired') || error.message.toLowerCase().includes('invalid') ? 'Código inválido ou expirado.' : authMessage(error))
    setScreen(kind === 'recovery' ? 'newPassword' : null)
  }, [])

  const resendConfirmation = useCallback(async (email: string) => {
    const { error } = await supabase!.auth.resend({ type: 'signup', email, options: { emailRedirectTo: appUrl() } })
    if (error) throw new Error(authMessage(error))
  }, [])

  const setNewPassword = useCallback(async (password: string) => {
    const { error } = await supabase!.auth.updateUser({ password })
    if (error) throw new Error(authMessage(error))
    setScreen(null)
  }, [])

  const api = useMemo<SessionApi>(
    () => ({
      configured: cloudConfigured,
      checked,
      session,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? null,
      screen,
      notice,
      openAuth: setScreen,
      closeAuth: () => setScreen(null),
      signUp,
      signIn,
      signOut,
      sendReset,
      verifyCode,
      resendConfirmation,
      setNewPassword,
      clearNotice: () => setNotice(null),
    }),
    [checked, session, screen, notice, signUp, signIn, signOut, sendReset, verifyCode, resendConfirmation, setNewPassword],
  )

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>
}

export function useSession(): SessionApi {
  const api = useContext(SessionContext)
  if (!api) throw new Error('useSession must be used inside SessionProvider')
  return api
}
