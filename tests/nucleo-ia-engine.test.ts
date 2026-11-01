/**
 * NÚCLEO IA — server logic (engine) with a scripted model and an in-memory budget.
 * No network, no database: what is checked is routing, the signed turn, append-only messages,
 * escalation, budget handling and the error paths.
 */
import { describe, expect, it } from 'vitest'
import { continueTurn, MAX_STEPS, startTurn, type Block, type CallResult, type Deps, type Reservation } from '../supabase/functions/_shared/ia/engine'
import { openTurn, sealTurn } from '../supabase/functions/_shared/ia/envelope'
import { affordableMaxTokens, costMicros, maxCallMicros, MODELS } from '../supabase/functions/_shared/ia/models'
import { TurnRequest, type StartRequest, type TurnResponse } from '../supabase/functions/_shared/ia/protocol'
import { routeFor } from '../supabase/functions/_shared/ia/router'
import { SYSTEM_PROMPT } from '../supabase/functions/_shared/ia/prompt'
import { APP_TOOLS } from '../supabase/functions/_shared/ia/tools'

const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres!'
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const USAGE = { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 1800 }

const start = (text: string, extra: Partial<StartRequest> = {}): StartRequest => ({
  kind: 'start',
  turnId: 'turno-teste-0001',
  text,
  today: '2026-11-01',
  timeZone: 'Europe/Lisbon',
  deep: false,
  consentVersion: 2,
  history: [],
  topics: '',
  focus: [],
  areasOff: [],
  ...extra,
})

const text = (t: string): CallResult => ({ content: [{ type: 'thinking', thinking: '', signature: 'sig-a' }, { type: 'text', text: t }], stop_reason: 'end_turn', usage: USAGE, model: 'x' })
const tool = (name: string, input: Record<string, unknown>, id = 'toolu_1'): CallResult => ({
  content: [{ type: 'thinking', thinking: '', signature: 'sig-b' }, { type: 'tool_use', id, name, input }],
  stop_reason: 'tool_use',
  usage: USAGE,
  model: 'x',
})

function harness(script: (CallResult | Error)[], opts: { uid?: string; refuse?: (a: { model: string; step: number }) => Reservation['outcome'] | null; now?: number } = {}) {
  const calls: Record<string, unknown>[] = []
  const reserves: { model: string; step: number; wantedMicros: number; minMicros: number; route: string; turnId: string }[] = []
  const settles: { ok: boolean; costMicros: number; tools: string[]; model: string }[] = []
  let id = 0
  const deps: Deps = {
    uid: opts.uid ?? A,
    secret: SECRET,
    now: () => opts.now ?? 1_800_000_000_000,
    async reserve(a) {
      reserves.push(a)
      const refused = opts.refuse?.(a)
      if (refused) return { outcome: refused, usageId: null, grantedMicros: 0 }
      return { outcome: 'ok', usageId: ++id, grantedMicros: a.wantedMicros }
    },
    async settle(_id, a) {
      settles.push({ ok: a.ok, costMicros: a.costMicros, tools: a.tools, model: a.model })
    },
    async callModel(p) {
      calls.push(JSON.parse(JSON.stringify(p)))
      const next = script.shift()
      if (!next) throw new Error('script vazio')
      if (next instanceof Error) throw next
      return next
    },
  }
  return { deps, calls, reserves, settles }
}

describe('preços e custo (tabela oficial 2026-11-01)', () => {
  it('custo real em micro-dólares: entrada, gravação e leitura de cache, saída', () => {
    // Haiku: 1000×0,10 + 1000×0,125 + 2000×0,01 + 500×0,50 = 495
    expect(costMicros('haiku', { input_tokens: 1000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 500 })).toBe(495)
    // Sonnet: 1000×2 + 1000×2,5 + 2000×0,10 + 500×10 = 9700
    expect(costMicros('sonnet', { input_tokens: 1000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 500 })).toBe(9700)
    // Haiku acima de 100 mil tokens no prompt: preço de contexto longo
    expect(costMicros('haiku', { input_tokens: 120_000, output_tokens: 0 })).toBe(60_000)
  })

  it('reserva cobre o pior caso e max_tokens encolhe para caber no que foi concedido', () => {
    expect(maxCallMicros('haiku', 4000, 2000)).toBe(4000 * 0.125 + 2000 * 0.5)
    expect(affordableMaxTokens('haiku', 4000, 1500)).toBe(2000)
    expect(affordableMaxTokens('haiku', 4000, 900)).toBe(800)
    expect(affordableMaxTokens('haiku', 4000, 600)).toBe(0)
    expect(MODELS.haiku.id).toBe('claude-haiku-5-5')
    expect(MODELS.sonnet.id).toBe('claude-sonnet-5-5')
    expect(MODELS.opus.enabled).toBe(false)
  })
})

