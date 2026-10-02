import { describe, expect, it } from 'vitest'
import { buildAgenda } from '../src/core/agenda'
import { mealsMorningLine, mealsNightLine, planDay } from '../src/core/day'
import { calendarMonth } from '../src/core/lifeCalendar'
import { copyWeek, duplicateTo, foodSafetyProblem, fromTemplate, mealCounts, mealTypes, mealTitle, sortMeals, weeksWithMeals } from '../src/core/meals'
import { metricValue, weekMetrics } from '../src/core/metrics'
import { computeScore } from '../src/core/score'
import { buildSnapshot } from '../src/core/snapshots'
import { autoId, buildList, consolidate, formatAmounts, groupRows, guessCategory, keysOnList, normalizeName, parseIngredient } from '../src/core/shopping'
import { emptyMealAnswers } from '../supabase/functions/_shared/planner/foodSafety.ts'
import { DEFAULT_REMINDERS, buildOccurrences } from '../src/features/reminders/engine'
import type { DataState, MealEntry, MealPlan, Settings, ShoppingEntry } from '../src/data/types'

const empty = (): DataState => ({ transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [], inbox: [], habits: [], recurring: [], completions: [], events: [], focusSessions: [], weeklyGoals: [], challenges: [], weekCheckins: [], weekSnapshots: [], financeGoals: [], lifePlans: [], planSteps: [], meals: [], shoppingItems: [] })
const settings = { onboarded: true, baseCurrency: 'BRL', initialBalance: 0, startedAt: '2026-07-01T12:00:00Z', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'America/Sao_Paulo', modules: { meals: true, tasks: true, habits: true, week: true, agenda: true, life: true } } as Settings
const e = { createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z' }
// Quarta 7/out/2026, 10:00 em São Paulo. Semana: seg 5/out → dom 11/out.
const NOW = new Date('2026-10-07T13:00:00Z')
const WEEK = '2026-10-05'
let seq = 0
const meal = (p: Partial<MealEntry>): MealEntry => ({ ...e, id: `m${++seq}`, date: '2026-10-05', type: 'lunch', name: '', time: '', description: '', ingredients: [], notes: '', done: false, doneAt: null, ...p })
const template: MealPlan = { id: 'meals-current', createdAt: '2026-09-01T12:00:00Z', updatedAt: '', status: 'approved', source: 'ai', notes: '', removed: [], shopping: [{ item: 'Banana', qty: '6', checked: false }], meals: [{ id: 't1', day: 1, time: '12:30', label: 'Almoço', items: ['Arroz', 'Frango'], substitutions: [] }, { id: 't2', day: 3, time: '07:30', label: 'Café da manhã', items: ['Ovos'], substitutions: [] }] }

describe('refeições com data real', () => {
  it('tipos padrão, personalizados e ordem; título cai no tipo quando não há nome', () => {
    expect(mealTypes({}).map((t) => t.label)).toEqual(['Café da manhã', 'Lanche da manhã', 'Almoço', 'Lanche da tarde', 'Jantar', 'Ceia'])
    const s = { mealTypes: [{ id: 'dinner', label: 'Janta', active: true }, { id: 'c-pre', label: 'Pré-treino', active: true }, { id: 'supper', label: 'Ceia', active: false }] }
    expect(mealTypes(s).map((t) => t.id).slice(0, 3)).toEqual(['dinner', 'c-pre', 'supper'])
    expect(mealTitle(s, meal({ type: 'dinner' }))).toBe('Janta')
    expect(mealTitle(s, meal({ type: 'dinner', name: 'Sopa' }))).toBe('Sopa')
  })

  it('segunda 05/10 e segunda 12/10 são refeições diferentes; ordem por dia, horário e tipo', () => {
    const list = sortMeals([meal({ date: '2026-10-12', time: '12:00' }), meal({ date: '2026-10-05', type: 'dinner' }), meal({ date: '2026-10-05', time: '07:30', type: 'breakfast' })], settings)
    expect(list.map((m) => [m.date, m.type])).toEqual([['2026-10-05', 'breakfast'], ['2026-10-05', 'dinner'], ['2026-10-12', 'lunch']])
  })

  it('copiar semana cria novas refeições nos mesmos dias, sem copiar "realizada", sem mexer na antiga', () => {
    const old = [meal({ date: '2026-09-28', name: 'Ovos', done: true, doneAt: '2026-09-28T10:00:00Z', ingredients: ['2 ovos'] }), meal({ date: '2026-10-04', type: 'dinner' })]
    const copy = copyWeek(old, '2026-09-28', WEEK)
    expect(copy.map((m) => m.date)).toEqual(['2026-10-05', '2026-10-11'])
    expect(copy.every((m) => !m.done && m.doneAt === null && !('id' in m))).toBe(true)
    expect(old[0].done).toBe(true)
    copy[0].ingredients.push('x')
    expect(old[0].ingredients).toEqual(['2 ovos'])
  })

  it('duplicar para outros dias e usar o plano da IA numa semana (explícito)', () => {
    const m = meal({ date: '2026-10-05', name: 'Salada', done: true })
    expect(duplicateTo(m, ['2026-10-05', '2026-10-06', '2026-10-07']).map((x) => [x.date, x.done])).toEqual([['2026-10-06', false], ['2026-10-07', false]])
    const fromAi = fromTemplate(template, WEEK, settings)
    expect(fromAi.map((x) => [x.date, x.type, x.time, x.ingredients.join('+')])).toEqual([['2026-10-05', 'lunch', '12:30', 'Arroz+Frango'], ['2026-10-07', 'breakfast', '07:30', 'Ovos']])
  })

  it('a mesma verificação de alergias do plano vale para refeições novas', () => {
    expect(foodSafetyProblem(['Pão com amendoim'], { ...emptyMealAnswers(), allergies: ['peanut'] })).toMatch(/não combina/)
    expect(foodSafetyProblem(['Arroz'], emptyMealAnswers())).toBeNull()
  })
})

describe('Agenda, Calendário, Manhã e Noite', () => {
  it('semana com refeições reais usa só elas; outras semanas continuam com o modelo da IA', () => {
    const d = empty()
    d.mealPlans = [template]
    d.meals = [meal({ date: '2026-10-05', time: '12:00', name: 'Feijoada' })]
    const items = buildAgenda(d, settings, '2026-10-05', '2026-10-18', NOW).filter((i) => i.kind === 'meal')
    expect(items.filter((i) => i.date <= '2026-10-11').map((i) => [i.date, i.title, i.source.kind])).toEqual([['2026-10-05', 'Feijoada', 'mealEntry']])
    expect(items.filter((i) => i.date >= '2026-10-12').map((i) => [i.date, i.title, i.source.kind])).toEqual([['2026-10-12', 'Almoço', 'meal'], ['2026-10-14', 'Café da manhã', 'meal']])
    const real = items[0]
    expect(real).toMatchObject({ checkable: false, markable: true })
    expect((real.source as { meal: MealEntry }).meal).toBe(d.meals[0]) // o registro original, sem cópia
  })

  it('refeição não entra em "itens concluídos" nem no Score; tem contagem própria', () => {
    const d = empty()
    d.tasks = [{ ...e, id: 't', title: 'x', projectId: null, dueDate: '2026-10-05', priority: 'none', status: 'done', completedAt: '2026-10-05T15:00:00Z' }]
    const before = weekMetrics(d, settings, WEEK, NOW)
    d.meals = [meal({ date: '2026-10-05', done: true }), meal({ date: '2026-10-05', type: 'dinner' }), meal({ date: '2026-10-06' })]
    const after = weekMetrics(d, settings, WEEK, NOW)
    expect(after.items).toEqual(before.items)
    expect(computeScore(after, [])).toEqual(computeScore(before, []))
    expect(after.meals).toEqual({ planned: 3, done: 1, days: 2 })
    expect(metricValue(after, 'items.done')).toBe(1)
    const snap = buildSnapshot(d, settings, WEEK, new Date('2026-10-13T12:00:00Z'))
    expect(snap.metrics).toMatchObject({ 'meals.planned': 3, 'meals.done': 1, 'meals.days': 2 })
    expect(mealCounts(d.meals, '2026-10-06', '2026-10-06')).toEqual({ planned: 1, done: 0, days: 1 })
  })

  it('Modo Manhã mostra quantas e a próxima; Noite mostra quantas foram marcadas, sem julgamento', () => {
    const d = empty()
    d.meals = [meal({ date: '2026-10-07', time: '07:30', type: 'breakfast', done: true }), meal({ date: '2026-10-07', time: '12:30', type: 'lunch' }), meal({ date: '2026-10-07', time: '19:30', type: 'dinner' })]
    const plan = planDay(d, settings, NOW)
    expect(mealsMorningLine(plan)).toBe('Hoje você tem 3 refeições planejadas · próxima: 12:30 Almoço.')
    expect(mealsNightLine(plan)).toBe('1 de 3 refeições planejadas foram marcadas como realizadas.')
    expect(plan.counts.total).toBe(0) // não viram "itens" do dia
    expect(mealsMorningLine(planDay(empty(), settings, NOW))).toBeNull()
  })

  it('Calendário de Vida mostra a refeição original no dia; fuso decide o "hoje"', () => {
    const d = empty()
    d.meals = [meal({ date: '2026-10-08', name: 'Peixe' })]
    const cal = calendarMonth(d, settings, '2026-10', NOW)
    expect(cal.items.get('2026-10-08')!.map((i) => i.title)).toEqual(['Peixe'])
    // 23:30 de quarta em SP já é quinta em Dubai: a próxima refeição muda conforme o fuso
    const late = new Date('2026-10-08T02:30:00Z')
    d.meals.push(meal({ date: '2026-10-07', type: 'supper', time: '23:00' }))
    expect(planDay(d, settings, late).date).toBe('2026-10-07')
    expect(planDay(d, { ...settings, timeZone: 'Asia/Dubai' }, late).date).toBe('2026-10-08')
  })

  it('lembretes: semana com refeições reais não repete as do modelo; só o tipo aparece', () => {
    const s = { ...settings, modules: { ...settings.modules, routine: true }, reminders: { showDetails: true, rules: Object.fromEntries(Object.entries(DEFAULT_REMINDERS.rules).map(([k, r]) => [k, { ...r, enabled: k === 'meals' }])) } } as Settings
    const d = empty()
    d.mealPlans = [template]
    d.meals = [meal({ date: '2026-10-08', time: '13:00', type: 'lunch', name: 'Frango com salada' })]
    const occ = buildOccurrences(d, s, { now: NOW, days: 14 }).filter((o) => o.kind === 'meals')
    const thisWeek = occ.filter((o) => o.key.includes('2026-10-0') || o.key.includes('2026-10-10') || o.key.includes('2026-10-11'))
    expect(thisWeek.map((o) => o.key.split(':')[0])).toEqual(['mealEntry'])
    expect(occ.some((o) => o.key.startsWith('meal:t1:2026-10-12'))).toBe(true)
    expect(occ.map((o) => `${o.title} ${o.body}`).join(' ')).not.toMatch(/Frango|salada/)
  })
})

describe('ingredientes', () => {
  it('lê quantidade e unidade só quando existem — nunca inventa', () => {
    expect(parseIngredient('200g de frango')).toMatchObject({ key: 'frango', qty: 200, unit: 'g' })
    expect(parseIngredient('1 kg arroz')).toMatchObject({ key: 'arroz', qty: 1000, unit: 'g' })
    expect(parseIngredient('2 ovos')).toMatchObject({ key: 'ovos', qty: 2, unit: 'un' })
    expect(parseIngredient('Frango 300 g')).toMatchObject({ key: 'frango', qty: 300, unit: 'g' })
    expect(parseIngredient('1/2 mamão')).toMatchObject({ key: 'mamao', qty: 0.5, unit: 'un' })
    expect(parseIngredient('1 colher de sopa de azeite')).toMatchObject({ key: 'azeite', qty: 1, unit: 'colher de sopa' })
    expect(parseIngredient('Frango')).toMatchObject({ key: 'frango', qty: null, unit: null })
  })

  it('consolida iguais (maiúsculas/acentos), soma unidades compatíveis e não mistura incompatíveis', () => {
    const list = consolidate([meal({ ingredients: ['200g de frango', 'Tomate', '1 kg arroz', 'Pão'] }), meal({ ingredients: ['200 g frango', 'tomate', '2 un arroz', 'Frango', 'pao'] }), meal({ ingredients: ['Peito de frango 300g', 'Leite 1 l', '500 ml leite'] })])
    const by = Object.fromEntries(list.map((i) => [i.key, i]))
    expect(formatAmounts(by.frango)).toBe('400 g + 1 sem quantidade')
    expect(by.frango.meals).toBe(2)
    expect(formatAmounts(by.tomate)).toBe('')
    expect(formatAmounts(by.arroz)).toBe('1 kg + 2 un')
    expect(formatAmounts(by.leite)).toBe('1,5 l')
    expect(by['peito de frango']).toBeDefined() // não vira "frango"
    expect(by.pao.meals).toBe(2)
    expect(list.filter((i) => i.key === 'tomate')).toHaveLength(1)
  })

  it('categorias sugeridas por palavras (resto em "Outros")', () => {
    expect(guessCategory('bananas')).toBe('Frutas')
    expect(guessCategory('peito de frango')).toBe('Carnes')
    expect(guessCategory('arroz integral')).toBe('Grãos')
    expect(guessCategory('xyz')).toBe('Outros')
  })
})

describe('lista de compras', () => {
  const st = (p: Partial<ShoppingEntry>): ShoppingEntry => ({ ...e, id: `s${++seq}`, week: WEEK, kind: 'manual', name: '', qty: '', unit: '', category: 'Outros', checked: false, note: '', ...p })

  it('automática + manual; manual nunca é tocada; estado do automático preservado ao mudar a refeição', () => {
    const meals = [meal({ ingredients: ['3 bananas', '200 g frango'] })]
    const entries = [st({ name: 'Detergente', category: 'Higiene' }), st({ id: autoId(WEEK, 'bananas'), kind: 'auto', key: 'bananas', name: 'Bananas', checked: true }), st({ week: '2026-09-28', name: 'De outra semana' })]
    let rows = buildList(meals, entries, WEEK)
    expect(rows.map((r) => [r.kind, r.name, r.amount, r.checked])).toEqual([['auto', '3 bananas'.replace('3 ', '').replace(/^b/, 'B'), '3 un', true], ['auto', 'Frango', '200 g', false], ['manual', 'Detergente', '', false]])
    // refeição muda a quantidade: o item continua comprado, só a quantidade muda
    rows = buildList([meal({ ingredients: ['5 bananas', '200 g frango'] })], entries, WEEK)
    expect(rows.find((r) => r.name === 'Bananas')).toMatchObject({ amount: '5 un', checked: true })
    // banana sai das refeições: como já foi comprada, continua até "Limpar comprados"
    rows = buildList([meal({ ingredients: ['200 g frango'] })], entries, WEEK)
    expect(rows.find((r) => r.name === 'Bananas')).toMatchObject({ orphan: true, checked: true })
    expect(rows.some((r) => r.name === 'Detergente')).toBe(true)
  })

  it('limpar comprados esconde só os comprados (estado "cleared"), não os pendentes', () => {
    const meals = [meal({ ingredients: ['Banana', 'Arroz'] })]
    const entries = [st({ id: autoId(WEEK, 'banana'), kind: 'auto', key: 'banana', name: 'Banana', checked: true, cleared: true })]
    expect(buildList(meals, entries, WEEK).map((r) => r.name)).toEqual(['Arroz'])
  })

  it('id fixo do item automático: dois aparelhos marcando o mesmo item caem no mesmo registro', () => {
    expect(autoId(WEEK, normalizeName('Banana'))).toBe(autoId(WEEK, normalizeName('banana')))
  })

  it('agrupa por categoria (Outros por último) e pendentes antes de comprados; evita duplicatas ao copiar', () => {
    const rows = buildList([meal({ ingredients: ['Banana', 'Maçã', 'Arroz'] })], [st({ name: 'Pilhas' }), st({ name: 'Uva', category: 'Frutas', checked: true })], WEEK)
    const groups = groupRows(rows)
    expect(groups.map((g) => g.category)).toEqual(['Frutas', 'Grãos', 'Outros'])
    expect(groups[0].rows.map((r) => r.name)).toEqual(['Banana', 'Maçã', 'Uva'])
    expect(keysOnList(rows).has(normalizeName('banana'))).toBe(true)
  })

  it('semana sem refeições reais não gera itens automáticos (o modelo da IA tem a lista dele)', () => {
    expect(buildList([], [], WEEK)).toEqual([])
    expect(weeksWithMeals([meal({ date: '2026-10-11' })]).has(WEEK)).toBe(true)
  })
})
