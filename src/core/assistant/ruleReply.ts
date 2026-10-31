/**
 * A rule sentence → the Assistant's answer. Never guesses: a goal not named (or named ambiguously),
 * a value without currency, a task without title → it ASKS (buttons with the options). When all is
 * clear it shows the full preview — the same rule, validation and sentence as "Minhas regras" — and
 * only "Confirmar e criar regra" writes it (through the usual proposal → save). Nothing is ever
 * created or turned on silently.
 */
import type { DataState, FinanceGoal, Rule, RuleAction, RuleCondition, Settings } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { ruleRecord } from '../rules/build'
import { triggerInfo } from '../rules/catalog'
import { describeAction, describeRule, ruleNames } from '../rules/sentence'
import type { RuleDraft } from '../rules/templates'
import { ruleProblem } from '../rules/validate'
import { findTwin } from '../rules/signature'
import { todayIn, zoneOf } from '../period'
import type { Reply } from './actions'
import { findByName } from './actions'
import { proposalId } from './proposal'
import type { RuleSketch } from './ruleSentence'

export const RULE_EXAMPLES = [
  'Quando eu registrar uma venda, adicionar uma tarefa para acompanhar o pagamento',
  'Quando uma despesa passar de R$ 500, destacar para revisão',
  'Quando eu concluir todas as tarefas de um projeto, me avisar',
  'Sempre que eu receber de um projeto, guarda 20% para Impostos',
  'Quando eu concluir um projeto, cria uma tarefa pedir avaliação daqui 3 dias',
  'Quando entrar mais de €1.000, guarda 10% para minha meta Viagem',
  'Toda segunda, cria uma tarefa revisar a semana',
]

const ask = (line: string, choices: Reply['choices']): Reply => ({ lines: [line], choices })
const stop = (line: string, extra: Partial<Reply> = {}): Reply => ({ lines: [line], link: { label: 'Criar em Minhas regras', path: '/rules' }, ...extra })
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export interface RuleReplyCtx {
  data: DataState
  settings: Settings
  now: Date
  newId(): string
}

