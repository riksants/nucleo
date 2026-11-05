/**
 * NÚCLEO IA (Etapa 3) — actions: plan, preview choices, one atomic write, idempotency, money rules,
 * dependencies, failures and undo. The "store" here applies writes like the app's repository batch
 * (core/rules/work applyOps): all of a commit or nothing.
 */
import { describe, expect, it } from 'vitest'
import { applyPlan, undoPlan } from '../src/core/assistant/ia/actions/apply'
import { buildPlan, compilePlan, initialChoice, planRecordId, previewValues, toggle, type Plan } from '../src/core/assistant/ia/actions/plan'
import { runActionsTool } from '../src/core/assistant/ia/actions/tool'
import { financeIndex, totalsBetween } from '../src/core/finance'
import { applyOps } from '../src/core/rules/work'
import type { BatchOp } from '../src/data/repository'
import type { CommitOptions } from '../src/data/store'
import type { DataState, Sale } from '../src/data/types'
import { makeConverter } from '../src/lib/rates'
import { blankAction, type Action } from '../supabase/functions/_shared/ia/actions'
import { account, NOW, settings } from './ia-fixtures'

const UID = '11111111-1111-4111-8111-111111111111'
const convert = makeConverter({ BRL: 1, EUR: 0.2, USD: 0.18 } as never)
const TODAY = '2026-11-04'

/** A store like the app's: commit stamps like stampOps and applies everything at once (or throws). */
function fakeStore(data: DataState, opts: { fail?: boolean; uid?: string } = {}) {
  const s = { data, commits: 0, uid: opts.uid ?? UID, fail: opts.fail ?? false }
  const io = {
    convert,
    areasOff: [] as never[],
    currentUid: async () => s.uid,
    snapshot: () => ({ data: s.data, settings }),
    async commit(ops: BatchOp[], o: CommitOptions) {
      if (s.fail) throw new Error('IndexedDB indisponível')
      const now = new Date().toISOString()
      const stamped = ops.map((op) => {
        if (op.op !== 'put') return op
        const { changedBy: _m, ...rest } = op.item as unknown as Record<string, unknown>
        void _m
        return { ...op, item: { ...rest, ...(o.mark ? { changedBy: o.mark } : {}), createdAt: (rest.createdAt as string) || now, updatedAt: now } as never }
      })
      s.data = applyOps(s.data, stamped)
      s.commits++
    },
  }
  return { s, io }
}

const plan = (actions: Action[], data = account(), id = 'p1', areasOff: never[] = []) => buildPlan(id, UID, 'teste', actions, { data, settings, now: NOW, areasOff })
const count = (d: DataState) => Object.fromEntries((['clients', 'projects', 'sales', 'tasks', 'transactions', 'events', 'financeGoals', 'notes'] as const).map((k) => [k, d[k].length]))

/** "Fechei o site da Clínica Nova por 2.400, metade agora (já recebi) e metade em 30 dias; cria o projeto, as tarefas e me lembra de cobrar." */
const BIG: Action[] = [
  blankAction('a1', 'criar_cliente', { pessoa: 'Clínica Nova' }),
  blankAction('a2', 'criar_projeto', { titulo: 'Site Clínica Nova', pessoa: 'Clínica Nova', depende_de: ['a1'] }),
  blankAction('a3', 'criar_venda', { titulo: 'Site', pessoa: 'Clínica Nova', valor: 2400, data: TODAY, entrada_recebida: 1200, ja_recebido_ou_pago: true, depende_de: ['a1'] }),
  blankAction('a4', 'criar_tarefa', { titulo: 'Briefing', data: '2026-11-09', alvo: 'Site Clínica Nova', depende_de: ['a2'] }),
  blankAction('a5', 'criar_tarefa', { titulo: 'Entrega', data: '2026-11-13', depende_de: ['a2'] }),
  blankAction('a6', 'criar_tarefa', { titulo: 'Cobrar a segunda parte — Clínica Nova', data: '2026-12-04', lembrete_minutos: 0 }),
]

