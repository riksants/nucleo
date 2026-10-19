/**
 * What a rule can listen to, check and do — in the person's words. The screens only offer the
 * conditions and actions that make sense for the chosen trigger.
 */
import type { MoneyOrigin, RuleActionKind, RuleConditionField, RuleTriggerKind } from '../../data/types'
import type { EventKind, EventNames } from './types'

export type TriggerGroup = 'Dinheiro' | 'Vendas' | 'Projetos' | 'Tarefas' | 'Clientes' | 'Metas' | 'Datas'

export interface TriggerInfo {
  kind: RuleTriggerKind
  group: TriggerGroup
  /** Read after "Quando…" ("Quando eu receber pagamento de um projeto"). */
  label: string
  /** The happening behind it. Shortcuts add a fixed origin or status. */
  base: EventKind
  origin?: MoneyOrigin
  status?: string
  /** Runs by date (in the automations pass), not when something is saved. */
  scheduled?: boolean
  /** Money entering: percentages can be reserved from it. */
  income?: boolean
  money?: boolean
  conditions: RuleConditionField[]
  actions: RuleActionKind[]
  tokens: (keyof EventNames)[]
}

const MONEY_IF: RuleConditionField[] = ['amount', 'category', 'client', 'project', 'text', 'weekday']
const ALWAYS: RuleActionKind[] = ['createTask', 'createNote', 'addInbox']
const MONEY_TOKENS: (keyof EventNames)[] = ['valor', 'descricao', 'cliente', 'projeto']

export const TRIGGERS: TriggerInfo[] = [
  { kind: 'moneyIn', group: 'Dinheiro', label: 'entrar dinheiro', base: 'moneyIn', income: true, money: true, conditions: [...MONEY_IF, 'origin'], actions: ['reservePercent', 'reserveFixed', ...ALWAYS, 'setCategory', 'clientStatus'], tokens: MONEY_TOKENS },
  { kind: 'moneyOut', group: 'Dinheiro', label: 'sair dinheiro', base: 'moneyOut', money: true, conditions: ['amount', 'category', 'text', 'weekday', 'origin'], actions: [...ALWAYS, 'setCategory', 'reserveFixed'], tokens: ['valor', 'descricao'] },
  { kind: 'projectPayment', group: 'Projetos', label: 'eu receber pagamento de um projeto', base: 'moneyIn', origin: 'project', income: true, money: true, conditions: ['amount', 'client', 'project', 'weekday'], actions: ['reservePercent', 'reserveFixed', ...ALWAYS, 'projectStatus', 'clientStatus', 'setCategory'], tokens: MONEY_TOKENS },
  { kind: 'salePayment', group: 'Vendas', label: 'eu receber pagamento de uma venda', base: 'moneyIn', origin: 'sale', income: true, money: true, conditions: ['amount', 'client', 'text', 'weekday'], actions: ['reservePercent', 'reserveFixed', ...ALWAYS, 'clientStatus', 'setCategory'], tokens: ['valor', 'descricao', 'cliente'] },
  { kind: 'subscriberPaid', group: 'Dinheiro', label: 'um assinante pagar', base: 'moneyIn', origin: 'subscriber', income: true, money: true, conditions: ['amount', 'client', 'text', 'weekday'], actions: ['reservePercent', 'reserveFixed', ...ALWAYS, 'setCategory'], tokens: ['valor', 'descricao', 'cliente'] },
  { kind: 'toolPaid', group: 'Dinheiro', label: 'uma assinatura ou ferramenta for paga', base: 'moneyOut', origin: 'tool', money: true, conditions: ['amount', 'text', 'weekday'], actions: [...ALWAYS, 'setCategory'], tokens: ['valor', 'descricao'] },
  { kind: 'saleCreated', group: 'Vendas', label: 'eu registrar uma venda', base: 'saleCreated', conditions: ['amount', 'client', 'text', 'weekday'], actions: [...ALWAYS, 'clientStatus', 'reserveFixed'], tokens: ['venda', 'cliente', 'valor'] },
  { kind: 'projectCreated', group: 'Projetos', label: 'eu criar um projeto', base: 'projectCreated', conditions: ['client', 'text', 'weekday'], actions: [...ALWAYS, 'clientStatus'], tokens: ['projeto', 'cliente'] },
  { kind: 'projectStatus', group: 'Projetos', label: 'um projeto mudar de status', base: 'projectStatus', conditions: ['status', 'statusBefore', 'client', 'project', 'text', 'weekday'], actions: [...ALWAYS, 'clientStatus', 'reserveFixed'], tokens: ['projeto', 'cliente'] },
  { kind: 'projectDone', group: 'Projetos', label: 'um projeto for concluído', base: 'projectStatus', status: 'done', conditions: ['client', 'project', 'text', 'weekday'], actions: [...ALWAYS, 'clientStatus', 'reserveFixed'], tokens: ['projeto', 'cliente'] },
  { kind: 'taskCreated', group: 'Tarefas', label: 'eu criar uma tarefa', base: 'taskCreated', conditions: ['project', 'priority', 'text', 'weekday'], actions: [...ALWAYS, 'projectStatus'], tokens: ['tarefa', 'projeto'] },
  { kind: 'taskDone', group: 'Tarefas', label: 'eu concluir uma tarefa', base: 'taskDone', conditions: ['project', 'priority', 'text', 'weekday'], actions: [...ALWAYS, 'projectStatus', 'reserveFixed'], tokens: ['tarefa', 'projeto'] },
  { kind: 'taskOverdue', group: 'Tarefas', label: 'uma tarefa atrasar', base: 'taskOverdue', scheduled: true, conditions: ['project', 'priority', 'text'], actions: [...ALWAYS], tokens: ['tarefa', 'projeto'] },
  { kind: 'clientCreated', group: 'Clientes', label: 'eu cadastrar um cliente', base: 'clientCreated', conditions: ['text', 'weekday'], actions: [...ALWAYS], tokens: ['cliente'] },
  { kind: 'clientStatus', group: 'Clientes', label: 'um cliente mudar de status', base: 'clientStatus', conditions: ['status', 'statusBefore', 'client', 'text', 'weekday'], actions: [...ALWAYS], tokens: ['cliente'] },
  { kind: 'goalSaved', group: 'Metas', label: 'uma meta receber dinheiro guardado', base: 'goalSaved', conditions: ['goal', 'amount', 'weekday'], actions: [...ALWAYS], tokens: ['valor'] },
  { kind: 'goalReached', group: 'Metas', label: 'uma meta for atingida', base: 'goalReached', conditions: ['goal', 'weekday'], actions: [...ALWAYS], tokens: [] },
  { kind: 'monthDay', group: 'Datas', label: 'chegar um dia do mês', base: 'date', scheduled: true, conditions: [], actions: [...ALWAYS], tokens: [] },
  { kind: 'weekDay', group: 'Datas', label: 'chegar um dia da semana', base: 'date', scheduled: true, conditions: [], actions: [...ALWAYS], tokens: [] },
]

