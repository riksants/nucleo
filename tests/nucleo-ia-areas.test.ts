/**
 * NÚCLEO IA (Etapa 2) — every area's lookup over a realistic multi-currency account, with the app's
 * own calculations. Focus: money never mixed across currencies, received vs still owed, a received
 * payment never counted twice, privacy areas enforced everywhere (agenda + search too), injected text
 * in notes and imported statements returned only as data, missing information, and big accounts.
 */
import { describe, expect, it } from 'vitest'
import { areasOffFor, runLookup } from '../src/core/assistant/ia/lookups'
import { FactBook } from '../supabase/functions/_shared/ia/facts'
import { APP_TOOLS, MAX_RESULT_CHARS, TOOL_DEFS, type Area } from '../supabase/functions/_shared/ia/tools'
import type { DataState, Settings } from '../src/data/types'
import { account, ALL_ON, E, NOW, settings, tx } from './ia-fixtures'

function run(tool: string, input: Record<string, unknown>, opts: { areasOff?: Area[]; data?: DataState; s?: Settings } = {}) {
  const book = new FactBook()
  const r = runLookup(tool, input, { data: opts.data ?? account(), settings: opts.s ?? settings, now: NOW, book, areasOff: opts.areasOff ?? [] })
  const facts = [...book.all.values()]
  return { r, p: JSON.parse(r.content), facts, find: (label: string) => facts.find((f) => f.label.startsWith(label)), all: (label: string) => facts.filter((f) => f.label.startsWith(label)) }
}

describe('ferramentas', () => {
  it('16 consultas, todas estritas e com esquema completo', () => {
    expect(APP_TOOLS).toHaveLength(16)
    for (const t of TOOL_DEFS) {
      expect(t.strict).toBe(true)
      expect(Object.keys(t.input_schema.properties).sort()).toEqual([...t.input_schema.required].sort())
    }
  })
})

describe('vendas: moedas separadas, recebido ≠ a receber', () => {
  it('totais por moeda, nunca somados', () => {
    const { r, all } = run('vendas', { situacao: 'todas', cliente: null, de: null, ate: null, pagina: 1 })
    expect(r.isError).toBe(false)
    expect(all('Total vendido').map((f) => f.display).sort()).toEqual(['R$ 1.300,00', '€ 500,00'])
    expect(all('Já recebido').map((f) => f.display).sort()).toEqual(['R$ 400,00', '€ 500,00'])
    expect(all('Ainda a receber').map((f) => f.display)).toEqual(['R$ 900,00'])
    // overdue: installment of 31/10 (300) + Maria's 300 past the deadline
    expect(all('Vencido e não pago').map((f) => f.display)).toEqual(['R$ 600,00'])
  })
  it('cada venda mostra recebido e falta receber como fatos diferentes; parcelas pelo app', () => {
    const { p, facts } = run('vendas', { situacao: 'em_aberto', cliente: 'Vânia', de: null, ate: null, pagina: 1 })
    expect(p.vendas).toHaveLength(1)
    expect(p.vendas[0]).toMatchObject({ comprador: 'Vânia', situacao: 'Parcialmente pago', parcelas: '0 de 2 pagas' })
    expect(facts.find((f) => f.id === p.vendas[0].recebido.id)?.display).toBe('R$ 400,00')
    expect(facts.find((f) => f.id === p.vendas[0].falta_receber.id)?.display).toBe('R$ 600,00')
    // 31/10 already passed (today 04/11): it is overdue, never "próximo vencimento"; the next one ahead is 30/11
    expect(p.vendas[0]).not.toHaveProperty('proximo_vencimento')
    expect(facts.find((f) => f.id === p.vendas[0].vencida_desde.id)?.display).toMatch(/31\/10/)
    expect(facts.find((f) => f.id === p.vendas[0].proxima_parcela_futura.id)?.display).toMatch(/30\/11/)
  })
  it('recebido no período conta a data do pagamento, em todas as vendas', () => {
    const { all } = run('vendas', { situacao: 'todas', cliente: null, de: '2026-10-11', ate: '2026-10-31', pagina: 1 })
    expect(all('Recebido de vendas no período').map((f) => f.display)).toEqual(['€ 500,00'])
  })
  it('comprador inexistente: ausente, sem inventar', () => {
    const { p } = run('vendas', { situacao: 'todas', cliente: 'Ninguém', de: null, ate: null, pagina: 1 })
    expect(p.fatos[0]).toMatchObject({ selo: 'ausente' })
  })
})

