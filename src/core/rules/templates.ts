/**
 * Ready-made rules, grouped by area of life. None is ever turned on by itself: tapping one opens the editor,
 * already filled, and the person chooses (the goal, the texts) and saves. Every model uses only events and
 * actions that exist in the app — nothing here depends on something the Núcleo can't see.
 */
import type { Currency, Entity, Rule } from '../../data/types'

/** A rule still being made (no id, order or since yet). */
export type RuleDraft = Omit<Rule, keyof Entity | 'order' | 'since' | 'on' | 'paused'>

export type TemplateGroup = 'Finanças' | 'Clientes e vendas' | 'Projetos' | 'Tarefas' | 'Hábitos' | 'Treinos' | 'Rotina' | 'Alimentação' | 'Organização'

export const TEMPLATE_GROUPS: TemplateGroup[] = ['Finanças', 'Clientes e vendas', 'Projetos', 'Tarefas', 'Hábitos', 'Treinos', 'Rotina', 'Alimentação', 'Organização']

export interface RuleTemplate {
  id: string
  group: TemplateGroup
  name: string
  text: string
  /** The person must choose a goal before saving. */
  needsGoal: boolean
  /** `base`: the person's main currency (a value condition is always in a currency the person sees). */
  draft(base: Currency): RuleDraft
}

