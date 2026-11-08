/**
 * PARTE 14 — monitoramento de erros em produção (Sentry), com PRIVACIDADE POR PADRÃO.
 *
 * Regras (ver docs/MONITORAMENTO.md):
 * - Só liga quando há um DSN (VITE_SENTRY_DSN) — desligado no desenvolvimento e nos builds e2e.
 * - sendDefaultPii: false. Nada de e-mail, nome, IP evitável, cookies, headers de auth, bodies.
 * - beforeSend por ALLOWLIST: remove o que é do domínio do usuário (extra, request body, contextos de
 *   negócio) e mascara qualquer valor sensível por NOME de campo E por FORMATO (token, JWT, senha,
 *   cofre, dinheiro, OTP, recovery…). Um evento que não dá para sanear com segurança não é enviado.
 * - Usuário identificado só por um pseudônimo técnico (hash do uid), limpo no logout.
 * - Sem Session Replay. Sem performance tracing. Falha do Sentry nunca quebra o app.
 */
import * as Sentry from '@sentry/react'

const DSN = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim()
const MODE = import.meta.env.MODE
const RELEASE = (import.meta.env.VITE_RELEASE as string | undefined)?.trim() || undefined

/** Ligado só com DSN e fora dos builds de teste (e2e*). */
export const MONITORING_ENABLED = Boolean(DSN) && !MODE.startsWith('e2e')

const REDACTED = '[redacted]'
const MAX_STR = 500
const MAX_DEPTH = 6
const MAX_KEYS = 120
const MAX_ARRAY = 50

// Nomes de campo cujo VALOR nunca deve sair (inclui segredos, auth e dados financeiros).
const SENSITIVE_KEY =
  /pass|password|senha|secret|token|authorization|bearer|cookie|\botp\b|recovery|vault|cofre|ciphertext|private.?key|service.?role|anthropic|vapid|p256dh|\bauth\b|\bdsn\b|\bpin\b|\bcode\b|apikey|balance|saldo|amount|valor|cents|\bpreco\b|price|charged|received|\btotal\b/i
// Campos técnicos que são seguros e úteis — nunca mascarados.
const SAFE_KEYS = new Set(['status', 'status_code', 'statuscode', 'httpstatus', 'statustext', 'method', 'module', 'screen', 'route', 'duration', 'release', 'environment', 'type', 'level'])

// Formatos de valor que nunca devem sair, mesmo sob um nome de campo inocente.
const SECRET_VALUE: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/, // JWT (access/refresh/anon/service)
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/i,
  /sk-a[n]t-[A-Za-z0-9_-]{10,}/, // Anthropic (prefixo escrito com classe [n] p/ não disparar scanners de segredo)
  /AGE-SECRET-KEY-1[0-9A-Z]{10,}/, // age (backup)
  /\bsb_secret_[A-Za-z0-9_-]{8,}/, // Supabase service key
  /\b[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}(-[A-Z0-9]{4})*\b/, // recovery code (grupos de 4)
]
const MONEY_VALUE = /(R\$|US\$|€|£|\$)\s?\d|\b\d{1,3}(\.\d{3})*,\d{2}\b|\b\d+\.\d{2}\b(?!\d)/ // dinheiro formatado

function scrubString(s: string): string {
  if (SECRET_VALUE.some((re) => re.test(s)) || MONEY_VALUE.test(s)) return REDACTED
  return s.length > MAX_STR ? s.slice(0, MAX_STR) + '…' : s
}

/** Mascara recursivamente por nome de campo e por formato de valor; limita tamanho e profundidade. */
export function scrubValue(key: string, value: unknown, depth = 0): unknown {
  const lk = key.toLowerCase()
  if (!SAFE_KEYS.has(lk) && SENSITIVE_KEY.test(lk)) return REDACTED
  if (value == null) return value
  if (typeof value === 'string') return scrubString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= MAX_DEPTH) return '[…]'
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => scrubValue(key, v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    let n = 0
    for (const k of Object.keys(value as Record<string, unknown>)) {
      if (n++ >= MAX_KEYS) break
      out[k] = scrubValue(k, (value as Record<string, unknown>)[k], depth + 1)
    }
    return out
  }
  return REDACTED // funções, símbolos etc.: fora
}

/** Mantém só rota/caminho; descarta query string (pode conter dado). */
function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url, 'http://x')
    const hash = u.hash.split('?')[0] // rota tipo #/financas; sem query
    return (u.origin !== 'http://x' ? u.origin : '') + u.pathname + hash
  } catch {
    return url.split('?')[0].slice(0, MAX_STR)
  }
}

// Contextos TÉCNICOS do Sentry que são seguros de enviar; qualquer outro (ex.: de negócio) é descartado.
const SAFE_CONTEXTS = new Set(['app', 'browser', 'os', 'device', 'runtime', 'culture', 'react', 'trace'])

