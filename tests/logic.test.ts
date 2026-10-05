import { describe, expect, it } from 'vitest'
import { paymentProblem, salePaid, saleRemaining, saleStatus, totalProblem, withPayment } from '../src/data/sales'
import { advanceCharge, chargeAfterPayment, convertTotals, nextChargeOf, projectRevenue, receivedByCurrency } from '../src/data/subscriptions'
import { nextChargeDate } from '../src/data/selectors'
import type { RoutineAnswers, Sale, SubPlan, Subscriber } from '../src/data/types'
import { formatMoney } from '../src/lib/money'
import { clean, effectiveRates, makeConverter } from '../src/lib/rates'
import { activeRules, emptyMealAnswers, sanitizeMealPlan, violations } from '../supabase/functions/_shared/planner/foodSafety.ts'
import { emptyRoutineAnswers, feasibility, findConflicts, fixedBlocks, mergeProposal, newCommitment } from '../supabase/functions/_shared/planner/schedule.ts'

const sale = (over: Partial<Sale> = {}): Sale => ({
  id: 's1', createdAt: '', updatedAt: '', clientId: null, clientName: 'Ana', product: 'Bolo', quantity: 2,
  date: '2026-09-01', total: 10000, currency: 'BRL', dueDate: '2026-09-30', payments: [], notes: '', ...over,
})

describe('vendas', () => {
  it('saldo e situação vêm só dos pagamentos', () => {
    const s = sale({ payments: [{ id: 'p1', date: '2026-09-02', amount: 3000, note: '' }] })
    expect(salePaid(s)).toBe(3000)
    expect(saleRemaining(s)).toBe(7000)
    expect(saleStatus(s)).toBe('partial')
    expect(saleStatus(sale())).toBe('pending')
    expect(saleStatus(withPayment(s, { id: 'p2', date: '2026-09-05', amount: 7000, note: '' }))).toBe('paid')
  })
  it('repetir o mesmo pagamento (mesmo id) não conta duas vezes', () => {
    const p = { id: 'p1', date: '2026-09-02', amount: 3000, note: '' }
    const twice = withPayment(withPayment(sale(), p), p)
    expect(twice.payments).toHaveLength(1)
    expect(salePaid(twice)).toBe(3000)
  })
  it('bloqueia pagamento acima do que falta e total menor que o recebido', () => {
    const s = sale({ payments: [{ id: 'p1', date: '2026-09-02', amount: 8000, note: '' }] })
    expect(paymentProblem(s, { id: 'p2', date: '2026-09-03', amount: 2001 })).toMatch(/passa/)
    expect(paymentProblem(s, { id: 'p2', date: '2026-09-03', amount: 2000 })).toBeNull()
    // editar o próprio pagamento desconta o valor antigo
    expect(paymentProblem(s, { id: 'p1', date: '2026-09-02', amount: 10000 })).toBeNull()
    expect(totalProblem(7000, s.payments)).toMatch(/menor/)
  })
})

const plan = (id: string, price: number, currency: string, interval: 'monthly' | 'yearly'): SubPlan => ({ id, createdAt: '', updatedAt: '', offeringId: 'o', name: id, price, currency, interval })
const sub = (planId: string, status: Subscriber['status'], payments: Subscriber['payments'] = []): Subscriber => ({
  id: `${planId}-${status}-${Math.random()}`, createdAt: '', updatedAt: '', offeringId: 'o', planId, name: 'x', clientId: null, email: '', startDate: '2026-01-15',
  nextCharge: '2026-01-31', status, cancelledAt: '', payments, notes: '',
})