describe('plano em várias áreas', () => {
  it('monta cliente, projeto, venda com entrada recebida, tarefas ligadas e lembrete — tudo pronto', () => {
    const p = plan(BIG)
    expect(p.items.map((i) => i.state)).toEqual(['pronto', 'pronto', 'pronto', 'pronto', 'pronto', 'pronto'])
    expect(p.items.find((i) => i.ref === 'a3')!.details.join(' ')).toMatch(/recebido agora R\$ 1\.200,00.*A receber: R\$ 1\.200,00/)
  })

  it('uma única gravação: cada registro uma vez, a entrada vira UMA entrada no Financeiro, tarefas no projeto', async () => {
    const { s, io } = fakeStore(account())
    const before = count(s.data)
    const p = plan(BIG)
    const r = await applyPlan(p, initialChoice(p), io, NOW)
    expect(r.ok).toBe(true)
    expect(s.commits).toBe(1)
    const after = count(s.data)
    expect({ clients: after.clients - before.clients, projects: after.projects - before.projects, sales: after.sales - before.sales, tasks: after.tasks - before.tasks, transactions: after.transactions - before.transactions }).toEqual({ clients: 1, projects: 1, sales: 1, tasks: 3, transactions: 1 })
    const sale = s.data.sales.find((x) => x.id === planRecordId('p1', 'a3'))!
    expect(sale).toMatchObject({ clientId: planRecordId('p1', 'a1'), total: 240000, currency: 'BRL' })
    expect(sale.payments).toEqual([expect.objectContaining({ amount: 120000, finance: true })])
    const income = s.data.transactions.find((t) => t.source?.parentId === sale.id)!
    expect(income).toMatchObject({ type: 'in', amount: 120000, id: `rcv-sale-${sale.payments[0].id}`, changedBy: 'assistant' })
    expect(s.data.tasks.filter((t) => t.projectId === planRecordId('p1', 'a2')).map((t) => t.title).sort()).toEqual(['Briefing', 'Entrega'])
    expect(s.data.tasks.find((t) => t.title.startsWith('Cobrar'))!.alerts).toEqual([expect.objectContaining({ type: 'day', days: 0, at: '09:00' })])
    expect(s.data.projects.find((x) => x.id === planRecordId('p1', 'a2'))).toMatchObject({ charged: 0, received: 0, payments: [] })
  })

  it('confirmar duas vezes (ou dois toques ao mesmo tempo) não duplica nada', async () => {
    const { s, io } = fakeStore(account())
    const p = plan(BIG)
    await applyPlan(p, initialChoice(p), io, NOW)
    const once = count(s.data)
    const again = await applyPlan(p, initialChoice(p), io, NOW)
    expect(again).toMatchObject({ ok: true, written: 0 })
    expect(count(s.data)).toEqual(once)
    // two taps at the same moment: both compile on the same snapshot; fixed ids → same records
    const { s: s2, io: io2 } = fakeStore(account())
    await Promise.all([applyPlan(p, initialChoice(p), io2, NOW), applyPlan(p, initialChoice(p), io2, NOW)])
    expect(count(s2.data)).toEqual(once)
    expect(s2.data.transactions.filter((t) => t.source?.parentId === planRecordId('p1', 'a3'))).toHaveLength(1)
  })

  it('o mesmo pedido de novo (outra conversa): cliente reaproveitado, venda/projeto/tarefas marcados como duplicados e desmarcados', async () => {
    const { s, io } = fakeStore(account())
    const p = plan(BIG)
    await applyPlan(p, initialChoice(p), io, NOW)
    const p2 = plan(BIG, s.data, 'p2')
    expect(p2.items.find((i) => i.ref === 'a1')!.state).toBe('existente')
    for (const ref of ['a2', 'a3', 'a4', 'a5']) expect(p2.items.find((i) => i.ref === ref)!.defaultOn, ref).toBe(false)
    expect(initialChoice(p2).has('a3')).toBe(false)
  })
})