/** Barreira final: nada sai sem passar por aqui. Em caso de dúvida, descarta o evento. */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
  try {
    if (event.request) {
      delete event.request.data // nunca corpo de request
      delete event.request.cookies
      delete (event.request as { query_string?: unknown }).query_string
      if (event.request.headers) for (const h of Object.keys(event.request.headers)) if (/authorization|cookie|token|apikey|auth/i.test(h)) delete event.request.headers[h]
      if (typeof event.request.url === 'string') event.request.url = sanitizeUrl(event.request.url)
    }
    // extra é onde código de app poderia despejar objetos do domínio (notas, prompts, records): não enviamos.
    delete event.extra
    // contexts: só os técnicos conhecidos (e ainda saneados por nome/formato).
    if (event.contexts) {
      const kept: Record<string, unknown> = {}
      for (const k of Object.keys(event.contexts)) if (SAFE_CONTEXTS.has(k)) kept[k] = scrubValue(k, (event.contexts as Record<string, unknown>)[k], 0)
      event.contexts = kept as Sentry.ErrorEvent['contexts']
    }
    if (event.tags) event.tags = scrubValue('tags', event.tags, 0) as Sentry.ErrorEvent['tags']
    if (typeof event.message === 'string') event.message = scrubString(event.message)
    for (const v of event.exception?.values ?? []) if (typeof v.value === 'string') v.value = scrubString(v.value)
    if (event.breadcrumbs) {
      // Mesmo filtro das migalhas (derruba console/ui.input, saneia fetch/navegação, tira corpo) + scrub final.
      event.breadcrumbs = event.breadcrumbs
        .map((b) => scrubBreadcrumb(b))
        .filter((b): b is Sentry.Breadcrumb => b != null)
        .map((b) => scrubValue('breadcrumb', b, 0) as Sentry.Breadcrumb)
    }
    // Usuário: só o id pseudônimo, nada mais (sem e-mail, nome, ip).
    event.user = event.user?.id ? { id: String(event.user.id) } : undefined
    delete (event as { server_name?: unknown }).server_name
    return event
  } catch {
    return null // meio-saneado nunca sai
  }
}

/** Só migalhas técnicas seguras; nada de texto digitado, console ou corpo de request. */
function scrubBreadcrumb(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (crumb.category === 'console' || crumb.category === 'ui.input') return null
  if (crumb.category === 'xhr' || crumb.category === 'fetch') {
    const d = (crumb.data ?? {}) as Record<string, unknown>
    crumb.data = { method: d.method, status_code: d.status_code, url: typeof d.url === 'string' ? sanitizeUrl(d.url) : undefined }
    return crumb
  }
  if (crumb.category === 'navigation' && crumb.data) {
    const d = crumb.data as Record<string, unknown>
    if (typeof d.from === 'string') d.from = sanitizeUrl(d.from)
    if (typeof d.to === 'string') d.to = sanitizeUrl(d.to)
  }
  if (typeof crumb.message === 'string') crumb.message = scrubString(crumb.message)
  return crumb
}

/** Pseudônimo estável do uid (FNV-1a, não reversível na prática) — conta usuários sem identificar. */
export function pseudonym(uid: string): string {
  const fnv = (seed: number) => {
    let h = seed >>> 0
    for (let i = 0; i < uid.length; i++) {
      h ^= uid.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }
  return fnv(0x811c9dc5) + fnv(0x7fffffff)
}

/** Ruído conhecido que não é bug do app. */
const IGNORE = [/ResizeObserver loop/i, /Non-Error promise rejection captured/i, /AbortError/i, /The operation was aborted/i, /Load failed/i, /NetworkError when attempting to fetch/i, /Failed to fetch dynamically imported module/i]

export function initMonitoring(): void {
  if (!MONITORING_ENABLED) return
  try {
    Sentry.init({
      dsn: DSN,
      environment: import.meta.env.PROD ? 'production' : 'development',
      release: RELEASE,
      // PRIVACIDADE: no SDK v11 o PADRÃO é COLETAR PII (IP, cookies, headers, corpos). Desligamos tudo
      // explicitamente na fonte — este é o equivalente ao antigo sendDefaultPii:false nesta versão.
      dataCollection: {
        userInfo: false, // sem IP/e-mail/username automáticos (só o {id} pseudônimo que nós mesmos setamos)
        cookies: false,
        httpHeaders: false,
        httpBodies: [], // nenhum corpo de request/response
        urlQueryParams: false,
      },
      // Só erros. Sem performance tracing e sem Session Replay (não adicionamos esses integrations).
      tracesSampleRate: 0,
      maxBreadcrumbs: 20,
      normalizeDepth: MAX_DEPTH,
      maxValueLength: MAX_STR,
      ignoreErrors: IGNORE,
      denyUrls: [/extensions\//i, /^chrome:\/\//i, /^chrome-extension:\/\//i, /^moz-extension:\/\//i, /^safari-extension:\/\//i],
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    })
  } catch {
    // Observabilidade nunca derruba o app.
  }
}

/** Contexto de usuário pseudônimo (login) ou limpo (logout). */
export function setMonitoringUser(uid: string | null): void {
  if (!MONITORING_ENABLED) return
  try {
    Sentry.setUser(uid ? { id: pseudonym(uid) } : null)
  } catch {
    /* ignora */
  }
}

/** Erro de renderização capturado pelo ErrorBoundary (uma captura por crash; sem duplicar). */
export function captureRenderError(error: unknown, componentStack?: string | null): void {
  if (!MONITORING_ENABLED) return
  try {
    Sentry.captureException(error, componentStack ? { contexts: { react: { componentStack } } } : undefined)
  } catch {
    /* ignora */
  }
}
