/** A rule in the person's words: "Quando eu receber pagamento de um projeto, se o valor for maior que €500: reservar 20% para Impostos". */
import { CATEGORY_LABEL as HABIT_CATEGORY_LABEL } from '../weekGoals'
import { CLIENT_STATUS, PROJECT_STATUS, TASK_PRIORITY } from '../../data/labels'
import type { Cents, Currency, DataState, Rule, RuleAction, RuleCondition, Settings } from '../../data/types'
import { formatMoney } from '../../lib/money'
import { categoryLabel, findCategory } from '../financeCategories'
import { ORIGIN_LABEL, triggerInfo, WEEKDAY_LABEL } from './catalog'
import type { RuleDraft } from './templates'

export interface Names {
  goal(id: string): string | undefined
  goalCurrency(id: string): Currency | undefined
  client(id: string): string | undefined
  project(id: string): string | undefined
  category(id: string): string
  money(cents: Cents, currency: Currency): string
}

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ou ${xs.at(-1)}`)
const statusLabel = (v: string) => [...PROJECT_STATUS, ...CLIENT_STATUS].find((o) => o.value === v)?.label.toLowerCase() ?? v

export function describeTrigger(t: Rule['trigger']): string {
  if (t.kind === 'monthDay') return `chegar o dia ${t.day ?? 1} do mês`
  if (t.kind === 'weekDay') {
    const days = [...(t.weekdays ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAY_LABEL[d])
    return days.length === 7 ? 'chegar cada dia da semana' : days.length ? `chegar ${list(days)}` : 'chegar um dia da semana'
  }
  return triggerInfo(t.kind).label
}

export function describeCondition(c: RuleCondition, n: Names): string {
  switch (c.field) {
    case 'amount':
      if (c.compare === 'base') {
        const v = c.op === 'gt' ? `maior que ${n.money(c.value, c.currency)}` : c.op === 'lt' ? `menor que ${n.money(c.value, c.currency)}` : `entre ${n.money(Math.min(c.value, c.value2 ?? c.value), c.currency)} e ${n.money(Math.max(c.value, c.value2 ?? c.value), c.currency)}`
        return `o valor (em qualquer moeda, convertido para ${c.currency}) for ${v}`
      }
      if (c.op === 'gt') return `o valor for maior que ${n.money(c.value, c.currency)}`
      if (c.op === 'lt') return `o valor for menor que ${n.money(c.value, c.currency)}`
      return `o valor estiver entre ${n.money(Math.min(c.value, c.value2 ?? c.value), c.currency)} e ${n.money(Math.max(c.value, c.value2 ?? c.value), c.currency)}`
    case 'currency':
      return `a moeda for ${list(c.values)}`
    case 'category':
      return `a categoria for ${list(c.values.map((v) => (HABIT_CATEGORY_LABEL as Record<string, string>)[v]?.toLowerCase() ?? n.category(v)))}`
    case 'origin':
      return `a origem for ${list(c.values.map((o) => ORIGIN_LABEL[o]))}`
    case 'client':
      return `o cliente for ${list(c.values.map((id) => n.client(id) ?? 'cliente apagado'))}`
    case 'project':
      return `o projeto for ${list(c.values.map((id) => n.project(id) ?? 'projeto apagado'))}`
    case 'text':
      return `o texto tiver “${c.contains.trim()}”`
    case 'status':
      return `o novo status for ${list(c.values.map(statusLabel))}`
    case 'statusBefore':
      return `o status anterior for ${list(c.values.map(statusLabel))}`
    case 'priority':
      return `a prioridade for ${list(c.values.map((p) => TASK_PRIORITY.find((o) => o.value === p)?.label.toLowerCase() ?? p))}`
    case 'goal':
      return `a meta for ${list(c.values.map((id) => n.goal(id) ?? 'meta apagada'))}`
    case 'weekday':
      return `for ${list(c.values.map((d) => WEEKDAY_LABEL[d]))}`
  }
}

export function describeAction(a: RuleAction, n: Names): string {
  const goal = (id: string) => (id ? (n.goal(id) ?? 'meta apagada') : 'uma meta')
  switch (a.kind) {
    case 'reservePercent':
      return `reservar ${a.percent}% para ${goal(a.goalId)}`
    case 'reserveFixed': {
      const cur = a.goalId ? n.goalCurrency(a.goalId) : undefined
      return `reservar ${cur && a.amount ? n.money(a.amount, cur) : 'um valor fixo'} para ${goal(a.goalId)}`
    }
    case 'createTask': {
      const due = a.dueDays === null ? '' : a.dueDays === 0 ? ' para o mesmo dia' : ` para daqui ${a.dueDays} ${a.dueDays === 1 ? 'dia' : 'dias'}`
      return `criar a tarefa “${a.title.trim() || '…'}”${due}`
    }
    case 'projectStatus':
      return `mudar o projeto para ${statusLabel(a.status)}`
    case 'clientStatus':
      return `mudar o cliente para ${statusLabel(a.status)}`
    case 'setCategory':
      return `aplicar a categoria ${n.category(a.category)} (se estiver sem)`
    case 'createNote':
      return `criar a nota “${a.title.trim() || '…'}”`
    case 'addInbox':
      return `adicionar “${a.text.trim() || '…'}” ao Inbox`
    case 'askReview':
      return `pedir minha revisão${a.text.trim() ? ` (“${a.text.trim()}”)` : ''}`
    case 'notify':
      return `me avisar${a.text.trim() ? ` (“${a.text.trim()}”)` : ''}`
  }
}

export function describeRule(rule: Pick<RuleDraft, 'trigger' | 'conditions' | 'actions'>, n: Names): { when: string; ifs: string[]; dos: string[]; summary: string } {
  const when = describeTrigger(rule.trigger)
  const ifs = rule.conditions.map((c) => describeCondition(c, n))
  const dos = rule.actions.map((a) => describeAction(a, n))
  const cond = ifs.length ? `, se ${ifs.join(' e ')}` : ''
  const summary = `Quando ${when}${cond}: ${dos.length ? dos.join(' · ') : 'nada ainda'}.`
  return { when, ifs, dos, summary: summary.charAt(0).toUpperCase() + summary.slice(1) }
}

/** Names from the data (deleted items get a neutral word). */
export function ruleNames(data: Pick<DataState, 'financeGoals' | 'clients' | 'projects'>, settings: Settings): Names {
  const goals = new Map(data.financeGoals.map((g) => [g.id, g]))
  const clients = new Map(data.clients.map((c) => [c.id, c.name]))
  const projects = new Map(data.projects.map((p) => [p.id, p.name]))
  return {
    goal: (id) => goals.get(id)?.name,
    goalCurrency: (id) => goals.get(id)?.currency,
    client: (id) => clients.get(id),
    project: (id) => projects.get(id),
    category: (id) => (findCategory(settings, id) ? categoryLabel(settings, id) : 'categoria apagada'),
    money: (c, cur) => formatMoney(c, cur),
  }
}
