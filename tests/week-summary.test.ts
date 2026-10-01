import { describe, expect, it } from 'vitest'
import { compareWeeks, headline, summarySentences } from '../src/core/weekSummary'

describe('resumo semanal', () => {
  it('sem dados, não inventa nada', () => {
    expect(summarySentences({}, { current: true, currency: 'BRL' })).toEqual([])
    expect(headline({}).itemsPercent).toBeNull()
  })

  it('frases com os números reais, sem julgamento', () => {
    const f = { 'items.expected': 29, 'items.done': 24, 'training.done': 4, 'training.planned': 5, 'habits.expected': 21, 'habits.done': 18, 'tasks.due': 10, 'tasks.dueDone': 7, 'tasks.completed': 9, 'finance.income': 100000, 'finance.expense': 40000, 'finance.net': 60000 }
    const s = summarySentences(f, { current: false, currency: 'BRL' })
    expect(s).toContain('Você concluiu 24 de 29 itens nesta semana.')
    expect(s).toContain('Treinou 4 vezes (5 dias planejados).')
    expect(s).toContain('Cumpriu 86% dos seus hábitos (18 de 21).')
    expect(s).toContain('3 tarefas com prazo na semana ficaram pendentes.')
    expect(s.join(' ')).toMatch(/saldo da semana \+R\$ 600,00/)
    expect(s.join(' ')).not.toMatch(/ruim|fracass|falhou|péssim/i)
  })

  it('semana em andamento fala "até agora" e "ainda pendente"', () => {
    const s = summarySentences({ 'items.expected': 3, 'items.done': 1, 'tasks.due': 2, 'tasks.dueDone': 1 }, { current: true, currency: 'BRL' })
    expect(s).toContain('Você concluiu 1 de 3 itens até agora.')
    expect(s).toContain('1 tarefa com prazo na semana ainda está pendente.')
  })

  it('comparação com a semana anterior é neutra e só com dados dos dois lados', () => {
    expect(compareWeeks({ 'items.expected': 10, 'items.done': 9 }, { 'items.expected': 10, 'items.done': 7 })).toBe('20 pontos percentuais acima da semana anterior (70%).')
    expect(compareWeeks({ 'items.expected': 10, 'items.done': 5 }, { 'items.expected': 10, 'items.done': 8 })).toBe('Semana anterior: 80% dos itens.')
    expect(compareWeeks({ 'items.expected': 10, 'items.done': 8 }, {})).toBeNull()
  })
})