describe('roteamento', () => {
  it.each([
    ['O que tenho amanhã?', 'rapida', 'haiku'],
    ['quanto gastei com mercado em outubro', 'rapida', 'haiku'],
    ['e em setembro?', 'rapida', 'haiku'],
    ['por que meus gastos subiram?', 'atenta', 'haiku'],
    ['compara outubro com setembro', 'atenta', 'haiku'],
    ['quanto falta pra meta da viagem', 'atenta', 'haiku'],
    ['Quero juntar 6 mil para a viagem até julho, dá?', 'profunda', 'sonnet'],
    ['me ajuda a organizar minhas finanças', 'profunda', 'sonnet'],
    ['vale a pena cancelar a academia?', 'profunda', 'sonnet'],
    ['fechei uma venda, cria o projeto e as tarefas e me lembra de cobrar', 'profunda', 'sonnet'],
  ])('%s → %s', (q, route, model) => {
    expect(routeFor(q)).toMatchObject({ route, model })
  })
  it('"Analisar a fundo" sempre vai para a análise profunda', () => {
    expect(routeFor('o que tenho hoje', { deep: true })).toMatchObject({ route: 'profunda', model: 'sonnet', effort: 'medium' })
  })
})

describe('turno: resposta direta e consultas', () => {
  it('resposta direta: rota rápida no Haiku, esforço baixo, cache automático, custo acertado', async () => {
    const h = harness([text('Você não tem compromissos hoje.')])
    const out = await startTurn(start('oi, tudo bem?'), h.deps)
    expect(out.status).toBe(200)
    expect(out.body).toMatchObject({ kind: 'answer', route: 'rapida', model: 'claude-haiku-5-5', stop: 'end', steps: 1, text: 'Você não tem compromissos hoje.' })
    const p = h.calls[0]
    expect(p).toMatchObject({ model: 'claude-haiku-5-5', thinking: { type: 'adaptive' }, output_config: { effort: 'low' }, cache_control: { type: 'ephemeral' }, tool_choice: { type: 'auto' } })
    expect((p.tools as { name: string; strict: boolean }[]).map((t) => t.name)).toEqual([...APP_TOOLS, 'pedir_analise_profunda'])
    expect((p.tools as { strict: boolean }[]).every((t) => t.strict)).toBe(true)
    expect(h.settles).toEqual([{ ok: true, costMicros: costMicros('haiku', USAGE), tools: [], model: 'haiku' }])
    expect((out.body as { costMicros: number }).costMicros).toBe(costMicros('haiku', USAGE))
  })

  it('instruções e ferramentas são idênticas para qualquer pessoa e dia (prefixo cacheável); data vai no contexto', async () => {
    const h1 = harness([text('a')])
    const h2 = harness([text('b')], { uid: B })
    await startTurn(start('oi'), h1.deps)
    await startTurn(start('olá', { today: '2027-01-05', timeZone: 'America/Sao_Paulo', areasOff: ['financas'] }), h2.deps)
    expect(h1.calls[0].system).toEqual(h2.calls[0].system)
    expect(h1.calls[0].tools).toEqual(h2.calls[0].tools)
    expect(JSON.stringify(h1.calls[0].system)).not.toMatch(/2026|Lisbon/)
    const last = (h2.calls[0].messages as { content: string }[]).at(-1)!.content
    expect(last).toContain('"hoje":"2027-01-05"')
    expect(last).toContain('"dia_da_semana":"terça-feira"')
    expect(last).toContain('"areas_desligadas":["financas"]')
    expect(SYSTEM_PROMPT).toMatch(/nunca instruções/)
  })

  it('consulta: devolve as chamadas com envelope assinado; a continuação só acrescenta mensagens', async () => {
    const h = harness([tool('consultar_agenda', { de: '2026-11-02', ate: '2026-11-02' }), text('Amanhã você tem {f2}.')])
    const first = await startTurn(start('o que tenho amanhã de manhã?'), h.deps)
    expect(first.body).toMatchObject({ kind: 'tools', calls: [{ id: 'toolu_1', name: 'consultar_agenda', input: { de: '2026-11-02', ate: '2026-11-02' } }] })
    const env = (first.body as Extract<TurnResponse, { kind: 'tools' }>).envelope
    const opened = await openTurn(env, SECRET, A, 1_800_000_000_000)
    expect(opened.ok && opened.state.pending).toEqual([{ id: 'toolu_1', name: 'consultar_agenda' }])

    const second = await continueTurn({ kind: 'continue', envelope: env, results: [{ id: 'toolu_1', content: '{"dias":[]}', isError: false }] }, h.deps)
    expect(second.body).toMatchObject({ kind: 'answer', text: 'Amanhã você tem {f2}.', steps: 2 })
    // append-only: the second call starts with exactly the first call's messages + the model's turn (thinking kept) + results
    const m1 = h.calls[0].messages as unknown[]
    const m2 = h.calls[1].messages as { role: string; content: unknown }[]
    expect(m2.slice(0, m1.length)).toEqual(m1)
    expect(m2[m1.length]).toEqual({ role: 'assistant', content: tool('consultar_agenda', { de: '2026-11-02', ate: '2026-11-02' }).content })
    expect(m2[m1.length + 1]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"dias":[]}' }] })
    expect(h.reserves.map((r) => [r.turnId, r.step])).toEqual([['turno-teste-0001', 1], ['turno-teste-0001', 2]])
  })

  it('histórico compacto vira mensagens anteriores (sem consultas antigas)', async () => {
    const h = harness([text('ok')])
    await startTurn(start('e em setembro?', { history: [{ q: 'quanto gastei com mercado em outubro', a: 'R$ 612,40 em 9 compras.' }], focus: [{ tool: 'resumo_financeiro', args: { periodo: 'mes', referencia: '2026-10', categoria: 'mercado' } }] }), h.deps)
    const msgs = h.calls[0].messages as { role: string; content: string }[]
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(msgs[2].content).toContain('"consultas_recentes":[{"tool":"resumo_financeiro","args":{"periodo":"mes","referencia":"2026-10","categoria":"mercado"}}]')
  })

  it('a última chamada permitida não pode pedir consulta (tool_choice none)', async () => {
    const script: CallResult[] = []
    for (let i = 0; i < MAX_STEPS - 1; i++) script.push(tool('buscar', { texto: `x${i}` }, `toolu_${i}`))
    script.push(text('fim'))
    const h = harness(script)
    let out = await startTurn(start('procura x'), h.deps)
    for (let i = 0; i < MAX_STEPS - 1; i++) {
      const body = out.body as Extract<TurnResponse, { kind: 'tools' }>
      out = await continueTurn({ kind: 'continue', envelope: body.envelope, results: [{ id: body.calls[0].id, content: '{}', isError: false }] }, h.deps)
    }
    expect(out.body).toMatchObject({ kind: 'answer', text: 'fim', steps: MAX_STEPS })
    expect(h.calls.at(-1)!.tool_choice).toEqual({ type: 'none' })
    expect(h.calls.slice(0, -1).every((c) => (c.tool_choice as { type: string }).type === 'auto')).toBe(true)
  })
})