describe('dinheiro: nunca sem confirmação explícita, nunca misturado', () => {
  it('projeto COM valor e venda para o mesmo trabalho: aviso de "a receber duas vezes" e a venda desmarcada', () => {
    const p = plan([BIG[0], { ...BIG[1], valor: 2400 }, BIG[2]])
    const sale = p.items.find((i) => i.ref === 'a3')!
    expect(sale.messages.map((m) => m.text).join()).toMatch(/duas vezes/)
    expect(sale.defaultOn).toBe(false)
  })

  const sale = (d: DataState) => d.sales.find((x) => x.id === 's1')! as Sale
  it('recebimento sem "já recebi" é bloqueado; com, vira pagamento + uma entrada', async () => {
    const without = plan([blankAction('a1', 'registrar_recebimento', { alvo: 'Site', valor: 300, data: TODAY })])
    expect(without.items[0].state).toBe('erro')
    expect(without.items[0].messages[0].text).toMatch(/Confirme/)
    const { s, io } = fakeStore(account())
    const p = plan([blankAction('a1', 'registrar_recebimento', { alvo: 'Site', valor: 300, data: TODAY, ja_recebido_ou_pago: true })])
    expect(p.items[0].state).toBe('pronto')
    await applyPlan(p, initialChoice(p), io, NOW)
    expect(sale(s.data).payments.map((x) => x.amount)).toEqual([40000, 30000])
    expect(s.data.transactions.filter((t) => t.source?.parentId === 's1').map((t) => t.amount).sort()).toEqual([30000, 40000])
  })
  it('recebimento parcial maior que o que falta, ou em outra moeda: bloqueado', () => {
    expect(plan([blankAction('a1', 'registrar_recebimento', { alvo: 'Site', valor: 700, data: TODAY, ja_recebido_ou_pago: true })]).items[0].state).toBe('erro')
    expect(plan([blankAction('a1', 'registrar_recebimento', { alvo: 'Site', valor: 100, moeda: 'EUR', data: TODAY, ja_recebido_ou_pago: true })]).items[0].messages.map((m) => m.text).join()).toMatch(/mesma moeda/)
  })
  it('recebimento igual a um já registrado: aviso de duplicado e desmarcado', () => {
    const p = plan([blankAction('a1', 'registrar_recebimento', { alvo: 'Site', valor: 400, data: '2026-10-01', ja_recebido_ou_pago: true })])
    expect(p.items[0].defaultOn).toBe(false)
    expect(p.items[0].messages.map((m) => m.text).join()).toMatch(/pagamento igual/)
  })
  it('venda com entrada sem "já recebi": bloqueada (não assume dinheiro)', () => {
    const p = plan([blankAction('a1', 'criar_venda', { titulo: 'Logo', pessoa: 'Ana', valor: 500, entrada_recebida: 200, data: TODAY })])
    expect(p.items[0].state).toBe('erro')
  })
  it('venda parcelada: parcelas do app somando exatamente o que falta; nenhuma entrada no Financeiro', async () => {
    const { s, io } = fakeStore(account())
    const p = plan([blankAction('a1', 'criar_venda', { titulo: 'Curso', pessoa: 'Ana', valor: 1000, data: TODAY, parcelas: 3, primeira_parcela: '2026-12-01', intervalo_parcelas: 'mes' })])
    await applyPlan(p, initialChoice(p), io, NOW)
    const v = s.data.sales.find((x) => x.id === planRecordId('p1', 'a1'))!
    expect(v.installments!.reduce((t, i) => t + i.amount, 0)).toBe(100000)
    expect(v.installments).toHaveLength(3)
    expect(v.payments).toEqual([])
    expect(s.data.transactions.filter((t) => t.source?.parentId === v.id)).toEqual([])
  })
  it('despesa só se paga; data futura não; transferência fora de receitas e despesas', async () => {
    expect(plan([blankAction('a1', 'registrar_despesa', { titulo: 'Luz', valor: 120, data: TODAY })]).items[0].state).toBe('erro')
    expect(plan([blankAction('a1', 'registrar_despesa', { titulo: 'Luz', valor: 120, data: '2026-11-20', ja_recebido_ou_pago: true })]).items[0].state).toBe('erro')
    const { s, io } = fakeStore(account())
    const p = plan([blankAction('a1', 'registrar_transferencia', { valor: 500, data: TODAY, ja_recebido_ou_pago: true }), blankAction('a2', 'registrar_despesa', { titulo: 'Luz', valor: 120, categoria: 'luz', data: TODAY, ja_recebido_ou_pago: true })])
    const before = totalsBetween(financeIndex(account().transactions, settings), TODAY, TODAY)
    await applyPlan(p, initialChoice(p), io, NOW)
    const t = totalsBetween(financeIndex(s.data.transactions, settings), TODAY, TODAY)
    expect(t.expense - before.expense).toBe(12000) // only the bill; the transfer moves the balance but is not an expense
    expect(s.data.transactions.find((x) => x.id === planRecordId('p1', 'a1'))).toMatchObject({ type: 'out', transfer: {}, amount: 50000 })
    expect(s.data.transactions.find((x) => x.id === planRecordId('p1', 'a2'))).toMatchObject({ category: 'bills', baseAmount: -12000 })
  })
  it('despesa em moeda sem cotação: nada é gravado', async () => {
    const { s, io } = fakeStore(account())
    io.convert = makeConverter({ BRL: 1 } as never)
    const p = plan([blankAction('a1', 'registrar_despesa', { titulo: 'Hosting', valor: 100, moeda: 'USD', data: TODAY, ja_recebido_ou_pago: true })])
    const r = await applyPlan(p, initialChoice(p), io, NOW)
    expect(r).toMatchObject({ ok: false })
    expect((r as { problems: string[] }).problems[0]).toMatch(/Sem cotação/)
    expect(s.commits).toBe(0)
  })
  it('reserva de meta: valor absoluto, nunca uma saída; repetir não soma de novo; mudou no meio → para', async () => {
    const { s, io } = fakeStore(account())
    const p = plan([blankAction('a1', 'reservar_meta', { alvo: 'Viagem', valor: 300 })])
    const tx = s.data.transactions.length
    await applyPlan(p, initialChoice(p), io, NOW)
    expect(s.data.financeGoals.find((g) => g.id === 'g1')!.saved).toBe(415000)
    expect(s.data.transactions.length).toBe(tx)
    expect(await applyPlan(p, initialChoice(p), io, NOW)).toMatchObject({ ok: true, written: 0 })
    expect(s.data.financeGoals.find((g) => g.id === 'g1')!.saved).toBe(415000)
    const stale = plan([blankAction('a1', 'reservar_meta', { alvo: 'Viagem', valor: 100 })], account(), 'p9')
    const r = await applyPlan(stale, initialChoice(stale), io, NOW)
    expect(r).toMatchObject({ ok: false })
  })
})

