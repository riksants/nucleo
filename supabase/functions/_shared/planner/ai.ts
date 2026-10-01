/**
 * Planner AI: input validation, prompt, structured-output schema and the
 * deterministic post-processing that runs on the server before anything is
 * returned. Runs in Deno (Edge Function) and in Node (tests).
 */
import type Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import { ALLERGENS, INTOLERANCES, RESTRICTIONS, sanitizeMealPlan } from './foodSafety.ts'
import { DAY_LONG, feasibility, findConflicts, fixedBlocks, freeWindows, mergeProposal, missingActivities, WEEKDAYS } from './schedule.ts'
import { fromMinutes, isTime, toMinutes } from './time.ts'
import type { MealAnswers, PlannedMeal, RoutineAnswers, RoutineBlock, ShoppingItem, Weekday } from './types.ts'

export const MODEL = 'claude-opus-5-5'

/* ------------------------------------------------------------------ input */

const time = z.string().refine((v) => v === '' || isTime(v), 'horário inválido')
const day = z.number().int().min(0).max(6)
const text = (max: number) => z.string().max(max)

const RoutineAnswersIn = z.object({
  wakeWeekday: time,
  sleepWeekday: time,
  wakeWeekend: time,
  sleepWeekend: time,
  commitments: z
    .array(
      z.object({
        id: text(40),
        title: text(60),
        kind: z.enum(['work', 'study', 'other']),
        days: z.array(day).max(7),
        start: time,
        end: time,
        away: z.boolean(),
        leaveAt: time,
        arriveAt: time,
        commuteMin: z.number().int().min(0).max(300),
        breakStart: time,
        breakEnd: time,
        fixed: z.boolean(),
      }),
    )
    .max(12),
  trainings: z
    .array(
      z.object({
        id: text(40),
        modality: text(60),
        days: z.array(day).max(7),
        start: time,
        durationMin: z.number().int().min(0).max(600),
        away: z.boolean(),
        commuteMin: z.number().int().min(0).max(300),
        fixed: z.boolean(),
      }),
    )
    .max(10),
  competitions: text(300),
  activities: z
    .array(
      z.object({
        id: text(40),
        name: text(60),
        timesPerWeek: z.number().int().min(1).max(14),
        durationMin: z.number().int().min(5).max(600),
        period: z.enum(['any', 'morning', 'afternoon', 'evening']),
        priority: z.enum(['high', 'medium', 'low']),
      }),
    )
    .max(15),
  bufferMin: z.number().int().min(0).max(120),
  restDays: z.array(day).max(7),
  goals: text(400),
})

const MealAnswersIn = z.object({
  goal: z.enum(['health', 'muscle', 'fatloss', 'performance', 'practical', 'budget']),
  athlete: z.boolean(),
  modality: text(60),
  allergies: z.array(text(40)).max(20),
  intolerances: z.array(text(40)).max(20),
  restrictions: z.array(text(40)).max(20),
  dislikes: text(300),
  likes: text(300),
  budget: z.enum(['low', 'medium', 'high']),
  budgetNote: text(120),
  cookMinutes: z.number().int().min(0).max(240),
  equipment: z.array(text(30)).max(12),
  mealsPerDay: z.number().int().min(2).max(6),
  mealTimes: z.array(time).max(6),
  clinical: z.boolean(),
  clinicalNote: text(200),
  performanceStrategy: z.boolean(),
})

export const PlannerRequest = z.object({
  requestId: z.string().min(8).max(64),
  mode: z.enum(['routine', 'meals', 'both']),
  consent: z.literal(true),
  routine: RoutineAnswersIn.optional(),
  meals: MealAnswersIn.optional(),
})
export type PlannerRequest = z.infer<typeof PlannerRequest>

/* ------------------------------------------------------------------ output */

const BlockOut = z.object({
  day: z.number().int(),
  start: z.string(),
  end: z.string(),
  title: z.string(),
  kind: z.enum(['activity', 'training', 'rest', 'meal', 'study', 'other']),
})

const MealOut = z.object({
  day: z.number().int(),
  time: z.string(),
  label: z.string(),
  items: z.array(z.string()),
  substitutions: z.array(z.string()),
})

export const RoutineOutput = z.object({
  blocks: z.array(BlockOut),
  unplaced: z.array(z.string()),
  notes: z.string(),
})

