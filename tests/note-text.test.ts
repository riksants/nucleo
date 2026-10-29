import { describe, expect, it } from 'vitest'
import { checklistProgress, linksIn, parseNote, toggleLine } from '../src/core/noteText'

describe('texto das notas', () => {
  const body = 'Compras\n- [ ] arroz\n- [x] café\n- lista simples\nVer https://exemplo.com/a e www.site.pt'
  it('reconhece checklist, lista e texto', () => {
    expect(parseNote(body).map((l) => l.kind)).toEqual(['text', 'check', 'check', 'bullet', 'text'])
    expect(checklistProgress(body)).toEqual({ done: 1, total: 2 })
  })
  it('marca e desmarca só a linha tocada', () => {
    expect(toggleLine(body, 1).split('\n')[1]).toBe('- [x] arroz')
    expect(toggleLine(body, 2).split('\n')[2]).toBe('- [ ] café')
    expect(toggleLine(body, 0)).toBe(body)
  })
  it('acha links', () => {
    expect(linksIn(body)).toEqual(['https://exemplo.com/a', 'www.site.pt'])
  })
})
