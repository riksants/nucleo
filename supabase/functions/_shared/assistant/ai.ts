/**
 * Optional AI interpreter for the Assistant (OFF by default in the app).
 * It only turns one free sentence into one structured intent. It never sees
 * the person's records and never executes anything: the app validates the
 * intent (parseIntent) and runs its own controlled actions, with the same
 * confirmations as typed commands.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { parseIntent, type Intent } from './intent.ts'

/** Smallest model: the task is classification of one short sentence. */
export const ASSISTANT_MODEL = 'claude-haiku-4-5'

/** What the app sends: the sentence, today's date in the person's zone, consent. Nothing else. */
export const AssistantRequest = z.object({
  requestId: z.string().min(8).max(64),
  text: z.string().trim().min(1).max(300),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  consent: z.literal(true),
})
export type AssistantRequest = z.infer<typeof AssistantRequest>

const TYPES = ['day', 'week', 'finance', 'goals', 'changes', 'insights', 'reorganizeDay', 'reorganizeWeek', 'plan', 'createTask', 'createEvent', 'createHabit', 'createWeeklyGoal', 'createFinanceGoal', 'moveTask', 'completeTask', 'deleteTask', 'help', 'unknown'] as const

/** Flat output (every field present, null when unused) — simple and strict for the model. */
export const AiOutput = z.object({
  type: z.enum(TYPES),
  date: z.string().nullable().describe('YYYY-MM-DD'),
  time: z.string().nullable().describe('HH:MM, 24h'),
  endTime: z.string().nullable().describe('HH:MM, 24h'),
  title: z.string().nullable().describe('task/event/habit/goal title, or the name searched for'),
  period: z.enum(['week', 'month']).nullable(),
  metric: z.enum(['training.days', 'study.days', 'tasks.completed', 'finance.saved']).nullable(),
  number: z.number().nullable().describe('target count, or money in cents for finance'),
})
export type AiOutput = z.infer<typeof AiOutput>

export const SYSTEM = `Você converte UMA frase em português (Brasil) em UMA intenção estruturada para o app de organização pessoal NÚCLEO.
Regras:
- Responda só com o objeto pedido. Não invente dados: use apenas o que está na frase.
- Datas absolutas em YYYY-MM-DD a partir da data de hoje informada; horários em HH:MM (24h).
- Valores em dinheiro em centavos (R$ 5.000 = 500000).
- Se a frase for ambígua, perigosa ou fora do escopo, use type "unknown".
- Exclusão só existe para tarefas (deleteTask) e só quando a frase pedir explicitamente para apagar/excluir uma tarefa.
- Tipos: day (o que tenho num dia), week (resumo da semana), finance (gastos; period week|month), goals (metas), changes (o que mudou; period),
  insights (sugestões), reorganizeDay, reorganizeWeek, plan (projeto/objetivo por nome em title), createTask (title, date?, time?),
  createEvent (title, date, time, endTime?), createHabit (title), createWeeklyGoal (metric?, number, title), createFinanceGoal (title, number, date = prazo),
  moveTask (title = nome da tarefa, date, time?), completeTask (title), deleteTask (title), help.`

/** Model output → app intent (then validated by the shared contract). */
export function toIntent(o: AiOutput): Intent {
  const t = o.title?.trim() ?? ''
  const raw: Record<string, unknown> = { type: o.type }
  switch (o.type) {
    case 'day':
      raw.date = o.date
      break
    case 'finance':
    case 'changes':
      raw.period = o.period ?? 'week'
      break
    case 'plan':
      raw.query = t
      break
    case 'createTask':
      Object.assign(raw, { title: t, ...(o.date ? { date: o.date } : {}), ...(o.date && o.time ? { time: o.time } : {}) })
      break
    case 'createEvent':
      Object.assign(raw, { title: t, date: o.date, start: o.time, ...(o.endTime ? { end: o.endTime } : {}) })
      break
    case 'createHabit':
      raw.name = t
      break
    case 'createWeeklyGoal':
      Object.assign(raw, { metric: o.metric, target: o.number, title: t })
      break
    case 'createFinanceGoal':
      Object.assign(raw, { name: t, target: o.number === null ? null : Math.round(o.number), deadline: o.date })
      break
    case 'moveTask':
      Object.assign(raw, { query: t, date: o.date, ...(o.time ? { time: o.time } : {}) })
      break
    case 'completeTask':
    case 'deleteTask':
      raw.query = t
      break
  }
  return parseIntent(raw)
}

export class InterpreterRefusal extends Error {}

export async function callInterpreter(client: Anthropic, req: AssistantRequest) {
  const response = await client.messages.parse({
    model: ASSISTANT_MODEL,
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: 'user', content: `Hoje é ${req.today}.\nFrase: ${req.text}` }],
    output_config: { format: zodOutputFormat(AiOutput) },
  })
  if (response.stop_reason === 'refusal') throw new InterpreterRefusal('refusal')
  const parsed = AiOutput.safeParse(response.parsed_output)
  const intent = parsed.success ? toIntent(parsed.data) : ({ type: 'unknown' } as Intent)
  return { intent, model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
}
