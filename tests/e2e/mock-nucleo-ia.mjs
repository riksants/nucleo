// NÚCLEO IA for the local mock server: the REAL server logic (engine, router, signed envelope,
// prompt, tools) with a scripted model instead of Anthropic, and an in-memory budget.
// Node 24 runs the .ts modules directly (type stripping).
import { continueTurn, startTurn } from '../../supabase/functions/_shared/ia/engine.ts'
import { costMicros } from '../../supabase/functions/_shared/ia/models.ts'
import { TurnRequest } from '../../supabase/functions/_shared/ia/protocol.ts'
import { blankAction } from '../../supabase/functions/_shared/ia/actions.ts'

const SECRET = 'segredo-do-mock-com-mais-de-32-caracteres!!'
export const iaLog = { requests: [], calls: [], spentMicros: 0 }
const USAGE = { input_tokens: 1400, output_tokens: 220, cache_creation_input_tokens: 0, cache_read_input_tokens: 2100 }

const prevMonth = (day) => {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** The scripted model: decides only from what the server really sends it. */
function fakeModel(params) {
  iaLog.calls.push({ model: params.model, effort: params.output_config?.effort, tools: params.tools.map((t) => t.name), messages: params.messages.length, tool_choice: params.tool_choice })
  const last = params.messages[params.messages.length - 1]
  const reply = (content, stop = 'end_turn') => ({ content: [{ type: 'thinking', thinking: '', signature: 'mock' }, ...content], stop_reason: stop, usage: USAGE, model: params.model })
  const say = (text) => reply([{ type: 'text', text }])
  const callTool = (name, input) => reply([{ type: 'tool_use', id: `toolu_${Math.random().toString(36).slice(2, 10)}`, name, input }], 'tool_use')

  if (Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
    const r = JSON.parse(last.content[0].content)
    if (r.erro) return say(`Não consegui consultar: ${r.erro}`)
    if (r.fatos && r.categoria) {
      const gasto = r.fatos[0]
      const first = params.messages.length <= 3
      return say(first ? `Você gastou {${gasto.id}} com ${r.categoria.toLowerCase()} em ${r.periodo}. Isso dá R$ 999,99 por dia.\nSugestão: revise as maiores compras.` : `Em ${r.periodo} foram {${gasto.id}} com ${r.categoria.toLowerCase()}.`)
    }
    if (r.dias) {
      const items = r.dias.flatMap((d) => d.itens)
      return say(items.length ? `Amanhã você tem: ${items.map((i) => `{${i.fato}}`).join(', ')}.` : 'Amanhã você não tem compromissos.')
    }
    // Etapa 4: forecast with its limitation; a plan over a value the person typed (calcular + "informado")
    if (r.mostrado_na_tela) return say('Posso lembrar disso. Confirme na tela.')
    if (r.erro && /lembrete/i.test(r.erro)) return say(r.erro)
    if (r.saldo_hoje) {
      const cen = r.cenarios_fim_do_mes
      const end = cen.selo === 'ausente' ? `Ainda não dá para prever o fim do mês ({${cen.id}}).` : `Previsão sem contar recebimentos: {${cen.sem_contar_recebimentos.id}}.`
      const q0 = typeof params.messages.at(-3)?.content === 'string' ? params.messages.at(-3).content : ''
      // "… mesmo?": the model invents a value in the middle (must stay hidden, also while streaming)
      const extra = /mesmo\?/.test(q0) ? ' Sobra R$ 777,77 para gastar.' : ''
      return say(`Hoje você tem {${r.saldo_hoje.id}}.${extra} ${end} Limitação: ${r.limitacoes[0]}`)
    }
    const asked = typeof params.messages.at(-3)?.content === 'string' ? params.messages.at(-3).content : JSON.stringify(params.messages.slice(-4, -2))
    if (r.metas && /quero juntar/i.test(asked)) return callTool('calcular', { operacao: 'diferenca', fatos: ['informado', r.metas[0].guardado.id], numero: null, valor_informado: 8000, moeda_informada: 'EUR', rotulo: 'Quanto falta para juntar' })
    if (r.resultado) return say(`Faltam {${r.resultado.id}} para chegar aos {${r.valor_informado.id}} que você quer juntar.`)
    if (r.metas) return say(`Para a meta ${r.metas[0].nome} faltam {${r.metas[0].falta.id}}.`)
    if (r.previa_mostrada_na_tela) return say(`Preparei a prévia com ${r.itens.length} itens: confira, ajuste se quiser e confirme.`)
    return say('Pronto.')
  }
  const text = typeof last.content === 'string' ? last.content : ''
  const ctx = JSON.parse(text.match(/<contexto>\n(.*)\n<\/contexto>/s)[1])
  const q = text.split('</contexto>')[1].trim().toLowerCase()
  if (q.includes('mercado')) return callTool('resumo_financeiro', { periodo: 'mes', referencia: ctx.hoje.slice(0, 7), categoria: 'mercado' })
  if (q.startsWith('e no mês anterior')) {
    const f = ctx.consultas_recentes.find((c) => c.tool === 'resumo_financeiro')
    if (!f) return say('Do que você está falando?')
    return callTool('resumo_financeiro', { ...f.args, referencia: prevMonth(ctx.hoje) })
  }
  // like the real run: the model SAYS it prepared a change without calling the tool
  if (q.startsWith('guarda')) return say('Preparei a reserva para a meta. Confira na tela e confirme.')
  if (q.startsWith('fechei')) {
    const d = (n) => new Date(Date.parse(ctx.hoje) + n * 86400000).toISOString().slice(0, 10)
    return callTool('propor_acoes', {
      resumo: 'Venda do site da Clínica Nova com projeto e tarefas',
      acoes: [
        blankAction('a1', 'criar_cliente', { pessoa: 'Clínica Nova' }),
        blankAction('a2', 'criar_projeto', { titulo: 'Site Clínica Nova', pessoa: 'Clínica Nova', depende_de: ['a1'] }),
        blankAction('a3', 'criar_venda', { titulo: 'Site', pessoa: 'Clínica Nova', valor: 2400, data: ctx.hoje, entrada_recebida: 1200, ja_recebido_ou_pago: true, depende_de: ['a1'] }),
        blankAction('a4', 'criar_tarefa', { titulo: 'Briefing', data: d(5), depende_de: ['a2'] }),
        blankAction('a5', 'criar_tarefa', { titulo: 'Entrega', data: d(9), depende_de: ['a2'] }),
        blankAction('a6', 'criar_tarefa', { titulo: 'Cobrar a segunda parte', data: d(30), lembrete_minutos: 0 }),
      ],
    })
  }
  if (q.includes('no azul')) return callTool('previsao_do_mes', {})
  if (q.startsWith('lembra que')) return callTool('propor_lembrete', { texto: 'Prefere respostas curtas' })
  if (q.startsWith('quero juntar')) return callTool('metas_financeiras', { nome: null })
  if (q.includes('meta')) return callTool('metas_financeiras', { nome: null })
  return say('Posso consultar sua agenda, finanças e metas.')
}

export async function handleNucleoIa(json, uid, emit) {
  if (!uid) return { status: 401, body: { error: 'auth', message: 'Entre na sua conta para usar a IA.' } }
  const parsed = TurnRequest.safeParse(json)
  if (!parsed.success) return { status: 400, body: { error: 'input', message: 'Pedido inválido.' } }
  iaLog.requests.push({ uid, kind: parsed.data.kind, ...(parsed.data.kind === 'start' ? { text: parsed.data.text, history: parsed.data.history, focus: parsed.data.focus, areasOff: parsed.data.areasOff } : { results: parsed.data.results.length }) })
  let n = 0
  const deps = {
    uid,
    secret: SECRET,
    now: () => Date.now(),
    reserve: async (a) => ({ outcome: 'ok', usageId: ++n, grantedMicros: a.wantedMicros }),
    settle: async (_id, a) => {
      iaLog.spentMicros += a.costMicros
    },
    callModel: async (p) => {
      const out = fakeModel(p)
      if (emit) {
        // like the real stream: a reset per call, then the text in small pieces, slowly enough to be seen
        emit({ t: 'r' })
        const text = out.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
        for (let i = 0; i < text.length; i += 12) {
          emit({ t: 'd', s: text.slice(i, i + 12) })
          await new Promise((r) => setTimeout(r, 60))
        }
      }
      return out
    },
  }
  const out = parsed.data.kind === 'start' ? await startTurn(parsed.data, deps) : await continueTurn(parsed.data, deps)
  return out
}

export const mockCost = (model) => costMicros(model, USAGE)