describe('turno assinado: isolamento entre contas e adulteração', () => {
  it('turno da conta A não continua com o login da conta B', async () => {
    const h = harness([tool('buscar', { texto: 'x' })])
    const first = await startTurn(start('procura x'), h.deps)
    const env = (first.body as { envelope: string }).envelope
    const hb = harness([text('nunca')], { uid: B })
    const out = await continueTurn({ kind: 'continue', envelope: env, results: [{ id: 'toolu_1', content: '{}', isError: false }] }, hb.deps)
    expect(out.status).toBe(409)
    expect(hb.calls).toHaveLength(0)
    expect(hb.reserves).toHaveLength(0)
  })

  it('envelope adulterado, de outro segredo ou vencido é recusado', async () => {
    const h = harness([tool('buscar', { texto: 'x' })])
    const env = ((await startTurn(start('procura x'), h.deps)).body as { envelope: string }).envelope
    const [body, sig] = env.split('.')
    const forged = JSON.parse(Buffer.from(body, 'base64url').toString())
    forged.model = 'sonnet'
    forged.spentMicros = 0
    const tampered = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`
    const h2 = harness([text('nunca')])
    expect((await continueTurn({ kind: 'continue', envelope: tampered, results: [{ id: 'toolu_1', content: '{}', isError: false }] }, h2.deps)).status).toBe(409)
    const other = await sealTurn(forged, 'outro-segredo-com-mais-de-32-caracteres!!')
    expect((await continueTurn({ kind: 'continue', envelope: other, results: [{ id: 'toolu_1', content: '{}', isError: false }] }, h2.deps)).status).toBe(409)
    const late = harness([text('nunca')], { now: 1_800_000_000_000 + 11 * 60 * 1000 })
    expect((await continueTurn({ kind: 'continue', envelope: env, results: [{ id: 'toolu_1', content: '{}', isError: false }] }, late.deps)).status).toBe(409)
    expect(h2.calls).toHaveLength(0)
    expect(late.calls).toHaveLength(0)
  })

  it('resultados só para as consultas pendentes', async () => {
    const h = harness([tool('buscar', { texto: 'x' })])
    const env = ((await startTurn(start('procura x'), h.deps)).body as { envelope: string }).envelope
    const out = await continueTurn({ kind: 'continue', envelope: env, results: [{ id: 'toolu_OUTRO', content: '{}', isError: false }] }, harness([]).deps)
    expect(out.status).toBe(400)
  })

  it('o corpo do pedido não identifica a pessoa: campos extras são descartados', () => {
    const parsed = TurnRequest.parse({ ...start('oi'), uid: B, user_id: B, model: 'claude-opus-5-5' })
    expect(parsed).not.toHaveProperty('uid')
    expect(parsed).not.toHaveProperty('user_id')
    expect(parsed).not.toHaveProperty('model')
    expect(TurnRequest.safeParse({ ...start('oi'), consentVersion: 1 }).success).toBe(false)
    expect(TurnRequest.safeParse({ ...start('oi'), turnId: '../../etc' }).success).toBe(false)
  })
})

describe('escalada e orçamento', () => {
  it('Haiku pede análise profunda → a pergunta recomeça no Sonnet a partir do início', async () => {
    const h = harness([tool('pedir_analise_profunda', { motivo: 'plano com várias etapas' }), text('Plano: {f1}')])
    const out = await startTurn(start('organiza meus próximos meses'), h.deps)
    expect(out.body).toMatchObject({ kind: 'answer', route: 'profunda', model: 'claude-sonnet-5-5' })
    expect(h.calls[1].model).toBe('claude-sonnet-5-5')
    expect(h.calls[1].messages).toEqual(h.calls[0].messages)
    expect((h.calls[1].tools as { name: string }[]).map((t) => t.name)).not.toContain('pedir_analise_profunda')
    expect(h.reserves.map((r) => r.model)).toEqual(['haiku', 'sonnet'])
  })

  it('sem orçamento de Sonnet na escalada → Haiku segue avisando que é análise simplificada', async () => {
    const h = harness([tool('pedir_analise_profunda', { motivo: 'x' }), text('Análise simplificada: …')], { refuse: (a) => (a.model === 'sonnet' ? 'limit-sonnet' : null) })
    const out = await startTurn(start('organiza meus próximos meses'), h.deps)
    expect(out.body).toMatchObject({ kind: 'answer', model: 'claude-haiku-5-5' })
    const last = (h.calls[1].messages as { role: string; content: unknown }[]).at(-1) as { content: { content: string }[] }
    expect(last.content[0].content).toMatch(/análise simplificada/)
    expect(h.calls[1].output_config).toEqual({ effort: 'medium' })
  })

  it('pergunta de planejamento sem orçamento de Sonnet já começa no Haiku com esforço médio', async () => {
    const h = harness([text('ok')], { refuse: (a) => (a.model === 'sonnet' ? 'sonnet-blocked' : null) })
    const out = await startTurn(start('quero juntar 5 mil até março'), h.deps)
    expect(out.body).toMatchObject({ kind: 'answer', route: 'atenta', model: 'claude-haiku-5-5' })
    expect(h.calls[0].output_config).toEqual({ effort: 'medium' })
  })

  it.each([
    ['limit-day', 429, 'limit', /limite de uso da IA de hoje/],
    ['limit-month', 429, 'limit', /deste mês/],
    ['no-plan', 403, 'no-plan', /não está incluída no seu plano/],
    ['global', 503, 'global-limit', /pausada/],
    ['paused', 503, 'paused', /pausada/],
    ['busy', 429, 'busy', /Aguarde/],
  ] as const)('orçamento recusado (%s) → %i sem chamar a IA', async (outcome, status, error, msg) => {
    const h = harness([text('nunca')], { refuse: () => outcome })
    const out = await startTurn(start('oi'), h.deps)
    expect(out.status).toBe(status)
    expect(out.body).toMatchObject({ error })
    expect((out.body as { message: string }).message).toMatch(msg)
    expect(h.calls).toHaveLength(0)
  })

  it('limite por pergunta no meio do turno: para com uma resposta, sem erro', async () => {
    const h = harness([tool('buscar', { texto: 'x' })], { refuse: (a) => (a.step === 2 ? 'limit-request' : null) })
    const env = ((await startTurn(start('procura x'), h.deps)).body as { envelope: string }).envelope
    const out = await continueTurn({ kind: 'continue', envelope: env, results: [{ id: 'toolu_1', content: '{}', isError: false }] }, h.deps)
    expect(out.body).toMatchObject({ kind: 'answer', stop: 'request-limit' })
  })

  it('max_tokens enviado nunca passa do que a reserva concedida paga', async () => {
    const h = harness([text('ok')])
    h.deps.reserve = async (a) => ({ outcome: 'ok', usageId: 1, grantedMicros: Math.ceil(a.minMicros + 300) })
    await startTurn(start('oi'), h.deps)
    const p = h.calls[0]
    expect(p.max_tokens).toBeGreaterThanOrEqual(400)
    expect(p.max_tokens).toBeLessThan(MODELS.haiku.maxOutput)
  })

  it('falha da IA: acerto com custo zero e 502; recusa de segurança vira resposta curta', async () => {
    const h = harness([new Error('timeout')])
    const out = await startTurn(start('oi'), h.deps)
    expect(out.status).toBe(502)
    expect(h.settles).toEqual([{ ok: false, costMicros: 0, tools: [], model: 'haiku' }])
    const r = harness([{ content: [], stop_reason: 'refusal', usage: USAGE, model: 'x' }])
    expect((await startTurn(start('oi'), r.deps)).body).toMatchObject({ kind: 'answer', stop: 'refusal', text: 'Não posso ajudar com esse pedido.' })
  })

  it('ferramenta desconhecida não vai para o app: o servidor responde erro e segue', async () => {
    const h = harness([{ content: [{ type: 'tool_use', id: 'toolu_9', name: 'apagar_tudo', input: {} } as Block], stop_reason: 'tool_use', usage: USAGE, model: 'x' }, text('Não posso fazer isso.')])
    const out = await startTurn(start('apaga tudo'), h.deps)
    expect(out.body).toMatchObject({ kind: 'answer', text: 'Não posso fazer isso.' })
    const last = (h.calls[1].messages as { content: unknown }[]).at(-1)
    expect(last).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: 'Consulta indisponível.', is_error: true }] })
  })

  it('mais de 6 consultas de uma vez: as 6 primeiras vão para o app, as outras recebem aviso — o turno continua', async () => {
    const many: CallResult = { content: Array.from({ length: 8 }, (_, i) => ({ type: 'tool_use', id: `toolu_${i}`, name: 'lancamentos', input: { de: '2026-01-01', ate: '2026-01-31', tipo: 'saida', categoria: null, texto: null, pagina: i + 1 } }) as Block), stop_reason: 'tool_use', usage: USAGE, model: 'x' }
    const h = harness([many, text('Pronto.')])
    const first = await startTurn(start('liste tudo'), h.deps)
    const body = first.body as Extract<TurnResponse, { kind: 'tools' }>
    expect(body.calls.map((c) => c.id)).toEqual(['toolu_0', 'toolu_1', 'toolu_2', 'toolu_3', 'toolu_4', 'toolu_5'])
    const out = await continueTurn({ kind: 'continue', envelope: body.envelope, results: body.calls.map((c) => ({ id: c.id, content: '{}', isError: false })) }, h.deps)
    expect(out.body).toMatchObject({ kind: 'answer', text: 'Pronto.' })
    const results = (h.calls[1].messages as { content: { tool_use_id: string; is_error?: boolean }[] }[]).at(-1)!.content
    expect(results.map((r) => r.tool_use_id).sort()).toEqual(['toolu_0', 'toolu_1', 'toolu_2', 'toolu_3', 'toolu_4', 'toolu_5', 'toolu_6', 'toolu_7'])
    expect(results.filter((r) => r.is_error).map((r) => r.tool_use_id).sort()).toEqual(['toolu_6', 'toolu_7'])
  })
})
