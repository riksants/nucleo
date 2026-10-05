import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildAgenda } from '../src/core/agenda'
import { runIntent } from '../src/core/assistant/actions'
import { parseIntent, readDate, readIntent } from '../src/core/assistant/intents'
import { isDestructive } from '../src/core/assistant/proposal'
import { computeInsights, markInsight, pruneInsightState, visibleInsights } from '../src/core/insights'
import { reorganizeDay, reorganizeWeek, replanItem } from '../src/core/reorganize'
import { activeWindow, busyOf, conflictsOf, findSlot, freeStarts } from '../src/core/timeline'
import { DEFAULT_REMINDERS, buildOccurrences } from '../src/features/reminders/engine'
import type { CalendarEvent, Completion, DataState, Habit, RoutinePlan, Settings, Task } from '../src/data/types'

const empty = (): DataState => ({ transactions: [], goals: [], clients: [], projects: [], tasks: [], tools: [], accounts: [], notes: [], portfolio: [], sales: [], offerings: [], subPlans: [], subscribers: [], plannerProfiles: [], routinePlans: [], mealPlans: [], inbox: [], habits: [], recurring: [], completions: [], events: [], focusSessions: [], weeklyGoals: [], challenges: [], weekCheckins: [], weekSnapshots: [], financeGoals: [], lifePlans: [], planSteps: [], meals: [], shoppingItems: [] })
const MODS = { tasks: true, agenda: true, habits: true, recurring: true, routine: true, finance: true, life: true, week: true, meals: true, today: true }
const settings = { onboarded: true, baseCurrency: 'BRL', initialBalance: 0, startedAt: '2026-07-01T12:00:00Z', rates: null, manualRates: {}, lastBackupAt: null, timeZone: 'America/Sao_Paulo', modules: MODS } as Settings
const e = { createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-01T12:00:00Z' }
// Terça 6/out/2026, 10:00 em São Paulo (13:00Z). Semana: seg 5 → dom 11.
const NOW = new Date('2026-10-06T13:00:00Z')
const TODAY = '2026-10-06'
let seq = 0
const task = (p: Partial<Task>): Task => ({ ...e, id: `t${++seq}`, title: `T${seq}`, projectId: null, dueDate: '', priority: 'none', status: 'todo', completedAt: null, ...p })
const event = (p: Partial<CalendarEvent>): CalendarEvent => ({ ...e, id: `e${++seq}`, title: 'Reunião', date: TODAY, start: '18:00', end: '19:00', notes: '', ...p })
const habit = (p: Partial<Habit>): Habit => ({ ...e, id: `h${++seq}`, name: 'Ler', rule: { type: 'daily' }, time: '', goal: '', active: true, startDate: '2026-09-01', ...p })
const routine = (blocks: RoutinePlan['blocks']): RoutinePlan => ({ ...e, createdAt: '2026-09-01T12:00:00Z', id: 'routine-current', status: 'approved', source: 'manual', notes: '', done: {}, blocks })

describe('linha do tempo: conflitos e horário livre', () => {
  it('conflitos que importam (compromisso, bloco fixo, prioridades) e ignora os triviais', () => {
    const d = empty()
    d.events = [event({ title: 'Reunião', start: '18:00', end: '19:00' }), event({ title: 'Dentista', start: '18:30', end: '19:30' })]
    d.tasks = [task({ title: 'Relatório', dueDate: TODAY, dueTime: '18:15' }), task({ title: 'A', dueDate: TODAY, dueTime: '09:00', priority: 'high' }), task({ title: 'B', dueDate: TODAY, dueTime: '09:10', priority: 'high' })]
    d.habits = [habit({ name: 'Água', time: '07:00' }), habit({ name: 'Vitamina', time: '07:05' })]
    const c = conflictsOf(buildAgenda(d, settings, TODAY, TODAY, NOW))
    const pairs = c.map((x) => [x.a.title, x.b.title].sort().join('+')).sort()
    expect(pairs).toEqual(['A+B', 'Dentista+Relatório', 'Dentista+Reunião', 'Relatório+Reunião'])
    expect(c.find((x) => x.a.title === 'Reunião' || x.b.title === 'Reunião')!.level).toBe('high')
    expect(c.find((x) => x.a.title === 'A')!.level).toBe('medium')
  })

  it('faixa ativa: configurações → rotina → 07:00–22:00 (padrão)', () => {
    expect(activeWindow(empty(), settings, TODAY)).toMatchObject({ start: 7 * 60, end: 22 * 60, source: 'default' })
    const d = empty()
    d.plannerProfiles = [{ ...e, id: 'planner-profile', mode: 'routine', routine: { wakeWeekday: '06:00', sleepWeekday: '23:00', wakeWeekend: '08:00', sleepWeekend: '23:30' } as never, meals: {} as never }]
    expect(activeWindow(d, settings, TODAY)).toMatchObject({ start: 6 * 60 + 30, end: 22 * 60 + 30, source: 'routine' })
    expect(activeWindow(d, { ...settings, activeHours: { start: '09:00', end: '18:00' } }, TODAY)).toMatchObject({ start: 540, end: 1080, source: 'settings' })
  })

  it('horário livre: nunca no passado, nunca ocupado, dentro da faixa, no fuso escolhido', () => {
    const d = empty()
    d.events = [event({ start: '10:30', end: '12:00' })]
    const starts = freeStarts(d, settings, TODAY, 30, NOW)
    expect(starts[0]).toBe(12 * 60) // agora 10:00 → a partir de 10:15; 10:15 encostaria na reunião (10:30), então 12:00
    expect(starts).not.toContain(10 * 60 + 30)
    expect(starts.every((s) => s + 30 <= 22 * 60)).toBe(true)
    expect(freeStarts(d, settings, '2026-10-05', 30, NOW)).toEqual([]) // ontem
    // Mesmo instante em Tóquio já é quarta 22:00: hoje (terça) é passado lá
    expect(freeStarts(d, { ...settings, timeZone: 'Asia/Tokyo' }, TODAY, 30, NOW)).toEqual([])
    expect(findSlot(d, settings, { from: TODAY, duration: 60, prefer: '11:00' }, NOW)).toEqual({ date: TODAY, start: '12:00' })
  })
})

describe('replanejamento e reorganização (só proposta)', () => {
  it('treino em conflito com reunião: sugere horário livre; não mexe no modelo da rotina', () => {
    const d = empty()
    d.routinePlans = [routine([{ id: 'gym', day: 2, start: '18:00', end: '19:00', title: 'Treino', kind: 'training', fixed: false }, { id: 'work', day: 2, start: '13:00', end: '17:00', title: 'Trabalho', kind: 'work', fixed: true }])]
    d.events = [event({ start: '18:00', end: '19:00' })]
    const items = buildAgenda(d, settings, TODAY, TODAY, NOW)
    const gym = busyOf(items).find((b) => b.key === `routine:gym:${TODAY}`)!
    const p = replanItem(d, settings, gym, NOW)!
    expect(p.summary).toMatch(/Existe espaço hoje às 19:00/)
    const ops = p.changes[0].ops
    expect(ops.map((o) => o.op === 'save' && o.collection)).toEqual(['completions', 'tasks'])
    expect((ops[0] as { record: Completion }).record).toMatchObject({ source: 'routine', sourceId: 'gym', date: TODAY, status: 'skipped' })
    expect((ops[1] as { record: Task }).record).toMatchObject({ title: 'Treino', dueDate: TODAY, dueTime: '19:00', fromRoutine: { blockId: 'gym', date: TODAY } })
    expect(d.routinePlans[0].blocks.find((b) => b.id === 'gym')!.start).toBe('18:00') // nada aplicado
    // Bloco fixo (trabalho) nunca é proposto para mudar
    expect(reorganizeDay(d, settings, NOW).changes.some((c) => c.id.includes('work'))).toBe(false)
  })

  it('organizar o dia: atrasadas e prioridades primeiro, em horários livres, sem cobrir compromissos; o que não cabe vai para amanhã', () => {
    const d = empty()
    d.events = [event({ start: '10:15', end: '21:30' })] // dia quase todo ocupado
    const late = task({ title: 'Atrasada', dueDate: '2026-10-02' })
    const high = task({ title: 'Importante', dueDate: TODAY, priority: 'high' })
    const low = task({ title: 'Simples', dueDate: TODAY })
    d.tasks = [low, high, late]
    const before = JSON.stringify(d)
    const p = reorganizeDay(d, settings, NOW)
    const byTitle = Object.fromEntries(p.changes.map((c) => [c.label.split(' · ')[1], c]))
    expect(Object.keys(byTitle).sort()).toEqual(['Atrasada', 'Importante', 'Simples'])
    expect(byTitle.Atrasada.label).toBe('21:30 · Atrasada') // só cabe uma depois da reunião
    expect(p.changes.filter((c) => c.label.startsWith('Amanhã')).length).toBe(2)
    expect(JSON.stringify(d)).toBe(before) // nada muda sem confirmar
  })

  it('organizar a semana: tira tarefas de um dia cheio, nunca passa do dia marcado, não mexe nas com horário', () => {
    const d = empty()
    const fri = Array.from({ length: 5 }, (_, i) => task({ title: `Sexta ${i}`, dueDate: '2026-10-09' }))
    const timed = task({ title: 'Com horário', dueDate: '2026-10-09', dueTime: '15:00' })
    const mon = task({ title: 'Amanhã cedo', dueDate: '2026-10-07' })
    d.tasks = [...fri, timed, mon]
    const p = reorganizeWeek(d, settings, NOW)
    const moved = p.changes.map((c) => (c.ops[0] as { record: Task }).record)
    expect(moved.length).toBeGreaterThanOrEqual(2)
    expect(moved.every((t) => t.dueDate >= TODAY && t.dueDate <= '2026-10-09')).toBe(true)
    expect(moved.some((t) => t.title === 'Com horário')).toBe(false)
    expect(p.notes[0]).toMatch(/faixa padrão/)
  })
})

describe('sugestões inteligentes', () => {
  const titles = (d: DataState, s = settings) => computeInsights(d, s, NOW).map((i) => i.title)

  it('sem dados, nenhuma sugestão inventada', () => {
    expect(computeInsights(empty(), settings, NOW)).toEqual([])
  })

  it('prazo hoje, atrasadas e dia cheio, com "por quê" baseado nos registros', () => {
    const d = empty()
    d.tasks = [task({ title: 'Contrato', dueDate: TODAY, priority: 'high' }), task({ dueDate: TODAY }), task({ title: 'Velha', dueDate: '2026-10-01' }), ...Array.from({ length: 4 }, () => task({ dueDate: '2026-10-09' }))]
    const list = computeInsights(d, settings, NOW)
    const due = list.find((i) => i.title === '“Contrato” vence hoje')!
    expect(due).toMatchObject({ priority: 'high', why: 'Ela vence hoje e há mais 1 tarefa para hoje.' })
    expect(list.some((i) => i.title === '1 tarefa ficou com data passada')).toBe(true)
    expect(list.find((i) => i.title.startsWith('Você deixou 4 tarefas para sexta'))?.action?.do).toEqual({ kind: 'reorganizeWeek' })
    expect(list[0].priority).toBe('high') // ordenado por prioridade
    expect(list.map((i) => `${i.title} ${i.why}`).join(' ')).not.toMatch(/falhou|improdutiv|mal\b|errad/i)
  })

  it('conflito com sugestão de novo horário para o lado flexível', () => {
    const d = empty()
    d.events = [event({ start: '18:00', end: '19:00' })]
    d.tasks = [task({ title: 'Ligar', dueDate: TODAY, dueTime: '18:30' })]
    const c = computeInsights(d, settings, NOW).find((i) => i.area === 'agenda')!
    expect(c).toMatchObject({ priority: 'high' })
    expect(c.action?.do).toMatchObject({ kind: 'replan' })
  })

  it('hábito pendente nos últimos 3 dias programados; meta semanal em risco', () => {
    const d = empty()
    d.habits = [habit({ name: 'Meditar', startDate: '2026-09-20' })]
    d.weeklyGoals = [{ ...e, id: 'g', week: '2026-10-05', title: 'Treinar 6 vezes', kind: 'quantity', metric: 'training.days', target: 6, manualValue: 0, status: 'active', repeatKey: 'k' }]
    const t = titles(d)
    expect(t).toContain('“Meditar” ficou pendente nos últimos 3 dias em que estava programado')
    expect(t).toContain('Sua meta “Treinar 6 vezes” está em 0 de 6')
  })

  it('metas financeiras, projetos e objetivos', () => {
    const d = empty()
    d.financeGoals = [{ ...e, id: 'fg', name: 'Reserva', target: 500000, saved: 10000, deadline: '2026-11-30', currency: 'BRL', note: '', status: 'active', history: [{ date: '2026-08-01', saved: 0 }] }]
    d.lifePlans = [{ ...e, id: 'p', kind: 'project', title: 'Viagem', description: '', category: '', startDate: '', deadline: '2026-10-10', status: 'active', notes: '' }, { ...e, id: 'o', kind: 'objective', title: 'Inglês', description: '', category: '', startDate: '', deadline: '', status: 'active', notes: '' }]
    d.planSteps = [{ ...e, id: 's', planId: 'p', title: 'Passagem', deadline: '2026-10-08', status: 'todo', doneAt: null, order: 0, notes: '' }]
    const t = titles(d)
    expect(t.some((x) => /Sua meta “Reserva” exige aproximadamente R\$ [\d.]+,\d\d por semana/.test(x))).toBe(true)
    expect(t).toContain('Seu projeto tem uma etapa vencendo quinta')
    expect(t).toContain('O prazo do projeto “Viagem” está próximo')
    expect(t).toContain('Seu objetivo “Inglês” está sem nenhuma próxima etapa definida')
    // última atualização há 5 dias: ainda não é "sem movimento" (só depois de 14)
    expect(t.some((x) => x.includes('sem movimento'))).toBe(false)
  })

  it('descartada não volta; adiada volta na data; estados antigos são limpos', () => {
    const d = empty()
    d.tasks = [task({ title: 'Velha', dueDate: '2026-10-01' })]
    const [i] = computeInsights(d, settings, NOW)
    let state = markInsight(undefined, i.key, { s: 'dismissed' }, NOW)
    expect(visibleInsights([i], state, TODAY)).toEqual([])
    state = markInsight(undefined, i.key, { s: 'snoozed', until: '2026-10-07' }, NOW)
    expect(visibleInsights([i], state, TODAY)).toEqual([])
    expect(visibleInsights([i], state, '2026-10-07')).toEqual([i])
    const old = { a: { s: 'dismissed' as const, at: '2026-08-01T00:00:00Z' }, b: { s: 'dismissed' as const, at: '2026-10-05T00:00:00Z' } }
    expect(Object.keys(pruneInsightState(old, NOW))).toEqual(['b'])
    const many = Object.fromEntries(Array.from({ length: 250 }, (_, k) => [`k${k}`, { s: 'dismissed' as const, at: new Date(NOW.getTime() - k * 1000).toISOString() }]))
    expect(Object.keys(pruneInsightState(many, NOW))).toHaveLength(200)
  })
})

describe('Assistente', () => {
  const ctx = (d: DataState) => ({ data: d, settings, now: NOW })

  it('compromisso tarde da noite termina até 23:59, nunca com duração zero', () => {
    expect(readIntent('Tenho reunião amanhã às 23h30', TODAY)).toMatchObject({ start: '23:30', end: '23:59' })
    expect(readIntent('Tenho reunião amanhã às 23h', TODAY)).toMatchObject({ start: '23:00', end: '23:59' })
    expect(readIntent('Tenho reunião amanhã às 22h15', TODAY)).toMatchObject({ start: '22:15', end: '23:15' })
  })

  it('"próxima terça" dito numa terça é a da semana que vem; "terça" é hoje', () => {
    // TODAY is a Tuesday.
    expect(readDate('proxima terca', TODAY)?.date).toBe('2026-10-13')
    expect(readDate('proximo sabado', TODAY)?.date).toBe('2026-10-10')
    expect(readDate('terca', TODAY)?.date).toBe(TODAY)
    expect(readDate('nesta terca-feira', TODAY)?.date).toBe(TODAY)
    expect(readDate('na sexta', TODAY)?.date).toBe('2026-10-09')
  })

  it('entende comandos em português e valida intenções vindas de fora', () => {
    expect(readIntent('Tenho reunião amanhã às 18h', TODAY)).toEqual({ type: 'createEvent', title: 'Reunião', date: '2026-10-07', start: '18:00', end: '19:00' })
    expect(readIntent('Quero guardar R$5.000 até dezembro', TODAY)).toMatchObject({ type: 'createFinanceGoal', target: 500000, deadline: '2026-12-31' })
    expect(readIntent('Organiza minha semana', TODAY)).toEqual({ type: 'reorganizeWeek' })
    expect(readIntent('qwerty', TODAY)).toEqual({ type: 'unknown' })
    expect(parseIntent({ type: 'createTask', title: 'x', date: '07/10' })).toEqual({ type: 'unknown' })
    expect(parseIntent({ type: 'deleteTransaction', id: '1' })).toEqual({ type: 'unknown' })
    expect(parseIntent({ type: 'createTask', title: 'Pagar', date: '2026-10-07', time: '09:00' })).toMatchObject({ type: 'createTask' })
  })

  it('leituras respondem com os dados reais (hoje, semana, financeiro, metas, projeto)', () => {
    const d = empty()
    d.tasks = [task({ title: 'Pagar boleto', dueDate: TODAY, dueTime: '09:00' })]
    d.transactions = [{ ...e, id: 'x', createdAt: '2026-10-06T12:00:00Z', type: 'out', amount: 4200, currency: 'BRL', baseAmount: -4200, reason: 'Mercado' }]
    d.lifePlans = [{ ...e, id: 'p', kind: 'project', title: 'Viagem para Itália', description: '', category: '', startDate: '', deadline: '', status: 'active', notes: '' }]
    d.planSteps = [{ ...e, id: 's1', planId: 'p', title: 'Passagem', deadline: '', status: 'done', doneAt: e.createdAt, order: 0, notes: '' }, { ...e, id: 's2', planId: 'p', title: 'Hotel', deadline: '2026-10-20', status: 'todo', doneAt: null, order: 1, notes: '' }]
    expect(runIntent(readIntent('O que tenho hoje?', TODAY), ctx(d)).list?.map((x) => x.title)).toContain('09:00 · Pagar boleto')
    expect(runIntent(readIntent('Quanto gastei esta semana?', TODAY), ctx(d)).lines[0]).toBe('Você gastou R$ 42,00 esta semana, até agora.')
    expect(runIntent(readIntent('Como está meu projeto da viagem?', TODAY), ctx(d)).lines).toEqual(['Projeto pessoal “Viagem para Itália”: em andamento.', '1 de 2 etapas concluídas (50%).', 'Próxima etapa: Hotel (até 20/10).'])
    expect(runIntent({ type: 'goals' }, ctx(d)).lines[0]).toMatch(/ainda não tem metas/)
    expect(runIntent({ type: 'week' }, ctx(d)).lines.length).toBeGreaterThan(0)
  })

  it('criar tarefa, hábito, meta e meta financeira viram proposta (nada gravado antes de confirmar)', () => {
    const d = empty()
    const before = JSON.stringify(d)
    const t = runIntent(readIntent('Coloca comprar passagem nas minhas tarefas', TODAY), ctx(d)).proposal!
    expect(t.kind).toBe('create')
    expect(t.changes[0].ops[0]).toMatchObject({ op: 'save', collection: 'tasks', before: null, record: { title: 'Comprar passagem', status: 'todo', dueDate: '' } })
    const h = runIntent(readIntent('cria um hábito de beber água', TODAY), ctx(d)).proposal!
    expect(h.changes[0].ops[0]).toMatchObject({ collection: 'habits', record: { name: 'Beber água', category: 'water', startDate: TODAY } })
    const g = runIntent(readIntent('Cria uma meta de treinar 4 vezes esta semana', TODAY), ctx(d)).proposal!
    expect(g.changes[0].ops[0]).toMatchObject({ collection: 'weeklyGoals', record: { metric: 'training.days', target: 4, week: '2026-10-05', kind: 'quantity' } })
    const f = runIntent(readIntent('Quero guardar R$5.000 até dezembro', TODAY), ctx(d)).proposal!
    expect(f.changes[0].ops[0]).toMatchObject({ collection: 'financeGoals', record: { target: 500000, saved: 0, deadline: '2026-12-31', currency: 'BRL' } })
    expect(JSON.stringify(d)).toBe(before)
  })

  it('mover e excluir pedem confirmação; exclusão é marcada como destrutiva; nome ambíguo pergunta', () => {
    const d = empty()
    d.tasks = [task({ title: 'Ligar pro banco', dueDate: TODAY }), task({ title: 'Ligar pra mãe' }), task({ title: 'Comprar pão' })]
    const move = runIntent(readIntent('move a tarefa ligar pro banco para sexta às 10h', TODAY), ctx(d)).proposal!
    expect(move.kind).toBe('update')
    expect(move.changes[0].ops[0]).toMatchObject({ record: { dueDate: '2026-10-09', dueTime: '10:00' }, before: { dueDate: TODAY } })
    const del = runIntent(readIntent('apaga a tarefa comprar pão', TODAY), ctx(d)).proposal!
    expect(isDestructive(del)).toBe(true)
    expect(del.changes[0].ops[0]).toMatchObject({ op: 'remove', collection: 'tasks' })
    expect(runIntent(readIntent('conclui ligar', TODAY), ctx(d)).lines[0]).toMatch(/Encontrei 2/)
  })

  it('não existe ação para apagar dinheiro, metas, projetos ou refeições; o Assistente não chama a rede', () => {
    const src = ['src/core/assistant/intents.ts', 'src/core/assistant/actions.ts', 'src/core/insights.ts', 'src/core/reorganize.ts', 'src/core/timeline.ts'].map((f) => readFileSync(f, 'utf8')).join('\n')
    // (imports from supabase/functions/_shared are local shared code, not network)
    expect(src).not.toMatch(/fetch\(|lib\/supabase|createClient|XMLHttpRequest|functions\.invoke/)
    expect(src).not.toMatch(/op: 'remove', collection: '(transactions|financeGoals|goals|weeklyGoals|lifePlans|planSteps|meals|accounts)'/)
  })
})

describe('lembretes de projetos pessoais, objetivos e etapas', () => {
  it('entram na regra "Prazos" existente; etapa concluída não gera lembrete', () => {
    const d = empty()
    d.lifePlans = [{ ...e, id: 'p', kind: 'objective', title: 'Maratona', description: '', category: '', startDate: '', deadline: '2026-10-12', status: 'active', notes: '' }]
    d.planSteps = [{ ...e, id: 's', planId: 'p', title: 'Inscrição', deadline: '2026-10-09', status: 'todo', doneAt: null, order: 0, notes: '' }, { ...e, id: 's2', planId: 'p', title: 'Tênis', deadline: '2026-10-10', status: 'done', doneAt: e.createdAt, order: 1, notes: '' }]
    const s = { ...settings, reminders: { showDetails: false, rules: Object.fromEntries(Object.entries(DEFAULT_REMINDERS.rules).map(([k, r]) => [k, { ...r, enabled: k === 'deadlines' }])) } } as Settings
    const keys = buildOccurrences(d, s, { now: NOW, days: 14 }).map((o) => o.key.split(':').slice(0, 2).join(':'))
    expect(keys.sort()).toEqual(['plan:p', 'step:s'])
  })
})
