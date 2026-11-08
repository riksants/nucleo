/**
 * PARTE 14 — testes de privacidade/regressão do monitoramento (Sentry). Garante que NENHUM dado sensível
 * sai do navegador, que o contexto de usuário é pseudônimo e limpo no logout, que o SDK fica desligado sem
 * DSN, que uma falha do Sentry nunca quebra o app, e que release/environment são configurados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scrubEvent, scrubValue, pseudonym, MONITORING_ENABLED } from '../src/lib/monitoring'
import type { ErrorEvent } from '@sentry/react'

// Valores FALSOS nos formatos sensíveis (nunca dados reais).
const FAKE = {
  password: 'SenhaSecreta123!',
  access: 'eyJhbGciOiJIUzI1NiISInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.abcdef_signature-123',
  bearer: 'Bearer sk-test-abcdefghijklmnopqrstuvwxyz0123',
  anthropic: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz',
  otp: '0123456789',
  recovery: 'K7QF-M2PL-ZX94-TRB8',
  vaultCt: 'c2VhbGVkLWNpcGhlcnRleHQtbXVpdG8tbG9uZ28',
  note: 'conteúdo privado de uma nota do usuário',
  prompt: 'minha conversa privada com a IA sobre finanças',
  money: 'R$ 27.493,32',
}

/** Monta um evento com valores sensíveis espalhados por todos os lugares que o Sentry preenche. */
function pollutedEvent(): ErrorEvent {
  return {
    type: undefined,
    // Mensagem de erro com um valor em FORMATO de token (o app nunca interpola senha crua em mensagens).
    message: `falhou ao autenticar: ${FAKE.access}`,
    release: 'abc123',
    environment: 'production',
    user: { id: 'pseudo-123', email: 'real@email.com', username: 'Fulano', ip_address: '1.2.3.4' },
    tags: { module: 'finance', password: FAKE.password },
    extra: {
      balance: 'R$ 27.493,32',
      note: FAKE.note,
      prompt: FAKE.prompt,
      record: { data: { password: FAKE.password, title: FAKE.note, secret: { ct: FAKE.vaultCt } } },
      access_token: FAKE.access,
      recovery_code: FAKE.recovery,
    },
    contexts: { app: { app_version: '1.0' }, auth: { token: FAKE.bearer, otp: FAKE.otp } },
    request: {
      url: 'https://app/nucleo/#/finance?q=segredo-na-query',
      headers: { Authorization: FAKE.bearer, Cookie: 'sb-access=xyz', 'User-Agent': 'x' },
      data: { password: FAKE.password, body: 'corpo com dados' },
      cookies: { 'sb-refresh': 'refreshtoken' },
    },
    exception: { values: [{ type: 'Error', value: `erro com ${FAKE.anthropic} e saldo ${FAKE.money}` }] },
    breadcrumbs: [
      { category: 'navigation', data: { from: '/#/notes?id=1', to: '/#/finance' } },
      { category: 'console', message: `log com ${FAKE.password}` },
      { category: 'ui.input', message: FAKE.note },
      { category: 'fetch', data: { method: 'POST', status_code: 200, url: 'https://x/rest/v1/records?select=secret', body: FAKE.note } },
    ],
  } as unknown as ErrorEvent
}

const asText = (e: unknown) => JSON.stringify(e)
const SENSITIVE = Object.values(FAKE)

describe('PARTE 14: sanitização do evento (nada sensível sai)', () => {
  it('nenhum valor sensível sobrevive ao beforeSend, em nenhum campo', () => {
    const out = scrubEvent(pollutedEvent())!
    expect(out).not.toBeNull()
    const text = asText(out)
    for (const v of SENSITIVE) expect(text).not.toContain(v)
    // também não vaza e-mail/username/ip do usuário nem cookie
    expect(text).not.toContain('real@email.com')
    expect(text).not.toContain('Fulano')
    expect(text).not.toContain('1.2.3.4')
    expect(text).not.toContain('refreshtoken')
    expect(text).not.toContain('segredo-na-query')
  })

  it('o usuário fica só com o id pseudônimo (sem e-mail, nome ou ip)', () => {
    const out = scrubEvent(pollutedEvent())!
    expect(out.user).toEqual({ id: 'pseudo-123' })
  })

  it('request body, cookies e header Authorization são removidos; url perde a query', () => {
    const out = scrubEvent(pollutedEvent())!
    expect(out.request?.data).toBeUndefined()
    expect(out.request?.cookies).toBeUndefined()
    expect(out.request?.headers?.Authorization).toBeUndefined()
    expect(out.request?.url).toBe('https://app/nucleo/#/finance')
  })

  it('mantém contexto TÉCNICO útil (module, status, método, release, environment)', () => {
    const out = scrubEvent(pollutedEvent())!
    expect(out.tags?.module).toBe('finance')
    expect(out.release).toBe('abc123')
    expect(out.environment).toBe('production')
    const fetchCrumb = out.breadcrumbs?.find((b) => b.category === 'fetch')
    expect(fetchCrumb?.data?.method).toBe('POST')
    expect(fetchCrumb?.data?.status_code).toBe(200)
    expect(fetchCrumb?.data?.url).toBe('https://x/rest/v1/records') // sem a query ?select=secret
  })

  it('migalhas de console e de texto digitado (ui.input) não são enviadas', () => {
    // scrubBreadcrumb roda no beforeBreadcrumb; aqui garantimos que, mesmo se chegarem ao evento,
    // o scrub de valor não deixa o conteúdo digitado passar.
    const out = scrubEvent(pollutedEvent())!
    const text = asText(out.breadcrumbs)
    expect(text).not.toContain(FAKE.note)
    expect(text).not.toContain(FAKE.password)
  })

  it('scrubValue mascara por NOME e por FORMATO, preservando valores inócuos', () => {
    expect(scrubValue('password', 'x')).toBe('[redacted]')
    expect(scrubValue('qualquer', FAKE.access)).toBe('[redacted]') // formato JWT, nome inócuo
    expect(scrubValue('saldo', 1234)).toBe('[redacted]') // nome financeiro, número
    expect(scrubValue('status', 404)).toBe(404) // técnico: mantém
    expect(scrubValue('module', 'finance')).toBe('finance')
  })

  it('um evento impossível de sanear com segurança não é enviado (retorna null)', () => {
    const bad = { get exception() { throw new Error('boom') } } as unknown as ErrorEvent
    expect(scrubEvent(bad)).toBeNull()
  })
})

