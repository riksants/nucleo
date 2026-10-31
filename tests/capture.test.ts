import { describe, expect, it } from 'vitest'
import { answerCapture, captureQuestions, parseCapture } from '../src/core/capture'

// 2026-10-31 is a Saturday.
const TODAY = '2026-10-31'

describe('cadastro inteligente (frase → campos)', () => {
  it('compromisso: "Tenho dentista amanhã às 15h."', () => {
    const d = parseCapture('Tenho dentista amanhã às 15h.', TODAY)
    expect(d).toMatchObject({ kind: 'event', title: 'Dentista', date: '2026-11-01', time: '15:00', end: '16:00' })
    expect(captureQuestions(d)).toEqual([])
  })

  it('recorrente: "Quero estudar inglês toda segunda e quarta às 19h."', () => {
    const d = parseCapture('Quero estudar inglês toda segunda e quarta às 19h.', TODAY)
    expect(d).toMatchObject({ kind: 'recurring', title: 'Estudar inglês', time: '19:00', rule: { type: 'weekdays', days: [1, 3] } })
  })

  it('tarefa com prazo: "Preciso terminar meu trabalho até sexta."', () => {
    const d = parseCapture('Preciso terminar meu trabalho até sexta.', TODAY)
    expect(d).toMatchObject({ kind: 'task', title: 'Terminar meu trabalho', date: '2026-11-06', deadline: true })
    expect(d.time).toBeUndefined()
  })

  it('hábito: "Quero criar o hábito de ler 20 minutos por dia."', () => {
    const d = parseCapture('Quero criar o hábito de ler 20 minutos por dia.', TODAY)
    expect(d).toMatchObject({ kind: 'habit', title: 'Ler', minutes: 20, rule: { type: 'daily' } })
  })

  it('hora ambígua é perguntada, nunca adivinhada', () => {
    const d = parseCapture('reunião com Ana amanhã às 3', TODAY)
    expect(d.kind).toBe('event')
    expect(d.time).toBeUndefined()
    expect(d.timeOptions).toEqual(['03:00', '15:00'])
    expect(captureQuestions(d)).toEqual(['time'])
    const a = answerCapture(d, { time: '15:00' })
    expect(a).toMatchObject({ time: '15:00', end: '16:00' })
    expect(captureQuestions(a)).toEqual([])
  })

  it('"da tarde" / "da noite" resolvem a hora', () => {
    expect(parseCapture('jantar com Pedro sexta às 8 da noite', TODAY)).toMatchObject({ kind: 'event', time: '20:00', date: '2026-11-06', title: 'Jantar com Pedro' })
    expect(parseCapture('consulta amanhã às 3 da tarde', TODAY)).toMatchObject({ time: '15:00' })
  })

  it('compromisso sem dia: pergunta o dia (não assume hoje)', () => {
    const d = parseCapture('Tenho reunião às 10h', TODAY)
    expect(d).toMatchObject({ kind: 'event', time: '10:00', needsDate: true })
    expect(d.date).toBeUndefined()
  })

  it('não inventa: sem data nem hora, só o título', () => {
    const d = parseCapture('Comprar presente da Júlia', TODAY)
    expect(d).toEqual({ kind: 'task', title: 'Comprar presente da Júlia' })
  })

  it('recorrências: mensal, a cada N, dias úteis, diária e semanal sem dia', () => {
    expect(parseCapture('Pagar aluguel todo dia 5', TODAY)).toMatchObject({ kind: 'recurring', title: 'Pagar aluguel', rule: { type: 'monthly', dayOfMonth: 5 } })
    expect(parseCapture('regar as plantas a cada 3 dias', TODAY)).toMatchObject({ kind: 'recurring', rule: { type: 'interval', every: 3, unit: 'day' }, title: 'Regar as plantas' })
    expect(parseCapture('reunião de equipe de segunda a sexta às 9h', TODAY)).toMatchObject({ kind: 'recurring', rule: { type: 'weekdays', days: [1, 2, 3, 4, 5] }, time: '09:00' })
    expect(parseCapture('tomar vitamina todos os dias às 8h', TODAY)).toMatchObject({ kind: 'recurring', rule: { type: 'daily' }, time: '08:00', title: 'Tomar vitamina' })
    const w = parseCapture('lavar o carro toda semana', TODAY)
    expect(w).toMatchObject({ kind: 'recurring', needsWeekday: true })
    expect(answerCapture(w, { weekday: 6 }).rule).toEqual({ type: 'weekdays', days: [6] })
  })

  it('"das 15h às 16h30" vira início e fim', () => {
    expect(parseCapture('aula de piano terça das 15h às 16h30', TODAY)).toMatchObject({ kind: 'event', date: '2026-11-03', time: '15:00', end: '16:30', title: 'Aula de piano' })
  })

  it('hábito com dias da semana e horário', () => {
    expect(parseCapture('criar hábito de treinar toda terça e quinta às 7h', TODAY)).toMatchObject({ kind: 'habit', title: 'Treinar', time: '07:00', rule: { type: 'weekdays', days: [2, 4] } })
  })

  it('"na segunda" é uma data, não uma repetição', () => {
    expect(parseCapture('ligar para o banco na segunda', TODAY)).toMatchObject({ kind: 'task', date: '2026-11-02', title: 'Ligar para o banco' })
  })
})
