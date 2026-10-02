import { describe, expect, it } from 'vitest'
import { computeChanges, periods } from '../src/core/changes'
import { completionId } from '../src/core/completions'
import { calendarMarks, calendarMonth, chargesBetween, dayIndicators, monthGrid } from '../src/core/lifeCalendar'
import { metricValue, weekMetrics } from '../src/core/metrics'
import { convertToProject, moveStep, nextOrder, planProgress, stepDone, stepsOf, suggestSteps } from '../src/core/plans'
import type { Completion, DataState, LifePlan, PlanStep, Settings, Task, Tool, Transaction } from '../src/data/types'

const empty = (): DataState => ({ transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [], inbox: [], habits: [], recurring: [], completions: [], events: [], focusSessions: [], weeklyGoals: [], challenges: [], weekCheckins: [], weekSnapshots: [], financeGoals: [], lifePlans: [], planSteps: [] })
const ALL = { tasks: true, agenda: true, habits: true, recurring: true, routine: true, finance: true, projects: true, tools: true, life: true, week: true }
const settings = { onboarded: true, baseCurrency: 'BRL', initialBalance: 0, startedAt: '2026-07-01T12:00:00Z', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'America/Sao_Paulo', modules: ALL } as Settings
const e = { createdAt: '2026-08-01T12:00:00Z', updatedAt: '2026-08-01T12:00:00Z' }
// Quinta 15/out/2026, 15:00 em São Paulo.
const NOW = new Date('2026-10-15T18:00:00Z')

const task = (id: string, p: Partial<Task> = {}): Task => ({ ...e, id, title: id, projectId: null, dueDate: '', priority: 'none', status: 'todo', completedAt: null, ...p })
const plan = (id: string, p: Partial<LifePlan> = {}): LifePlan => ({ ...e, id, kind: 'project', title: id, description: '', category: '', startDate: '', deadline: '', status: 'active', notes: '', ...p })
const step = (id: string, planId: string, order: number, p: Partial<PlanStep> = {}): PlanStep => ({ ...e, id, planId, title: id, deadline: '', status: 'todo', doneAt: null, order, notes: '', ...p })
const done = (source: Completion['source'], id: string, date: string): Completion => ({ ...e, id: completionId(source, id, date), source, sourceId: id, date, status: 'done' })