describe('assinantes', () => {
  const plans = [plan('m', 2000, 'BRL', 'monthly'), plan('y', 12000, 'BRL', 'yearly'), plan('e', 500, 'EUR', 'monthly')]
  const subs = [sub('m', 'active'), sub('m', 'active'), sub('y', 'active'), sub('m', 'cancelled'), sub('m', 'trial'), sub('e', 'active', [{ id: 'p', date: '2026-09-01', amount: 500, currency: 'EUR', note: '' }])]

  it('projeção por moeda: mensal exato, anual como equivalente, cancelados e testes fora', () => {
    const [brl, eur] = projectRevenue(subs, plans)
    expect(brl).toMatchObject({ currency: 'BRL', monthlyPlans: 4000, yearlyAsMonthly: 1000, yearly: 4000 * 12 + 12000, active: 3 })
    expect(eur).toMatchObject({ currency: 'EUR', monthlyPlans: 500, yearly: 6000, active: 1 })
  })
  it('recebido fica separado da projeção e por moeda', () => {
    expect(receivedByCurrency(subs).get('EUR')).toBe(500)
    expect(receivedByCurrency(subs).get('BRL')).toBeUndefined()
    expect(receivedByCurrency(subs, '2026-10-01').size).toBe(0)
  })
  it('não soma moedas sem conversão: informa o que faltou', () => {
    const convert = makeConverter({ EUR: 1, BRL: 6 })
    expect(convertTotals([{ currency: 'BRL', cents: 600 }, { currency: 'EUR', cents: 100 }], 'EUR', convert)).toEqual({ total: 200, missing: [] })
    expect(convertTotals([{ currency: 'JPY', cents: 100 }], 'EUR', convert).missing).toEqual(['JPY'])
  })
  it('próxima cobrança mensal respeita fim de mês', () => {
    expect(advanceCharge('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(nextChargeOf(sub('m', 'active'), plans[0], new Date(2026, 2, 5))).toBe('2026-03-31')
    expect(nextChargeOf(sub('m', 'cancelled'), plans[0])).toBe('')
  })
  it('registrar pagamento avança a partir da cobrança atual, mesmo com data guardada antiga', () => {
    const today = new Date(2026, 9, 4)
    // Stored 31 Jan, today 4 Oct: the charge due is 31 Oct; paying moves it to 30 Nov (not to 28 Feb).
    expect(nextChargeOf(sub('m', 'active'), plans[0], today)).toBe('2026-10-31')
    expect(chargeAfterPayment(sub('m', 'active'), plans[0], today)).toBe('2026-11-30')
    expect(chargeAfterPayment({ ...sub('m', 'active'), nextCharge: '2026-01-10' }, plans[0], today)).toBe('2026-11-10')
    // Date still ahead: one cycle after it, as before.
    expect(chargeAfterPayment({ ...sub('m', 'active'), nextCharge: '2026-10-20' }, plans[0], today)).toBe('2026-11-20')
    expect(chargeAfterPayment({ ...sub('y', 'active'), nextCharge: '2025-03-01' }, plans[1], today)).toBe('2028-03-01') // due 1 Mar 2027 → next one a year later
    // The new date is what the screen then shows as the next charge.
    const paid = { ...sub('m', 'active'), nextCharge: chargeAfterPayment({ ...sub('m', 'active'), nextCharge: '2026-01-10' }, plans[0], today) }
    expect(nextChargeOf(paid, plans[0], today)).toBe('2026-11-10')
  })
})

describe('assinaturas (o que você paga)', () => {
  const tool = (nextCharge: string, billing: 'monthly' | 'yearly' = 'monthly') => ({ id: 't', createdAt: '', updatedAt: '', name: 'App', plan: '', price: 1000, currency: 'BRL', billing, nextCharge, status: 'active', link: '', notes: '' }) as never
  it('cobrança no dia 31 fica no último dia dos meses curtos, sem escorregar para o dia 3', () => {
    expect(nextChargeDate(tool('2026-01-31'), new Date(2026, 1, 10))).toBe('2026-02-28')
    expect(nextChargeDate(tool('2026-01-31'), new Date(2026, 2, 1))).toBe('2026-03-31')
    expect(nextChargeDate(tool('2026-01-31'), new Date(2026, 9, 4))).toBe('2026-10-31')
    expect(nextChargeDate(tool('2026-01-30'), new Date(2026, 9, 31))).toBe('2026-11-30')
  })
  it('anual em 29 de fevereiro cai em 28 nos anos comuns e volta ao 29 no bissexto', () => {
    expect(nextChargeDate(tool('2024-02-29', 'yearly'), new Date(2026, 0, 1))).toBe('2026-02-28')
    expect(nextChargeDate(tool('2024-02-29', 'yearly'), new Date(2027, 5, 1))).toBe('2028-02-29')
  })
  it('data hoje ou futura não muda', () => {
    expect(nextChargeDate(tool('2026-10-04'), new Date(2026, 9, 4))).toBe('2026-10-04')
    expect(nextChargeDate(tool('2026-12-15'), new Date(2026, 9, 4))).toBe('2026-12-15')
  })
})

describe('moedas e câmbio', () => {
  it('lê todas as moedas da fonte, mantendo AED', () => {
    const t = clean({ BRL: 6.1, AED: 4.2, USD: 1.1, JPY: 160, xyz: 2, BTC: 0.00001 })!
    expect(Object.keys(t).sort()).toEqual(['AED', 'BRL', 'EUR', 'JPY', 'USD'])
  })
  it('converter não inventa taxa e não altera valores originais', () => {
    const convert = makeConverter(effectiveRates({ rates: { values: { EUR: 1, BRL: 6, USD: 1.2 }, fetchedAt: '', source: '' }, manualRates: { BRL: 5 } }))
    expect(convert(500, 'BRL', 'EUR')).toBe(100)
    expect(convert(100, 'EUR', 'USD')).toBe(120)
    expect(convert(100, 'EUR', 'CHF')).toBeNull()
    const original = { amount: 500, currency: 'BRL' }
    convert(original.amount, original.currency, 'USD')
    expect(original).toEqual({ amount: 500, currency: 'BRL' })
  })
  it('formato das moedas antigas continua igual', () => {
    expect(formatMoney(150050, 'EUR')).toBe('€ 1.500,50')
    expect(formatMoney(-2000, 'BRL')).toBe('−R$ 20,00')
    expect(formatMoney(1000, 'AED')).toBe('10,00 د.إ')
    expect(formatMoney(1000, 'USD')).toBe('US$ 10,00')
  })
})

const routine = (over: Partial<RoutineAnswers> = {}): RoutineAnswers => ({ ...emptyRoutineAnswers(), ...over })

describe('rotina', () => {
  it('“saio às 8h, almoço 12–13, chego às 18h” vira deslocamentos, trabalho e almoço sem sobreposição', () => {
    const work = { ...newCommitment(), id: 'w', days: [1 as const], leaveAt: '08:00', arriveAt: '18:00', commuteMin: 30 }
    const a = routine({ commitments: [work] })
    const blocks = fixedBlocks(a)
    expect(blocks.map((b) => `${b.start}-${b.end} ${b.kind}`)).toEqual([
      '08:00-08:30 commute',
      '08:30-12:00 work',
      '12:00-13:00 meal',
      '13:00-17:30 work',
      '17:30-18:00 commute',
    ])
    expect(findConflicts(blocks, a)).toEqual([])
  })
  it('detecta sobreposição entre compromissos fixos', () => {
    const a = routine({
      commitments: [{ ...newCommitment(), id: 'w', days: [2], away: false, start: '09:00', end: '17:00', breakStart: '', breakEnd: '' }],
      trainings: [{ id: 't', modality: 'Jiu-jitsu', days: [2], start: '16:30', durationMin: 60, away: false, commuteMin: 0, fixed: true }],
    })
    expect(feasibility(a).fixedConflicts.length).toBeGreaterThan(0)
  })
  it('avisa quando as atividades não cabem e pede prioridade', () => {
    const a = routine({
      wakeWeekday: '07:00', sleepWeekday: '08:30', wakeWeekend: '07:00', sleepWeekend: '08:30',
      activities: [{ id: 'x', name: 'Leitura', timesPerWeek: 5, durationMin: 120, period: 'any', priority: 'high' }],
    })
    const { problems } = feasibility(a)
    expect(problems.some((p) => p.message.includes('não cabe'))).toBe(true)
  })
  it('proposta da IA: rejeita sobreposição, horário fora do dia, dia de descanso e excesso de frequência; preserva fixos', () => {
    const work = { ...newCommitment(), id: 'w', days: [1 as const], leaveAt: '08:00', arriveAt: '18:00', commuteMin: 30 }
    const a = routine({ commitments: [work], restDays: [0], activities: [{ id: 'l', name: 'Leitura', timesPerWeek: 1, durationMin: 30, period: 'any', priority: 'medium' }] })
    const { blocks, rejected } = mergeProposal(a, [
      { id: 'a', day: 1, start: '10:00', end: '10:30', title: 'Leitura', kind: 'activity', fixed: false }, // em cima do trabalho
      { id: 'b', day: 1, start: '20:00', end: '20:30', title: 'Leitura', kind: 'activity', fixed: false }, // ok
      { id: 'c', day: 2, start: '20:00', end: '20:30', title: 'Leitura', kind: 'activity', fixed: false }, // passa de 1×
      { id: 'd', day: 0, start: '10:00', end: '10:30', title: 'Corrida', kind: 'activity', fixed: false }, // descanso
      { id: 'e', day: 3, start: '05:00', end: '05:30', title: 'Corrida', kind: 'activity', fixed: false }, // antes de acordar
      { id: 'w-1a', day: 1, start: '09:00', end: '10:00', title: 'Trabalho', kind: 'work', fixed: true }, // fixo vindo da IA: ignorado
    ])
    expect(rejected).toHaveLength(4)
    expect(blocks.filter((b) => !b.fixed).map((b) => b.id)).toEqual(['b'])
    expect(blocks.filter((b) => b.fixed)).toEqual(fixedBlocks(a))
    expect(findConflicts(blocks, a)).toEqual([])
  })
})

describe('alimentação', () => {
  const answers = { ...emptyMealAnswers(), allergies: ['peanut', 'milk'], restrictions: ['nopork'], dislikes: 'jiló, fígado' }
  it('bloqueia alérgenos, restrições e alimentos recusados, inclusive nas substituições', () => {
    const out = sanitizeMealPlan(
      {
        meals: [{ id: 'm', day: 1, time: '07:30', label: 'Café', items: ['Pão com manteiga de amendoim', 'Iogurte natural', 'Banana', 'Leite de coco'], substitutions: ['Trocar banana por paçoca', 'Trocar por mamão'] }],
        shopping: [{ item: 'Bacon', qty: '200 g', checked: false }, { item: 'Aveia', qty: '1 kg', checked: false }, { item: 'Jiló', qty: '', checked: false }],
        notes: 'Faça jejum de 16 horas\nBeba água',
      },
      answers,
    )
    expect(out.meals[0].items).toEqual(['Banana', 'Leite de coco'])
    expect(out.meals[0].substitutions).toEqual(['Trocar por mamão'])
    expect(out.shopping.map((s) => s.item)).toEqual(['Aveia'])
    expect(out.notes).toBe('Beba água')
    expect(out.removed.length).toBe(6)
  })
  it('exceções evitam falsos positivos óbvios sem liberar o alérgeno', () => {
    const rules = activeRules({ ...emptyMealAnswers(), allergies: ['milk'] })
    expect(violations('Leite de amêndoas', rules)).toHaveLength(0)
    expect(violations('Queijo minas', rules)).toHaveLength(1)
    const lactose = activeRules({ ...emptyMealAnswers(), intolerances: ['lactose'] })
    expect(violations('Iogurte sem lactose', lactose)).toHaveLength(0)
    // para alergia ao leite, "sem lactose" NÃO libera (a proteína continua lá)
    expect(violations('Iogurte sem lactose', rules)).toHaveLength(1)
  })
})