describe('dependências, privacidade, conta e falhas', () => {
  it('desmarcar o cliente desmarca projeto, venda e tarefas que dependem dele; marcar uma tarefa marca o projeto e o cliente', () => {
    const p = plan(BIG)
    const off = toggle(p, initialChoice(p), 'a1')
    expect([...off.chosen].sort()).toEqual(['a6'])
    expect(off.also.sort()).toEqual(['a2', 'a3', 'a4', 'a5'])
    const on = toggle(p, off.chosen, 'a4')
    expect([...on.chosen].sort()).toEqual(['a1', 'a2', 'a4', 'a6'])
  })
  it('compilar com uma dependência desmarcada é recusado', () => {
    const p = plan(BIG)
    const c = compilePlan(p, new Set(['a2']), { data: account(), settings, now: NOW, areasOff: [], convert })
    expect(c.ops).toEqual([])
    expect(c.problems[0]).toMatch(/precisa de/)
  })
  it('área desligada na privacidade: a ação é bloqueada', () => {
    expect(plan([BIG[2]], account(), 'p1', ['vendas'] as never[]).items[0].state).toBe('erro')
  })
  it('outra conta conectada: nada é aplicado', async () => {
    const { s, io } = fakeStore(account(), { uid: '22222222-2222-4222-8222-222222222222' })
    const p = plan(BIG)
    expect(await applyPlan(p, initialChoice(p), io, NOW)).toMatchObject({ ok: false })
    expect(s.commits).toBe(0)
  })
  it('falha ao gravar (aparelho sem armazenamento): nada muda, dá para tentar de novo', async () => {
    const { s, io } = fakeStore(account(), { fail: true })
    const before = JSON.stringify(s.data)
    const p = plan(BIG)
    const r = await applyPlan(p, initialChoice(p), io, NOW)
    expect(r).toMatchObject({ ok: false })
    expect((r as { problems: string[] }).problems[0]).toMatch(/Nada foi gravado/)
    expect(JSON.stringify(s.data)).toBe(before)
    s.fail = false
    expect(await applyPlan(p, initialChoice(p), io, NOW)).toMatchObject({ ok: true })
  })
  it('conflito de agenda vira aviso; compromisso e tarefa movidos e repetição sem efeito', async () => {
    const c = plan([blankAction('a1', 'criar_compromisso', { titulo: 'Call', data: '2026-11-05', hora: '10:30', hora_fim: '11:30' })])
    expect(c.items[0].messages.map((m) => m.text).join()).toMatch(/Conflito de horário com Reunião Vânia/)
    const { s, io } = fakeStore(account())
    const p = plan([blankAction('a1', 'mover_compromisso', { alvo: 'Reunião Vânia', hora: '16:00' }), blankAction('a2', 'mover_tarefa', { alvo: 'Enviar layout', data: '2026-11-06' })])
    await applyPlan(p, initialChoice(p), io, NOW)
    expect(s.data.events.find((e) => e.id === 'e1')).toMatchObject({ start: '16:00', end: '17:00', date: '2026-11-05' })
    expect(s.data.tasks.find((t) => t.id === 'k1')).toMatchObject({ dueDate: '2026-11-06', changedBy: 'assistant' })
    expect(await applyPlan(p, initialChoice(p), io, NOW)).toMatchObject({ ok: true, written: 0 })
  })
  it('nome ambíguo ou inexistente: o item fica bloqueado com a explicação', () => {
    expect(plan([blankAction('a1', 'concluir_tarefa', { alvo: 'tarefa que não existe' })]).items[0].state).toBe('erro')
  })
  it('recebimento numa venda nova do mesmo plano acima do que falta: bloqueado', () => {
    const p = plan([blankAction('v', 'criar_venda', { titulo: 'X', pessoa: 'Ana', valor: 100, data: TODAY }), blankAction('r', 'registrar_recebimento', { valor: 150, data: TODAY, ja_recebido_ou_pago: true, depende_de: ['v'] })])
    expect(p.items[1].state).toBe('erro')
  })
})