describe('Calendário de Vida', () => {
  it('mês correto: semanas de segunda a domingo cobrindo o mês', () => {
    const g = monthGrid('2026-10') // 1/out é quinta
    expect(g.from).toBe('2026-09-28')
    expect(g.to).toBe('2026-11-01')
    expect(g.dates).toHaveLength(35)
    expect(monthGrid('2026-11').dates).toHaveLength(42) // 1/nov é domingo: 6 semanas
    expect(monthGrid('2027-02').dates[0]).toBe('2027-02-01')
  })

  it('junta fontes diferentes sem copiar: cada item aponta para o registro original', () => {
    const d = empty()
    d.tasks = [task('Comprar passagem', { dueDate: '2026-10-10' })]
    d.events = [{ ...e, id: 'ev', title: 'Dentista', date: '2026-10-10', start: '09:00', end: '10:00', notes: '' }]
    d.habits = [{ ...e, id: 'treino', name: 'Treinar', rule: { type: 'weekdays', days: [6] }, time: '', goal: '', active: true, startDate: '2026-09-01', category: 'training' }]
    d.lifePlans = [plan('Viagem', { deadline: '2026-10-20' }), plan('Inglês', { kind: 'objective', deadline: '2026-10-20', status: 'done' })]
    d.planSteps = [step('Reservar hotel', 'Viagem', 0, { deadline: '2026-10-12' })]
    d.financeGoals = [{ ...e, id: 'fg', name: 'Reserva', target: 500000, saved: 1000, deadline: '2026-10-31', currency: 'BRL', note: '', status: 'active', history: [] }]
    d.projects = [{ ...e, id: 'site', name: 'Site cliente', clientId: null, kind: 'site', status: 'inProgress', startDate: '', dueDate: '2026-10-25', endDate: '', charged: 0, received: 0, currency: 'BRL', link: '', notes: '' }]
    d.tools = [{ ...e, id: 'tl', name: 'Editor', link: '', plan: '', price: 5000, currency: 'BRL', billing: 'monthly', nextCharge: '2026-08-05', notes: '', status: 'active' } as Tool]
    const before = JSON.stringify(d)
    const cal = calendarMonth(d, settings, '2026-10', NOW)
    const day10 = cal.items.get('2026-10-10')!
    expect(day10.find((i) => i.kind === 'task')!.source).toMatchObject({ kind: 'task', task: d.tasks[0] })
    expect((day10.find((i) => i.kind === 'task')!.source as { task: Task }).task).toBe(d.tasks[0]) // o mesmo objeto, não uma cópia
    expect(day10.some((i) => i.kind === 'event')).toBe(true)
    expect(day10.some((i) => i.kind === 'habit')).toBe(true) // sábado: treino
    const marks = [...cal.marks.values()].flat()
    expect(marks.map((m) => m.key).sort()).toEqual(['fgoal:fg', 'plan:Viagem', 'project:site', 'step:Reservar hotel', 'tool:tl:2026-10-05', 'tool:tl:2026-11-05'].sort().filter((k) => k !== 'tool:tl:2026-11-05'))
    // nada é gravado nem duplicado
    expect(JSON.stringify(d)).toBe(before)
    expect(new Set(marks.map((m) => m.key)).size).toBe(marks.length)
    expect(dayIndicators(day10, cal.marks.get('2026-10-10') ?? []).map((x) => x.label)).toEqual(['1 compromisso', '1 tarefa', 'treino'])
  })

  it('editar o registro original muda o calendário (camada de visualização)', () => {
    const d = empty()
    d.tasks = [task('Antes', { dueDate: '2026-10-10' })]
    expect(calendarMonth(d, settings, '2026-10', NOW).items.get('2026-10-10')![0].title).toBe('Antes')
    d.tasks = [{ ...d.tasks[0], title: 'Depois', dueDate: '2026-10-11' }]
    const cal = calendarMonth(d, settings, '2026-10', NOW)
    expect(cal.items.get('2026-10-10')).toBeUndefined()
    expect(cal.items.get('2026-10-11')![0].title).toBe('Depois')
  })

  it('troca de mês calcula só as semanas visíveis', () => {
    const d = empty()
    d.tasks = [task('out', { dueDate: '2026-10-10' }), task('dez', { dueDate: '2026-12-10' })]
    const oct = calendarMonth(d, settings, '2026-10', NOW)
    expect([...oct.items.keys()]).toEqual(['2026-10-10'])
    const dec = calendarMonth(d, settings, '2026-12', NOW)
    expect([...dec.items.keys()]).toEqual(['2026-12-10'])
  })

  it('etapa concluída (ou com tarefa concluída) e projeto concluído não aparecem como prazo', () => {
    const d = empty()
    d.lifePlans = [plan('P', { deadline: '2026-10-20' })]
    d.tasks = [task('t1', { status: 'done', completedAt: '2026-10-01T12:00:00Z' })]
    d.planSteps = [step('a', 'P', 0, { deadline: '2026-10-12', status: 'done', doneAt: '2026-10-02T12:00:00Z' }), step('b', 'P', 1, { deadline: '2026-10-13', taskId: 't1' }), step('c', 'P', 2, { deadline: '2026-10-14' })]
    expect(calendarMarks(d, settings, '2026-10-01', '2026-10-31').map((m) => m.key)).toEqual(['step:c', 'plan:P'])
  })

  it('cobranças mensais respeitam o fim do mês e nunca aparecem antes da primeira data', () => {
    const tool = { ...e, id: 't', name: 'x', link: '', plan: '', price: 100, currency: 'BRL', billing: 'monthly', nextCharge: '2026-01-31', notes: '', status: 'active' } as Tool
    expect(chargesBetween(tool, '2026-02-01', '2026-03-31')).toEqual(['2026-02-28', '2026-03-31'])
    expect(chargesBetween({ ...tool, nextCharge: '2026-12-15' }, '2026-10-01', '2026-10-31')).toEqual([])
    expect(chargesBetween({ ...tool, billing: 'yearly', nextCharge: '2025-10-07' }, '2026-10-01', '2026-10-31')).toEqual(['2026-10-07'])
  })
})

