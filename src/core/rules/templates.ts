/**
 * Ready-made rules. None is ever turned on by itself: tapping one opens the editor, already filled,
 * and the person chooses (the goal, the texts) and saves.
 */
import type { Entity, Rule } from '../../data/types'

/** A rule still being made (no id, order or since yet). */
export type RuleDraft = Omit<Rule, keyof Entity | 'order' | 'since' | 'on' | 'paused'>

export interface RuleTemplate {
  id: string
  name: string
  text: string
  /** The person must choose a goal before saving. */
  needsGoal: boolean
  draft(): RuleDraft
}

export const TEMPLATES: RuleTemplate[] = [
  {
    id: 'taxes',
    name: 'Separe para impostos',
    text: 'Quando eu receber pagamento de um projeto, reservar 20% para uma meta (por exemplo, Impostos).',
    needsGoal: true,
    draft: () => ({ name: 'Separe para impostos', template: 'taxes', trigger: { kind: 'projectPayment' }, conditions: [], actions: [{ kind: 'reservePercent', goalId: '', percent: 20 }] }),
  },
  {
    id: 'save',
    name: 'Guarde parte do que recebe',
    text: 'Quando entrar dinheiro, reservar 10% para uma meta.',
    needsGoal: true,
    draft: () => ({ name: 'Guarde parte do que recebe', template: 'save', trigger: { kind: 'moneyIn' }, conditions: [], actions: [{ kind: 'reservePercent', goalId: '', percent: 10 }] }),
  },
  {
    id: 'review',
    name: 'Peça avaliação',
    text: 'Quando um projeto for concluído, criar a tarefa “Pedir avaliação” para daqui 3 dias.',
    needsGoal: false,
    draft: () => ({ name: 'Peça avaliação', template: 'review', trigger: { kind: 'projectDone' }, conditions: [], actions: [{ kind: 'createTask', title: 'Pedir avaliação a {cliente}', dueDays: 3, linkProject: true, priority: 'none' }] }),
  },
  {
    id: 'follow',
    name: 'Acompanhe o cliente',
    text: 'Quando eu registrar uma venda, criar uma tarefa de acompanhamento para daqui 7 dias.',
    needsGoal: false,
    draft: () => ({ name: 'Acompanhe o cliente', template: 'follow', trigger: { kind: 'saleCreated' }, conditions: [], actions: [{ kind: 'createTask', title: 'Acompanhar {cliente} ({venda})', dueDays: 7, linkProject: false, priority: 'none' }] }),
  },
  {
    id: 'late',
    name: 'Organize atrasos',
    text: 'Quando uma tarefa atrasar, adicionar “Reagendar” ao Inbox — sem mudar datas nem duplicar a tarefa.',
    needsGoal: false,
    draft: () => ({ name: 'Organize atrasos', template: 'late', trigger: { kind: 'taskOverdue' }, conditions: [], actions: [{ kind: 'addInbox', text: 'Reagendar: {tarefa}' }] }),
  },
  {
    id: 'receipt',
    name: 'Envie o recibo',
    text: 'Quando eu receber pagamento de um projeto, criar a tarefa “Enviar recibo” para hoje.',
    needsGoal: false,
    draft: () => ({ name: 'Envie o recibo', template: 'receipt', trigger: { kind: 'projectPayment' }, conditions: [], actions: [{ kind: 'createTask', title: 'Enviar recibo a {cliente}', dueDays: 0, linkProject: true, priority: 'none' }] }),
  },
  {
    id: 'newClient',
    name: 'Cliente novo',
    text: 'Quando eu cadastrar um cliente, criar a tarefa “Enviar proposta” para daqui 2 dias.',
    needsGoal: false,
    draft: () => ({ name: 'Cliente novo', template: 'newClient', trigger: { kind: 'clientCreated' }, conditions: [], actions: [{ kind: 'createTask', title: 'Enviar proposta a {cliente}', dueDays: 2, linkProject: false, priority: 'none' }] }),
  },
  {
    id: 'month',
    name: 'Fechamento do mês',
    text: 'Todo dia 1, criar a tarefa “Revisar o mês no Financeiro”.',
    needsGoal: false,
    draft: () => ({ name: 'Fechamento do mês', template: 'month', trigger: { kind: 'monthDay', day: 1 }, conditions: [], actions: [{ kind: 'createTask', title: 'Revisar o mês no Financeiro', dueDays: 0, linkProject: false, priority: 'none' }] }),
  },
]