describe('confirmar de novo depois de aplicado', () => {
  it('recebimento que quitou a venda: a segunda confirmação reconhece que já foi feito (sem erro, sem duplicar)', async () => {
    const { s, io } = fakeStore(account())
    const p = plan([blankAction('a1', 'registrar_recebimento', { alvo: 'Consultoria', valor: 300, data: TODAY, ja_recebido_ou_pago: true })])
    expect(p.items[0].state).toBe('pronto')
    await applyPlan(p, initialChoice(p), io, NOW)
    expect(s.data.sales.find((x) => x.id === 's3')!.payments).toHaveLength(1)
    const again = await applyPlan(p, initialChoice(p), io, NOW)
    expect(again).toMatchObject({ ok: true, written: 0, alreadyApplied: ['a1'] })
    expect(s.data.sales.find((x) => x.id === 's3')!.payments).toHaveLength(1)
    expect(s.data.transactions.filter((t) => t.source?.parentId === 's3')).toHaveLength(1)
  })
  it('tarefa concluída: confirmar de novo não muda nada', async () => {
    const { s, io } = fakeStore(account())
    const p = plan([blankAction('a1', 'concluir_tarefa', { alvo: 'Enviar layout' })])
    await applyPlan(p, initialChoice(p), io, NOW)
    const doneAt = s.data.tasks.find((t) => t.id === 'k1')!.completedAt
    expect(await applyPlan(p, initialChoice(p), io, NOW)).toMatchObject({ ok: true, written: 0 })
    expect(s.data.tasks.find((t) => t.id === 'k1')!.completedAt).toBe(doneAt)
  })
})