describe('projetos pessoais e objetivos', () => {
  it('progresso: pelas etapas quando há etapas; manual só sem etapas; nada inventado', () => {
    const p = plan('P', { manualProgress: 70 })
    expect(planProgress(p, [], [])).toEqual({ source: 'manual', done: 0, total: 0, percent: 70 })
    expect(planProgress(plan('Q'), [], [])).toEqual({ source: 'none', done: 0, total: 0, percent: null })
    const steps = [step('a', 'P', 0, { status: 'done' }), step('b', 'P', 1), step('c', 'P', 2), step('d', 'P', 3, { status: 'done' })]
    const s10 = [...steps, ...Array.from({ length: 6 }, (_, i) => step(`x${i}`, 'P', 4 + i, i < 2 ? { status: 'done' } : {}))]
    expect(planProgress(p, s10, [])).toEqual({ source: 'steps', done: 4, total: 10, percent: 40 }) // manual ignorado quando há etapas
  })

  it('etapa com tarefa vinculada conta como concluída quando a tarefa é concluída (sem gravar na etapa)', () => {
    const s = step('a', 'P', 0, { taskId: 't' })
    expect(stepDone(s, [task('t')])).toBe(false)
    expect(stepDone(s, [task('t', { status: 'done', completedAt: NOW.toISOString() })])).toBe(true)
    expect(s.status).toBe('todo')
  })

  it('reordenar troca só os vizinhos (e normaliza ordens repetidas)', () => {
    const steps = [step('a', 'P', 0), step('b', 'P', 1), step('c', 'P', 2), step('z', 'Q', 0)]
    const moved = moveStep(steps, 'P', 'c', -1)
    expect(moved.map((s) => [s.id, s.order]).sort()).toEqual([['b', 2], ['c', 1]])
    const after = steps.map((s) => moved.find((m) => m.id === s.id) ?? s)
    expect(stepsOf(after, 'P').map((s) => s.id)).toEqual(['a', 'c', 'b'])
    expect(moveStep(steps, 'P', 'a', -1)).toEqual([])
    const dup = [step('a', 'P', 0), step('b', 'P', 0), step('c', 'P', 0)]
    const fixed = moveStep(dup, 'P', 'c', -1)
    const all = dup.map((s) => fixed.find((m) => m.id === s.id) ?? s)
    expect(new Set(all.map((s) => s.order)).size).toBe(3)
    expect(nextOrder(steps, 'P')).toBe(3)
  })

  it('objetivo vira projeto pessoal no mesmo registro (sem cópia), guardando a origem', () => {
    const o = plan('o1', { kind: 'objective', title: 'Me mudar para Barcelona', deadline: '2027-06-01', status: 'active' })
    const p = convertToProject(o, 'Mudança para Barcelona', NOW)
    expect(p).toMatchObject({ id: 'o1', kind: 'project', title: 'Mudança para Barcelona', convertedFrom: 'objective', convertedAt: NOW.toISOString(), deadline: '2027-06-01', status: 'active', createdAt: o.createdAt })
    const steps = [step('s', 'o1', 0, { status: 'done' })]
    expect(planProgress(p, steps, []).percent).toBe(100) // etapas continuam ligadas
  })

  it('sugestões locais só quando pedidas e sem repetir etapas existentes', () => {
    expect(suggestSteps({ category: 'travel' }, [{ title: 'Definir orçamento' }])).toEqual(['Comprar transporte', 'Reservar hospedagem', 'Separar documentos', 'Montar roteiro'])
    expect(suggestSteps({ category: '' }, [])).toEqual([])
  })

  it('meta semanal "Etapas concluídas" usa as etapas (e tarefas vinculadas) da semana', () => {
    const d = empty()
    d.lifePlans = [plan('P')]
    d.tasks = [task('t', { status: 'done', completedAt: '2026-10-13T15:00:00Z' })]
    d.planSteps = [step('a', 'P', 0, { status: 'done', doneAt: '2026-10-12T15:00:00Z' }), step('b', 'P', 1, { taskId: 't' }), step('c', 'P', 2, { status: 'done', doneAt: '2026-10-05T15:00:00Z' })]
    expect(metricValue(weekMetrics(d, settings, '2026-10-12', NOW), 'steps.done')).toBe(2)
    expect(metricValue(weekMetrics(d, { ...settings, modules: { ...ALL, life: false } }, '2026-10-12', NOW), 'steps.done')).toBeNull()
  })
})