export const MealOutput = z.object({
  meals: z.array(MealOut),
  shopping: z.array(z.object({ item: z.string(), qty: z.string() })),
  notes: z.string(),
})

export const BothOutput = z.object({ routine: RoutineOutput, meals: MealOutput })

/* ------------------------------------------------------------------ prompt */

const LABELS = new Map([...ALLERGENS, ...INTOLERANCES, ...RESTRICTIONS].map((r) => [r.id, r.label]))
const named = (ids: string[]) => ids.map((x) => LABELS.get(x) ?? x).join(', ')

const SYSTEM = `Você monta planejamentos semanais para um app pessoal de organização, em português do Brasil.

Regras de rotina:
- Os blocos fixos informados já estão na agenda e não podem ser movidos, encurtados ou sobrepostos. Não os repita na resposta.
- Coloque cada atividade pedida apenas dentro das janelas livres informadas, respeitando a duração e o período preferido, sem ultrapassar a frequência semanal pedida.
- Nunca crie sobreposições. Não use os dias de descanso para atividades.
- Se algo não couber, não force: liste em "unplaced" o que ficou de fora e por quê. Priorize atividades de prioridade alta.
- O campo "title" de uma atividade deve ser exatamente o nome pedido.

Regras de alimentação (quando pedido):
- Este é um planejamento alimentar de organização, não uma prescrição clínica. Não calcule calorias nem macros, não sugira suplementos, jejum, dietas restritivas, detox ou estratégias de corte de peso.
- Alergias, intolerâncias, restrições e alimentos recusados são condições obrigatórias: nenhum item, substituição ou compra pode contê-los, nem como ingrediente.
- Use as refeições nos horários informados, respeite orçamento, tempo de preparo e equipamentos.
- Substituições devem respeitar as mesmas restrições.
- A lista de compras deve cobrir a semana, com quantidades aproximadas.

Responda só com o JSON do formato pedido.`

function windowsText(answers: RoutineAnswers): string {
  const fixed = fixedBlocks(answers)
  return WEEKDAYS.map((d) => {
    const free = freeWindows(fixed, answers, d)
    const rest = answers.restDays.includes(d) ? ' (dia de descanso)' : ''
    return `${DAY_LONG[d]} [day=${d}]${rest}: ${free.map((w) => `${fromMinutes(w.start)}–${w.end >= 1440 ? '24:00' : fromMinutes(w.end)}`).join(', ') || 'sem janelas livres'}`
  }).join('\n')
}

/** Only the questionnaire answers go to the AI. Nothing from other sections. */
export function buildUserMessage(req: PlannerRequest): string {
  const parts: string[] = []
  if (req.routine && req.mode !== 'meals') {
    const fixed = fixedBlocks(req.routine as RoutineAnswers)
    parts.push(
      `ROTINA\nAcordar/dormir em dias úteis: ${req.routine.wakeWeekday}/${req.routine.sleepWeekday}; fim de semana: ${req.routine.wakeWeekend}/${req.routine.sleepWeekend}.`,
      `Intervalo mínimo entre blocos: ${req.routine.bufferMin} min.`,
      `Blocos fixos (já na agenda):\n${fixed.map((b) => `- day=${b.day} ${b.start}–${b.end} ${b.title}`).join('\n') || '- nenhum'}`,
      `Janelas livres por dia (já descontando os intervalos):\n${windowsText(req.routine as RoutineAnswers)}`,
      `Atividades desejadas:\n${req.routine.activities.map((a) => `- "${a.name}": ${a.timesPerWeek}x/semana, ${a.durationMin} min, período ${a.period}, prioridade ${a.priority}`).join('\n') || '- nenhuma'}`,
      req.routine.competitions ? `Competições: ${req.routine.competitions}` : '',
      req.routine.goals ? `Objetivos: ${req.routine.goals}` : '',
    )
  }
  if (req.meals && req.mode !== 'routine') {
    const m = req.meals
    parts.push(
      `ALIMENTAÇÃO\nObjetivo: ${m.goal}. ${m.athlete ? `Atleta de ${m.modality || 'esporte não informado'}.` : ''}`,
      `PROIBIDO (alergias): ${named(m.allergies) || 'nenhuma'}`,
      `PROIBIDO (intolerâncias): ${named(m.intolerances) || 'nenhuma'}`,
      `PROIBIDO (restrições): ${named(m.restrictions) || 'nenhuma'}`,
      `PROIBIDO (não come): ${m.dislikes || 'nada informado'}`,
      `Preferências: ${m.likes || 'não informadas'}`,
      `Orçamento: ${m.budget}${m.budgetNote ? ` (${m.budgetNote})` : ''}. Tempo para cozinhar por dia: ${m.cookMinutes} min. Equipamentos: ${m.equipment.join(', ') || 'não informado'}.`,
      `${m.mealsPerDay} refeições por dia, nos horários: ${m.mealTimes.join(', ')}. Gere as refeições dos 7 dias (day 0 a 6).`,
    )
  }
  return parts.filter(Boolean).join('\n\n')
}