describe('desfazer', () => {
  it('desfaz tudo (registros, pagamento e a entrada dele)', async () => {
    const { s, io } = fakeStore(account())
    const before = count(s.data)
    const p = plan(BIG)
    const r = await applyPlan(p, initialChoice(p), io, NOW)
    if (!r.ok || !r.applied) throw new Error('não aplicou')
    expect(await undoPlan(r.applied, io)).toMatchObject({ ok: true })
    expect(count(s.data)).toEqual(before)
  })
  it('se algo mudou depois de confirmar, não desfaz pela metade', async () => {
    const { s, io } = fakeStore(account())
    const p = plan(BIG)
    const r = await applyPlan(p, initialChoice(p), io, NOW)
    if (!r.ok || !r.applied) throw new Error('não aplicou')
    s.data = { ...s.data, tasks: s.data.tasks.map((t) => (t.title === 'Briefing' ? { ...t, title: 'Briefing editado' } : t)) }
    const snapshot = JSON.stringify(s.data)
    expect(await undoPlan(r.applied, io)).toMatchObject({ ok: false })
    expect(JSON.stringify(s.data)).toBe(snapshot)
  })
})

describe('ferramenta propor_acoes', () => {
  it('argumentos inválidos voltam como erro para a IA; válidos montam o plano e não gravam nada', () => {
    const ctx = { data: account(), settings, now: NOW, areasOff: [], uid: UID, planId: 'pt' }
    expect(runActionsTool({ resumo: 'x', acoes: [{ tipo: 'apagar_tudo' }] }, ctx)).toMatchObject({ isError: true, plan: null })
    const ok = runActionsTool({ resumo: 'Venda', acoes: BIG }, ctx)
    expect(ok.isError).toBe(false)
    expect((ok.plan as Plan).items).toHaveLength(6)
    expect(JSON.parse(ok.content).instrucao).toMatch(/Nada foi gravado/)
  })
  it('a IA pode omitir campos (ferramenta não estrita): faltantes viram vazios; formato errado volta como erro', () => {
    const ctx = { data: account(), settings, now: NOW, areasOff: [], uid: UID, planId: 'pl' }
    const ok = runActionsTool({ resumo: 'x', acoes: [{ ref: 'a1', tipo: 'criar_tarefa', titulo: 'Ligar', data: '2026-11-05' }] }, ctx)
    expect(ok.isError).toBe(false)
    expect(ok.plan!.items[0]).toMatchObject({ state: 'pronto', action: { ja_recebido_ou_pago: null, depende_de: [], valor: null } })
    expect(runActionsTool({ resumo: 'x', acoes: [{ ref: 'a1', tipo: 'registrar_despesa', valor: 'cem' }] }, ctx).isError).toBe(true)
    expect(runActionsTool({ resumo: 'x', acoes: [{ ref: 'a1', tipo: 'criar_tarefa', data: '05/11/2026' }] }, ctx).isError).toBe(true)
  })
  it('valores da prévia com nomes precisos: guardado ANTES/DEPOIS da reserva, parcelas, novo horário mantendo a duração', () => {
    const ctx = { data: account(), settings }
    const r = plan([blankAction('a1', 'reservar_meta', { alvo: 'Viagem', valor: 300 })])
    const rv = Object.fromEntries(previewValues(r, 'a1', ctx).map((v) => [v.label, v.display]))
    expect(rv).toMatchObject({ 'Guardado ANTES da reserva': 'R$ 3.850,00', 'Guardado DEPOIS da reserva': 'R$ 4.150,00', 'Falta para a meta DEPOIS da reserva': 'R$ 1.850,00' })
    const v = plan([blankAction('a1', 'criar_venda', { titulo: 'Curso', pessoa: 'Ana', valor: 900, entrada_recebida: 300, ja_recebido_ou_pago: true, data: TODAY, parcelas: 2, primeira_parcela: '2026-12-01', intervalo_parcelas: 'mes' })])
    const vv = Object.fromEntries(previewValues(v, 'a1', ctx).map((x) => [x.label, x.display]))
    expect(vv).toMatchObject({ 'Dia da venda': 'qua, 04/11', 'Fica a receber': 'R$ 600,00', 'Vencimento da parcela 1': 'ter, 01/12', 'Valor da parcela 2': 'R$ 300,00' })
    const m = plan([blankAction('a1', 'mover_compromisso', { alvo: 'Reunião Vânia', hora: '16:00' })])
    expect(Object.fromEntries(previewValues(m, 'a1', ctx).map((x) => [x.label, x.display]))).toMatchObject({ 'Novo horário (a duração é mantida)': '16:00–17:00' })
  })
})