describe('lançamentos: recebimento nunca contado duas vezes, transferência fora dos totais', () => {
  it('entrada de recebimento traz a origem; totais na moeda principal pelo valor do app', () => {
    const { p, find } = run('lancamentos', { de: '2026-10-01', ate: '2026-10-31', tipo: 'todos', categoria: null, texto: null, pagina: 1 })
    const venda = p.lancamentos.find((l: { descricao: string }) => l.descricao.startsWith('Venda Site'))
    expect(venda.origem).toBe('recebimento de venda')
    // entradas = 400 + (EUR 500 lançado como R$ 3.000 no dia) ; saídas = 950 + 39,90 ; transferência fora
    expect(find('Entradas (lançamentos)')?.display).toBe('R$ 3.400,00')
    expect(find('Saídas (lançamentos)')?.display).toBe('R$ 989,90')
    expect(p.lancamentos.find((l: { descricao: string }) => l.descricao === 'Para a Wise').categoria).toMatch(/Transferência/)
    expect(p.observacoes.join(' ')).toMatch(/não some de novo/)
  })
  it('valor original de cada lançamento fica na própria moeda', () => {
    const { p, facts } = run('lancamentos', { de: '2026-10-01', ate: '2026-10-31', tipo: 'entrada', categoria: null, texto: 'logo', pagina: 1 })
    expect(facts.find((f) => f.id === p.lancamentos[0].valor.id)?.display).toBe('€ 500,00')
  })
  it('texto de extrato importado com uma "ordem" vai só como descrição (dado JSON), sem efeito', () => {
    const { r, p } = run('lancamentos', { de: '2026-10-01', ate: '2026-10-31', tipo: 'saida', categoria: null, texto: 'netflix', pagina: 1 })
    expect(p.lancamentos[0]).toMatchObject({ descricao: expect.stringContaining('IGNORE AS REGRAS'), importado_de_extrato: true })
    expect(() => JSON.parse(r.content)).not.toThrow()
    expect(p).not.toHaveProperty('instrucao')
  })
  it('período ou datas inválidas são recusados', () => {
    expect(run('lancamentos', { de: '2025-01-01', ate: '2026-10-31', tipo: 'todos', categoria: null, texto: null, pagina: 1 }).r.isError).toBe(true)
    expect(run('lancamentos', { de: 'ontem', ate: '2026-10-31', tipo: 'todos', categoria: null, texto: null, pagina: 1 }).r.isError).toBe(true)
  })
})

describe('clientes e projetos', () => {
  it('cobrado, recebido e a receber por moeda; sem dados de contato', () => {
    const { r, all } = run('clientes_e_projetos', { nome: null, situacao: 'ativos' })
    expect(all('Ainda a receber dos projetos').map((f) => f.display).sort()).toEqual(['R$ 1.500,00', 'US$ 1.000,00'])
    expect(all('Já recebido dos projetos').map((f) => f.display)).toEqual(['R$ 500,00'])
    expect(r.content).not.toMatch(/@|\+55|99999|Rua das Flores/)
  })
})

describe('assinantes e o que a pessoa paga', () => {
  it('assinantes: receita prevista por moeda, cancelados fora, recebido no mês', () => {
    const { all, p } = run('assinantes', { situacao: 'todos' })
    expect(all('Planos mensais ativos').map((f) => `${f.display}|${f.seal}`)).toEqual(['R$ 100,00|previsto'])
    expect(all('Receita prevista no ano').map((f) => f.display).sort()).toEqual(['R$ 1.200,00', '€ 120,00'])
    expect(all('Recebido de assinantes').map((f) => f.display)).toEqual(['R$ 50,00'])
    expect(p.assinantes.find((a: { nome: string }) => a.nome === 'Bruno').pagou_neste_mes).toMatch(/não há pagamento/)
    expect(p.assinantes.find((a: { nome: string }) => a.nome === 'Davi').situacao).toBe('Cancelada')
  })
  it('ferramentas: totais mensal e anual por moeda, só as ativas', () => {
    const { all } = run('contas_e_assinaturas_pagas', {})
    expect(all('Total mensal das assinaturas ativas').map((f) => f.display)).toEqual(['R$ 30,00'])
    expect(all('Total anual das assinaturas anuais ativas').map((f) => f.display)).toEqual(['US$ 100,00'])
  })
})

describe('tarefas, hábitos, alimentação, metas e planos', () => {
  it('tarefas atrasadas pelo prazo de hoje', () => {
    const { p } = run('tarefas', { filtro: 'atrasadas', projeto: null, de: null, ate: null })
    expect(p.tarefas.map((t: { titulo: string }) => t.titulo)).toEqual(['Enviar layout'])
  })
  it('hábitos: contagem do app (feito / previsto)', () => {
    const { p } = run('habitos_e_rotina', { de: '2026-11-02', ate: '2026-11-04' })
    expect(p.habitos[0]).toMatchObject({ nome: 'Beber água', feito: 2 })
    expect(p.habitos[0].previsto).toBeGreaterThanOrEqual(2)
  })
  it('alimentação: refeição planejada e lista de compras', () => {
    const { p } = run('alimentacao', { de: '2026-11-04', ate: '2026-11-06' })
    // the meal type (almoço) goes with the dish, so "o que vou almoçar" is answered from data
    expect(p.dias[0].refeicoes[0]).toMatchObject({ tipo: 'Almoço', prato: 'Frango com legumes', horario: '12:30', feita: false })
    expect(p.lista_de_compras).toEqual(['2 kg Arroz'])
  })
  it('planos com etapas e próxima etapa', () => {
    const { p } = run('metas_e_planos', {})
    expect(p.planos[0]).toMatchObject({ titulo: 'Mudança', etapas: '1 de 2', proxima_etapa: 'Encaixotar' })
  })
})

