import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AiOutput, AssistantRequest, toIntent } from '../supabase/functions/_shared/assistant/ai.ts'
import { MIN_GAP_MS, resetGuard, resolveIntent, SESSION_CAP } from '../src/core/assistant/resolve'

const TODAY = '2026-10-06'
const ON = { enabled: true, consentAt: '2026-10-06T10:00:00Z' }
const out = (p: Partial<AiOutput>): AiOutput => ({ type: 'unknown', date: null, time: null, endTime: null, title: null, period: null, metric: null, number: null, ...p })

function spy(result: unknown = out({ type: 'createTask', title: 'Pagar luz' })) {
  const calls: unknown[][] = []
  return { calls, call: async (...args: unknown[]) => (calls.push(args), toIntent(result as AiOutput)) }
}

describe('interpretador com IA: desligado por padrão, custo zero', () => {
  beforeEach(() => resetGuard())

  it('desligado (padrão) ou sem consentimento: nunca chama, nem para frase que os comandos não entendem', async () => {
    for (const ai of [undefined, { enabled: false, consentAt: null }, { enabled: true, consentAt: null }]) {
      const s = spy()
      const r = await resolveIntent('empurra aquilo pra depois do almoço', TODAY, { ai, online: true, available: true, call: s.call })
      expect(s.calls).toHaveLength(0)
      expect(r).toMatchObject({ via: 'rules', intent: { type: 'unknown' } })
    }
  })

  it('ligado: comandos locais continuam primeiro; a IA só entra quando eles não entendem', async () => {
    const s = spy()
    expect(await resolveIntent('O que tenho amanhã?', TODAY, { ai: ON, online: true, available: true, call: s.call }, 0)).toMatchObject({ via: 'rules', intent: { type: 'day' } })
    expect(s.calls).toHaveLength(0)
    const r = await resolveIntent('anota aí que preciso pagar a luz', TODAY, { ai: ON, online: true, available: true, call: s.call }, 10_000)
    expect(r).toMatchObject({ via: 'ai', intent: { type: 'createTask', title: 'Pagar luz' } })
    // só a frase e a data de hoje vão para a IA
    expect(s.calls).toEqual([['anota aí que preciso pagar a luz', TODAY]])
  })

  it('sem conexão ou sem conta: avisa e continua com os comandos; erro da IA não quebra nada', async () => {
    const s = spy()
    expect((await resolveIntent('frase livre', TODAY, { ai: ON, online: false, available: true, call: s.call })).note).toBe('Este recurso precisa de conexão. Os comandos do Assistente continuam funcionando sem internet.')
    expect((await resolveIntent('frase livre', TODAY, { ai: ON, online: true, available: false, call: s.call })).note).toMatch(/conta conectada/)
    expect(s.calls).toHaveLength(0)
    const r = await resolveIntent('frase livre', TODAY, { ai: ON, online: true, available: true, call: async () => Promise.reject(new Error('Limite de 30 interpretações por dia atingido.')) }, 50_000)
    expect(r).toMatchObject({ via: 'rules', intent: { type: 'unknown' }, note: 'Limite de 30 interpretações por dia atingido.' })
  })

  it('proteção contra laço: uma por vez, intervalo mínimo e limite por sessão', async () => {
    const s = spy()
    const opts = { ai: ON, online: true, available: true, call: s.call }
    await resolveIntent('frase 1', TODAY, opts, 100_000)
    expect((await resolveIntent('frase 2', TODAY, opts, 100_000 + MIN_GAP_MS - 1)).note).toMatch(/Aguarde/)
    for (let i = 0; i < SESSION_CAP + 5; i++) await resolveIntent(`f${i}`, TODAY, opts, 200_000 + i * MIN_GAP_MS)
    expect(s.calls.length).toBe(SESSION_CAP)
  })
})

describe('contrato da IA: só intenções válidas, nada executado por ela', () => {
  it('converte a saída em intenção e valida (datas, horários, valores em centavos)', () => {
    expect(toIntent(out({ type: 'createEvent', title: 'Dentista', date: '2026-10-08', time: '14:00' }))).toEqual({ type: 'createEvent', title: 'Dentista', date: '2026-10-08', start: '14:00' })
    expect(toIntent(out({ type: 'createFinanceGoal', title: 'Viagem', number: 500000, date: '2026-12-31' }))).toEqual({ type: 'createFinanceGoal', name: 'Viagem', target: 500000, deadline: '2026-12-31' })
    expect(toIntent(out({ type: 'finance', period: 'month' }))).toEqual({ type: 'finance', period: 'month' })
  })

  it('saída inválida vira "não entendi" (nunca uma ação)', () => {
    expect(toIntent(out({ type: 'createEvent', title: 'X', date: '08/10', time: '14:00' }))).toEqual({ type: 'unknown' })
    expect(toIntent(out({ type: 'moveTask', title: 'X', date: '2026-10-08', time: '25:00' }))).toEqual({ type: 'unknown' })
    expect(toIntent(out({ type: 'deleteTask', title: '' }))).toEqual({ type: 'unknown' })
    expect(AiOutput.safeParse({ ...out({}), type: 'deleteTransaction' }).success).toBe(false)
  })

  it('pedido aceito só com consentimento, frase curta e sem campos extras', () => {
    expect(AssistantRequest.safeParse({ requestId: 'abcdefgh1', text: 'oi', today: TODAY, consent: false }).success).toBe(false)
    expect(AssistantRequest.safeParse({ requestId: 'abcdefgh1', text: 'x'.repeat(301), today: TODAY, consent: true }).success).toBe(false)
    const ok = AssistantRequest.parse({ requestId: 'abcdefgh1', text: 'oi', today: TODAY, consent: true, tasks: [{ title: 'segredo' }] } as never)
    expect(Object.keys(ok).sort()).toEqual(['consent', 'requestId', 'text', 'today'])
  })
})

describe('privacidade e segredos', () => {
  it('o app envia só frase, data, id e consentimento; a função guarda só tipo, modelo e tokens', () => {
    const client = readFileSync('src/features/assistant/ai.ts', 'utf8')
    expect(client).toMatch(/body: \{ requestId: newRequestId\(\), text, today, consent: true \}/)
    const fn = readFileSync('supabase/functions/assistant/index.ts', 'utf8')
    expect(fn).toMatch(/result: \{ type: intent\.type, model \}, input_tokens: inputTokens, output_tokens: outputTokens/)
    expect(fn).not.toMatch(/insert\(\{[^}]*text/)
    expect(fn).not.toMatch(/console\.(log|info|debug)/)
  })

  it('nenhuma chave da IA nem service_role no código do app', () => {
    const files: string[] = []
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(f)) files.push(p)
      }
    }
    walk('src')
    const all = files.map((f) => readFileSync(f, 'utf8')).join('\n')
    expect(all).not.toMatch(/ANTHROPIC_API_KEY|sk-ant-|SERVICE_ROLE/)
  })
})
