import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { challengeState, CHALLENGE_TEMPLATES, FINANCE_NOSPEND } from '../src/core/challenges'
import { completionId } from '../src/core/completions'
import { financeIndex, monthForecast, monthSummary, topCategory, totalsBetween, weekMoney } from '../src/core/finance'
import { categoryLabel, fixedCategoryIds, pickableCategories } from '../src/core/financeCategories'
import { goalPlan, savedBetween, savedOn, startHistory, withSaved } from '../src/core/financeGoals'
import { forecastText, monthComparisonText, weekMoneySentences } from '../src/core/financeText'
import { METRICS_VERSION, metricValue, weekMetrics } from '../src/core/metrics'
import { buildSnapshot } from '../src/core/snapshots'
import { goalProgress } from '../src/core/weekGoals'
import { withExtras } from '../src/data/store'
import type { Challenge, DataState, FinanceGoal, Settings, Tool, Transaction, WeeklyGoal } from '../src/data/types'

const empty = (): DataState => ({ transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [], inbox: [], habits: [], recurring: [], completions: [], events: [], focusSessions: [], weeklyGoals: [], challenges: [], weekCheckins: [], weekSnapshots: [], financeGoals: [], lifePlans: [], planSteps: [] })
const settings = { onboarded: true, baseCurrency: 'BRL', initialBalance: 100000, startedAt: '2026-07-01T12:00:00Z', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'America/Sao_Paulo', modules: { finance: true } } as Settings
let seq = 0
/** Movement registered at `at` (UTC instant). amount in cents, base currency unless said otherwise. */
const tx = (type: Transaction['type'], amount: number, at: string, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${++seq}`,
  createdAt: at,
  updatedAt: at,
  type,
  amount,
  currency: 'BRL',
  baseAmount: type === 'out' ? -amount : amount,
  reason: 'x',
  ...extra,
})
// Thursday 1 Oct 2026, 15:00 in São Paulo. Week: Mon 28/9 → Sun 4/10.
const NOW = new Date('2026-10-01T18:00:00Z')
const WEEK = '2026-09-28'
const noon = (date: string) => `${date}T15:00:00Z` // 12:00 in São Paulo

describe('categorias (opcionais)', () => {
  it('movimentação sem categoria continua válida e aparece como "Sem categoria"', () => {
    const d = empty()
    d.transactions = [tx('out', 5000, noon('2026-09-28')), tx('out', 3000, noon('2026-09-29'), { category: 'food' })]
    const t = totalsBetween(financeIndex(d.transactions, settings), '2026-09-28', '2026-10-04')
    expect(t.expense).toBe(8000)
    expect(t.byCategory).toEqual({ '': 5000, food: 3000 })
    expect(categoryLabel(settings, undefined)).toBe('Sem categoria')
    // "Sem categoria" nunca é chamada de maior categoria
    expect(topCategory(t)).toEqual({ category: 'food', amount: 3000 })
  })

  it('salvar sem categoria não cria o campo; limpar remove; desnecessário só em saídas', () => {
    const old = tx('out', 1000, noon('2026-09-01'))
    expect('category' in withExtras({ ...old }, 'out', {})).toBe(false)
    expect('unnecessary' in withExtras({ ...old }, 'out', {})).toBe(false)
    const set = withExtras({ ...old }, 'out', { category: 'food', unnecessary: true })
    expect(set).toMatchObject({ category: 'food', unnecessary: true })
    const cleared = withExtras(set, 'out', { category: null, unnecessary: false })
    expect('category' in cleared || 'unnecessary' in cleared).toBe(false)
    expect('unnecessary' in withExtras(tx('in', 1, noon('2026-09-01')), 'in', { unnecessary: true })).toBe(false)
    expect('category' in withExtras(tx('adjust', 1, noon('2026-09-01')), 'adjust', { category: 'food' })).toBe(false)
  })

  it('personalizadas e ocultas: ocultar não some com a categoria de quem já usa', () => {
    const s = { ...settings, financeCategories: { custom: [{ id: 'c-pets', label: 'Pets', type: 'out' as const }], hidden: ['travel'] } }
    const ids = pickableCategories(s, 'out').map((c) => c.id)
    expect(ids).toContain('c-pets')
    expect(ids).not.toContain('travel')
    expect(pickableCategories(s, 'out', 'travel').map((c) => c.id)).toContain('travel')
    expect(categoryLabel(s, 'travel')).toBe('Viagem')
    expect([...fixedCategoryIds(s)].sort()).toEqual(['bills', 'housing', 'subscriptions'])
  })
})

describe('fuso horário', () => {
  it('movimentação perto da meia-noite pertence ao dia do fuso escolhido', () => {
    const d = empty()
    d.transactions = [tx('out', 2000, '2026-10-05T02:30:00Z')] // dom 4/out 23:30 em SP; seg 5/out em Dubai
    expect(totalsBetween(financeIndex(d.transactions, settings), '2026-09-28', '2026-10-04').expense).toBe(2000)
    expect(totalsBetween(financeIndex(d.transactions, { ...settings, timeZone: 'Asia/Dubai' }), '2026-09-28', '2026-10-04').expense).toBe(0)
  })
})

describe('revisão semanal', () => {
  const data = () => {
    const d = empty()
    d.transactions = [
      tx('in', 300000, noon('2026-09-28'), { category: 'salary' }),
      tx('out', 18000, noon('2026-09-28'), { category: 'food' }),
      tx('out', 12000, noon('2026-09-30'), { category: 'transport' }),
      tx('out', 4000, noon('2026-10-01'), { category: 'leisure', unnecessary: true }),
      tx('adjust', 50000, noon('2026-09-29')), // ajuste: muda o saldo, não é entrada
      // semana anterior: seg a qui somam 40.000; sex 20.000 (fora da comparação "mesmos dias")
      tx('out', 40000, noon('2026-09-22'), { category: 'food' }),
      tx('out', 20000, noon('2026-09-25')),
    ]
    return d
  }

  it('totais, maior categoria, média por dia e gastos desnecessários', () => {
    const w = weekMoney(data(), settings, WEEK, NOW)
    expect(w.totals).toMatchObject({ income: 300000, expense: 34000, net: 266000, count: 4, unnecessaryCount: 1, unnecessaryAmount: 4000 })
    expect(w.top).toEqual({ category: 'food', amount: 18000 })
    expect(w.daysElapsed).toBe(4)
    expect(w.dailyAverage).toBe(8500)
  })

  it('comparação com a semana anterior usa os mesmos dias (seg → qui)', () => {
    const w = weekMoney(data(), settings, WEEK, NOW)
    expect(w.previous?.expense).toBe(40000)
    expect(w.expenseDiff).toBe(-6000)
    const s = weekMoneySentences({ current: true, income: 300000, expense: 34000, net: 266000, count: 4, dailyAverage: 8500, top: { label: 'Alimentação', amount: 18000 }, expenseDiff: -6000, unnecessaryCount: 1, unnecessaryAmount: 4000, saved: null }, 'BRL')
    expect(s).toContain('Você gastou R$ 340,00 esta semana, até agora.')
    expect(s).toContain('Seu maior gasto foi Alimentação: R$ 180,00.')
    expect(s).toContain('Você gastou R$ 60,00 menos que na semana anterior (mesmos dias).')
    expect(s.join(' ')).not.toMatch(/errad|ruim|exager|culpa/i)
  })

  it('sem dados: nada inventado', () => {
    const w = weekMoney(empty(), settings, WEEK, NOW)
    expect(w.totals.count).toBe(0)
    expect(w.expenseDiff).toBeNull()
    expect(weekMoneySentences({ current: true, income: 0, expense: 0, net: 0, count: 0, dailyAverage: 0, top: null, expenseDiff: null, unnecessaryCount: 0, unnecessaryAmount: 0, saved: null }, 'BRL')).toEqual([])
  })

  it('métricas da semana e foto (v2) guardam os números financeiros novos', () => {
    const d = data()
    const m = weekMetrics(d, settings, WEEK, NOW)
    expect(m.finance).toMatchObject({ income: 300000, expense: 34000, count: 4, unnecessaryCount: 1, top: { category: 'food', amount: 18000 } })
    expect(METRICS_VERSION).toBeGreaterThanOrEqual(2)
    const snap = buildSnapshot(d, settings, WEEK, new Date('2026-10-06T12:00:00Z'))
    expect(snap.metricsVersion).toBe(METRICS_VERSION)
    expect(snap.metrics['finance.unnecessaryCount']).toBe(1)
    expect(snap.metrics['finance.count']).toBe(4)
    expect(snap.financeTop).toEqual({ category: 'food', amount: 18000 })
  })
})

describe('moedas diferentes', () => {
  it('usa o valor convertido no registro (não mistura nem reconverte) e avisa quantas são de outra moeda', () => {
    const d = empty()
    d.transactions = [tx('out', 1000, noon('2026-09-28'), { currency: 'USD', amount: 1000, baseAmount: -5400 }), tx('out', 2000, noon('2026-09-29'))]
    const t = totalsBetween(financeIndex(d.transactions, settings), WEEK, '2026-10-04')
    expect(t.expense).toBe(7400)
    expect(t.otherCurrency).toBe(1)
  })

  it('metas em outra moeda não entram no "Guardar" (que usa a moeda de registro)', () => {
    const usd: FinanceGoal = goal({ currency: 'USD', history: [{ date: '2026-09-01', saved: 0 }, { date: '2026-09-29', saved: 50000 }] })
    expect(savedBetween([usd], 'BRL', WEEK, '2026-10-04')).toBeNull()
    expect(savedBetween([usd], 'USD', WEEK, '2026-10-04')).toBe(50000)
  })
})

function goal(p: Partial<FinanceGoal> = {}): FinanceGoal {
  return { id: `g${++seq}`, createdAt: '2026-09-01T12:00:00Z', updatedAt: '', name: 'Reserva', target: 500000, saved: 200000, deadline: '2026-12-31', currency: 'BRL', note: '', status: 'active', history: [{ date: '2026-09-01', saved: 200000 }], ...p }
}

describe('metas financeiras com prazo', () => {
  it('quanto falta, porcentagem e quanto seria necessário por mês e por semana', () => {
    const g = goal({ saved: 200000, target: 500000, deadline: '2027-01-01', history: [{ date: '2026-10-01', saved: 200000 }] })
    const p = goalPlan(g, '2026-10-01') // 92 dias ≈ 3 meses
    expect(p.missing).toBe(300000)
    expect(p.percent).toBe(40)
    expect(p.perMonth).toBeGreaterThanOrEqual(99000)
    expect(p.perMonth).toBeLessThanOrEqual(101000)
    expect(p.perWeek).toBe(Math.ceil(300000 / (92 / 7)))
    expect(p.onPace).toBeNull() // recém-criada: cedo para dizer
  })

  it('menos de um mês: só por semana; prazo chegou; meta alcançada', () => {
    expect(goalPlan(goal({ deadline: '2026-10-15' }), '2026-10-01')).toMatchObject({ perMonth: null, perWeek: 150000 })
    expect(goalPlan(goal({ deadline: '2026-10-01' }), '2026-10-01')).toMatchObject({ due: true, perMonth: null, perWeek: null })
    expect(goalPlan(goal({ saved: 500000 }), '2026-10-01')).toMatchObject({ reached: true, missing: 0, percent: 100 })
  })

  it('ritmo: compara com a linha reta entre o início e o prazo', () => {
    const base = { target: 400000, deadline: '2026-12-30', history: [{ date: '2026-09-01', saved: 0 }] }
    // 30 de 120 dias passados → esperado ≈ 100.000
    expect(goalPlan(goal({ ...base, saved: 120000 }), '2026-10-01').onPace).toBe(true)
    expect(goalPlan(goal({ ...base, saved: 50000 }), '2026-10-01').onPace).toBe(false)
  })

  it('histórico: um ponto por dia; valor inicial é ponto de partida, não "guardado na semana"', () => {
    let h = withSaved(null, 200000, '2026-09-29') // criada na terça com R$ 2.000
    h = withSaved({ history: h }, 230000, '2026-09-30')
    h = withSaved({ history: h }, 250000, '2026-09-30') // mesmo dia: substitui
    h = withSaved({ history: h }, 240000, '2026-10-01') // retirada
    expect(h).toEqual([{ date: '2026-09-29', saved: 200000 }, { date: '2026-09-30', saved: 250000 }, { date: '2026-10-01', saved: 240000 }])
    const g = goal({ saved: 240000, history: h })
    expect(savedOn(g, '2026-09-20')).toBe(200000)
    expect(savedBetween([g], 'BRL', WEEK, '2026-10-04')).toBe(40000)
    expect(savedBetween([g], 'BRL', WEEK, '2026-09-30')).toBe(50000)
  })

  it('dinheiro guardado no mesmo dia em que a meta foi criada conta como guardado', () => {
    const h = withSaved({ history: startHistory(200000, '2026-09-28') }, 230000, '2026-09-28')
    expect(savedBetween([goal({ saved: 230000, history: h })], 'BRL', WEEK, '2026-10-04')).toBe(30000)
  })

  it('meta semanal "Guardar R$ X" usa o que foi registrado como guardado (não entradas − saídas)', () => {
    const d = empty()
    d.transactions = [tx('in', 500000, noon('2026-09-28'))] // salário não é "economizado"
    d.financeGoals = [goal({ saved: 250000, history: [{ date: '2026-09-01', saved: 200000 }, { date: '2026-09-29', saved: 250000 }] })]
    const m = weekMetrics(d, settings, WEEK, NOW)
    expect(metricValue(m, 'finance.saved')).toBe(50000)
    expect(metricValue(m, 'finance.net')).toBe(500000)
    const wg: WeeklyGoal = { id: 'w', createdAt: '', updatedAt: '', week: WEEK, title: 'Guardar R$ 200', kind: 'money', metric: 'finance.saved', target: 20000, manualValue: 0, status: 'active', repeatKey: 'k' }
    expect(goalProgress(wg, m)).toMatchObject({ value: 50000, achieved: true, auto: true })
    // sem metas com prazo: sem dado (não vira zero nem usa o saldo)
    const none = weekMetrics({ ...d, financeGoals: [] }, settings, WEEK, NOW)
    expect(goalProgress(wg, none)).toMatchObject({ noData: true, achieved: false })
  })
})

describe('resumo mensal e comparação', () => {
  const data = () => {
    const d = empty()
    d.transactions = [
      tx('in', 450000, noon('2026-08-05')),
      tx('out', 120000, noon('2026-08-05'), { category: 'housing' }),
      tx('out', 80000, noon('2026-08-20'), { category: 'food' }),
      tx('in', 450000, noon('2026-09-05'), { category: 'salary' }),
      tx('out', 120000, noon('2026-09-05'), { category: 'housing' }),
      tx('out', 60000, noon('2026-09-10'), { category: 'food' }),
      tx('out', 4000, noon('2026-09-12'), { category: 'leisure', unnecessary: true }),
      tx('out', 20000, noon('2026-09-25'), { category: 'food' }),
      tx('adjust', -1000, noon('2026-09-26')),
      tx('out', 30000, noon('2026-10-03'), { category: 'food' }),
    ]
    return d
  }

  it('mês fechado: saldo inicial, entradas, saídas, resultado, categorias e comparação com o mês inteiro anterior', () => {
    const s = monthSummary(data(), settings, '2026-09', new Date('2026-10-15T15:00:00Z'))
    expect(s.inProgress).toBe(false)
    expect(s.opening).toBe(100000 + 450000 - 200000)
    expect(s.totals).toMatchObject({ income: 450000, expense: 204000, net: 246000, unnecessaryCount: 1 })
    expect(s.closing).toBe(s.opening + 246000 - 1000) // o ajuste muda o saldo, não as saídas
    expect(s.categories[0]).toEqual({ category: 'housing', amount: 120000 })
    expect(s.comparison).toMatchObject({ partial: false, expenseChangePct: 2 })
    expect(monthComparisonText(s, 'BRL')).toBe('Você gastou 2% mais que em agosto.')
  })

  it('mês parcial compara com o mesmo período do mês anterior e diz isso', () => {
    const s = monthSummary(data(), settings, '2026-10', new Date('2026-10-14T15:00:00Z'))
    expect(s.inProgress).toBe(true)
    expect(s.comparison).toMatchObject({ partial: true, uptoDay: 14 })
    expect(s.comparison?.previous.expense).toBe(184000) // 1 a 14 de setembro
    expect(monthComparisonText(s, 'BRL')).toBe('Até o dia 14 deste mês, seus gastos estão 84% abaixo do mesmo período de setembro.')
  })

  it('sem comparação quando o app começou a ser usado no meio do mês anterior', () => {
    const s = monthSummary(data(), { ...settings, startedAt: '2026-08-15T12:00:00Z' }, '2026-09', new Date('2026-10-15T15:00:00Z'))
    expect(s.comparison).toBeNull()
    expect(monthComparisonText(s, 'BRL')).toMatch(/começou a usar o NÚCLEO depois do início de agosto/)
  })
})

describe('previsão do fim do mês', () => {
  it('poucos dados: não mostra previsão', () => {
    const d = empty()
    d.transactions = [tx('out', 5000, noon('2026-10-01')), tx('out', 5000, noon('2026-10-02'))]
    const f = monthForecast(d, settings, new Date('2026-10-03T15:00:00Z'))
    expect(f.ready).toBe(false)
    expect(forecastText(f, 'BRL').title).toBe('Ainda não há dados suficientes para uma previsão confiável.')
  })

  it('estimativa = saldo − ritmo variável × dias restantes − cobranças previstas; fixos não são projetados', () => {
    const d = empty()
    d.transactions = [
      tx('in', 400000, noon('2026-10-01')),
      tx('out', 150000, noon('2026-10-01'), { category: 'housing' }), // fixo: não vira ritmo diário
      ...[2, 4, 6, 8, 10].map((day) => tx('out', 10000, noon(`2026-10-${String(day).padStart(2, '0')}`), { category: 'food' })),
    ]
    d.tools = [
      { id: 'tl', createdAt: '', updatedAt: '', name: 'Editor', link: '', plan: '', price: 5000, currency: 'BRL', billing: 'monthly', nextCharge: '2026-10-20', notes: '', status: 'active' },
      { id: 'tu', createdAt: '', updatedAt: '', name: 'Hosting', link: '', plan: '', price: 1000, currency: 'USD', billing: 'monthly', nextCharge: '2026-10-25', notes: '', status: 'active' },
    ] as Tool[]
    const f = monthForecast(d, settings, new Date('2026-10-10T15:00:00Z'))
    expect(f.ready).toBe(true)
    if (!f.ready) return
    // saldo: 100.000 + 400.000 − 150.000 − 50.000 = 300.000; variável 50.000 em 10 dias = 5.000/dia; 21 dias restantes
    expect(f.balance).toBe(300000)
    expect(f.dailyVariable).toBe(5000)
    expect(f.daysLeft).toBe(21)
    expect(f.upcoming).toBe(5000)
    expect(f.upcomingOther).toHaveLength(1)
    expect(f.estimate).toBe(300000 - 5000 * 21 - 5000)
    const text = forecastText(f, 'BRL')
    expect(text.title).toMatch(/estimativa de saldo no fim do mês é de aproximadamente R\$ 1\.900,00/)
    expect(text.detail).toMatch(/Estimativa com base/)
  })

  it('começou a usar no meio do mês: conta os dias desde o início do uso', () => {
    const d = empty()
    d.transactions = [2, 3, 4, 5, 6].map((n) => tx('out', 1000, noon(`2026-10-${String(n + 10).padStart(2, '0')}`)))
    const s = { ...settings, startedAt: '2026-10-12T12:00:00Z' }
    expect(monthForecast(d, s, new Date('2026-10-16T15:00:00Z')).ready).toBe(false) // 5 dias de uso
    expect(monthForecast(d, s, new Date('2026-10-18T15:00:00Z')).ready).toBe(true) // 7 dias
  })
})

describe('desafio "sem gasto desnecessário"', () => {
  const ch = (rule: string): Challenge => ({ id: 'c1', createdAt: '', updatedAt: '', template: 'nospend7', name: 'x', objective: '', mode: 'daily', rule, target: 7, startDate: WEEK, durationDays: 7, endedAt: null })

  it('usa a marcação real; dia sem registro fica neutro (não conta sozinho)', () => {
    const d = empty()
    d.transactions = [
      tx('out', 1000, noon('2026-09-28')), // seg: saída normal → conta
      tx('out', 2000, noon('2026-09-29'), { unnecessary: true }), // ter: desnecessário → não conta
      tx('in', 9000, noon('2026-09-30')), // qua: só entrada → sem registro de saída
    ]
    // ter marcado à mão, mas o registro real prevalece; qui sem nada, confirmado à mão → conta
    d.completions = ['2026-09-29', '2026-10-01'].map((date) => ({ id: completionId('challenge', 'c1', date), createdAt: '', updatedAt: '', source: 'challenge' as const, sourceId: 'c1', date, status: 'done' as const }))
    const s = challengeState(ch(FINANCE_NOSPEND), d, settings, NOW)
    const day = (date: string) => s.days.find((x) => x.date === date)!
    expect(day('2026-09-28')).toMatchObject({ met: true, noData: false })
    expect(day('2026-09-29')).toMatchObject({ met: false, unnecessary: 1 })
    expect(day('2026-09-30')).toMatchObject({ met: false, noData: true })
    expect(day('2026-10-01')).toMatchObject({ met: true, noData: false })
    expect(s.value).toBe(2)
  })

  it('o modelo novo usa os dados reais; desafios manuais antigos continuam manuais', () => {
    expect(CHALLENGE_TEMPLATES.find((t) => t.id === 'nospend7')?.rule).toBe(FINANCE_NOSPEND)
    const d = empty()
    d.transactions = [tx('out', 1000, noon('2026-09-28'))]
    expect(challengeState(ch('manual'), d, settings, NOW).value).toBe(0)
  })
})

describe('desempenho e privacidade', () => {
  it('agrupamento por dia é calculado uma vez por lista', () => {
    const list = [tx('out', 1000, noon('2026-09-28'))]
    expect(financeIndex(list, settings)).toBe(financeIndex(list, settings))
    expect(financeIndex([...list], settings)).not.toBe(financeIndex(list, settings))
  })

  it('nenhum valor financeiro vai para console nos arquivos de finanças', () => {
    const files = ['src/core/finance.ts', 'src/core/financeGoals.ts', 'src/core/financeText.ts', 'src/core/financeCategories.ts', 'src/features/finance/FinanceGoals.tsx', 'src/features/finance/MonthView.tsx', 'src/features/finance/CategoriesSheet.tsx', 'src/features/finance/TransactionSheet.tsx', 'src/features/week/MoneyCard.tsx']
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/console\.(log|info|debug|warn|error)/)
  })
})
