/**
 * Assistant intent contract, shared by the app and the optional AI interpreter
 * (Edge Function). Whoever produced an intent — the local command reader or
 * the AI — it is validated here before the app runs anything.
 */
import { z } from 'zod'

export const Intent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('day'), date: z.string() }),
  z.object({ type: z.literal('week') }),
  z.object({ type: z.literal('finance'), period: z.enum(['week', 'month']) }),
  z.object({ type: z.literal('goals') }),
  z.object({ type: z.literal('changes'), period: z.enum(['week', 'month']) }),
  z.object({ type: z.literal('insights') }),
  z.object({ type: z.literal('reorganizeDay') }),
  z.object({ type: z.literal('reorganizeWeek') }),
  z.object({ type: z.literal('plan'), query: z.string().max(120) }),
  z.object({ type: z.literal('createTask'), title: z.string().min(1).max(120), date: z.string().optional(), time: z.string().optional() }),
  z.object({ type: z.literal('createEvent'), title: z.string().min(1).max(120), date: z.string(), start: z.string(), end: z.string().optional() }),
  z.object({ type: z.literal('createHabit'), name: z.string().min(1).max(80) }),
  z.object({ type: z.literal('createWeeklyGoal'), metric: z.string().nullable(), target: z.number().positive(), title: z.string().max(120) }),
  z.object({ type: z.literal('createFinanceGoal'), name: z.string().min(1).max(120), target: z.number().int().positive(), deadline: z.string() }),
  z.object({ type: z.literal('moveTask'), query: z.string().min(1).max(120), date: z.string(), time: z.string().optional() }),
  z.object({ type: z.literal('completeTask'), query: z.string().min(1).max(120) }),
  z.object({ type: z.literal('deleteTask'), query: z.string().min(1).max(120) }),
  z.object({ type: z.literal('help') }),
  z.object({ type: z.literal('unknown') }),
])
export type Intent = z.infer<typeof Intent>

/** Validates an intent from any source (e.g. the AI interpreter); invalid → unknown. */
export function parseIntent(raw: unknown): Intent {
  const r = Intent.safeParse(raw)
  if (!r.success) return { type: 'unknown' }
  const i = r.data
  const date = (d?: string) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d)
  const time = (t?: string) => !t || /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
  if ('date' in i && !date(i.date)) return { type: 'unknown' }
  if ('deadline' in i && !date(i.deadline)) return { type: 'unknown' }
  if (('time' in i && !time(i.time)) || ('start' in i && !time(i.start)) || ('end' in i && !time(i.end))) return { type: 'unknown' }
  return i
}