describe('desfazer tudo com regras da pessoa (motor real de regras, na mesma gravação)', () => {
  // A store whose commit runs the person's rules in the SAME write, like the app's store.commit.
  async function withRules() {
    const { safeRulesForWrite } = await import('../src/core/rules/engine')
    const d = account()
    // reserved money must fit in the balance (a rule never reserves more than what is available)
    d.financeGoals = d.financeGoals.map((g) => (g.id === 'g1' ? { ...g, inBalance: true, saved: 100000 } : g))
    d.rules = [{ id: 'r1', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', name: 'Reservar 20% do que entra', on: true, since: '2026-10-01', order: 1, trigger: { kind: 'moneyIn' }, conditions: [], actions: [{ kind: 'reservePercent', goalId: 'g1', percent: 20 }, { kind: 'createTask', title: 'Conferir o recebimento', dueDays: 0, linkProject: false, priority: 'none' }] } as never]
    const s = { data: d }
    const io = {
      convert,
      areasOff: [] as never[],
      currentUid: async () => UID,
      snapshot: () => ({ data: s.data, settings }),
      async commit(ops: BatchOp[], o: CommitOptions) {
        const extra = safeRulesForWrite(s.data, { ...settings, onboarded: true } as never, convert, ops, o.by ?? 'person', NOW)
        const all = [...ops, ...extra]
        s.data = applyOps(s.data, all)
        return all
      },
    }
    return { s, io }
  }
  const SALE = [blankAction('v', 'criar_venda', { titulo: 'Curso', pessoa: 'Ana', valor: 900, entrada_recebida: 300, ja_recebido_ou_pago: true, data: TODAY })]

  it('a confirmação mostra o que as regras fizeram; desfazer tudo devolve a reserva da regra e remove a tarefa dela', async () => {
    const { s, io } = await withRules()
    const saved0 = s.data.financeGoals.find((g) => g.id === 'g1')!.saved
    const tasks0 = s.data.tasks.length
    const p = plan(SALE, s.data)
    const r = await applyPlan(p, initialChoice(p), io, NOW)
    if (!r.ok || !r.applied) throw new Error('não aplicou')
    expect(r.ruleEffects.join(' ')).toMatch(/Reservar 20%/)
    expect(s.data.financeGoals.find((g) => g.id === 'g1')!.saved).toBe(saved0 + 6000) // 20% de R$ 300
    expect(s.data.tasks.length).toBe(tasks0 + 1)
    const u = await undoPlan(r.applied, io, NOW)
    expect(u).toMatchObject({ ok: true })
    expect((u as { ruleEffects: string[] }).ruleEffects.join(' ')).toMatch(/Reservar 20%/)
    expect(s.data.financeGoals.find((g) => g.id === 'g1')!.saved).toBe(saved0)
    expect(s.data.tasks.length).toBe(tasks0)
    expect(s.data.sales.some((x) => x.id.startsWith('ia-'))).toBe(false)
    expect(s.data.transactions.some((t) => t.source?.parentId?.startsWith('ia-'))).toBe(false)
    expect(s.data.automationRuns.find((x) => x.id === r.applied!.ruleRuns[0].id)!.status).toBe('undone')
  })

  it('a reserva da regra foi mexida depois (a pessoa tirou dinheiro da meta): nada é desfeito e o motivo aparece', async () => {
    const { s, io } = await withRules()
    const p = plan(SALE, s.data)
    const r = await applyPlan(p, initialChoice(p), io, NOW)
    if (!r.ok || !r.applied) throw new Error('não aplicou')
    s.data = { ...s.data, financeGoals: s.data.financeGoals.map((g) => (g.id === 'g1' ? { ...g, saved: 1000, updatedAt: '2030-01-01T00:00:00Z' } : g)) }
    const before = JSON.stringify(s.data)
    const u = await undoPlan(r.applied, io, NOW)
    expect(u).toMatchObject({ ok: false })
    expect((u as { remaining: string[] }).remaining.join(' ')).toMatch(/Reservar 20%/)
    expect(JSON.stringify(s.data)).toBe(before)
  })

  it('a pessoa criou depois uma tarefa no projeto novo: nada é desfeito e a tarefa é citada', async () => {
    const { s, io } = fakeStore(account())
    const p = plan([blankAction('c', 'criar_cliente', { pessoa: 'Zeca' }), blankAction('pr', 'criar_projeto', { titulo: 'App Zeca', pessoa: 'Zeca', depende_de: ['c'] })])
    const r = await applyPlan(p, initialChoice(p), io, NOW)
    if (!r.ok || !r.applied) throw new Error('não aplicou')
    s.data = { ...s.data, tasks: [...s.data.tasks, { id: 'manual1', createdAt: 'x', updatedAt: 'x', title: 'Wireframe', projectId: planRecordId('p1', 'pr'), dueDate: '', priority: 'none', status: 'todo', completedAt: null }] }
    const u = await undoPlan(r.applied, io, NOW)
    expect(u).toMatchObject({ ok: false })
    expect((u as { remaining: string[] }).remaining.join(' ')).toMatch(/Wireframe/)
    expect(s.data.projects.some((x) => x.id === planRecordId('p1', 'pr'))).toBe(true)
  })

  it('entrada criada DEPOIS para um pagamento do plano (cotação que chegou mais tarde) sai junto', async () => {
    const { s, io } = fakeStore(account())
    const p = plan([blankAction('v', 'criar_venda', { titulo: 'Curso', pessoa: 'Ana', valor: 900, entrada_recebida: 300, ja_recebido_ou_pago: true, data: TODAY })])
    const r = await applyPlan(p, initialChoice(p), io, NOW)
    if (!r.ok || !r.applied) throw new Error('não aplicou')
    const v = s.data.sales.find((x) => x.id === planRecordId('p1', 'v'))!
    // simulate: the income of the down payment did not exist at confirm and was created later
    const income = s.data.transactions.find((t) => t.source?.paymentId === v.payments[0].id)!
    r.applied.entries = r.applied.entries.filter((e) => !(e.collection === 'transactions' && e.id === income.id))
    const u = await undoPlan(r.applied, io, NOW)
    expect(u).toMatchObject({ ok: true })
    expect(s.data.transactions.some((t) => t.id === income.id)).toBe(false)
  })
})

describe('prévia anunciada sem plano', () => {
  it('detecta resposta que fala em prévia/alteração preparada', async () => {
    const { claimsPlan } = await import('../src/core/assistant/ia/client')
    expect(claimsPlan('Preparei a reserva de R$ 300 para a meta. Confira na tela.')).toBe(true)
    expect(claimsPlan('Encontrei a meta Viagem: faltam R$ 2.150,00.')).toBe(false)
  })
})
