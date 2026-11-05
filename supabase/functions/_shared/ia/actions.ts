/**
 * NÚCLEO IA — actions the model may PROPOSE (Etapa 3). It never writes: the app turns the list into
 * a plan, shows an editable preview, and writes only after the person confirms.
 *
 * One flat, strict shape for every action (every field present, null when unused), so the arguments
 * always validate exactly. Amounts are in currency units (1200.5 = R$ 1.200,50).
 */
import { z } from 'zod'

export const ACTION_TOOL = 'propor_acoes'

export const ACTION_TYPES = [
  'criar_tarefa',
  'mover_tarefa',
  'concluir_tarefa',
  'criar_compromisso',
  'mover_compromisso',
  'criar_cliente',
  'criar_projeto',
  'criar_venda',
  'registrar_recebimento',
  'registrar_despesa',
  'registrar_entrada',
  'registrar_transferencia',
  'reservar_meta',
  'criar_meta_financeira',
  'criar_nota',
  'criar_habito',
  'adicionar_compra',
] as const
export type ActionType = (typeof ACTION_TYPES)[number]

const S = (d: string) => ({ type: ['string', 'null'], description: d })
const N = (d: string) => ({ type: ['number', 'null'], description: d })
const I = (d: string) => ({ type: ['integer', 'null'], description: d })

const ACTION_PROPS: Record<string, unknown> = {
  ref: { type: 'string', description: 'Identificador curto desta ação no plano (a1, a2…), usado em depende_de.' },
  tipo: { type: 'string', enum: [...ACTION_TYPES] },
  depende_de: { type: 'array', items: { type: 'string' }, description: 'refs de ações deste plano das quais esta depende (ex.: o projeto depende do cliente novo).' },
  titulo: S('Título/nome: da tarefa, compromisso, projeto, produto vendido, nota, hábito, meta, item de compra, ou descrição da despesa/entrada.'),
  pessoa: S('Nome do cliente ou comprador.'),
  alvo: S('Registro EXISTENTE a que a ação se refere, pelo nome (tarefa a mover/concluir, compromisso a mover, venda/projeto que recebeu, meta onde reservar).'),
  data: S('AAAA-MM-DD: prazo da tarefa, dia do compromisso, dia da venda, dia do recebimento/pagamento, prazo do projeto ou da meta.'),
  hora: S('HH:MM: horário da tarefa ou início do compromisso.'),
  hora_fim: S('HH:MM: fim do compromisso.'),
  valor: N('Valor em unidades da moeda (1200.5). Venda: total. Projeto: valor cobrado. Recebimento/despesa/entrada/transferência/reserva: o valor. Meta: o alvo.'),
  moeda: S('Código da moeda (BRL, EUR, USD…), ou null para a moeda principal / a do registro.'),
  categoria: S('Categoria da despesa/entrada, como a pessoa fala.'),
  observacao: S('Texto da nota ou observação.'),
  ja_recebido_ou_pago: { type: ['boolean', 'null'], description: 'true SOMENTE se a pessoa disse que o dinheiro já foi recebido/pago. null se ela não disse.' },
  entrada_recebida: N('Venda: parte do total que a pessoa disse que JÁ recebeu no ato. null se nada.'),
  parcelas: I('Venda: em quantas parcelas o restante será pago (2 ou mais), ou null.'),
  primeira_parcela: S('Venda: AAAA-MM-DD da primeira parcela, ou null.'),
  // optional fixed choices: "one of the values, or null" (anyOf) — the API refuses an enum inside a type list
  intervalo_parcelas: { anyOf: [{ type: 'string', enum: ['mes', 'semana'] }, { type: 'null' }], description: 'Venda: parcelas mensais ou semanais.' },
  sentido: { anyOf: [{ type: 'string', enum: ['saida', 'entrada'] }, { type: 'null' }], description: 'Transferência: saída desta conta ou entrada nela.' },
  lembrete_minutos: I('Lembrete: minutos antes do horário (tarefa com hora ou compromisso), 0 = na hora. Tarefa sem hora: qualquer valor = lembrete às 09:00 do dia.'),
}

