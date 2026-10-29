import { describe, expect, it } from 'vitest'
import { actionsInNote, suggestFor } from '../src/core/intentSuggest'

const T = '2026-10-29'
const kinds = (s: string) => suggestFor(s, T).map((x) => x.kind)

describe('sugestões da caixa de entrada', () => {
  it('comprar → lista de compras ou tarefa, com a data', () => {
    expect(kinds('Comprar arroz amanhã')).toEqual(['shopping', 'task', 'note'].slice(0, kinds('Comprar arroz amanhã').length))
    expect(suggestFor('Comprar arroz amanhã', T)[1]).toMatchObject({ kind: 'task', date: '2026-10-30', label: 'Tarefa · amanhã' })
  })
  it('pagar internet dia 10 → lembrete com data ou conta recorrente; "todo dia" → conta primeiro', () => {
    const s = suggestFor('Pagar internet dia 10', T)
    expect(s[0]).toMatchObject({ kind: 'task', date: '2026-11-10' })
    expect(s[1]).toMatchObject({ kind: 'bill', dayOfMonth: 10 })
    expect(suggestFor('Pagar aluguel todo dia 5', T)[0]).toMatchObject({ kind: 'bill', dayOfMonth: 5 })
  })
  it('ideia para um novo site → anotação ou projeto', () => {
    expect(kinds('Ideia para um novo site')).toEqual(['note', 'project'])
  })
  it('reunião com hora → compromisso', () => {
    expect(suggestFor('Reunião com a Padaria sexta 15h', T)[0]).toMatchObject({ kind: 'event', date: '2026-10-30', time: '15:00' })
  })
  it('respeita seções desligadas', () => {
    expect(suggestFor('Comprar arroz', T, (k) => k !== 'shopping').map((x) => x.kind)).not.toContain('shopping')
  })
})

describe('ações dentro de notas', () => {
  it('acha linhas acionáveis e ignora o resto e itens já marcados', () => {
    const found = actionsInNote('Cores quentes\nLembrar de renovar o domínio dia 10\n- [x] Enviar logo\nFinalizar o site do cliente', T)
    expect(found.map((f) => f.line)).toEqual(['Lembrar de renovar o domínio dia 10', 'Finalizar o site do cliente'])
    expect(found[0].suggestion).toMatchObject({ date: '2026-11-10' })
  })
})
