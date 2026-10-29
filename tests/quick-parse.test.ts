import { describe, expect, it } from 'vitest'
import { parseQuickTask } from '../src/core/quickParse'

const T = '2026-10-29' // a Thursday

describe('quick task', () => {
  it('reads date and time and keeps the rest as the title', () => {
    expect(parseQuickTask('Ligar pro banco amanhã às 10h', T)).toEqual({ title: 'Ligar pro banco', dueDate: '2026-10-30', dueTime: '10:00', priority: 'none' })
    expect(parseQuickTask('Enviar proposta sexta', T)).toMatchObject({ title: 'Enviar proposta', dueDate: '2026-10-30' })
    expect(parseQuickTask('Pagar internet dia 10', T)).toMatchObject({ title: 'Pagar internet', dueDate: '2026-11-10' })
  })
  it('a time alone is today; urgent is high priority', () => {
    expect(parseQuickTask('Reunião 15:30', T)).toMatchObject({ title: 'Reunião', dueDate: T, dueTime: '15:30' })
    expect(parseQuickTask('Revisar contrato urgente', T)).toMatchObject({ title: 'Revisar contrato', priority: 'high' })
  })
  it('plain text stays as typed', () => {
    expect(parseQuickTask('Comprar domínio', T)).toEqual({ title: 'Comprar domínio', dueDate: '', dueTime: '', priority: 'none' })
  })
})
