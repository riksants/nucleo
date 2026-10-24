import { isAuthApiError, type Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { accountsOnDevice, removeAccountFromDevice } from '../../data/deviceCleanup'
import { appUrl, cloudConfigured, supabase } from '../../lib/supabase'
import { silencePushOnThisDevice } from '../reminders/push'
import { authMessage, isEmailThrottle } from './authRules'

export type AuthScreen = null | 'signin' | 'signup' | 'forgot' | 'newPassword'

interface SessionApi {
  configured: boolean
  /** False until the stored session (and any ?code= from an e-mail link) was checked. */
  checked: boolean
  /** A session just ended: its data is being removed from the device (nothing may be shown). */
  clearing: boolean
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
  /**
   * Ends every session of the account on the server: the other devices first, then this one.
   * `beforeThisDevice` runs in between, while this session is still valid. Throws, with nothing
   * changed, when the server can't be reached.
   */
  signOutEverywhere(opts?: { beforeThisDevice?(): Promise<void> }): Promise<void>
  sendReset(email: string): Promise<void>
  /** 6-digit code from the e-mail. Works inside the installed iPhone app, where links open in Safari. */
  verifyCode(email: string, code: string, kind: 'signup' | 'recovery'): Promise<void>
  resendConfirmation(email: string): Promise<void>
  setNewPassword(password: string): Promise<void>
  clearNotice(): void
}

const SessionContext = createContext<SessionApi | null>(null)

/** Survives the restart that follows a cleanup, so the sign-in screen can say what happened. */
const ENDED_KEY = 'nucleo:sessionEnded'

interface EndedNote {
  passive: boolean
  lost: number
  /** "Sair de todos os aparelhos". */
  everywhere?: boolean
}

function takeEndedNote(): EndedNote | null {
  try {
    const raw = sessionStorage.getItem(ENDED_KEY)
    sessionStorage.removeItem(ENDED_KEY)
    return raw ? (JSON.parse(raw) as EndedNote) : null
  } catch {
    return null
  }
}

function leaveEndedNote(note: EndedNote) {
  try {
    sessionStorage.setItem(ENDED_KEY, JSON.stringify(note))
  } catch {
    // no storage: the sign-in screen just opens without the explanation
  }
}

/** Read once per page load (StrictMode runs the effects twice). */
const endedNote = typeof sessionStorage === 'undefined' ? null : takeEndedNote()

function sessionEndedMessage(lost: number): string {
  const lostText = lost ? ` ${lost} ${lost === 1 ? 'alteração que ainda não tinha chegado' : 'alterações que ainda não tinham chegado'} ao servidor ${lost === 1 ? 'foi descartada' : 'foram descartadas'}.` : ''
  return `Sua sessão terminou. Por segurança, os dados da conta foram removidos deste aparelho — tudo continua salvo na conta. Entre de novo para continuar.${lostText}`
}

const EVERYWHERE_MESSAGE = 'Você saiu da conta em todos os aparelhos. Nos outros, os dados da conta são removidos assim que o app for aberto ou voltar para a tela.'

/**
 * Removes an account from this device. Signed out (nobody else here), also its preferences and
 * push; with another account already signed in (another tab), only what is the old account's.
 */
async function removeFromDevice(uid: string, current: string | null): Promise<{ pendingLost: number }> {
  const result = await removeAccountFromDevice(uid, { wholeDevice: !current })
  if (!current) await silencePushOnThisDevice().catch(() => {})
  return result
}

/** Leftovers of accounts whose session ended while the app was closed (or a cleanup was cut short). */
async function removeLeftovers(current: string | null): Promise<string[]> {
  const others = (await accountsOnDevice()).filter((uid) => uid !== current)
  for (const uid of others) await removeFromDevice(uid, current)
  return others
}

/** A fresh page: no state of the old account survives in memory (screens, assistant, caches). */
function restart() {
  location.replace(location.pathname + location.search)
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
  const [clearing, setClearing] = useState(false)
  /** The account the screen is showing; when the session stops being it, that account is removed. */
  const shownUid = useRef<string | null>(null)
  const manualSignOut = useRef(false)
  const everywhere = useRef(false)
  const ending = useRef<Promise<void> | null>(null)

  /**
   * Any end of a session — "Sair", expired or revoked token, another tab — goes through here:
   * nothing is shown while the account is removed from the device, then the page starts fresh.
   */
  const endAccount = useCallback((uid: string, next: string | null) => {
    if (ending.current) return
    const passive = !manualSignOut.current
    setClearing(true)
    ending.current = new Promise<void>((resolve) => {
      // Outside the auth callback: work that waits on the auth client from inside it deadlocks.
      setTimeout(() => {
        removeFromDevice(uid, next)
          .then(
            ({ pendingLost }) => leaveEndedNote({ passive, lost: passive ? pendingLost : 0, everywhere: everywhere.current }),
            (err) => {
              // Whatever was left is found and removed when the app opens again.
              console.error('Conta: falha ao limpar o aparelho', err instanceof Error ? err.name : 'unknown')
              leaveEndedNote({ passive, lost: 0, everywhere: everywhere.current })
            },
          )
          .finally(() => {
            resolve()
            restart()
          })
      }, 0)
    })
  }, [])

  useEffect(() => {
    if (!supabase) return
    const params = new URLSearchParams(location.search)
    const linkError = params.get('error_description')
    const hadCode = params.has('code')

    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      const nextUid = next?.user.id ?? null
      const previous = shownUid.current
      shownUid.current = nextUid
      setSession(next)
      if (previous && previous !== nextUid) endAccount(previous, nextUid)
      if (event === 'PASSWORD_RECOVERY') setScreen('newPassword')
      if (event === 'SIGNED_IN' && hadCode && params.get('type') !== 'recovery') setNotice(null)
    })

    supabase.auth.getSession().then(async ({ data: { session: current }, error }) => {
      const uid = current?.user.id ?? null
      shownUid.current = uid
      setSession(current)
      // Before anything is shown: accounts whose session ended while the app was closed.
      let leftovers: string[] = []
      try {
        leftovers = await removeLeftovers(uid)
      } catch (err) {
        console.error('Conta: falha ao limpar o aparelho', err instanceof Error ? err.name : 'unknown')
      }
      if (!uid && (endedNote || leftovers.length)) {
        if (endedNote?.everywhere) setNotice(EVERYWHERE_MESSAGE)
        else if (endedNote?.passive !== false) setNotice(sessionEndedMessage(endedNote?.lost ?? 0))
        setScreen('signin')
      }
      if (linkError) setNotice(`Link inválido ou expirado: ${linkError}`)
      else if (hadCode && !current) {
        // PKCE links only complete in the browser that asked for them. The e-mail is
        // still confirmed on the server, so signing in works from here.
        // Recovery links land here too (the link doesn't say which it was): explain both.
        setNotice('Se você confirmou o cadastro, já pode entrar com seu e-mail e senha. Se pediu para trocar a senha, toque em “Esqueci minha senha” e use o código de 6 dígitos do e-mail.')
        setScreen('signin')
      } else if (error) setNotice(authMessage(error))
      cleanAuthParams()
      setChecked(true)
    })
    return () => data.subscription.unsubscribe()
  }, [endAccount])

  // A token the server no longer accepts (session revoked by "Sair de todos os aparelhos" or a
  // password change elsewhere, user removed) ends the session here too. Checked when the app opens,
  // comes back to the front or back online, and every few minutes while it's on screen; offline or
  // a server problem never signs out.
  const signedIn = session?.user.id ?? null
  useEffect(() => {
    if (!supabase || !checked || !signedIn) return
    const client = supabase
    let last = 0
    const verify = () => {
      if (Date.now() - last < 30_000) return
      last = Date.now()
      void client.auth.getUser().then(({ error }) => {
        if (error && isAuthApiError(error) && (error.status === 401 || error.status === 403)) void client.auth.signOut({ scope: 'local' })
      })
    }
    verify()
    const onVisible = () => document.visibilityState === 'visible' && verify()
    const timer = setInterval(onVisible, 5 * 60_000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [checked, signedIn])

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase!.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } })
    // "Wait a minute" only comes for an address that already started a sign-up: answering like
    // any other sign-up keeps the screen from telling who has an account.
    if (error && !(isEmailThrottle(error) && error.message.toLowerCase().includes('for security purposes'))) throw new Error(authMessage(error))
    if (error) return { needsConfirmation: true }
    return { needsConfirmation: !data.session }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase!.auth.signInWithPassword({ email, password })
    if (error) throw new Error(authMessage(error))
    setScreen(null)
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    manualSignOut.current = true
    // "local" ends the session on this device only. The SIGNED_OUT that follows removes the
    // account from the device (endAccount); the page starts fresh when that is done.
    await supabase.auth.signOut({ scope: 'local' })
    await ending.current
  }, [])

  const signOutEverywhere = useCallback(async (opts?: { beforeThisDevice?(): Promise<void> }) => {
    if (!supabase) return
    // First every other session is revoked on the server (refresh tokens included); "others" keeps
    // this one, so a failure (offline) changes nothing here and can be shown. "global" would drop
    // this device's session even when the server never got the request.
    const { error } = await supabase.auth.signOut({ scope: 'others' })
    if (error) throw new Error(`${authMessage(error)} Nenhum aparelho foi desconectado.`)
    await opts?.beforeThisDevice?.()
    manualSignOut.current = true
    everywhere.current = true
    // Then this one, like "Sair". The other devices notice on their next check and clean up.
    await supabase.auth.signOut({ scope: 'local' })
    await ending.current
  }, [])

  const sendReset = useCallback(async (email: string) => {
    const { error } = await supabase!.auth.resetPasswordForEmail(email, { redirectTo: appUrl() })
    // The server answers an unknown address with success but an existing one, asked again too
    // soon, with "wait": both get the same screen ("if an account exists…"), so it can't be used
    // to find out who has an account. The server still limits the e-mails.
    if (error && !isEmailThrottle(error)) throw new Error(authMessage(error))
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
    // The server also ends every other session of the account and voids pending e-mail codes.
    const { error } = await supabase!.auth.updateUser({ password })
    if (error) throw new Error(authMessage(error))
    setScreen(null)
  }, [])

  const api = useMemo<SessionApi>(
    () => ({
      configured: cloudConfigured,
      checked,
      clearing,
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
      signOutEverywhere,
      sendReset,
      verifyCode,
      resendConfirmation,
      setNewPassword,
      clearNotice: () => setNotice(null),
    }),
    [checked, clearing, session, screen, notice, signUp, signIn, signOut, signOutEverywhere, sendReset, verifyCode, resendConfirmation, setNewPassword],
  )

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>
}

export function useSession(): SessionApi {
  const api = useContext(SessionContext)
  if (!api) throw new Error('useSession must be used inside SessionProvider')
  return api
}