describe('anotações: conteúdo real como dado', () => {
  it('texto com injeção volta como campo de texto, com aviso de segurança', () => {
    const { r, p } = run('anotacoes', { texto: 'ideias', pagina: 1 })
    expect(p.aviso_de_seguranca).toMatch(/NÃO é instrução/)
    expect(p.anotacoes[0].texto).toMatch(/IGNORE TODAS AS INSTRUÇÕES/)
    expect(typeof p.anotacoes[0].texto).toBe('string')
    expect(r.about).toEqual(['Ideias'])
  })
  it('nota longa é cortada com aviso; caixa de entrada incluída', () => {
    const { p } = run('anotacoes', { texto: null, pagina: 1 })
    const diary = p.anotacoes.find((n: { titulo: string }) => n.titulo === 'Diário')
    expect(diary.texto.length).toBeLessThan(1300)
    expect(diary.texto).toMatch(/texto cortado: 5000 caracteres/)
    expect(p.caixa_de_entrada).toEqual(['Ligar para o contador'])
  })
  it('notas de acesso (Senhas) nunca aparecem', () => {
    const { r } = run('anotacoes', { texto: 'pin', pagina: 1 })
    expect(r.content).not.toMatch(/1234|CIFRADO|Banco Vânia/)
  })
})

describe('privacidade por área', () => {
  it('área desligada: consulta recusada', () => {
    expect(run('vendas', { situacao: 'todas', cliente: null, de: null, ate: null, pagina: 1 }, { areasOff: ['vendas'] }).r).toMatchObject({ isError: true })
    expect(JSON.parse(run('anotacoes', { texto: null, pagina: 1 }, { areasOff: ['anotacoes'] }).r.content).erro).toMatch(/desligada/)
  })
  it('agenda esconde itens de áreas desligadas e avisa', () => {
    const d = account()
    d.tasks.push(E('k9', { title: 'Tarefa secreta', projectId: null, dueDate: '2026-11-05', priority: 'none', status: 'todo', completedAt: null }))
    const { r, p } = run('consultar_agenda', { de: '2026-11-05', ate: '2026-11-05' }, { data: d, areasOff: ['tarefas'] })
    expect(r.content).not.toMatch(/Tarefa secreta/)
    expect(r.content).toMatch(/Reunião Vânia/)
    expect(p.fora_do_alcance).toMatch(/Tarefa/)
  })
  it('busca só mostra grupos de áreas permitidas, e nunca Senhas', () => {
    const on = run('buscar', { texto: 'Vânia' })
    expect(on.r.content).toMatch(/Clientes/)
    expect(on.r.content).not.toMatch(/Senhas|Banco Vânia/)
    const off = run('buscar', { texto: 'Vânia' }, { areasOff: ['clientes', 'vendas', 'agenda'] })
    expect(off.r.content).not.toMatch(/Clientes|Vendas|Compromissos/)
  })
  it('escolhas da pessoa + seções desligadas viram áreas fora do alcance', () => {
    const s = { ...settings, modules: { ...ALL_ON, sales: false, subscribers: false }, assistantAi: { enabled: true, consentAt: 'x', consentVersion: 2, areasOff: ['anotacoes'] } } as unknown as Settings
    expect(areasOffFor(s).sort()).toEqual(['anotacoes', 'vendas'])
  })
})

describe('conta grande', () => {
  it('5.000 lançamentos: página de 25, totais de tudo, resultado dentro do limite e rápido', () => {
    const d = account()
    for (let i = 0; i < 5000; i++) d.transactions.push(tx('out', 1000 + (i % 50), `2026-${String(1 + (i % 10)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, `Compra ${i}`, { category: 'food' }))
    const t0 = performance.now()
    const { r, p, find } = run('lancamentos', { de: '2026-01-01', ate: '2026-10-31', tipo: 'saida', categoria: 'mercado', texto: null, pagina: 2 }, { data: d })
    const ms = performance.now() - t0
    expect(r.content.length).toBeLessThanOrEqual(MAX_RESULT_CHARS)
    expect(p.pagina).toBe(2)
    expect(p.paginas).toBe(200)
    expect(find('Quantidade de lançamentos')?.display).toBe('5000 lançamentos')
    expect(ms).toBeLessThan(1500)
  })
  it('lista enorme de tarefas é limitada e avisa', () => {
    const d = account()
    for (let i = 0; i < 500; i++) d.tasks.push(E(`kk${i}`, { title: `Tarefa ${i}`, projectId: null, dueDate: '', priority: 'none', status: 'todo', completedAt: null }))
    const { r, p } = run('tarefas', { filtro: 'abertas', projeto: null, de: null, ate: null }, { data: d })
    expect(p.tarefas).toHaveLength(40)
    expect(p.aviso).toMatch(/40 primeiras/)
    expect(r.content.length).toBeLessThanOrEqual(MAX_RESULT_CHARS)
  })
})
