/**
 * NÚCLEO IA — the lookups the model may ask for. The list is FIXED (same for every person and
 * every question) so the instructions + tools prefix is cached and shared; areas a person turned
 * off are refused when the app runs the lookup, not by changing this list.
 *
 * Lookups run in the app over the signed-in account's own data, with the app's own calculations.
 * They only read. Strict schemas: the model's arguments always match exactly.
 */

export type ToolName = 'consultar_agenda' | 'resumo_financeiro' | 'metas_financeiras' | 'buscar'
export const APP_TOOLS: ToolName[] = ['consultar_agenda', 'resumo_financeiro', 'metas_financeiras', 'buscar']
/** Only on the fast model: hands the question to the deeper one. */
export const ESCALATE_TOOL = 'pedir_analise_profunda'

export type Area = 'agenda' | 'financas' | 'metas' | 'busca'
export const TOOL_AREA: Record<ToolName, Area> = {
  consultar_agenda: 'agenda',
  resumo_financeiro: 'financas',
  metas_financeiras: 'metas',
  buscar: 'busca',
}
export const AREA_LABEL: Record<Area, string> = { agenda: 'Agenda', financas: 'Finanças', metas: 'Metas', busca: 'Busca' }

const DATE = { type: 'string', description: 'Data no formato AAAA-MM-DD.' }

interface ToolDef {
  name: string
  description: string
  strict: true
  input_schema: { type: 'object'; properties: Record<string, unknown>; required: string[]; additionalProperties: false }
}

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'consultar_agenda',
    description:
      'Compromissos de um intervalo de dias (até 14): eventos, tarefas com data, blocos da rotina, hábitos, recorrentes e refeições planejadas, com horário e situação (feito, pendente, encerrado). Use para "o que tenho hoje/amanhã/na semana", conflitos de horário e para achar um compromisso citado.',
    strict: true,
    input_schema: { type: 'object', properties: { de: DATE, ate: DATE }, required: ['de', 'ate'], additionalProperties: false },
  },
  {
    name: 'resumo_financeiro',
    description:
      'Totais calculados pelo app para um mês ou uma semana: entradas, saídas, saldo no início e no fim, gastos por categoria, as maiores saídas, comparação com o período anterior equivalente e, no mês atual, a previsão de saldo do fim do mês. Transferências entre contas próprias e ajustes de saldo não contam como entrada nem saída. Opcionalmente filtra uma categoria (nome como a pessoa fala, ex.: "mercado").',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', enum: ['mes', 'semana'] },
        referencia: { type: 'string', description: 'Mês: AAAA-MM. Semana: qualquer dia da semana, AAAA-MM-DD.' },
        categoria: { type: ['string', 'null'], description: 'Nome da categoria, ou null para todas.' },
      },
      required: ['periodo', 'referencia', 'categoria'],
      additionalProperties: false,
    },
  },
  {
    name: 'metas_financeiras',
    description:
      'Metas de dinheiro ativas (ex.: guardar para uma viagem): valor alvo, quanto já foi guardado, quanto falta, prazo, quanto guardar por mês/semana para chegar no prazo e se está no ritmo. Opcionalmente filtra pelo nome.',
    strict: true,
    input_schema: { type: 'object', properties: { nome: { type: ['string', 'null'], description: 'Parte do nome da meta, ou null para todas.' } }, required: ['nome'], additionalProperties: false },
  },
  {
    name: 'buscar',
    description:
      'Busca por nome/texto em todos os registros da pessoa (clientes, projetos, tarefas, notas, vendas, metas, planos…). Devolve título, tipo e identificador; use para descobrir a que registro a pessoa se refere antes de outra consulta.',
    strict: true,
    input_schema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'], additionalProperties: false },
  },
]

export const ESCALATE_DEF: ToolDef = {
  name: ESCALATE_TOOL,
  description:
    'Passa a pergunta para uma análise mais profunda. Use SOMENTE quando a pessoa pede um planejamento com várias etapas, uma decisão que pesa vários fatores, ou uma análise que cruza várias áreas e você não conseguiria responder bem. Não use para consultas simples.',
  strict: true,
  input_schema: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'], additionalProperties: false },
}

/** Tool list per model (fixed per model → cached). */
export const toolsFor = (model: 'haiku' | 'sonnet' | 'opus') => (model === 'haiku' ? [...TOOL_DEFS, ESCALATE_DEF] : TOOL_DEFS)

export const isAppTool = (name: string): name is ToolName => (APP_TOOLS as string[]).includes(name)

/** Limits for what the app sends back for one lookup. */
export const MAX_RESULT_CHARS = 12_000
export const MAX_RESULTS_PER_STEP = 6
