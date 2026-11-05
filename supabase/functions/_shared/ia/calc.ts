/**
 * NÚCLEO IA — `calcular` (Etapa 4). The model never does arithmetic: it asks the app to combine
 * facts of THIS turn (f1, f2…) and, when the person typed an amount ("quero juntar 10 mil"), that
 * amount as "informado". The app computes in integer cents over the facts' exact amounts and
 * returns a new fact. Runs in the app (where the facts live); same schema rules as the lookups.
 */

export const CALC_TOOL = 'calcular'

export const CALC_OPS = ['soma', 'diferenca', 'porcentagem_de', 'variacao', 'dividir', 'multiplicar'] as const
export type CalcOp = (typeof CALC_OPS)[number]

export const CALC_TOOL_DEF = {
  name: CALC_TOOL,
  description:
    'Faz uma conta exata com fatos de dinheiro desta resposta (f1, f2…) e devolve um fato novo. Use SEMPRE que precisar de soma, diferença, porcentagem, variação, valor por mês/semana ou total de N meses — nunca calcule de cabeça. ' +
    'Operações: soma (2 ou mais), diferenca (o 1º menos o 2º), porcentagem_de (o 1º como % do 2º), variacao (% do 1º sobre o 2º), dividir (o 1º por "numero", ex.: meses até o prazo), multiplicar (o 1º por "numero", ex.: 12 meses). ' +
    'Para usar um valor que a PESSOA disse na pergunta (não registrado no app), escreva "informado" na lista de fatos e preencha valor_informado (em unidades da moeda, ex.: 10000) e moeda_informada (ex.: "BRL", ou null para a moeda principal). Moedas diferentes não se misturam; previsões continuam previsões.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      operacao: { type: 'string', enum: [...CALC_OPS] },
      fatos: { type: 'array', items: { type: 'string' }, description: 'Ids dos fatos na ordem da conta (ex.: ["f3", "f7"]) ou "informado".' },
      numero: { type: ['integer', 'null'], description: 'Divisor ou multiplicador (1 a 600) para dividir/multiplicar; null nas outras.' },
      valor_informado: { type: ['number', 'null'], description: 'Valor dito pela pessoa, em unidades da moeda; null se não usar "informado".' },
      moeda_informada: { type: ['string', 'null'], description: 'Código da moeda do valor informado (BRL, EUR, USD…), ou null para a moeda principal.' },
      rotulo: { type: 'string', description: 'O que o resultado é, em poucas palavras, sem números (ex.: "Quanto guardar por mês até o prazo").' },
    },
    required: ['operacao', 'fatos', 'numero', 'valor_informado', 'moeda_informada', 'rotulo'],
    additionalProperties: false,
  },
}
