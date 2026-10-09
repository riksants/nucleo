import { describe, expect, it } from 'vitest'
import { appendOperator, endsWithOperator, evaluate, isExpression, parseMoney, resultText } from '../src/lib/calc'
import { parseAmount } from '../src/lib/money'

const cents = (text: string) => {
  const r = evaluate(text)
  return r.ok ? r.cents : r.error
}

describe('calculadora do campo de valor', () => {
  it('faz as contas básicas', () => {
    expect(cents('1200 + 350')).toBe(155000)
    expect(cents('50 × 4')).toBe(20000)
    expect(cents('1000 − 250')).toBe(75000)
    expect(cents('600 ÷ 3')).toBe(20000)
  })

  it('aceita contas em sequência', () => {
    expect(cents('100 + 50 + 25')).toBe(17500)
    expect(cents('2500 + 750 + 120')).toBe(337000)
    expect(resultText(337000)).toBe('3.370')
  })

  it('continua a conta depois do "="', () => {
    const r = evaluate('100 + 50')
    expect(r.ok && resultText(r.cents)).toBe('150')
    expect(cents(appendOperator('150', '+') + '50')).toBe(20000)
  })

  it('multiplica e divide antes de somar e subtrair', () => {
    expect(cents('10 + 5 × 2')).toBe(2000)
    expect(cents('100 − 20 ÷ 4')).toBe(9500)
  })

  it('aceita os símbolos do teclado do computador', () => {
    expect(cents('10*3')).toBe(3000)
    expect(cents('10/4')).toBe(250)
    expect(cents('10-4')).toBe(600)
    expect(cents('10x3')).toBe(3000)
  })

  it('mantém os centavos, com vírgula ou ponto como hoje', () => {
    expect(cents('10,50 + 0,25')).toBe(1075)
    expect(cents('1.500,50 + 1.000')).toBe(250050)
    expect(cents('1500.50 + 0.5')).toBe(150100)
    expect(cents('100 ÷ 3')).toBe(3333)
    expect(cents('0,1 + 0,2')).toBe(30)
    expect(resultText(1075)).toBe('10,75')
    // The "=" result is read back the same way.
    expect(parseAmount(resultText(250050))).toBe(250050)
    expect(parseAmount(resultText(3333))).toBe(3333)
  })

  it('um número sozinho funciona exatamente como antes', () => {
    for (const text of ['300', '1.500,50', '1500.50', '1,5', '€ 20', '0,01']) {
      const r = evaluate(text)
      expect(r.ok && r.cents).toBe(parseAmount(text))
      expect(r.ok && r.isExpression).toBe(false)
    }
    expect(isExpression('300')).toBe(false)
    expect(isExpression('300 + 1')).toBe(true)
  })

  it('impede divisão por zero', () => {
    expect(cents('100 ÷ 0')).toBe('divideByZero')
    expect(cents('100 ÷ 0,00')).toBe('divideByZero')
  })

  it('rejeita contas inválidas', () => {
    for (const text of ['+', '+ 5', '5 +', '5 + + 5', '5 ×', 'abc', '5 + abc', '1.2.3 + 1', '5 ++ 2', '− 5']) expect(cents(text)).toBe('invalid')
    expect(cents('')).toBe('empty')
    expect(cents('   ')).toBe('empty')
  })

  it('nunca devolve zero, negativo, NaN ou Infinity para salvar', () => {
    expect(cents('100 − 100')).toBe('notPositive')
    expect(cents('100 − 250')).toBe('notPositive')
    expect(cents('0')).toBe('notPositive')
    expect(cents('0,001')).toBe('notPositive')
    const huge = evaluate('999999999999999 × 999999999999999')
    expect(huge.ok).toBe(false)
    for (const text of ['1 ÷ 3 × 3', '10 ÷ 3 + 10 ÷ 3', '0,1 × 3']) {
      const r = evaluate(text)
      expect(r.ok && Number.isSafeInteger(r.cents)).toBe(true)
    }
  })

  it('tocar em operadores não cria contas inválidas', () => {
    expect(appendOperator('', '+')).toBe('')
    expect(appendOperator('100', '+')).toBe('100 + ')
    expect(appendOperator('100 + ', '*')).toBe('100 × ')
    expect(appendOperator('100 + ', '-')).toBe('100 − ')
    expect(endsWithOperator('100 + ')).toBe(true)
    expect(endsWithOperator('100 + 5')).toBe(false)
  })

  it('200 + 50 = 250, depois × 2 = 500 (o fluxo do campo de valor)', () => {
    let text = appendOperator('200', '+') + '50'
    expect(text).toBe('200 + 50')
    let r = evaluate(text)
    text = r.ok ? resultText(r.cents) : ''
    expect(text).toBe('250')
    text = appendOperator(text, '*') + '2'
    r = evaluate(text)
    expect(r.ok && resultText(r.cents)).toBe('500')
  })

  it('0,1 + 0,2 mostra 0,3 (sem erro de ponto flutuante)', () => {
    const r = evaluate('0,1 + 0,2')
    expect(r.ok && resultText(r.cents)).toBe('0,30')
    expect(evaluate('0,1 × 3').ok && resultText(30)).toBe('0,30')
  })

  it('valor salvo pelos formulários: número como antes, conta pelo resultado (mesmo sem "=")', () => {
    expect(parseMoney('1.500,50')).toBe(parseAmount('1.500,50'))
    expect(parseMoney('0')).toBe(parseAmount('0'))
    expect(parseMoney('')).toBe(parseAmount(''))
    expect(parseMoney('200 + 50')).toBe(25000)
    expect(parseMoney('200 + 50 + ')).toBe(25000)
    expect(parseMoney('10 ÷ 0')).toBeNull()
    expect(parseMoney('abc + 2')).toBeNull()
  })
})