export const TEMPLATES: RuleTemplate[] = [
  // ------------------------------------------------------------ Finanças
  {
    id: 'taxes',
    group: 'Finanças',
    name: 'Separe para impostos',
    text: 'Quando eu receber pagamento de um projeto, reservar 20% para uma meta (por exemplo, Impostos).',
    needsGoal: true,
    draft: () => ({ name: 'Separe para impostos', template: 'taxes', trigger: { kind: 'projectPayment' }, conditions: [], actions: [{ kind: 'reservePercent', goalId: '', percent: 20 }] }),
  },
  {
    id: 'save',
    group: 'Finanças',
    name: 'Guarde parte do que recebe',
    text: 'Quando entrar dinheiro, reservar 10% para uma meta.',
    needsGoal: true,
    draft: () => ({ name: 'Guarde parte do que recebe', template: 'save', trigger: { kind: 'moneyIn' }, conditions: [], actions: [{ kind: 'reservePercent', goalId: '', percent: 10 }] }),
  },
  {
    id: 'bigExpense',
    group: 'Finanças',
    name: 'Revise despesas grandes',
    text: 'Quando sair mais de 500 (na sua moeda), pedir sua revisão em Pendências — sem mudar nada na movimentação.',
    needsGoal: false,
    draft: (base) => ({ name: 'Revise despesas grandes', template: 'bigExpense', trigger: { kind: 'moneyOut' }, conditions: [{ field: 'amount', op: 'gt', value: 50000, currency: base }], actions: [{ kind: 'askReview', text: 'Conferir: {descricao} ({valor})' }] }),
  },
  {
    id: 'toolDue',
    group: 'Finanças',
    name: 'Confira cada cobrança de assinatura',
    text: 'No dia da cobrança de uma assinatura, criar a tarefa “Conferir cobrança” (os lembretes antes do dia ficam em Ajustes → Lembretes).',
    needsGoal: false,
    draft: () => ({ name: 'Confira cada cobrança de assinatura', template: 'toolDue', trigger: { kind: 'toolDue' }, conditions: [], actions: [{ kind: 'createTask', title: 'Conferir cobrança de {descricao} ({valor})', dueDays: 0, linkProject: false, priority: 'none' }] }),
  },
  {
    id: 'month',
    group: 'Finanças',
    name: 'Fechamento do mês',
    text: 'Todo dia 1, criar a tarefa “Revisar o mês no Financeiro”.',
    needsGoal: false,
    draft: () => ({ name: 'Fechamento do mês', template: 'month', trigger: { kind: 'monthDay', day: 1 }, conditions: [], actions: [{ kind: 'createTask', title: 'Revisar o mês no Financeiro', dueDays: 0, linkProject: false, priority: 'none' }] }),
  },
  // ------------------------------------------------------------ Clientes e vendas
  {
    id: 'follow',
    group: 'Clientes e vendas',
    name: 'Acompanhe o pagamento da venda',
    text: 'Quando eu registrar uma venda, criar uma tarefa de acompanhamento para daqui 7 dias.',
    needsGoal: false,
    draft: () => ({ name: 'Acompanhe o pagamento da venda', template: 'follow', trigger: { kind: 'saleCreated' }, conditions: [], actions: [{ kind: 'createTask', title: 'Acompanhar pagamento de {cliente} ({venda})', dueDays: 7, linkProject: false, priority: 'none' }] }),
  },
  {
    id: 'thanks',
    group: 'Clientes e vendas',
    name: 'Agradeça o pagamento',
    text: 'Quando eu receber pagamento de uma venda, criar a tarefa “Agradecer” para hoje.',
    needsGoal: false,
    draft: () => ({ name: 'Agradeça o pagamento', template: 'thanks', trigger: { kind: 'salePayment' }, conditions: [], actions: [{ kind: 'createTask', title: 'Agradecer {cliente} pelo pagamento', dueDays: 0, linkProject: false, priority: 'none' }] }),
  },
  {
    id: 'newClient',
    group: 'Clientes e vendas',
    name: 'Cliente novo',
    text: 'Quando eu cadastrar um cliente, criar a tarefa “Enviar proposta” para daqui 2 dias.',
    needsGoal: false,
    draft: () => ({ name: 'Cliente novo', template: 'newClient', trigger: { kind: 'clientCreated' }, conditions: [], actions: [{ kind: 'createTask', title: 'Enviar proposta a {cliente}', dueDays: 2, linkProject: false, priority: 'none' }] }),
  },
  {
    id: 'receipt',
    group: 'Clientes e vendas',
    name: 'Envie o recibo',
    text: 'Quando eu receber pagamento de um projeto, criar a tarefa “Enviar recibo” para hoje.',
    needsGoal: false,
    draft: () => ({ name: 'Envie o recibo', template: 'receipt', trigger: { kind: 'projectPayment' }, conditions: [], actions: [{ kind: 'createTask', title: 'Enviar recibo a {cliente}', dueDays: 0, linkProject: true, priority: 'none' }] }),
  },
  // ------------------------------------------------------------ Projetos
  {
    id: 'review',
    group: 'Projetos',
    name: 'Peça avaliação',
    text: 'Quando um projeto for concluído, criar a tarefa “Pedir avaliação” para daqui 3 dias.',
    needsGoal: false,
    draft: () => ({ name: 'Peça avaliação', template: 'review', trigger: { kind: 'projectDone' }, conditions: [], actions: [{ kind: 'createTask', title: 'Pedir avaliação a {cliente}', dueDays: 3, linkProject: true, priority: 'none' }] }),
  },
  {
    id: 'allTasks',
    group: 'Projetos',
    name: 'Projeto sem tarefas abertas',
    text: 'Quando eu concluir todas as tarefas de um projeto, me avisar em Pendências (o status do projeto não muda sozinho).',
    needsGoal: false,
    draft: () => ({ name: 'Projeto sem tarefas abertas', template: 'allTasks', trigger: { kind: 'projectTasksDone' }, conditions: [], actions: [{ kind: 'notify', text: 'Todas as tarefas de {projeto} estão concluídas' }] }),
  },
  // ------------------------------------------------------------ Tarefas
  {
    id: 'late',
    group: 'Tarefas',
    name: 'Organize atrasos',
    text: 'Quando uma tarefa atrasar, adicionar “Reagendar” ao Inbox — sem mudar datas nem duplicar a tarefa.',
    needsGoal: false,
    draft: () => ({ name: 'Organize atrasos', template: 'late', trigger: { kind: 'taskOverdue' }, conditions: [], actions: [{ kind: 'addInbox', text: 'Reagendar: {tarefa}' }] }),
  },
  {
    id: 'urgent',
    group: 'Tarefas',
    name: 'Tarefa urgente',
    text: 'Quando eu criar uma tarefa de prioridade alta, me avisar em Pendências.',
    needsGoal: false,
    draft: () => ({ name: 'Tarefa urgente', template: 'urgent', trigger: { kind: 'taskCreated' }, conditions: [{ field: 'priority', values: ['high'] }], actions: [{ kind: 'notify', text: 'Tarefa urgente: {tarefa}' }] }),
  },
  // ------------------------------------------------------------ Hábitos
  {
    id: 'reading',
    group: 'Hábitos',
    name: 'Anote o que leu',
    text: 'Quando eu marcar um hábito de leitura como feito, adicionar “Anotar o que li” ao Inbox.',
    needsGoal: false,
    draft: () => ({ name: 'Anote o que leu', template: 'reading', trigger: { kind: 'habitDone' }, conditions: [{ field: 'category', values: ['reading'] }], actions: [{ kind: 'addInbox', text: 'Anotar o que li hoje' }] }),
  },
  // ------------------------------------------------------------ Treinos
  {
    id: 'trainingLog',
    group: 'Treinos',
    name: 'Registre o treino',
    text: 'Quando eu marcar um hábito de treino como feito, adicionar “Registrar cargas e observações” ao Inbox. As metas de treino da semana já contam sozinhas.',
    needsGoal: false,
    draft: () => ({ name: 'Registre o treino', template: 'trainingLog', trigger: { kind: 'habitDone' }, conditions: [{ field: 'category', values: ['training'] }], actions: [{ kind: 'addInbox', text: 'Registrar cargas e observações do treino' }] }),
  },
  {
    id: 'trainingPlan',
    group: 'Treinos',
    name: 'Planeje os treinos da semana',
    text: 'Todo domingo, criar a tarefa “Planejar os treinos da semana”.',
    needsGoal: false,
    draft: () => ({ name: 'Planeje os treinos da semana', template: 'trainingPlan', trigger: { kind: 'weekDay', weekdays: [0] }, conditions: [], actions: [{ kind: 'createTask', title: 'Planejar os treinos da semana', dueDays: 0, linkProject: false, priority: 'none' }] }),
  },
  // ------------------------------------------------------------ Rotina
  {
    id: 'weekReview',
    group: 'Rotina',
    name: 'Revise a semana',
    text: 'Toda segunda, criar a tarefa “Revisar a semana”.',
    needsGoal: false,
    draft: () => ({ name: 'Revise a semana', template: 'weekReview', trigger: { kind: 'weekDay', weekdays: [1] }, conditions: [], actions: [{ kind: 'createTask', title: 'Revisar a semana', dueDays: 0, linkProject: false, priority: 'none' }] }),
  },
  // ------------------------------------------------------------ Alimentação
  {
    id: 'meals',
    group: 'Alimentação',
    name: 'Planeje as refeições',
    text: 'Todo domingo, criar a tarefa “Planejar refeições e lista de compras”.',
    needsGoal: false,
    draft: () => ({ name: 'Planeje as refeições', template: 'meals', trigger: { kind: 'weekDay', weekdays: [0] }, conditions: [], actions: [{ kind: 'createTask', title: 'Planejar refeições e lista de compras', dueDays: 0, linkProject: false, priority: 'none' }] }),
  },
  // ------------------------------------------------------------ Organização
  {
    id: 'inbox',
    group: 'Organização',
    name: 'Esvazie a Caixa de entrada',
    text: 'Toda sexta, criar a tarefa “Esvaziar a Caixa de entrada”.',
    needsGoal: false,
    draft: () => ({ name: 'Esvazie a Caixa de entrada', template: 'inbox', trigger: { kind: 'weekDay', weekdays: [5] }, conditions: [], actions: [{ kind: 'createTask', title: 'Esvaziar a Caixa de entrada', dueDays: 0, linkProject: false, priority: 'none' }] }),
  },
]