/* ------------------------------------------------------------------ call */

export class PlannerRefusal extends Error {}
export class PlannerInvalid extends Error {}

export async function callPlanner(client: Anthropic, req: PlannerRequest) {
  const schema = req.mode === 'both' ? BothOutput : req.mode === 'routine' ? RoutineOutput : MealOutput
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
    system: SYSTEM,
    messages: [{ role: 'user', content: buildUserMessage(req) }],
  })
  if (response.stop_reason === 'refusal') throw new PlannerRefusal('A IA não pôde gerar este planejamento.')
  if (response.stop_reason === 'max_tokens') throw new PlannerInvalid('Resposta incompleta da IA.')
  const parsed = schema.safeParse(response.parsed_output)
  if (!parsed.success) throw new PlannerInvalid('A IA devolveu um formato inválido.')
  return { output: parsed.data, model: response.model }
}

/* ------------------------------------------------------------------ post-processing */

let n = 0
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(++n).toString(36)}`

export interface RoutineResult {
  blocks: RoutineBlock[]
  rejected: string[]
  unplaced: string[]
  missing: string[]
  notes: string
}

export interface MealsResult {
  meals: PlannedMeal[]
  shopping: ShoppingItem[]
  notes: string
  removed: string[]
  warnings: string[]
}

export function finishRoutine(answers: RoutineAnswers, out: z.infer<typeof RoutineOutput>): RoutineResult {
  const proposed: RoutineBlock[] = out.blocks.map((b) => ({ id: id('ai'), day: b.day as Weekday, start: b.start, end: b.end, title: b.title, kind: b.kind, fixed: false }))
  const merged = mergeProposal(answers, proposed)
  return { blocks: merged.blocks, rejected: merged.rejected, unplaced: out.unplaced, missing: missingActivities(answers, merged.blocks), notes: out.notes }
}

export function finishMeals(answers: MealAnswers, out: z.infer<typeof MealOutput>, routine?: { answers: RoutineAnswers; blocks: RoutineBlock[] }): MealsResult {
  const meals: PlannedMeal[] = out.meals
    .filter((m) => WEEKDAYS.includes(m.day as Weekday) && isTime(m.time))
    .map((m) => ({ id: id('meal'), day: m.day as Weekday, time: m.time, label: m.label, items: m.items, substitutions: m.substitutions }))
  const safe = sanitizeMealPlan({ meals, shopping: out.shopping.map((s) => ({ ...s, checked: false })), notes: out.notes }, answers)
  const warnings: string[] = []
  if (routine) {
    // Combined plan: a meal must not fall inside a non-meal block of the routine.
    for (const m of safe.meals) {
      const t = toMinutes(m.time)
      const clash = routine.blocks.find((b) => b.day === m.day && b.kind !== 'meal' && toMinutes(b.start) <= t && t < (b.end === '23:59' ? 1440 : toMinutes(b.end)))
      if (clash) warnings.push(`${DAY_LONG[m.day]} ${m.time} (${m.label}) cai durante “${clash.title}”.`)
    }
  }
  for (const day of WEEKDAYS) {
    const count = safe.meals.filter((m) => m.day === day).length
    if (count && count < Math.max(2, answers.mealsPerDay - 1)) warnings.push(`${DAY_LONG[day]} ficou com só ${count} refeição(ões).`)
  }
  return { ...safe, warnings }
}

/** Refuses up front what should go to a professional instead of the AI. */
export function screeningProblem(req: PlannerRequest): string | null {
  if (req.mode !== 'routine' && req.meals?.clinical) return 'clinical'
  if (req.mode !== 'meals' && req.routine) {
    const { fixedConflicts } = feasibility(req.routine as RoutineAnswers)
    if (fixedConflicts.length) return 'fixed-conflicts'
  }
  return null
}

export { findConflicts }
