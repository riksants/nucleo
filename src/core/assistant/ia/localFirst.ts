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

export function localAnswers(intent: Intent, question: string): boolean {
  if (intent.type === 'unknown') return false
  if (ACTIONS.has(intent.type)) return true
  const words = question.trim().split(/\s+/).filter(Boolean).length
  return words <= SHORT_COMMAND_WORDS
}
