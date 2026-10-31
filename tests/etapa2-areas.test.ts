// Etapa 2: Rotina (adicionar sem apagar, só este dia / todos, duplicar, frase, evidência), Assinaturas (pausar
// sem cobrança retroativa, aviso por assinatura), Alimentação (texto → refeições), Caixa de entrada (compras,
// duplicata) e Portfólio (frase → campos). Lembretes que acompanham tudo.
import { describe, expect, it } from 'vitest'
import { planToolCharges } from '../src/core/automation/toolCharge'
import { completionId } from '../src/core/completions'
import { parseMealText } from '../src/core/mealText'
import { DEFAULT_MEAL_TYPES } from '../src/core/meals'
import { parsePortfolio } from '../src/core/portfolioText'
import { addActivity, blocksBackedBy, duplicateActivity, evidenceFor, kindFromTitle, parseRoutineLine, removeActivity, sameActivity, updateActivity } from '../src/core/routine'
import { nextCycleFrom, pauseTool, resumeTool, withStatus } from '../src/core/toolPause'
import { buildAgenda } from '../src/core/agenda'
import { buildOccurrences } from '../src/features/reminders/engine'
import { duplicateOf, shoppingItems } from '../src/features/inbox/inbox'
import type { Completion, DataState, Habit, InboxItem, RoutineBlock, RoutinePlan, Settings, Tool } from '../src/data/types'
import { emptyData, makeCtx, T } from './automation-helpers'

const e = { createdAt: T, updatedAt: T }
let n = 0
const id = () => `n${++n}`
const block = (over: Partial<RoutineBlock>): RoutineBlock => ({ id: 'b', day: 1, start: '07:00', end: '08:00', title: 'Academia', kind: 'training', fixed: false, ...over })
const plan = (blocks: RoutineBlock[], over: Partial<RoutinePlan> = {}): RoutinePlan => ({ ...e, id: 'routine-current', status: 'approved', source: 'manual', notes: '', done: {}, blocks, ...over })
const settings = (over: Partial<Settings> = {}): Settings =>
  ({ onboarded: true, baseCurrency: 'EUR', initialBalance: 0, startedAt: '', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'Europe/Lisbon', modules: { routine: true, habits: true, tools: true, meals: false }, reminders: { showDetails: true, rules: {}, on: true }, ...over }) as Settings
// Segunda, 2 de novembro de 2026.
const MON = '2026-11-02'

describe('Rotina: os planejamentos existentes ficam intactos', () => {
  const existing = [block({ id: 'a', day: 1 }), block({ id: 'b2', day: 3 }), block({ id: 'w', day: 1, title: 'Trabalho', kind: 'work', start: '09:00', end: '17:00', fixed: true })]

  it('adicionar em vários dias só acrescenta; o resto não muda', () => {
    const p = plan(existing)
    const { plan: next, added } = addActivity(p, { title: 'Inglês', kind: 'study', start: '19:00', end: '20:00', days: [1, 3, 5] }, id)
    expect(added).toHaveLength(3)
    expect(next.blocks.slice(0, 3)).toEqual(existing)
    expect(next.blocks).toHaveLength(6)
  })

  it('não duplica um dia que já tem a mesma atividade', () => {
    const { added } = addActivity(plan(existing), { title: 'academia', kind: 'training', start: '07:00', end: '08:00', days: [1, 2] }, id)
    expect(added.map((b) => b.day)).toEqual([2])
  })

  it('editar "só este dia" muda um bloco; "todos" muda a mesma atividade nos outros dias, mantendo ids e dias', () => {
    const p = plan(existing)
    const one = updateActivity(p, existing[0], { start: '06:30', end: '07:30' }, 'one')
    expect(one.blocks.find((b) => b.id === 'a')).toMatchObject({ start: '06:30', day: 1 })
    expect(one.blocks.find((b) => b.id === 'b2')).toMatchObject({ start: '07:00' })
    const all = updateActivity(p, existing[0], { start: '06:30', end: '07:30' }, 'all')
    expect(all.blocks.filter((b) => b.title === 'Academia').map((b) => [b.id, b.day, b.start])).toEqual([['a', 1, '06:30'], ['b2', 3, '06:30']])
    expect(all.blocks.find((b) => b.id === 'w')).toEqual(existing[2])
    expect(sameActivity(p, existing[0]).map((b) => b.id)).toEqual(['a', 'b2'])
  })

  it('duplicar copia só para os dias que não têm; remover "só este dia" não toca os outros', () => {
    const p = plan(existing)
    const { added } = duplicateActivity(p, existing[0], [1, 3, 6], id)
    expect(added.map((b) => b.day)).toEqual([6])
    const removed = removeActivity(p, existing[0], 'one')
    expect(removed.blocks.map((b) => b.id)).toEqual(['b2', 'w'])
    expect(removeActivity(p, existing[0], 'all').blocks.map((b) => b.id)).toEqual(['w'])
  })

  it('frase: dias, horário e tipo, sem inventar', () => {
    expect(parseRoutineLine('Academia segunda, quarta e sexta das 7h às 8h', MON)).toMatchObject({ title: 'Academia', kind: 'training', start: '07:00', end: '08:00', days: [1, 3, 5] })
    expect(parseRoutineLine('Estudar inglês todos os dias às 19h', MON)).toMatchObject({ title: 'Estudar inglês', kind: 'study', start: '19:00', end: '20:00', days: [0, 1, 2, 3, 4, 5, 6] })
    const amb = parseRoutineLine('Meditar às 6', MON)
    expect(amb.start).toBe('')
    expect(amb.timeOptions).toEqual(['06:00', '18:00'])
    expect(parseRoutineLine('Ler', MON)).toMatchObject({ title: 'Ler', days: [], start: '' })
    expect(kindFromTitle('Almoço')).toBe('meal')
  })
})