export const ACTION_TOOL_DEF = {
  name: ACTION_TOOL,
  description:
    'Prepara alterações no Núcleo para a pessoa revisar e confirmar na tela (nada é gravado por você). Use para criar, mover, concluir e registrar. Várias ações de várias áreas podem ir num só plano, ligadas por depende_de. Dinheiro como recebido/pago SOMENTE quando a pessoa disse isso (ja_recebido_ou_pago=true); se não disse, pergunte antes. Venda, recebimento, despesa, transferência, parcela e reserva de meta são coisas diferentes. Trabalho com entrega para cliente = projeto (recebimentos no projeto), nunca projeto e venda juntos. Transferência entre contas da pessoa = um lançamento de transferência, sem escolher conta (o Núcleo tem um saldo só).',
  // Not strict: the API allows at most 16 optional (union) fields over all strict tools, and this one alone
  // has ~19. The app validates every action itself (ActionArgs below) and sends errors back to the model.
  strict: false as const,
  input_schema: {
    type: 'object' as const,
    properties: {
      resumo: { type: 'string', description: 'Uma frase dizendo o que o plano faz.' },
      acoes: { type: 'array', items: { type: 'object', properties: ACTION_PROPS, required: Object.keys(ACTION_PROPS), additionalProperties: false } },
    },
    required: ['resumo', 'acoes'],
    additionalProperties: false as const,
  },
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const Action = z.object({
  ref: z.string().min(1).max(20),
  tipo: z.enum(ACTION_TYPES),
  depende_de: z.array(z.string().max(20)).max(10),
  titulo: z.string().max(160).nullable(),
  pessoa: z.string().max(120).nullable(),
  alvo: z.string().max(160).nullable(),
  data: day.nullable(),
  hora: time.nullable(),
  hora_fim: time.nullable(),
  valor: z.number().finite().nonnegative().max(1e10).nullable(),
  moeda: z.string().regex(/^[A-Za-z]{3}$/).nullable(),
  categoria: z.string().max(60).nullable(),
  observacao: z.string().max(4000).nullable(),
  ja_recebido_ou_pago: z.boolean().nullable(),
  entrada_recebida: z.number().finite().nonnegative().max(1e10).nullable(),
  parcelas: z.number().int().min(2).max(60).nullable(),
  primeira_parcela: day.nullable(),
  intervalo_parcelas: z.enum(['mes', 'semana']).nullable(),
  sentido: z.enum(['saida', 'entrada']).nullable(),
  lembrete_minutos: z.number().int().min(0).max(10080).nullable(),
})
export type Action = z.infer<typeof Action>

/** As the model sends it (not strict): any optional field may be missing → filled with null. */
const LooseAction = Action.partial().required({ ref: true, tipo: true }).transform((a) => blankAction(a.ref, a.tipo, Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined))))
export const ActionArgs = z.object({ resumo: z.string().max(400).optional().default(''), acoes: z.array(LooseAction).min(1).max(15) })
export type ActionArgs = z.infer<typeof ActionArgs>

/** A blank action (tests, edits): every field null. */
export const blankAction = (ref: string, tipo: ActionType, fields: Partial<Action> = {}): Action => ({
  ref,
  tipo,
  depende_de: [],
  titulo: null,
  pessoa: null,
  alvo: null,
  data: null,
  hora: null,
  hora_fim: null,
  valor: null,
  moeda: null,
  categoria: null,
  observacao: null,
  ja_recebido_ou_pago: null,
  entrada_recebida: null,
  parcelas: null,
  primeira_parcela: null,
  intervalo_parcelas: null,
  sentido: null,
  lembrete_minutos: null,
  ...fields,
})