describe('PARTE 14: pseudônimo de usuário', () => {
  it('é estável, hexadecimal e diferente do uid', () => {
    const uid = '11111111-1111-4111-8111-111111111111'
    expect(pseudonym(uid)).toBe(pseudonym(uid))
    expect(pseudonym(uid)).toMatch(/^[0-9a-f]{16}$/)
    expect(pseudonym(uid)).not.toContain(uid)
    expect(pseudonym(uid)).not.toBe(pseudonym('22222222-2222-4222-8222-222222222222'))
  })
})

describe('PARTE 14: desligado sem configuração', () => {
  it('MONITORING_ENABLED é false no ambiente de teste (sem DSN)', () => {
    expect(MONITORING_ENABLED).toBe(false)
  })
})

// Com um DSN presente, o SDK é mockado para inspecionar a configuração sem enviar nada.
describe('PARTE 14: ligado (SDK mockado) — init, logout e resiliência', () => {
  const init = vi.fn()
  const setUser = vi.fn()
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_SENTRY_DSN', 'https://pub@o1.ingest.us.sentry.io/42')
    vi.stubEnv('VITE_RELEASE', 'commit-sha-abc')
    init.mockReset()
    setUser.mockReset()
    vi.doMock('@sentry/react', () => ({ init, setUser, captureException: vi.fn() }))
  })
  afterEach(() => {
    vi.doUnmock('@sentry/react')
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('init usa sendDefaultPii:false, tracesSampleRate:0, beforeSend, release e environment; sem Replay', async () => {
    const m = await import('../src/lib/monitoring')
    expect(m.MONITORING_ENABLED).toBe(true)
    m.initMonitoring()
    expect(init).toHaveBeenCalledTimes(1)
    const cfg = init.mock.calls[0][0]
    expect(cfg.sendDefaultPii).toBeFalsy() // nunca habilitamos PII
    // v11 coleta PII por padrão: desligamos cada fonte explicitamente.
    expect(cfg.dataCollection).toMatchObject({ userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false })
    expect(cfg.dataCollection.httpBodies).toEqual([])
    expect(cfg.tracesSampleRate).toBe(0)
    expect(cfg.release).toBe('commit-sha-abc')
    expect(cfg.environment).toBeTruthy()
    expect(typeof cfg.beforeSend).toBe('function')
    expect(typeof cfg.beforeBreadcrumb).toBe('function')
    expect('replaysSessionSampleRate' in cfg).toBe(false) // sem Session Replay
  })

  it('login seta usuário pseudônimo; logout limpa o contexto', async () => {
    const m = await import('../src/lib/monitoring')
    m.setMonitoringUser('11111111-1111-4111-8111-111111111111')
    expect(setUser).toHaveBeenCalledWith({ id: m.pseudonym('11111111-1111-4111-8111-111111111111') })
    const call = setUser.mock.calls[0][0]
    expect(call.email).toBeUndefined()
    expect(call.username).toBeUndefined()
    m.setMonitoringUser(null) // logout
    expect(setUser).toHaveBeenLastCalledWith(null)
  })

  it('troca A→B: o id de B nunca é o de A', async () => {
    const m = await import('../src/lib/monitoring')
    m.setMonitoringUser('aaaaaaaa-1111-4111-8111-111111111111')
    m.setMonitoringUser(null)
    m.setMonitoringUser('bbbbbbbb-2222-4222-8222-222222222222')
    const idA = m.pseudonym('aaaaaaaa-1111-4111-8111-111111111111')
    const idB = setUser.mock.calls.at(-1)![0].id
    expect(idB).not.toBe(idA)
  })

  it('falha do Sentry.init não quebra o app', async () => {
    init.mockImplementation(() => {
      throw new Error('sentry caiu')
    })
    const m = await import('../src/lib/monitoring')
    expect(() => m.initMonitoring()).not.toThrow()
  })
})