describe('Rotina: evidência real (nunca o relógio)', () => {
  const habit: Habit = { ...e, id: 'h', name: 'Treinar', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-01-01', category: 'training' }
  const b = block({ id: 'a', day: 1 })
  const done = (via?: string): Completion => ({ ...e, id: completionId('habit', 'h', MON), source: 'habit', sourceId: 'h', date: MON, status: 'done', ...(via ? { via } : {}) })

  it('hábito de treino feito → evidência para o treino do dia', () => {
    expect(evidenceFor({ habits: [habit], completions: [done()] }, b, MON)?.habit.id).toBe('h')
    expect(evidenceFor({ habits: [habit], completions: [] }, b, MON)).toBeNull()
  })

  it('o hábito marcado a partir da própria rotina não conta (sem laço)', () => {
    expect(evidenceFor({ habits: [habit], completions: [done(`routine:a:${MON}`)] }, b, MON)).toBeNull()
  })

  it('a linha da rotina mostra a sugestão; continua pendente até a pessoa (ou a opção ligada) marcar', () => {
    const data = { ...emptyData(), routinePlans: [plan([b])], habits: [habit], completions: [done()] } as DataState
    const [item] = buildAgenda(data, settings(), MON, MON, new Date('2026-11-02T20:00:00Z')).filter((i) => i.kind === 'routine')
    expect(item.status).toBe('pending')
    expect(item.evidence?.habitName).toBe('Treinar')
  })

  it('uma sessão marca um bloco só (o primeiro aberto do dia)', () => {
    const p = plan([b, block({ id: 'c', day: 1, start: '18:00', end: '19:00' })], { autoFromEvidence: true })
    expect(blocksBackedBy(p, habit, MON, []).map((x) => x.id)).toEqual(['a'])
    expect(blocksBackedBy(p, habit, MON, [{ ...e, id: completionId('routine', 'a', MON), source: 'routine', sourceId: 'a', date: MON, status: 'done' }]).map((x) => x.id)).toEqual(['c'])
  })
})

describe('Rotina: lembrete por atividade', () => {
  const now = new Date('2026-11-01T12:00:00Z')
  const keys = (blocks: RoutineBlock[]) => buildOccurrences({ ...emptyData(), routinePlans: [plan(blocks)] } as DataState, settings(), { now, days: 3 }).filter((o) => o.kind === 'routine')
  it('desligado não avisa; minutos próprios valem', () => {
    expect(keys([block({ id: 'a', remindMin: false })])).toHaveLength(0)
    const own = keys([block({ id: 'a', remindMin: 30 })])
    expect(own.map((o) => o.key)).toContain(`routine:a:${MON}T07:00:30`)
  })
})

describe('Assinaturas: pausar e retomar', () => {
  const tool = (over: Partial<Tool> = {}): Tool => ({ ...e, id: 't', name: 'Figma', link: '', plan: '', price: 2000, currency: 'EUR', billing: 'monthly', nextCharge: '2026-08-20', notes: '', status: 'active', chargeDay: 20, ...over })

  it('pausada não gera cobrança', () => {
    expect(planToolCharges(makeCtx({ tools: [pauseTool(tool(), '2026-08-01')] }, '2026-10-25'), '2026-08-01')).toEqual([])
  })

  it('ao retomar: próximo vencimento no ciclo certo, sem cobrar o período pausado', () => {
    const resumed = resumeTool(pauseTool(tool(), '2026-08-01'), '2026-10-25')
    expect(resumed).toMatchObject({ status: 'active', nextCharge: '2026-11-20', resumedAt: '2026-10-25' })
    expect(resumed.pausedAt).toBeUndefined()
    expect(planToolCharges(makeCtx({ tools: [resumed] }, '2026-10-25'), '2026-08-01')).toEqual([])
    const [p] = planToolCharges(makeCtx({ tools: [resumed] }, '2026-11-20'), '2026-08-01')
    expect(p.runs.map((r) => r.date)).toEqual(['2026-11-20'])
  })

  it('mesmo se a data não foi avançada (outro aparelho), nada antes do dia da retomada é cobrado', () => {
    const t = tool({ resumedAt: '2026-10-25' })
    const [p] = planToolCharges(makeCtx({ tools: [t] }, '2026-11-21'), '2026-08-01')
    expect(p.runs.map((r) => r.date)).toEqual(['2026-11-20'])
  })

  it('dia 31 continua no fim do mês; anual anda de ano em ano', () => {
    expect(nextCycleFrom({ nextCharge: '2026-01-31', chargeDay: 31, billing: 'monthly' }, '2026-02-10')).toBe('2026-02-28')
    expect(nextCycleFrom({ nextCharge: '2025-03-10', billing: 'yearly' }, '2026-05-01')).toBe('2027-03-10')
  })

  it('escolher "Pausada" no formulário segue a mesma regra', () => {
    const before = tool()
    expect(withStatus(before, { ...before, status: 'paused' }, '2026-09-01')).toMatchObject({ status: 'paused', pausedAt: '2026-09-01' })
    const paused = pauseTool(before, '2026-09-01')
    expect(withStatus(paused, { ...paused, status: 'active' }, '2026-10-25')).toMatchObject({ status: 'active', nextCharge: '2026-11-20' })
  })

  it('o histórico (cobranças já registradas) não é tocado por pausar', () => {
    const t = tool()
    expect(pauseTool(t, '2026-09-01')).toMatchObject({ ...t, status: 'paused' })
  })

  it('lembretes: pausada não avisa; antecedência própria vale', () => {
    const now = new Date('2026-11-15T12:00:00Z')
    const occ = (t: Tool) => buildOccurrences({ ...emptyData(), tools: [t] } as DataState, settings(), { now, days: 14 }).filter((o) => o.kind === 'payments')
    const active = tool({ nextCharge: '2026-11-20' })
    expect(occ({ ...active, status: 'paused' })).toHaveLength(0)
    const own = occ({ ...active, remindDays: 3 })
    expect(own.some((o) => o.key.startsWith('tool:t:2026-11-20:3:'))).toBe(true)
  })
})

describe('Alimentação: texto → refeições (conferidas antes)', () => {
  const week = '2026-11-02'
  it('horário, tipo e alimentos, como escritos', () => {
    const d = parseMealText('07:00 Café da manhã: pão integral, 2 ovos e café\nAlmoço 12h30 - arroz, feijão, 150 g de frango\nFrango com salada', { date: MON, week, types: DEFAULT_MEAL_TYPES })
    expect(d[0]).toMatchObject({ date: MON, time: '07:00', type: 'breakfast', name: '', ingredients: ['pão integral', '2 ovos', 'café'] })
    expect(d[1]).toMatchObject({ time: '12:30', type: 'lunch', ingredients: ['arroz', 'feijão', '150 g de frango'] })
    expect(d[2]).toMatchObject({ type: '', name: 'Frango com salada', ingredients: [], time: '' })
  })
  it('"Quarta" muda o dia das linhas seguintes', () => {
    const d = parseMealText('Jantar: sopa\nQuarta\nJantar: peixe', { date: MON, week, types: DEFAULT_MEAL_TYPES })
    expect(d.map((x) => x.date)).toEqual([MON, '2026-11-04'])
  })
})

describe('Caixa de entrada', () => {
  it('compras: separa os itens escritos', () => {
    expect(shoppingItems('Comprar arroz, ovos e leite.')).toEqual(['Arroz', 'Ovos', 'Leite'])
    expect(shoppingItems('Mercado: café + açúcar')).toEqual(['Café', 'Açúcar'])
  })
  it('duplicata: mesmo texto ainda em Novos', () => {
    const item: InboxItem = { ...e, id: 'i', text: 'Ligar para João amanhã', status: 'open', convertedTo: null, processedAt: null }
    expect(duplicateOf([item], 'ligar para joão amanhã!')?.id).toBe('i')
    expect(duplicateOf([{ ...item, status: 'done' }], 'Ligar para João amanhã')).toBeNull()
  })
})

describe('Portfólio: frase → campos (sem inventar)', () => {
  it('o exemplo do pedido', () => {
    expect(parsePortfolio('Adicionar meu projeto de site para uma lavanderia em Barcelona, com link lavanderiabcn.es, categoria desenvolvimento web e status concluído')).toEqual({
      name: 'Site para uma lavanderia em Barcelona',
      kind: 'site',
      link: 'lavanderiabcn.es',
      category: 'Desenvolvimento web',
      status: 'done',
    })
  })
  it('sem link escrito, link vazio; app em andamento', () => {
    expect(parsePortfolio('App de treinos para academia, em andamento')).toEqual({ name: 'App de treinos para academia', kind: 'app', link: '', category: '', status: 'inProgress' })
  })
})
