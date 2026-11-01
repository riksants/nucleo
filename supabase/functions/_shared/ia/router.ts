/**
 * NÚCLEO IA — which model answers a question. Runs on the SERVER (the app may call it only to
 * show the expected route; it never chooses the model).
 *
 *   rapida   → Haiku 5.5, effort low     (default: lookups, conversation, one area)
 *   atenta   → Haiku 5.5, effort medium  (comparison, cause, one-area analysis)
 *   profunda → Sonnet 5.5, effort medium (planning/decisions, actions over several areas,
 *                                         "Analisar a fundo", escalation)
 */
import type { Effort, ModelKey } from './models.ts'

export type Route = 'rapida' | 'atenta' | 'profunda'

export interface RouteChoice {
  route: Route
  model: ModelKey
  effort: Effort
  /** Short reason (kept in ai_usage, shown in tests). */
  why: string
}

export const ROUTES: Record<Route, { model: ModelKey; effort: Effort }> = {
  rapida: { model: 'haiku', effort: 'low' },
  atenta: { model: 'haiku', effort: 'medium' },
  profunda: { model: 'sonnet', effort: 'medium' },
}

export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const has = (t: string, words: string[]) => words.some((w) => new RegExp(`(^|[^a-z])${w}`).test(t))

const PLANNING = ['planej', 'planeja', 'monta um plano', 'monte um plano', 'me ajuda a', 'me ajude a', 'estrategia', 'devo ', 'vale a pena', 'como faco para', 'como eu faco', 'o que eu faco', 'quero juntar', 'quero guardar', 'quero economizar', 'quero quitar', 'quero pagar', 'consigo juntar', 'da pra juntar', 'da para juntar', 'decid', 'prioriz', 'reorganiz']
const ANALYSIS = ['por que', 'porque ', 'por qual motivo', 'compar', 'analis', 'diferenca', 'tendencia', 'evolu', 'mais que o normal', 'menos que o normal', 'acima do normal', 'media', 'padrao', 'onde estou', 'onde gast', 'quanto falta', 'ritmo', 'previs', 'subiu', 'caiu', 'aumentou', 'diminuiu', 'piorou', 'melhorou']
const ACTION = ['cria', 'crie', 'criar', 'adiciona', 'adicione', 'coloca', 'coloque', 'registra', 'registre', 'lanca', 'lance', 'marca', 'marque', 'move', 'mova', 'muda', 'mude', 'passa ', 'agenda ', 'agende', 'lembra', 'lembre', 'cobra', 'cobre', 'anota', 'anote', 'reserva', 'reserve', 'guarda ', 'guarde', 'conclui', 'conclua']
const AREAS: Record<string, string[]> = {
  tarefas: ['tarefa'],
  agenda: ['reuniao', 'evento', 'compromisso', 'consulta '],
  vendas: ['venda', 'vendi', 'fechei'],
  projetos: ['projeto'],
  clientes: ['cliente'],
  financas: ['gasto', 'gastei', 'despesa', 'paguei', 'pagamento', 'recebi', 'recebimento', 'entrada', 'saida', 'transfer', 'reais', 'r$', 'euro'],
  metas: ['meta', 'objetivo'],
  habitos: ['habito'],
  notas: ['nota', 'anotacao'],
  compras: ['lista de compras', 'mercado'],
}

/** Server-side route of a new question. `deep` = the person tapped "Analisar a fundo". */
export function routeFor(text: string, opts: { deep?: boolean; openPlan?: boolean } = {}): RouteChoice {
  const t = fold(text)
  const pick = (route: Route, why: string): RouteChoice => ({ route, ...ROUTES[route], why })
  if (opts.deep) return pick('profunda', 'pedido de análise a fundo')
  if (opts.openPlan) return pick('profunda', 'ajuste de plano aberto')
  if (has(t, PLANNING)) return pick('profunda', 'planejamento ou decisão')
  const actions = ACTION.filter((w) => has(t, [w])).length
  const areas = Object.values(AREAS).filter((ws) => has(t, ws)).length
  if (actions >= 3 || (actions >= 1 && areas >= 2 && / e |, /.test(t))) return pick('profunda', 'ações em várias áreas')
  if (has(t, ANALYSIS)) return pick('atenta', 'comparação ou análise')
  return pick('rapida', 'consulta ou conversa')
}

/** Route after the fast model asked for a deeper analysis, given what the budget allows. */
export function escalated(sonnetAllowed: boolean): RouteChoice {
  return sonnetAllowed ? { route: 'profunda', ...ROUTES.profunda, why: 'escalada pelo modelo rápido' } : { route: 'atenta', ...ROUTES.atenta, why: 'escalada sem orçamento de análise profunda' }
}
