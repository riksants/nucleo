import { describe, expect, it } from 'vitest'
import { markOrganized, splitCapture, suggestedDate } from '../src/features/inbox/inbox'
import type { InboxItem } from '../src/data/types'

describe('caixa de entrada', () => {
  it('primeira linha vira título, o resto vira observação', () => {
    expect(splitCapture('Ligar para João amanhã')).toEqual({ title: 'Ligar para João amanhã', notes: '' })
    expect(splitCapture('Comprar presente\nalgo de até R$ 100\nver loja X')).toEqual({ title: 'Comprar presente', notes: 'algo de até R$ 100\nver loja X' })
    const long = 'a'.repeat(200)
    expect(splitCapture(long).title.length).toBeLessThanOrEqual(118)
    expect(splitCapture(long).notes).toBe(long)
  })

  it('"amanhã"/"hoje" sugerem a data no fuso do usuário (só sugestão)', () => {
    expect(suggestedDate('Ligar para João amanhã', '2026-10-31')).toBe('2026-11-01')
    expect(suggestedDate('pagar conta HOJE', '2026-10-01')).toBe('2026-10-01')
    expect(suggestedDate('Ideia de app', '2026-10-01')).toBe('')
    expect(suggestedDate('amanhecer na praia', '2026-10-01')).toBe('')
  })

  it('organizar mantém o item original com o vínculo ao que ele virou', () => {
    const item: InboxItem = { id: 'i1', createdAt: 'c', updatedAt: 'u', text: 'Ligar para João', status: 'open', convertedTo: null, processedAt: null }
    const done = markOrganized(item, { collection: 'tasks', id: 't1' })
    expect(done).toMatchObject({ id: 'i1', text: 'Ligar para João', status: 'done', convertedTo: { collection: 'tasks', id: 't1' }, createdAt: 'c' })
    expect(done.processedAt).toBeTruthy()
    expect(markOrganized(item, null).convertedTo).toBeNull()
  })
})