/** Turns a sketch into a rule draft, or the question/message that comes first. */
export function ruleReply(sketch: RuleSketch, ctx: RuleReplyCtx): Reply {
  const { data, settings } = ctx
  if (!sketch.trigger) return { lines: ['Não entendi quando a regra deve rodar. Tente assim:'], list: RULE_EXAMPLES.map((title) => ({ title })), link: { label: 'Criar em Minhas regras', path: '/rules' } }
  if (!sketch.actions.length && sketch.trigger.kind === 'habitDone' && /acompanhamento|progresso|meta/i.test(sketch.text))
    return { lines: ['Isso o Núcleo já faz sozinho: as metas da semana de treino e os hábitos vinculados contam cada vez que você marca o hábito, sem precisar de regra. Se quiser que algo a mais aconteça (uma nota, um aviso), diga o que fazer.'] }
  if (!sketch.actions.length) return { lines: ['Não entendi o que a regra deve fazer. Tente assim:'], list: RULE_EXAMPLES.map((title) => ({ title })), link: { label: 'Criar em Minhas regras', path: '/rules' } }
  const info = triggerInfo(sketch.trigger.kind)

  // A value without currency: ask (never assume one).
  const conditions: Extract<RuleCondition, { field: 'amount' }>[] = []
  for (const c of sketch.conditions) {
    const currency = c.currency ?? sketch.currency
    if (!currency) {
      const options = [...new Set([settings.baseCurrency, ...(settings.currencies ?? [])])].slice(0, 5)
      return ask(
        `Em qual moeda é o valor de ${(c.value / 100).toLocaleString('pt-BR')}?`,
        options.map((cur) => ({ label: cur, sketch: { ...sketch, currency: cur } })),
      )
    }
    conditions.push({ ...c, currency })
  }

  const goals = data.financeGoals.filter((g) => g.status === 'active')
  const actions: RuleAction[] = []
  for (const [i, a] of sketch.actions.entries()) {
    if (a.kind === 'reservePercent' || a.kind === 'reserveFixed') {
      if (info.scheduled) return stop('Regras por data não reservam dinheiro. Para guardar todo mês, use “Guardar todo mês” na meta, em Financeiro.')
      if (a.kind === 'reservePercent' && !info.income) return stop('Reservar uma porcentagem só vale quando entra dinheiro (um recebimento).')
      if (a.kind === 'reservePercent' && !(a.percent >= 1 && a.percent <= 100)) return stop('A porcentagem vai de 1 a 100.')
      let goal: FinanceGoal | undefined = goals.find((g) => g.id === sketch.goals?.[i])
      const what = a.kind === 'reservePercent' ? `os ${a.percent}%` : formatMoney(a.amount, a.currency ?? goals[0]?.currency ?? settings.baseCurrency)
      if (!goal) {
        if (!goals.length) return stop('Você ainda não tem uma meta para receber a reserva. Crie a meta em Financeiro e escreva de novo.', { link: { label: 'Abrir Financeiro', path: '/finance' } })
        const choices = (list: FinanceGoal[]) => list.slice(0, 8).map((g) => ({ label: g.name, sketch: { ...sketch, goals: { ...sketch.goals, [i]: g.id } } }))
        if (!a.goal) return ask(`Para qual meta você quer reservar ${what}?`, choices(goals))
        const found = findByName(goals, (g) => g.name, a.goal)
        if (found.one) goal = found.one
        else if (found.many.length > 1) return ask(`Encontrei mais de uma meta parecida com “${a.goal}”. Para qual delas reservar ${what}?`, choices(found.many))
        else return ask(`Não encontrei a meta “${a.goal}”. Para qual meta você quer reservar ${what}?`, choices(goals))
      }
      if (a.kind === 'reserveFixed') {
        if (a.currency && a.currency !== goal.currency) return stop(`A meta ${goal.name} é em ${goal.currency}, e o valor foi dito em ${a.currency}. Reservas de valor fixo são na moeda da meta: escreva o valor em ${goal.currency}.`)
        actions.push({ kind: 'reserveFixed', goalId: goal.id, amount: a.amount })
      } else actions.push({ kind: 'reservePercent', goalId: goal.id, percent: a.percent })
      continue
    }
    if (a.kind === 'createTask') {
      if (!a.title.trim()) return stop('Qual o título da tarefa? Escreva de novo com o título, por exemplo: “… cria uma tarefa enviar recibo”.')
      actions.push({ kind: 'createTask', title: a.title, dueDays: a.dueDays, linkProject: info.tokens.includes('projeto'), priority: a.priority })
      continue
    }
    if (a.kind === 'createNote') {
      if (!a.title.trim()) return stop('Qual o título da nota? Escreva de novo com o título.')
      actions.push({ kind: 'createNote', title: a.title, body: '' })
      continue
    }
    if (a.kind === 'askReview' || a.kind === 'notify') {
      actions.push({ kind: a.kind, text: a.text })
      continue
    }
    actions.push({ kind: 'addInbox', text: a.text })
  }
  const extra: RuleCondition[] = sketch.trigger.kind === 'habitDone' && sketch.habitCategory ? [{ field: 'category', values: [sketch.habitCategory] }] : []
  for (const a of actions) if (!info.actions.includes(a.kind)) return stop(`“${cap(describeAction(a, ruleNames(data, settings)))}” não vale para este “quando”.`)

  const names = ruleNames(data, settings)
  const allConditions: RuleCondition[] = [...conditions, ...extra]
  const sentence = describeRule({ trigger: sketch.trigger, conditions: allConditions, actions }, names)
  const draft: RuleDraft & { name: string } = { name: cap(sentence.dos[0]).slice(0, 60), trigger: sketch.trigger, conditions: allConditions, actions }
  const problem = ruleProblem(draft, data)
  if (problem) return stop(`Quase lá: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}.`)

  const today = todayIn(zoneOf(settings), ctx.now)
  const record = ruleRecord(draft, true, undefined, data.rules, today, ctx.newId) as Rule
  const notes: string[] = []
  for (const a of actions) {
    if (a.kind !== 'reservePercent' && a.kind !== 'reserveFixed') continue
    const g = goals.find((x) => x.id === a.goalId)!
    if (!g.inBalance) notes.push(`A meta ${g.name} não está marcada como “Este dinheiro está no meu saldo”: até você ligar isso na meta, a reserva não será feita.`)
  }
  for (const c of conditions) notes.push(`Só olha valores em ${c.currency}. Para comparar outras moedas pela cotação, ajuste no editor.`)
  const twin = findTwin(draft, data.rules)
  if (twin.same) notes.push(`Você já tem uma regra igual: “${twin.same.name}”.`)
  else if (twin.similar) notes.push(`Parecida com “${twin.similar.name}”: as duas vão agir no mesmo acontecimento.`)
  notes.push('Ela fica ligada a partir de hoje. Tudo o que fizer aparece em “Feito pelo Núcleo”, com Desfazer. Nunca cria entradas ou saídas de dinheiro.')

  return {
    lines: ['Entendi. Vou criar esta regra:'],
    rule: { when: sentence.when, ifs: sentence.ifs, dos: sentence.dos },
    proposal: {
      id: proposalId(),
      kind: 'create',
      title: 'Nova regra',
      summary: sentence.summary,
      confirmLabel: 'Confirmar e criar regra',
      changes: [{ id: 'rule', label: `${draft.name}`, detail: sentence.summary, ops: [{ op: 'save', collection: 'rules', record: record as unknown as Rule & Record<string, unknown>, before: null }] }],
      notes,
    },
    link: { label: 'Ajustar no editor antes de criar', path: '/rules', params: { draft: JSON.stringify(draft) } },
  }
}
