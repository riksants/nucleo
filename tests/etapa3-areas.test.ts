// Etapa 3: notas enormes (rápidas, busca no texto inteiro, nada cortado), Score aproximado e neutro,
// "avançou / ficou pendente" com dados reais, frase de tarefa com repetição.
import { describe, expect, it } from 'vitest'
import { parseCapture } from '../src/core/capture'
import { actionsOf, ANALYSIS_LIMIT, checklistCount, MAX_NOTE, noteMatches, sizeWords, summaryOf } from '../src/core/noteIndex'
import { computeScore, scoreBand } from '../src/core/score'
import { weekHighlights } from '../src/core/weekHighlights'
import type { Note, PlanStep, Task, WeeklyGoal } from '../src/data/types'

const e = { createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
const note = (body: string, over: Partial<Note> = {}): Note => ({ ...e, id: 'n', title: '', body, pinned: false, ...over })

describe('Anotações enormes', () => {
  // ~260 000 characters, like the note that froze the app, with a word only at the very end.
  const lines = Array.from({ length: 5200 }, (_, i) => (i % 10 === 0 ? `- [${i % 20 === 0 ? 'x' : ' '}] item ${i} com acentuação` : `Linha ${i} de um texto bem comprido para testar o desempenho da lista.`))
  const big = `${lines.join('\n')}\nPalavra-chave-escondida-no-fim: renovar o domínio dia 10`
  const n = note(big)

  it('o texto tem o tamanho real e nada é cortado', () => {
    expect(big.length).toBeGreaterThan(260_000)
    expect(n.body).toBe(big)
  })

  it('prévia, checklist e sugestões em poucos milissegundos (e calculados uma vez por versão)', () => {
    const t0 = performance.now()
    const s = summaryOf(n)
    const first = performance.now() - t0
    const t1 = performance.now()
    summaryOf(n)
    const again = performance.now() - t1
    expect(s.lines.length).toBeLessThanOrEqual(3)
    expect(s.progress).toEqual(checklistCount(big))
    expect(s.progress.total).toBe(520)
    expect(first).toBeLessThan(200)
    expect(again).toBeLessThan(1)
  })

  it('busca encontra no texto inteiro (inclusive o fim), sem acento e sem diferenciar maiúsculas', () => {
    expect(noteMatches(n, 'palavra-chave-escondida')).toBe(true)
    expect(noteMatches(n, 'ACENTUACAO item 5180')).toBe(true)
    expect(noteMatches(n, 'inexistente')).toBe(false)
    const t0 = performance.now()
    for (let i = 0; i < 50; i++) noteMatches(n, `linha ${i}`)
    expect(performance.now() - t0).toBeLessThan(200)
  })

  it('sugestões olham só os primeiros 20 mil caracteres (o fim não gera sugestão)', () => {
    const acts = actionsOf(n, '2026-11-01', () => true)
    expect(acts.some((a) => a.line.includes('renovar o domínio'))).toBe(false)
    const small = note('Renovar o domínio dia 10')
    expect(actionsOf(small, '2026-11-01', () => true).some((a) => a.line.includes('Renovar'))).toBe(true)
    expect(ANALYSIS_LIMIT).toBe(20_000)
  })

  it('limite informado, não silencioso', () => {
    expect(MAX_NOTE).toBe(2_000_000)
    expect(sizeWords(262_144)).toBe('262 mil caracteres')
    expect(sizeWords(2_500_000)).toBe('2,5 milhões de caracteres')
  })
})

describe('Score: dado real, valor aproximado, palavra neutra', () => {
  it('arredonda de 5 em 5 e descreve sem julgamento', () => {
    expect(scoreBand(73)).toEqual({ approx: 75, label: 'Consistente' })
    expect(scoreBand(82)).toEqual({ approx: 80, label: 'Muito consistente' })
    expect(scoreBand(41)).toEqual({ approx: 40, label: 'Parcial' })
    expect(scoreBand(12)).toEqual({ approx: 10, label: 'Começando' })
    expect(scoreBand(null)).toBeNull()
  })

  it('o cálculo continua o mesmo: área sem dados não conta (não penaliza quem não usa)', () => {
    const tally = (done: number, expected: number) => ({ done, expected })
    const m = { tasks: { due: tally(8, 10) }, habitsNoTraining: tally(0, 0), routineNoTraining: tally(0, 0), training: { done: 0, planned: 0 }, recurring: tally(3, 4) } as never
    const r = computeScore(m, [])
    expect(r.areas.habits.score).toBeNull()
    expect(r.overall).toBe(Math.round((80 * 25 + 75 * 10) / 35))
  })
})

describe('Semana: avançou / ficou pendente (só registros)', () => {
  const task = (over: Partial<Task>): Task => ({ ...e, id: 't', title: 'T', projectId: null, dueDate: '', priority: 'none', status: 'todo', completedAt: null, ...over })
  const week = '2026-10-26'
  it('listas curtas, a partir do que foi feito e do que tinha prazo', () => {
    const tasks = [
      task({ id: 'a', title: 'Entregar site', status: 'done', completedAt: '2026-10-27T10:00:00Z', priority: 'high' }),
      task({ id: 'b', title: 'Antiga', status: 'done', completedAt: '2026-10-10T10:00:00Z' }),
      task({ id: 'c', title: 'Pagar contador', dueDate: '2026-10-28' }),
      task({ id: 'd', title: 'Futuro', dueDate: '2026-11-05' }),
    ]
    const steps = [{ ...e, id: 's', planId: 'p', title: 'Reservar hotel', deadline: '', status: 'done', doneAt: '2026-10-29T09:00:00Z', order: 0, notes: '' }] as PlanStep[]
    const goals = [{ ...e, id: 'g', week, title: 'Treinar 3 vezes' }] as unknown as WeeklyGoal[]
    const h = weekHighlights({ tasks, planSteps: steps, weeklyGoals: goals }, week, '2026-10-30', ['g'])
    expect(h.advanced.map((a) => a.text)).toEqual(['Meta cumprida: Treinar 3 vezes', 'Entregar site', 'Etapa: Reservar hotel'])
    expect(h.pending.map((p) => p.text)).toEqual(['Pagar contador'])
  })
  it('sem dados, listas vazias (nada inventado)', () => {
    expect(weekHighlights({ tasks: [], planSteps: [], weeklyGoals: [] }, week, '2026-10-30')).toEqual({ advanced: [], pending: [], advancedTotal: 0, pendingTotal: 0 })
  })
})

describe('Tarefas por frase', () => {
  const today = '2026-10-31'
  it('"Entregar projeto sexta às 15h"', () => {
    expect(parseCapture('Entregar projeto sexta às 15h', today)).toMatchObject({ title: 'Entregar projeto', date: '2026-11-06', time: '15:00' })
  })
  it('"Comprar material amanhã"', () => {
    expect(parseCapture('Comprar material amanhã', today)).toMatchObject({ kind: 'task', title: 'Comprar material', date: '2026-11-01' })
  })
  it('"Revisar contrato toda segunda" repete: vai para Recorrentes', () => {
    expect(parseCapture('Revisar contrato toda segunda', today)).toMatchObject({ kind: 'recurring', title: 'Revisar contrato', rule: { type: 'weekdays', days: [1] } })
  })
})
