/**
 * Assinaturas: pausar e retomar. Paused = no charge, no reminder, nothing deleted (runs, payments and history stay).
 * Resuming never charges the paused period: the next charge is the first one of the cycle from today on, and the
 * automation never creates a charge dated before the resume day.
 */
import type { Tool } from '../data/types'
import { dayOfDate, isDate, shiftMonths } from './automation/dates'

export function pauseTool(tool: Tool, today: string): Tool {
  if (tool.status === 'paused') return tool
  return { ...tool, status: 'paused', pausedAt: today }
}

/** First charge of the same cycle (same day of the month) on or after `today`. */
export function nextCycleFrom(tool: Pick<Tool, 'nextCharge' | 'chargeDay' | 'billing'>, today: string): string {
  if (!isDate(tool.nextCharge) || (tool.billing !== 'monthly' && tool.billing !== 'yearly')) return tool.nextCharge
  if (tool.nextCharge >= today) return tool.nextCharge
  const anchor = tool.chargeDay ?? dayOfDate(tool.nextCharge)
  const step = tool.billing === 'monthly' ? 1 : 12
  let date = tool.nextCharge
  for (let k = 1; date < today && k < 1200; k++) date = shiftMonths(tool.nextCharge, k * step, anchor)
  return date
}

export function resumeTool(tool: Tool, today: string): Tool {
  const { pausedAt: _p, ...rest } = tool
  const active: Tool = { ...rest, status: 'active', resumedAt: today }
  return { ...active, nextCharge: nextCycleFrom(tool, today), ...(tool.chargeDay || !isDate(tool.nextCharge) ? {} : { chargeDay: dayOfDate(tool.nextCharge) }) }
}

/** Applies a status chosen in the form the same way as the buttons (pause / resume rules). */
export function withStatus(before: Tool | null, next: Tool, today: string): Tool {
  if (!before) return next.status === 'paused' ? { ...next, pausedAt: today } : next
  if (before.status !== 'paused' && next.status === 'paused') return { ...next, pausedAt: today }
  if (before.status === 'paused' && next.status !== 'paused') {
    const resumed = resumeTool({ ...next, status: 'paused' }, today)
    return { ...resumed, status: next.status }
  }
  return next
}
