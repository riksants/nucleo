import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { buildUserMessage, callPlanner, finishMeals, PlannerInvalid, PlannerRefusal, PlannerRequest, screeningProblem } from '../supabase/functions/_shared/planner/ai.ts'
import { emptyMealAnswers } from '../supabase/functions/_shared/planner/foodSafety.ts'
import { emptyRoutineAnswers, findConflicts, newCommitment } from '../supabase/functions/_shared/planner/schedule.ts'

const routine = { ...emptyRoutineAnswers(), commitments: [{ ...newCommitment(), id: 'w', days: [1, 2, 3, 4, 5] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[] }], activities: [{ id: 'l', name: 'Leitura', timesPerWeek: 2, durationMin: 30, period: 'evening' as const, priority: 'high' as const }] }
const meals = { ...emptyMealAnswers(), allergies: ['peanut'] }

function fakeClient(response: { stop_reason: string; parsed_output: unknown }, seen: unknown[] = []) {
  return {
    beta: {
      messages: {
        parse: async (params: unknown) => {
          seen.push(params)
          return { ...response, model: 'claude-opus-5-5' }
        },
      },
    },
  } as unknown as Anthropic
}

describe('IA do planejamento', () => {
  it('valida o pedido e exige consentimento', () => {
    expect(PlannerRequest.safeParse({ requestId: 'abcdefgh1', mode: 'routine', consent: false, routine }).success).toBe(false)
    expect(PlannerRequest.safeParse({ requestId: 'abcdefgh1', mode: 'routine', consent: true, routine }).success).toBe(true)
  })

  it('a mensagem leva só as respostas do questionário', () => {
    const msg = buildUserMessage({ requestId: 'abcdefgh1', mode: 'both', consent: true, routine, meals })
    expect(msg).toContain('Leitura')
    expect(msg).toContain('PROIBIDO (alergias): Amendoim')
    expect(msg).not.toMatch(/senha|saldo|cliente|password/i)
  })

  it('usa o modelo e o formato estruturado; recusa e formato inválido viram erros tratáveis', async () => {
    const seen: unknown[] = []
    const ok = await callPlanner(fakeClient({ stop_reason: 'end_turn', parsed_output: { blocks: [], unplaced: [], notes: '' } }, seen), { requestId: 'abcdefgh1', mode: 'routine', consent: true, routine })
    expect(ok.output).toEqual({ blocks: [], unplaced: [], notes: '' })
    expect(seen[0]).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' })
    await expect(callPlanner(fakeClient({ stop_reason: 'refusal', parsed_output: null }), { requestId: 'abcdefgh1', mode: 'routine', consent: true, routine })).rejects.toBeInstanceOf(PlannerRefusal)
    await expect(callPlanner(fakeClient({ stop_reason: 'end_turn', parsed_output: { wrong: true } }), { requestId: 'abcdefgh1', mode: 'routine', consent: true, routine })).rejects.toBeInstanceOf(PlannerInvalid)
  })

  it('pós-processamento bloqueia alérgeno e aponta refeição durante o trabalho', () => {
    const res = finishMeals(
      meals,
      {
        meals: [
          { day: 1, time: '07:30', label: 'Café', items: ['Pão com pasta de amendoim', 'Café'], substitutions: [] },
          { day: 1, time: '10:00', label: 'Lanche', items: ['Fruta'], substitutions: [] },
        ],
        shopping: [{ item: 'Amendoim torrado', qty: '200 g' }],
        notes: '',
      },
      { answers: routine, blocks: [{ id: 'w-1', day: 1, start: '08:30', end: '12:00', title: 'Trabalho', kind: 'work', fixed: true }] },
    )
    expect(res.meals[0].items).toEqual(['Café'])
    expect(res.shopping).toEqual([])
    expect(res.warnings.some((w) => w.includes('Trabalho'))).toBe(true)
  })

  it('casos clínicos não vão para a IA; conflitos fixos também não', () => {
    expect(screeningProblem({ requestId: 'abcdefgh1', mode: 'meals', consent: true, meals: { ...meals, clinical: true } })).toBe('clinical')
    const clash = { ...routine, trainings: [{ id: 't', modality: 'Corrida', days: [1] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[], start: '09:00', durationMin: 60, away: false, commuteMin: 0, fixed: true }] }
    expect(screeningProblem({ requestId: 'abcdefgh1', mode: 'routine', consent: true, routine: clash })).toBe('fixed-conflicts')
    expect(findConflicts([], routine)).toEqual([])
  })
})
