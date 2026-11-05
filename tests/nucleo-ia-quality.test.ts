/**
 * NÚCLEO IA — Etapa 4, free part of the quality set: routing over the ~100 PT-BR questions
 * (spec §10: ≥ 90%), plus the shape of the set itself.
 */
import { describe, expect, it } from 'vitest'
import { routeFor } from '../supabase/functions/_shared/ia/router'
import { TOOL_DEFS } from '../supabase/functions/_shared/ia/tools'
import { CALC_TOOL } from '../supabase/functions/_shared/ia/calc'
import { CORPUS } from './ia-quality/corpus'

describe('conjunto de qualidade', () => {
  it('tem ~100 perguntas, ids únicos, acompanhamentos apontando para itens anteriores e ferramentas que existem', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(100)
    const ids = CORPUS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const known = new Set([...TOOL_DEFS.map((t) => t.name), CALC_TOOL])
    for (const c of CORPUS) {
      if (c.after) expect(ids.indexOf(c.after), c.id).toBeLessThan(ids.indexOf(c.id))
      for (const g of c.tools ?? []) for (const t of g) expect(known.has(t), `${c.id}: ${t}`).toBe(true)
    }
  })

  it('roteamento ≥ 90% no total e 100% em análise, previsão, planejamento e decisão', () => {
    const misses = CORPUS.filter((c) => routeFor(c.q).route !== c.route).map((c) => `${c.id} "${c.q}": ${routeFor(c.q).route} (esperado ${c.route})`)
    const accuracy = 1 - misses.length / CORPUS.length
    expect(accuracy, misses.join('\n')).toBeGreaterThanOrEqual(0.9)
    const strict = misses.filter((m) => /^(x|p|l|d)\d/.test(m))
    expect(strict, strict.join('\n')).toEqual([])
  })
})