describe('O que mudou?', () => {
  const tx = (amount: number, at: string): Transaction => ({ id: `tx${at}${amount}`, createdAt: at, updatedAt: at, type: 'out', amount, currency: 'BRL', baseAmount: -amount, reason: 'x' })

  it('períodos parciais equivalentes (semana até hoje; mês até o mesmo dia)', () => {
    const w = periods('week', '2026-10-15')
    expect(w).toMatchObject({ current: { from: '2026-10-12', to: '2026-10-15' }, previous: { from: '2026-10-05', to: '2026-10-08' } })
    expect(w.label).toBe('Comparação até quinta, com os mesmos dias da semana anterior.')
    const m = periods('month', '2026-10-12')
    expect(m).toMatchObject({ current: { from: '2026-10-01', to: '2026-10-12' }, previous: { from: '2026-09-01', to: '2026-09-12' } })
    expect(m.label).toBe('Comparação até o dia 12, com o mesmo período de setembro.')
    expect(periods('month', '2026-03-31').previous.to).toBe('2026-02-28')
  })

  it('tarefas, hábitos, treino, financeiro e etapas — em linguagem neutra', () => {
    const d = empty()
    // Tarefas: 3 nesta semana (seg–qui), 1 nos mesmos dias da anterior
    d.tasks = [...['2026-10-12', '2026-10-13', '2026-10-14'].map((day, i) => task(`c${i}`, { status: 'done', completedAt: `${day}T15:00:00Z` })), task('p', { status: 'done', completedAt: '2026-10-06T15:00:00Z' })]
    // Hábito diário de leitura desde 1/out: anterior 2 de 4; atual 4 de 4 (hoje marcado)
    d.habits = [{ ...e, id: 'ler', name: 'Ler', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-10-01', category: 'reading' }]
    d.completions = ['2026-10-05', '2026-10-06', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'].map((day) => done('habit', 'ler', day))
    d.transactions = [tx(20000, '2026-10-13T15:00:00Z'), tx(38000, '2026-10-06T15:00:00Z')]
    d.lifePlans = [plan('Viagem')]
    d.planSteps = [step('a', 'Viagem', 0, { status: 'done', doneAt: '2026-10-13T15:00:00Z' }), step('b', 'Viagem', 1, { status: 'done', doneAt: '2026-10-14T15:00:00Z' })]
    const c = computeChanges(d, settings, 'week', NOW)
    const text = c.lines.map((l) => l.text)
    expect(text).toContain('Você concluiu 2 tarefas a mais que na semana anterior (3 e 1).')
    expect(text).toContain('Seu cumprimento de hábitos passou de 50% para 100%.')
    expect(text).toContain('Seus gastos nesta semana estão R$ 180,00 abaixo dos mesmos dias da semana anterior.')
    expect(text).toContain('Você concluiu 2 etapas do projeto Viagem.')
    expect(text.join(' ')).not.toMatch(/pior|fracass|ruim|(^|[^0-9])0%/)
  })

  it('dados insuficientes: sem linha (nunca "0%"); app novo não compara', () => {
    const d = empty()
    d.habits = [{ ...e, id: 'ler', name: 'Ler', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-10-14', category: 'reading' }]
    const c = computeChanges(d, settings, 'week', NOW)
    expect(c.lines).toEqual([]) // hábito com menos de 3 dias esperados em cada período
    expect(computeChanges(d, { ...settings, startedAt: '2026-10-10T12:00:00Z' }, 'month', NOW)).toMatchObject({ notComparable: true, lines: [] })
  })

  it('mês parcial: gastos até o dia, comparados com o mesmo período', () => {
    const d = empty()
    d.transactions = [tx(10000, '2026-10-05T15:00:00Z'), tx(28000, '2026-09-05T15:00:00Z'), tx(99999, '2026-09-20T15:00:00Z')]
    const c = computeChanges(d, settings, 'month', NOW)
    expect(c.lines.map((l) => l.text)).toContain('Seus gastos até o dia 15 estão R$ 180,00 abaixo do mesmo período do mês passado.')
  })

  it('Score só com os dois períodos válidos (e respeita "esconder Score")', () => {
    const d = empty()
    d.tasks = [...Array.from({ length: 4 }, (_, i) => task(`a${i}`, { dueDate: '2026-10-13', status: i < 3 ? 'done' : 'todo', completedAt: i < 3 ? '2026-10-13T15:00:00Z' : null })), ...Array.from({ length: 4 }, (_, i) => task(`b${i}`, { dueDate: '2026-10-06', status: i < 2 ? 'done' : 'todo', completedAt: i < 2 ? '2026-10-06T15:00:00Z' : null }))]
    d.recurring = [{ ...e, id: 'r', title: 'Casa', rule: { type: 'daily' }, time: '', notes: '', active: true, startDate: '2026-09-01' }]
    d.completions = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'].map((day) => done('recurring', 'r', day))
    const c = computeChanges(d, settings, 'week', NOW)
    expect(c.lines.some((l) => l.area === 'score')).toBe(true)
    expect(computeChanges(d, { ...settings, hideScore: true }, 'week', NOW).lines.some((l) => l.area === 'score')).toBe(false)
    expect(computeChanges(empty(), settings, 'week', NOW).lines.some((l) => l.area === 'score')).toBe(false)
  })

  it('fuso: etapa concluída perto da meia-noite conta no dia do fuso escolhido', () => {
    const d = empty()
    d.lifePlans = [plan('P')]
    d.planSteps = [step('a', 'P', 0, { status: 'done', doneAt: '2026-10-12T02:30:00Z' })] // dom 11/out 23:30 em SP
    expect(metricValue(weekMetrics(d, settings, '2026-10-12', NOW), 'steps.done')).toBe(0)
    expect(metricValue(weekMetrics(d, { ...settings, timeZone: 'Europe/Madrid' }, '2026-10-12', NOW), 'steps.done')).toBe(1)
  })
})
