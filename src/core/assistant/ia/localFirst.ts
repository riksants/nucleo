/**
 * NÚCLEO IA — when the local command reader answers instead of the AI (free, instant, offline).
 *
 * With the AI on, a local answer must be COMPLETE: the reader only knows fixed shapes, so a longer
 * question ("quanto gastei com mercado este mês?") would get a generic summary that ignores part of
 * what was asked. Rules:
 * - actions (create/move/complete/delete, reorganize, help) stay local: they become a proposal to
 *   confirm, and the AI does not write in this version;
 * - lookups stay local only when short (up to 5 words), i.e. the command itself
 *   ("O que tenho hoje?", "Resumo financeiro", "Como estão minhas metas?").
 */
import type { Intent } from '../intents'

const ACTIONS = new Set<Intent['type']>(['createTask', 'createEvent', 'createHabit', 'createWeeklyGoal', 'createFinanceGoal', 'moveTask', 'completeTask', 'deleteTask', 'reorganizeDay', 'reorganizeWeek', 'help'])
export const SHORT_COMMAND_WORDS = 5

/**
 * A QUESTION is never turned into an action by the local reader ("Quanto preciso guardar por mês para
 * juntar R$ 150 mil até dezembro de 2027?" is a calculation, not "create a goal"): it goes to the AI.
 */
const QUESTION_START = /^(quanto|quantos|quantas|qual|quais|como|quando|onde|por ?que|porqu[eê]|ser[aá]|devo|consigo|d[aá] (pra|para)|[eé] poss[ií]vel|vale a pena|o que|quem)(?![a-zà-ú])/
const ONLY_ASKING = /(s[oó]|apenas) (uma )?(pergunta|curiosidade|d[uú]vida)|simula[cç][aã]o|simulando|hipoteticamente|n[aã]o (crie|cria|criar|registre|salve)/

export function isQuestion(text: string): boolean {
  const t = text.trim().toLowerCase()
  return QUESTION_START.test(t) || ONLY_ASKING.test(t)
}

export function localAnswers(intent: Intent, question: string): boolean {
  if (intent.type === 'unknown') return false
  if (ACTIONS.has(intent.type)) return intent.type === 'help' || !isQuestion(question)
  const words = question.trim().split(/\s+/).filter(Boolean).length
  return words <= SHORT_COMMAND_WORDS
}
