/**
 * Cloudflare Turnstile on the sign-in screens (Entrar, Criar conta, Recuperar senha, Reenviar
 * e-mail). Only the public site key lives here; the secret key is set in Supabase Auth, which checks
 * each token. Without VITE_TURNSTILE_SITE_KEY nothing is loaded and the screens work as before.
 *
 * The script is fetched from Cloudflare every time the screen opens: it is cross-origin, so the
 * service worker never stores it (Workbox only precaches the app's own files), as Cloudflare asks.
 */
import { useEffect, useRef, useState } from 'react'
import { TURNSTILE_SITE_KEY } from './captchaKey'

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string | undefined
  remove(id: string): void
}

declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

let loading: Promise<Turnstile> | null = null

function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')))
    script.onerror = () => {
      script.remove()
      reject(new Error('turnstile'))
    }
    document.head.appendChild(script)
  }).catch((err) => {
    // Blocked or offline: the next try loads it again.
    loading = null
    throw err
  })
  return loading
}

/**
 * One check. A token works once and for about 5 minutes: the screen remounts this (new `key`)
 * after every request that used it. `onToken(null)` when the token expired or the check failed.
 */
export function Captcha({ onToken }: { onToken(token: string | null): void }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'checking' | 'done' | 'failed'>('checking')
  const [round, setRound] = useState(0)
  const report = useRef(onToken)
  useEffect(() => {
    report.current = onToken
  })

  useEffect(() => {
    let widget: string | undefined
    let gone = false
    loadTurnstile().then(
      (turnstile) => {
        if (gone || !box.current) return
        widget = turnstile.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          // Shown only when Cloudflare needs the person to tick a box.
          appearance: 'interaction-only',
          size: 'flexible',
          theme: 'auto',
          language: 'pt-br',
          callback: (token: string) => {
            setState('done')
            report.current(token)
          },
          'expired-callback': () => {
            setState('checking')
            report.current(null)
          },
          'error-callback': () => {
            setState('failed')
            report.current(null)
            return true
          },
          'timeout-callback': () => {
            setState('failed')
            report.current(null)
          },
        })
      },
      () => {
        if (!gone) setState('failed')
      },
    )
    return () => {
      gone = true
      if (widget) window.turnstile?.remove(widget)
    }
  }, [round])

  return (
    <div>
      <div ref={box} />
      {state === 'checking' && <p className="text-[13px] text-faint">Verificação de segurança em andamento…</p>}
      {state === 'failed' && (
        <p className="text-[14px] leading-relaxed text-expense">
          Não foi possível fazer a verificação de segurança. Confira a conexão.{' '}
          <button
            type="button"
            onClick={() => {
              setState('checking')
              setRound((n) => n + 1)
            }}
            className="font-medium text-accent-hi underline underline-offset-2 hover:text-ink"
          >
            Tentar de novo
          </button>
        </p>
      )}
    </div>
  )
}
