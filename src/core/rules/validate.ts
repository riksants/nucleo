/**
 * Is a rule complete and coherent? Used by the editor (and, later, by anything else that builds
 * rules, such as the Assistant): the message says what to fix, in the person's words.
 */
import type { DataState } from '../../data/types'
import { triggerInfo } from './catalog'
import type { RuleDraft } from './templates'
import { MAX_ACTIONS } from './types'

export function ruleProblem(d: RuleDraft & { name: string }, data: Pick<DataState, 'financeGoals'>): string | null {
  if (!d.name.trim()) return 'Dê um nome para a regra'
  const info = triggerInfo(d.trigger.kind)
  if (d.trigger.kind === 'monthDay' && !(Number.isInteger(d.trigger.day) && d.trigger.day! >= 1 && d.trigger.day! <= 31)) return 'Escolha o dia do mês'
  if (d.trigger.kind === 'weekDay' && !d.trigger.weekdays?.length) return 'Escolha pelo menos um dia da semana'

  for (const c of d.conditions) {
    if (!info.conditions.includes(c.field)) return 'Uma das condições não vale para este “Quando”'
    if (c.field === 'amount') {
      if (!(c.value > 0)) return 'Digite o valor da condição'
      if (c.op === 'between' && !((c.value2 ?? 0) > 0)) return 'Digite os dois valores da condição “entre”'
    } else if (c.field === 'text') {
      if (!c.contains.trim()) return 'Digite o texto da condição'
    } else if (!c.values.length) return 'Escolha pelo menos uma opção em cada condição'
  }

  if (!d.actions.length) return 'Escolha pelo menos uma ação'
  if (d.actions.length > MAX_ACTIONS) return `No máximo ${MAX_ACTIONS} ações por regra`
  for (const a of d.actions) {
    if (!info.actions.includes(a.kind)) return 'Uma das ações não vale para este “Quando”'
    switch (a.kind) {
      case 'reservePercent':
      case 'reserveFixed':
        if (!a.goalId || !data.financeGoals.some((g) => g.id === a.goalId)) return 'Escolha a meta da reserva'
        if (a.kind === 'reservePercent' && !(Number.isInteger(a.percent) && a.percent >= 1 && a.percent <= 100)) return 'A porcentagem vai de 1 a 100'
        if (a.kind === 'reserveFixed' && !(a.amount > 0)) return 'Digite o valor a reservar'
        break
      case 'createTask':
        if (!a.title.trim()) return 'Digite o título da tarefa'
        if (a.dueDays !== null && !(Number.isInteger(a.dueDays) && a.dueDays >= 0 && a.dueDays <= 365)) return 'O prazo da tarefa vai de 0 a 365 dias'
        break
      case 'createNote':
        if (!a.title.trim()) return 'Digite o título da nota'
        break
      case 'addInbox':
        if (!a.text.trim()) return 'Digite o texto do item do Inbox'
        break
      case 'setCategory':
        if (!a.category) return 'Escolha a categoria'
        break
    }
  }
  return null
}