export const TRIGGER_GROUPS: TriggerGroup[] = ['Dinheiro', 'Projetos', 'Vendas', 'Tarefas', 'Clientes', 'Metas', 'Datas']

const BY_KIND = new Map(TRIGGERS.map((t) => [t.kind, t]))
export const triggerInfo = (kind: RuleTriggerKind): TriggerInfo => BY_KIND.get(kind) ?? TRIGGERS[0]

export const CONDITION_LABEL: Record<RuleConditionField, string> = {
  amount: 'o valor',
  currency: 'a moeda',
  category: 'a categoria',
  origin: 'a origem',
  client: 'o cliente',
  project: 'o projeto',
  text: 'o texto',
  status: 'o novo status',
  statusBefore: 'o status anterior',
  priority: 'a prioridade',
  goal: 'a meta',
  weekday: 'o dia da semana',
}

export const ACTION_LABEL: Record<RuleActionKind, string> = {
  reservePercent: 'Reservar uma porcentagem para uma meta',
  reserveFixed: 'Reservar um valor fixo para uma meta',
  createTask: 'Criar uma tarefa',
  projectStatus: 'Mudar o status do projeto',
  clientStatus: 'Mudar o status do cliente',
  setCategory: 'Aplicar uma categoria',
  createNote: 'Criar uma nota',
  addInbox: 'Adicionar ao Inbox',
}

export const ORIGIN_LABEL: Record<MoneyOrigin, string> = {
  manual: 'lançada por mim',
  project: 'pagamento de projeto',
  sale: 'pagamento de venda',
  subscriber: 'assinante',
  tool: 'assinatura/ferramenta',
}

export const WEEKDAY_LABEL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
